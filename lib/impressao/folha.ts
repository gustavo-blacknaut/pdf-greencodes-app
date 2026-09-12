'use client';

/**
 * Monta a folha inteira como imagem, do tamanho exato do papel.
 *
 * Antes, cada página ia para a impressora como uma imagem solta e quem
 * decidia o tamanho era o outro lado — o CSS da janela escondida, depois o
 * driver. Duas medidas para a mesma folha, e quando discordavam o driver
 * encolhia o trabalho para caber: uma fatura A4 saía do tamanho de uma A5, no
 * meio do papel.
 *
 * Agora só existe uma medida. A folha é desenhada aqui, em milímetros, com a
 * arte já escalada, deslocada, espelhada e marcada dentro dela. O outro lado
 * recebe uma imagem na proporção exata do papel e só precisa dizer ao Windows
 * qual papel é — não sobra o que negociar.
 *
 * A conta de onde a arte cai é a de `layout.ts`, a mesma que a prévia usa.
 * Prévia que mostra uma coisa e papel que sai outra é pior que não ter prévia.
 */

import {
  aplicarNosPixels,
  ajustesDe,
  medidaGirada,
  raioDaNitidez,
  temAjuste,
  type Ajustes,
} from './ajustes';
import {
  bordaNaFolha,
  folhaEmMm,
  marcasDeCorte,
  marcasDeRegistro,
  passaDaFolha,
  posicionar,
  sobra,
  type BordaDaImpressora,
  type Caixa,
  type Medida,
  type ModoDeEscala,
} from './layout';

export type Espelho = 'nao' | 'horizontal' | 'vertical';

export type Orientacao = 'auto' | 'retrato' | 'paisagem';

export type Montagem = {
  papel: string;
  paisagem: boolean;
  /**
   * Automática deita a folha quando a página é mais larga que alta, página a
   * página. Sem isto, vale `paisagem`.
   */
  orientacao?: Orientacao;
  /** Falso manda a folha em tons de cinza: é o que garante preto e branco. */
  colorido?: boolean;
  /** Resolução do desenho. Vai até 600, contido pelo teto de pixels da folha. */
  dpi: number;
  escala: ModoDeEscala;
  porcento?: number;
  deslocaX?: number;
  deslocaY?: number;
  margemLados?: number;
  margemCima?: number;
  espelho?: Espelho;
  negativo?: boolean;
  marcasCorte?: boolean;
  marcasRegistro?: boolean;
  /** A beirada que a impressora escolhida não alcança. Vem do driver. */
  borda?: BordaDaImpressora;
  /** Brilho, contraste, cor, nitidez e giro desta arte. */
  ajustes?: Ajustes;
};

/** O que a arte mede de verdade, em milímetros. */
export type Arte = Medida;

export type Plano = {
  /** A folha em pixels, que vira o tamanho do canvas. */
  folha: { largura: number; altura: number };
  /** Onde a arte entra, em pixels. */
  arte: { x: number; y: number; largura: number; altura: number };
  pontosPorMm: number;
};

const ESPESSURA_DA_MARCA_MM = 0.25;
const COMPRIMENTO_DA_MARCA_MM = 4;
const VAO_DA_MARCA_MM = 2;
const RAIO_DO_ALVO_MM = 1.5;
const AFASTAMENTO_DO_ALVO_MM = 6;

/**
 * O teto do desenho: 600 DPI, a melhor qualidade que a laser comum aproveita.
 *
 * O teto de verdade é de pixels, e não de DPI. Uma A4 a 600 DPI são 35
 * megapixels — duas telas dessas (a página e a folha) ficam em uns 280 MB,
 * que uma máquina de 4 GB aguenta. Uma A3 a 600 daria 70, então papel maior
 * desce sozinho até caber: a A3 sai a uns 430 DPI.
 */
export const DPI_MAXIMO = 600;
const PIXELS_MAXIMOS_DA_FOLHA = 36_000_000;

/**
 * O teto cai pela metade em máquina de 4 GB.
 *
 * As máquinas da loja são i3 antigos: duas telas de 35 megapixels são uns
 * 280 MB só de pixel, e aí o navegador derruba a aba no meio da impressão.
 * Metade disso ainda dá mais de 400 DPI numa A4 — acima dos 300 em que a
 * diferença já não sai do papel.
 */
export function cabeNaMemoria(pixels: number): number {
  const memoria = typeof navigator === 'undefined' ? undefined : (navigator as { deviceMemory?: number }).deviceMemory;
  return memoria && memoria <= 4 ? pixels / 2 : pixels;
}

export function resolucao(dpi: unknown): number {
  const lido = Number(dpi);
  if (!Number.isFinite(lido) || lido <= 0) return DPI_MAXIMO;
  return Math.min(Math.max(lido, 72), DPI_MAXIMO);
}

/** O DPI que a folha aguenta sem passar do teto de pixels. */
function dpiQueCabe(folha: Medida): number {
  const polegadas = (folha.largura / 25.4) * (folha.altura / 25.4);
  return Math.floor(Math.sqrt(cabeNaMemoria(PIXELS_MAXIMOS_DA_FOLHA) / polegadas));
}

/**
 * A folha sai deitada?
 *
 * No automático, quem decide é a página: mais larga que alta, deita — como a
 * impressora do navegador faz. Assim um PDF com páginas em pé e deitadas
 * misturadas sai cada uma do jeito certo, sem ninguém escolher.
 */
export function folhaDeitada(montagem: Pick<Montagem, 'orientacao' | 'paisagem'>, arte: Arte): boolean {
  if (montagem.orientacao === 'paisagem') return true;
  if (montagem.orientacao === 'retrato') return false;
  if (montagem.orientacao === 'auto') return arte.largura > arte.altura;
  return Boolean(montagem.paisagem);
}

/**
 * A folha e onde a arte cai nela, em milímetros. A prévia e a impressão
 * usam esta mesma conta.
 *
 * No "ajustar à página" a arte cabe dentro do que a impressora alcança, como
 * a impressão do navegador faz: margem menor que a beirada física cortaria a
 * borda do documento. Nos outros modos a medida é de quem pediu — tamanho
 * original é tamanho original —, e a prévia só mostra a beirada tracejada.
 */
export function montarFolha(arteOriginal: Arte, montagem: Montagem) {
  // A arte girada é a que conta para tudo daqui para baixo: uma foto em pé
  // girada 90 graus é uma arte deitada, e é ela que decide a folha.
  const arte = medidaGirada(arteOriginal, montagem.ajustes?.girar ?? 0);
  const deitada = folhaDeitada(montagem, arte);
  const folha = folhaEmMm(montagem.papel, deitada);
  const borda = bordaNaFolha(montagem.borda, deitada);
  const cabeInteira = (montagem.escala ?? 'pagina') === 'pagina';

  const caixa = posicionar(folha, arte, {
    escala: montagem.escala,
    porcento: montagem.porcento,
    deslocaX: montagem.deslocaX,
    deslocaY: montagem.deslocaY,
    margemLados: cabeInteira ? Math.max(montagem.margemLados ?? 0, borda.lados) : montagem.margemLados,
    margemCima: cabeInteira ? Math.max(montagem.margemCima ?? 0, borda.cima) : montagem.margemCima,
  });
  return { folha, caixa, borda, deitada };
}

/** O que dizer antes de imprimir: arte fora do papel, ou na beirada que não sai. */
export function avisoDaFolha(arte: Arte, montagem: Montagem): string | null {
  const { folha, caixa, borda } = montarFolha(arte, montagem);
  const maior = (fora: ReturnType<typeof sobra>) =>
    Math.max(fora.esquerda, fora.direita, fora.cima, fora.baixo).toFixed(1);

  if (passaDaFolha(folha, caixa)) {
    return `A arte passa da folha em até ${maior(sobra(folha, caixa))} mm. O que fica de fora não sai impresso.`;
  }
  if (!borda.lados && !borda.cima) return null;

  const alcance = { largura: folha.largura - borda.lados * 2, altura: folha.altura - borda.cima * 2 };
  const dentro = { ...caixa, x: caixa.x - borda.lados, y: caixa.y - borda.cima };
  if (!passaDaFolha(alcance, dentro)) return null;
  return `Até ${maior(sobra(alcance, dentro))} mm da arte caem na beirada que esta impressora não alcança (o tracejado da prévia) e podem sair cortados.`;
}

/**
 * A geometria da folha, sem tocar em canvas nenhum.
 *
 * Separada do desenho para poder ser conferida sozinha: é aqui que mora a
 * diferença entre a arte no tamanho certo e a arte encolhida no meio.
 */
export function planoDaFolha(arte: Arte, montagem: Montagem): Plano {
  const { folha, caixa } = montarFolha(arte, montagem);
  const dpi = Math.min(resolucao(montagem.dpi), dpiQueCabe(folha));
  const pontosPorMm = dpi / 25.4;

  return {
    folha: {
      largura: Math.max(1, Math.round(folha.largura * pontosPorMm)),
      altura: Math.max(1, Math.round(folha.altura * pontosPorMm)),
    },
    arte: {
      x: caixa.x * pontosPorMm,
      y: caixa.y * pontosPorMm,
      largura: Math.max(1, caixa.largura * pontosPorMm),
      altura: Math.max(1, caixa.altura * pontosPorMm),
    },
    pontosPorMm,
  };
}

/**
 * Desenha a folha pronta para imprimir.
 *
 * `origem` é a página já rasterizada; `arte` é quanto ela mede de verdade, em
 * milímetros. As duas coisas são separadas de propósito: o tamanho do raster
 * depende da resolução do desenho, o tamanho da arte não — é o que está
 * escrito no PDF, e é ele que manda quando alguém pede "tamanho original".
 */
export function desenharFolha(
  origem: CanvasImageSource,
  arte: Arte,
  montagem: Montagem,
  destino: HTMLCanvasElement,
): Plano {
  const plano = planoDaFolha(arte, montagem);

  destino.width = plano.folha.largura;
  destino.height = plano.folha.altura;

  const pincel = destino.getContext('2d', { alpha: false });
  if (!pincel) throw new Error('Seu navegador bloqueou o canvas 2D, necessário para imprimir.');

  pincel.fillStyle = '#ffffff';
  pincel.fillRect(0, 0, destino.width, destino.height);
  pincel.imageSmoothingEnabled = true;
  pincel.imageSmoothingQuality = 'high';

  desenharArte(pincel, origem, plano, montagem);

  if (montagem.marcasCorte || montagem.marcasRegistro) {
    desenharMarcas(pincel, plano, montagem);
  }

  return plano;
}

function desenharArte(
  pincel: CanvasRenderingContext2D,
  origem: CanvasImageSource,
  plano: Plano,
  montagem: Montagem,
): void {
  const { x, y, largura, altura } = plano.arte;

  pincel.save();

  // O espelho vira o eixo em torno do centro da própria arte: espelhar em
  // torno do centro da folha moveria o trabalho de lugar, e quem imprime
  // transfer quer a mesma posição, ao contrário.
  if (montagem.espelho === 'horizontal' || montagem.espelho === 'vertical') {
    const centroX = x + largura / 2;
    const centroY = y + altura / 2;
    pincel.translate(centroX, centroY);
    pincel.scale(
      montagem.espelho === 'horizontal' ? -1 : 1,
      montagem.espelho === 'vertical' ? -1 : 1,
    );
    pincel.translate(-centroX, -centroY);
  }

  // O giro é em torno do centro da arte, como o espelho. A imagem entra
  // deitada na caixa já girada: por isso as medidas trocam no 90 e no 270.
  const girar = montagem.ajustes?.girar ?? 0;
  if (girar) {
    pincel.translate(x + largura / 2, y + altura / 2);
    pincel.rotate((girar * Math.PI) / 180);
    const [l, a] = girar === 90 || girar === 270 ? [altura, largura] : [largura, altura];
    pincel.translate(-l / 2, -a / 2);
    // Negativo só na arte, e não na folha: o papel em volta continua branco
    // porque é papel, e não parte do fotolito.
    if (montagem.negativo) pincel.filter = 'invert(1)';
    pincel.drawImage(origem, 0, 0, l, a);
  } else {
    if (montagem.negativo) pincel.filter = 'invert(1)';
    pincel.drawImage(origem, x, y, largura, altura);
  }
  pincel.restore();

  // Cor, luz e nitidez saem sobre os pixels já desenhados, com a mesma conta
  // da prévia. O "preto e branco" da fila entra aqui como tons de cinza: o
  // driver que ignora o "sem cor" não tem mais cor para imprimir.
  const ajustes = ajustesDe({
    ...montagem.ajustes,
    cinza: montagem.ajustes?.cinza || montagem.colorido === false,
  });
  if (temAjuste(ajustes)) {
    ajustarArea(pincel, plano.arte, plano.pontosPorMm, ajustes);
  }
}

/**
 * Os mesmos ajustes num canvas inteiro: é o que a prévia usa, onde o canvas
 * é só a arte. `pixelsPorMm` é a resolução daquele desenho, e é ela que dá à
 * nitidez o mesmo tamanho de raio que ela terá no papel.
 */
export function ajustarCanvas(tela: HTMLCanvasElement, ajustes: Ajustes, pixelsPorMm: number): void {
  if (!temAjuste(ajustes) || !tela.width || !tela.height) return;
  const pincel = tela.getContext('2d', { willReadFrequently: true });
  if (!pincel) return;
  ajustarArea(pincel, { x: 0, y: 0, largura: tela.width, altura: tela.height }, pixelsPorMm, ajustes);
}

/**
 * Aplica os ajustes só onde a arte caiu, em faixas.
 *
 * Em faixas porque uma A4 a 600 DPI são 35 milhões de pixels: pedir a imagem
 * inteira de uma vez, mais o borrão da nitidez, passaria de meio gigabyte e
 * derrubaria a janela justamente na máquina fraca. Cada faixa leva uma sobra
 * em cima e embaixo, do tamanho do raio, para a nitidez não marcar a emenda.
 */
function ajustarArea(
  pincel: CanvasRenderingContext2D,
  area: { x: number; y: number; largura: number; altura: number },
  pixelsPorMm: number,
  ajustes: Ajustes,
): void {
  const tela = pincel.canvas;
  const x = Math.max(0, Math.floor(area.x));
  const y = Math.max(0, Math.floor(area.y));
  const largura = Math.min(tela.width - x, Math.ceil(area.largura + (area.x - x)));
  const altura = Math.min(tela.height - y, Math.ceil(area.altura + (area.y - y)));
  if (largura <= 0 || altura <= 0) return;

  const sobra = ajustes.nitidez > 0 ? raioDaNitidez(pixelsPorMm) + 1 : 0;
  const porFaixa = Math.max(1, Math.floor(4_000_000 / largura));

  for (let inicio = 0; inicio < altura; inicio += porFaixa) {
    const de = Math.max(0, inicio - sobra);
    const ate = Math.min(altura, inicio + porFaixa + sobra);
    const faixa = pincel.getImageData(x, y + de, largura, ate - de);
    aplicarNosPixels(faixa.data, largura, ate - de, ajustes, pixelsPorMm);
    // Devolve só o miolo: as sobras existiram para o borrão, e as delas
    // mesmas saíram sem vizinho de um dos lados.
    pincel.putImageData(faixa, x, y + de, 0, inicio - de, largura, Math.min(porFaixa, altura - inicio));
  }
}

function desenharMarcas(
  pincel: CanvasRenderingContext2D,
  plano: Plano,
  montagem: Montagem,
): void {
  const mm = plano.pontosPorMm;
  const caixaEmMm: Caixa = {
    x: plano.arte.x / mm,
    y: plano.arte.y / mm,
    largura: plano.arte.largura / mm,
    altura: plano.arte.altura / mm,
  };

  pincel.save();
  pincel.fillStyle = '#000000';
  pincel.strokeStyle = '#000000';

  if (montagem.marcasCorte) {
    const espessura = Math.max(1, ESPESSURA_DA_MARCA_MM * mm);
    for (const traco of marcasDeCorte(caixaEmMm, COMPRIMENTO_DA_MARCA_MM, VAO_DA_MARCA_MM)) {
      const x1 = Math.min(traco.x1, traco.x2) * mm;
      const y1 = Math.min(traco.y1, traco.y2) * mm;
      const comprimento = Math.abs(traco.x2 - traco.x1) * mm;
      const altura = Math.abs(traco.y2 - traco.y1) * mm;
      pincel.fillRect(
        x1 - (comprimento === 0 ? espessura / 2 : 0),
        y1 - (altura === 0 ? espessura / 2 : 0),
        comprimento === 0 ? espessura : comprimento,
        altura === 0 ? espessura : altura,
      );
    }
  }

  if (montagem.marcasRegistro) {
    const espessura = Math.max(1, (ESPESSURA_DA_MARCA_MM * mm) / 1.5);
    const raio = RAIO_DO_ALVO_MM * mm;
    const braco = raio + 1 * mm;
    pincel.lineWidth = espessura;

    for (const alvo of marcasDeRegistro(caixaEmMm, AFASTAMENTO_DO_ALVO_MM)) {
      const cx = alvo.x * mm;
      const cy = alvo.y * mm;

      pincel.beginPath();
      pincel.arc(cx, cy, raio, 0, Math.PI * 2);
      pincel.stroke();

      pincel.beginPath();
      pincel.moveTo(cx - braco, cy);
      pincel.lineTo(cx + braco, cy);
      pincel.moveTo(cx, cy - braco);
      pincel.lineTo(cx, cy + braco);
      pincel.stroke();
    }
  }

  pincel.restore();
}

/** O tamanho de uma página de PDF em milímetros, a partir dos pontos dela. */
export function pontosParaMm(pontos: number): number {
  return (pontos / 72) * 25.4;
}
