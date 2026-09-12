/**
 * Os ajustes de imagem da impressão: brilho, contraste, cor e nitidez.
 *
 * A conta mora aqui, sozinha e sem canvas, porque duas telas precisam dela e
 * precisam concordar até o último pixel: a prévia, que mostra a folha, e a
 * folha de verdade, que vai para a impressora. Prévia que mostra uma coisa e
 * papel que sai outra é pior que não ter prévia.
 *
 * Tudo é feito sobre os pixels, e não com o `filter` do canvas: o filtro do
 * navegador não tem temperatura de cor nem máscara de nitidez, e o pouco que
 * tem arredonda de um jeito na tela e de outro no desenho grande. Uma conta
 * só, aplicada nos dois lugares, é o que garante que o papel saia igual.
 */

export type Ajustes = {
  /** -100 a 100. Soma luz, sem mexer no contraste. */
  brilho: number;
  /** -100 a 100. Afasta claro e escuro do meio. */
  contraste: number;
  /** -100 (cinza) a 100 (cor forte). */
  saturacao: number;
  /** -100 (frio, azulado) a 100 (quente, alaranjado). */
  temperatura: number;
  /** -100 a 100, que são dois pontos de luz para cada lado, como na câmera. */
  exposicao: number;
  /** 0 a 100. Máscara de nitidez: realça a borda sem inventar detalhe. */
  nitidez: number;
  /** Tons de cinza só desta imagem. */
  cinza: boolean;
  /** Giro em graus, no sentido do relógio. */
  girar: 0 | 90 | 180 | 270;
};

export const AJUSTES_NEUTROS: Ajustes = {
  brilho: 0,
  contraste: 0,
  saturacao: 0,
  temperatura: 0,
  exposicao: 0,
  nitidez: 0,
  cinza: false,
  girar: 0,
};

/** Tem alguma coisa para fazer, ou a imagem passa direto? */
export function temAjuste(a: Ajustes): boolean {
  return (
    a.brilho !== 0 ||
    a.contraste !== 0 ||
    a.saturacao !== 0 ||
    a.temperatura !== 0 ||
    a.exposicao !== 0 ||
    a.nitidez > 0 ||
    a.cinza
  );
}

/** Completa o que faltar com o neutro: opção guardada de uma versão antiga não quebra. */
export function ajustesDe(valor: Partial<Ajustes> | undefined | null): Ajustes {
  return { ...AJUSTES_NEUTROS, ...(valor ?? {}) };
}

const limitar = (valor: number, minimo: number, maximo: number) => Math.min(Math.max(valor, minimo), maximo);

/**
 * As tabelas de 256 valores de cada canal.
 *
 * Exposição, temperatura, brilho e contraste são conta de um canal só, então
 * cabem numa tabela pronta: em vez de refazer cinco operações em cada um dos
 * 35 milhões de pixels de uma folha A4 a 600 DPI, olha-se o valor na tabela.
 */
export function tabelasDeCor(a: Ajustes): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] {
  // Exposição em pontos de luz, como na câmera: cada ponto dobra a luz.
  const luz = Math.pow(2, limitar(a.exposicao, -100, 100) / 50);
  // Quente sobe o vermelho e baixa o azul; frio faz o contrário. O verde
  // fica quieto, que é o que mantém a pele parecendo pele.
  const temperatura = limitar(a.temperatura, -100, 100) / 100;
  const ganho = [luz * (1 + temperatura * 0.3), luz, luz * (1 - temperatura * 0.3)];
  const brilho = (limitar(a.brilho, -100, 100) / 100) * 255 * 0.5;
  // 100 de contraste dobra a distância até o meio; -100 achata tudo no cinza.
  const contraste = 1 + limitar(a.contraste, -100, 100) / 100;

  return [0, 1, 2].map((canal) => {
    const tabela = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v += 1) {
      const comLuz = v * ganho[canal] + brilho;
      tabela[v] = (comLuz - 128) * contraste + 128;
    }
    return tabela;
  }) as [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
}

/** O cinza que o olho enxerga, e não a média dos três canais. */
export const luminancia = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Aplica cor e luz nos pixels, no lugar.
 *
 * Ordem: luz e cor primeiro (tabela), saturação depois — saturar antes de
 * corrigir a temperatura exageraria justamente o desvio que a temperatura
 * está consertando.
 */
export function pintarPixels(pixels: Uint8ClampedArray, a: Ajustes): void {
  const [tr, tg, tb] = tabelasDeCor(a);
  const satura = 1 + limitar(a.saturacao, -100, 100) / 100;
  const mexeNaSaturacao = a.cinza || satura !== 1;

  for (let i = 0; i < pixels.length; i += 4) {
    let r = tr[pixels[i]];
    let g = tg[pixels[i + 1]];
    let b = tb[pixels[i + 2]];

    if (mexeNaSaturacao) {
      const cinza = luminancia(r, g, b);
      const forca = a.cinza ? 0 : satura;
      r = cinza + (r - cinza) * forca;
      g = cinza + (g - cinza) * forca;
      b = cinza + (b - cinza) * forca;
    }

    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  }
}

/**
 * Máscara de nitidez: a imagem menos uma cópia borrada dela.
 *
 * O raio acompanha a resolução do desenho. Sem isso, a mesma nitidez que na
 * prévia (uns 4 pixels por milímetro) vira quase nada na folha a 600 DPI (24
 * por milímetro), e a pessoa ajustaria olhando uma coisa e imprimindo outra.
 */
export function raioDaNitidez(pixelsPorMm: number): number {
  return Math.max(1, Math.round(pixelsPorMm / 4));
}

export function afiar(
  pixels: Uint8ClampedArray,
  largura: number,
  altura: number,
  forca: number,
  pixelsPorMm: number,
): void {
  if (forca <= 0 || largura < 3 || altura < 3) return;
  const raio = raioDaNitidez(pixelsPorMm);
  const borrado = borrarEmCaixa(pixels, largura, altura, raio);
  const quanto = limitar(forca, 0, 100) / 100;

  for (let i = 0; i < pixels.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const original = pixels[i + c];
      pixels[i + c] = original + (original - borrado[i + c]) * quanto * 1.5;
    }
  }
}

/**
 * Borrão de caixa, separado em duas passadas com soma corrente.
 *
 * O custo não depende do raio: é o que permite borrar uma folha de 35
 * megapixels sem a janela parar.
 */
function borrarEmCaixa(pixels: Uint8ClampedArray, largura: number, altura: number, raio: number): Uint8ClampedArray {
  const meio = new Float32Array(pixels.length);
  const saida = new Uint8ClampedArray(pixels.length);
  const janela = raio * 2 + 1;

  for (let y = 0; y < altura; y += 1) {
    const linha = y * largura * 4;
    for (let c = 0; c < 3; c += 1) {
      let soma = 0;
      for (let x = -raio; x <= raio; x += 1) soma += pixels[linha + limitar(x, 0, largura - 1) * 4 + c];
      for (let x = 0; x < largura; x += 1) {
        meio[linha + x * 4 + c] = soma / janela;
        const sai = linha + limitar(x - raio, 0, largura - 1) * 4 + c;
        const entra = linha + limitar(x + raio + 1, 0, largura - 1) * 4 + c;
        soma += pixels[entra] - pixels[sai];
      }
    }
  }

  for (let x = 0; x < largura; x += 1) {
    for (let c = 0; c < 3; c += 1) {
      let soma = 0;
      for (let y = -raio; y <= raio; y += 1) soma += meio[limitar(y, 0, altura - 1) * largura * 4 + x * 4 + c];
      for (let y = 0; y < altura; y += 1) {
        saida[y * largura * 4 + x * 4 + c] = soma / janela;
        const sai = limitar(y - raio, 0, altura - 1) * largura * 4 + x * 4 + c;
        const entra = limitar(y + raio + 1, 0, altura - 1) * largura * 4 + x * 4 + c;
        soma += meio[entra] - meio[sai];
      }
    }
  }
  return saida;
}

/** Tudo junto, sobre os pixels de uma imagem já desenhada. */
export function aplicarNosPixels(
  pixels: Uint8ClampedArray,
  largura: number,
  altura: number,
  ajustes: Ajustes,
  pixelsPorMm: number,
): void {
  pintarPixels(pixels, ajustes);
  afiar(pixels, largura, altura, ajustes.nitidez, pixelsPorMm);
}

/** A medida da arte depois do giro: 90 e 270 trocam largura por altura. */
export function medidaGirada<T extends { largura: number; altura: number }>(medida: T, girar: number): T {
  return girar === 90 || girar === 270 ? { ...medida, largura: medida.altura, altura: medida.largura } : medida;
}
