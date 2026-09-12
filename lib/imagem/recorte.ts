/**
 * A geometria da área que a pessoa marca com o mouse.
 *
 * Fica fora do componente de propósito: arrastar canto é a parte que erra
 * sozinha — inverte quando passa do outro lado, escapa da imagem, quebra a
 * proporção travada — e nada disso se confere de olho na tela. Aqui é número
 * entrando e número saindo, e o teste mede.
 *
 * Tudo em **pixels da imagem de origem**, nunca em pixels de tela: é o que o
 * corte recebe, e é por isso que o que sai é exatamente o que estava marcado.
 */

export type Recorte = { x: number; y: number; largura: number; altura: number };
export type Medida = { largura: number; altura: number };

/** Os oito pontos de pegar: cantos e meios de lado. */
export type Alca = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * O menor recorte que ainda faz sentido, em pixels de origem.
 *
 * Menos que isso é quase sempre a mão tremendo, não a intenção — e um recorte
 * de 2 pixels não tem como ser conferido na tela.
 */
export const MINIMO = 16;

const inteiro = (n: number) => Math.round(n);

/** A proporção pedida, como número, ou nada quando é livre. */
export function proporcaoDe(escolha: string): number | undefined {
  const [l, a] = String(escolha).split('x').map(Number);
  return l > 0 && a > 0 ? l / a : undefined;
}

/** A imagem toda, que é por onde todo recorte começa. */
export function recorteInteiro(imagem: Medida): Recorte {
  return { x: 0, y: 0, largura: inteiro(imagem.largura), altura: inteiro(imagem.altura) };
}

/**
 * Encaixa o recorte dentro da imagem, sem deixar virar do avesso.
 *
 * Com proporção travada, o que estoura **encolhe** em vez de ser cortado num
 * lado só: cortar um lado mudaria a proporção, que é justamente o que a trava
 * promete não deixar acontecer.
 */
export function limitar(recorte: Recorte, imagem: Medida, proporcao?: number): Recorte {
  const minimo = Math.min(MINIMO, imagem.largura, imagem.altura);
  let largura = Math.min(Math.abs(recorte.largura), imagem.largura);
  let altura = Math.min(Math.abs(recorte.altura), imagem.altura);

  if (proporcao) {
    if (largura / altura > proporcao) largura = altura * proporcao;
    else altura = largura / proporcao;
  }

  largura = Math.max(minimo, largura);
  altura = Math.max(minimo, altura);
  const x = Math.min(Math.max(0, recorte.x), imagem.largura - largura);
  const y = Math.min(Math.max(0, recorte.y), imagem.altura - altura);

  return { x: inteiro(x), y: inteiro(y), largura: inteiro(largura), altura: inteiro(altura) };
}

/** Arrasta o recorte inteiro, sem mudar de tamanho. */
export function mover(recorte: Recorte, dx: number, dy: number, imagem: Medida): Recorte {
  return limitar({ ...recorte, x: recorte.x + dx, y: recorte.y + dy }, imagem);
}

/**
 * Puxa uma alça.
 *
 * A âncora é sempre o lado oposto ao que está sendo puxado: arrastar o canto
 * de cima à esquerda mexe nesse canto e deixa o de baixo à direita onde está.
 * Nas alças de lado com proporção travada, o outro eixo cresce para os dois
 * lados — senão o recorte andaria sozinho enquanto só se pedia largura.
 */
export function redimensionar(
  recorte: Recorte,
  alca: Alca,
  dx: number,
  dy: number,
  imagem: Medida,
  proporcao?: number,
): Recorte {
  const minimo = Math.min(MINIMO, imagem.largura, imagem.altura);
  let esquerda = recorte.x;
  let topo = recorte.y;
  let direita = recorte.x + recorte.largura;
  let base = recorte.y + recorte.altura;

  if (alca.includes('w')) esquerda += dx;
  if (alca.includes('e')) direita += dx;
  if (alca.includes('n')) topo += dy;
  if (alca.includes('s')) base += dy;

  // Passou do outro lado: em vez de virar do avesso, para no mínimo.
  if (direita - esquerda < minimo) {
    if (alca.includes('w')) esquerda = direita - minimo;
    else direita = esquerda + minimo;
  }
  if (base - topo < minimo) {
    if (alca.includes('n')) topo = base - minimo;
    else base = topo + minimo;
  }

  if (proporcao) {
    const ehLadoVertical = alca === 'n' || alca === 's';
    const ehLadoHorizontal = alca === 'e' || alca === 'w';
    let largura = direita - esquerda;
    let altura = base - topo;

    if (ehLadoVertical) largura = altura * proporcao;
    else altura = largura / proporcao;

    if (ehLadoVertical) {
      const centro = (esquerda + direita) / 2;
      esquerda = centro - largura / 2;
      direita = centro + largura / 2;
      if (alca === 'n') topo = base - altura;
      else base = topo + altura;
    } else if (ehLadoHorizontal) {
      const centro = (topo + base) / 2;
      topo = centro - altura / 2;
      base = centro + altura / 2;
      if (alca === 'w') esquerda = direita - largura;
      else direita = esquerda + largura;
    } else {
      if (alca.includes('w')) esquerda = direita - largura;
      else direita = esquerda + largura;
      if (alca.includes('n')) topo = base - altura;
      else base = topo + altura;
    }
  }

  return limitar({ x: esquerda, y: topo, largura: direita - esquerda, altura: base - topo }, imagem, proporcao);
}

/** O maior recorte daquela proporção, centrado — o que "aparar pelo centro" faz. */
export function naProporcao(imagem: Medida, proporcao: number): Recorte {
  const atual = imagem.largura / imagem.altura;
  const largura = atual > proporcao ? imagem.altura * proporcao : imagem.largura;
  const altura = atual > proporcao ? imagem.altura : imagem.largura / proporcao;
  return limitar(
    { x: (imagem.largura - largura) / 2, y: (imagem.altura - altura) / 2, largura, altura },
    imagem,
    proporcao,
  );
}

/** A mesma marcação numa imagem de outro tamanho, guardando as proporções. */
export function proporcional(recorte: Recorte, de: Medida, para: Medida): Recorte {
  const escalaX = para.largura / de.largura;
  const escalaY = para.altura / de.altura;
  return limitar(
    {
      x: recorte.x * escalaX,
      y: recorte.y * escalaY,
      largura: recorte.largura * escalaX,
      altura: recorte.altura * escalaY,
    },
    para,
  );
}

/** Quanto o recorte mede no papel, em milímetros, naquela resolução. */
export function emMilimetros(pixels: number, dpi: number): number {
  return (pixels / Math.max(1, dpi)) * 25.4;
}
