'use client';

/**
 * O que a gráfica faz depois que a arte fica pronta.
 *
 * Nada aqui mexe no desenho: é montagem de folha, marca de corte e numeração
 * — o serviço entre aprovar a arte e mandar para a máquina. Tudo em pdf-lib,
 * sem rasterizar, porque isto também roda no site.
 *
 * Milímetro é a unidade de quem trabalha com papel. A conversão para ponto
 * (1/72 de polegada) acontece só na hora de desenhar.
 */

import { FORMATOS_MM, mmParaPt, openWithPdfLib, salvarPdf, sanitizeText } from '../nucleo';
import type { RunContext, RunResult } from '../tipos';
import { suffixName, yieldToBrowser } from '../../utils';
import { hexParaRgb } from '../layout';
import { loadPdfLib } from '../lazy';

/** Teto de páginas na saída. Numerar é multiplicar, e engano é fácil. */
const MAX_PAGINAS_GERADAS = 5000;

const PT_POR_MM = 72 / 25.4;
const emMm = (pt: number) => Math.round((pt / PT_POR_MM) * 10) / 10;

export function limitar(valor: unknown, minimo: number, maximo: number, padrao: number): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.min(Math.max(numero, minimo), maximo);
}

export function ligado(valor: unknown, padrao: boolean): boolean {
  if (valor === undefined || valor === null || valor === '') return padrao;
  return valor === true || valor === 'true';
}

/** O papel escolhido, em pontos, já deitado se for o caso. */
export function folhaEmPontos(opcoes: Record<string, string | number | boolean>): { largura: number; altura: number } {
  const nome = String(opcoes.papel ?? 'a4');
  const medida = FORMATOS_MM[nome as keyof typeof FORMATOS_MM] ?? FORMATOS_MM.a4;
  const largura = mmParaPt(medida.largura);
  const altura = mmParaPt(medida.altura);
  return ligado(opcoes.deitado, false) ? { largura: altura, altura: largura } : { largura, altura };
}

// ------------------------------------------------------------ rotação ---

export type PdfDoc = Awaited<ReturnType<typeof openWithPdfLib>>;

/**
 * Devolve o documento sem `/Rotate`, com o giro já aplicado no desenho.
 *
 * O `/Rotate` não muda o desenho: é um recado para o leitor girar na hora de
 * mostrar. O `embedPages` do pdf-lib ignora esse recado, então uma página de
 * 300x400 que o leitor mostra deitada, como 400x300, voltava em pé — e numa
 * gráfica isso põe a linha de corte no lado errado do papel.
 *
 * Resolver aqui, uma vez, em vez de em cada ferramenta: combinar giro com
 * espelho e com escala na mesma chamada de `drawPage` exige acertar caso a
 * caso, e caso esquecido ali não quebra nada — entrega um PDF bonito com a
 * medida trocada, que só aparece depois de cortado.
 *
 * Documento que já está reto volta como veio, sem custo nenhum.
 */
export async function semGiro(doc: PdfDoc): Promise<PdfDoc> {
  const paginas = doc.getPages();
  const giroDe = (i: number) => ((((paginas[i].getRotation().angle % 360) + 360) % 360));
  if (paginas.every((_, i) => giroDe(i) === 0)) return doc;

  const { PDFDocument, degrees } = await loadPdfLib();
  const reto = await PDFDocument.create();
  const embutidas = await reto.embedPages(paginas);

  embutidas.forEach((item, i) => {
    const giro = giroDe(i);
    const trocaEixos = giro === 90 || giro === 270;
    const pagina = reto.addPage([
      trocaEixos ? item.height : item.width,
      trocaEixos ? item.width : item.height,
    ]);

    // Girar no sentido do relogio leva o desenho para fora do primeiro
    // quadrante; o deslocamento devolve ele para dentro da folha.
    const desloca =
      giro === 90
        ? { x: 0, y: item.width }
        : giro === 180
          ? { x: item.width, y: item.height }
          : giro === 270
            ? { x: item.height, y: 0 }
            : { x: 0, y: 0 };

    pagina.drawPage(item, { ...desloca, rotate: degrees(-giro) });
  });

  // Gravar e reabrir não é desperdício: é o que torna o documento real.
  // As páginas embutidas do pdf-lib só viram XObject de verdade quando o
  // documento é serializado. Devolver o `reto` direto entregava um arquivo
  // que o leitor abre com "cannot find object in xref" e mostra em branco —
  // e branco, numa gráfica, é a tiragem inteira perdida.
  return PDFDocument.load(await reto.save());
}

// ------------------------------------------------------- marcas de corte ---

/**
 * Marcas de corte e sangria.
 *
 * A folha de saída é maior que a arte: sobra a sangria e, fora dela, as
 * marcas. O corte acontece na linha da arte; a sangria é o que a guilhotina
 * come quando erra um fio de milímetro — e é por isso que ela precisa ter
 * desenho dentro, não branco.
 */
export async function cropMarks(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await semGiro(await openWithPdfLib(source.bytes, source.senha));

  const sangria = mmParaPt(limitar(ctx.options.sangriaMm, 0, 20, 3));
  const comprimento = mmParaPt(limitar(ctx.options.marcasMm, 1, 15, 4));
  const espessura = limitar(ctx.options.espessura, 0.1, 2, 0.25);
  // Um respiro entre a ponta da marca e a borda do papel: encostada no limite
  // de impressão, a marca simplesmente não sai.
  const respiro = mmParaPt(2);
  const borda = sangria + comprimento + respiro;

  const ampliar = String(ctx.options.origem ?? 'ja-tem') === 'ampliar';
  const registro = ligado(ctx.options.registro, false);

  const out = await PDFDocument.create();
  const embutidas = await out.embedPages(doc.getPages());
  if (embutidas.length === 0) throw new Error('O documento não tem páginas.');
  const preto = rgb(0, 0, 0);

  for (let i = 0; i < embutidas.length; i += 1) {
    ctx.onProgress(i / embutidas.length, `Página ${i + 1}/${embutidas.length}`);
    const item = embutidas[i];
    const folha = out.addPage([item.width + borda * 2, item.height + borda * 2]);

    if (ampliar && sangria > 0) {
      // Ampliar empurra o desenho para dentro da sangria. É remendo, e a nota
      // do fim diz isso: sangria de verdade vem feita do arquivo original.
      const escala = Math.max((item.width + sangria * 2) / item.width, (item.height + sangria * 2) / item.height);
      folha.drawPage(item, {
        x: borda - (item.width * escala - item.width) / 2,
        y: borda - (item.height * escala - item.height) / 2,
        xScale: escala,
        yScale: escala,
      });
    } else {
      folha.drawPage(item, { x: borda, y: borda });
    }

    const risco = (x1: number, y1: number, x2: number, y2: number) =>
      folha.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: espessura, color: preto });

    // Oito marcas: duas por canto, na linha do corte, começando depois da
    // sangria para não riscar a arte.
    for (const [x, sentidoX] of [
      [borda, -1],
      [borda + item.width, 1],
    ] as const) {
      for (const [y, sentidoY] of [
        [borda, -1],
        [borda + item.height, 1],
      ] as const) {
        const deX = x + sentidoX * sangria;
        const deY = y + sentidoY * sangria;
        risco(deX, y, deX + sentidoX * comprimento, y);
        risco(x, deY, x, deY + sentidoY * comprimento);
      }
    }

    if (registro) {
      const raio = mmParaPt(2);
      for (const centro of [
        { x: borda + item.width / 2, y: borda / 2 },
        { x: borda + item.width / 2, y: folha.getHeight() - borda / 2 },
        { x: borda / 2, y: borda + item.height / 2 },
        { x: folha.getWidth() - borda / 2, y: borda + item.height / 2 },
      ]) {
        folha.drawCircle({ x: centro.x, y: centro.y, size: raio, borderColor: preto, borderWidth: espessura });
        risco(centro.x - raio * 1.4, centro.y, centro.x + raio * 1.4, centro.y);
        risco(centro.x, centro.y - raio * 1.4, centro.x, centro.y + raio * 1.4);
      }
    }

    await yieldToBrowser();
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);

  const primeira = out.getPage(0);
  const notas = [
    `Folha de ${emMm(primeira.getWidth())}x${emMm(primeira.getHeight())} mm para uma arte de ` +
      `${emMm(embutidas[0].width)}x${emMm(embutidas[0].height)} mm. O corte é na linha das marcas.`,
    'Imprima em tamanho real. "Ajustar à página" encolhe tudo e as marcas deixam de valer.',
  ];
  if (ampliar && sangria > 0) {
    notas.push(
      'A arte foi ampliada para preencher a sangria. É um remendo: o desenho cresceu um pouco e a beirada saiu do quadro.',
    );
  } else if (sangria > 0) {
    notas.push(
      `Contamos que a arte já tenha ${emMm(sangria)} mm de sangria. Se não tiver, a beirada pode sair branca no corte.`,
    );
  }

  return {
    files: [{ name: suffixName(source.name, 'marcas-de-corte'), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: notas,
  };
}
// ------------------------------------------------------------ numeração ---

/**
 * Onde assentar o número, já na linha de base.
 *
 * A conta do rodapé não é a mesma do topo: no topo desconta-se a altura da
 * letra da margem de cima, no rodapé a margem já É a linha de base. Somar o
 * tamanho dos dois lados jogava o número para fora da folha com letra grande
 * e margem pequena.
 */
export const CANTOS = {
  'topo-direita': (l: number, a: number, m: number, t: number) => ({ x: l - m, y: a - m - t, direita: true }),
  'topo-esquerda': (_l: number, a: number, m: number, t: number) => ({ x: m, y: a - m - t, direita: false }),
  'rodape-direita': (l: number, _a: number, m: number, _t: number) => ({ x: l - m, y: m, direita: true }),
  'rodape-esquerda': (_l: number, _a: number, m: number, _t: number) => ({ x: m, y: m, direita: false }),
};

/**
 * Numeração sequencial, para talão e ingresso.
 *
 * Cada número gera um jogo completo do documento — as duas vias de um recibo
 * levam o mesmo número, que é o que faz o canhoto bater com a via. Quem quer
 * uma via só manda um PDF de uma página.
 */
export async function sequentialNumbering(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await semGiro(await openWithPdfLib(source.bytes, source.senha));

  const quantidade = Math.round(limitar(ctx.options.quantidade, 1, MAX_PAGINAS_GERADAS, 100));
  const inicio = Math.round(limitar(ctx.options.inicio, 0, 9_999_999, 1));
  const digitos = Math.round(limitar(ctx.options.digitos, 1, 10, 4));
  const tamanho = limitar(ctx.options.tamanho, 5, 72, 12);
  const margem = mmParaPt(limitar(ctx.options.margemMm, 2, 60, 10));
  const prefixo = sanitizeText(String(ctx.options.prefixo ?? '').trim());
  const canto = CANTOS[String(ctx.options.posicao ?? 'topo-direita') as keyof typeof CANTOS] ?? CANTOS['topo-direita'];
  const { r, g, b } = hexParaRgb(String(ctx.options.cor ?? '#d92d20'));

  const doJogo = doc.getPageCount();
  if (doJogo === 0) throw new Error('O documento não tem páginas.');
  const total = quantidade * doJogo;
  if (total > MAX_PAGINAS_GERADAS) {
    throw new Error(
      `Isso daria ${total} páginas (${quantidade} números x ${doJogo} do jogo), acima do limite de ` +
        `${MAX_PAGINAS_GERADAS}. Reduza a quantidade, ou divida o trabalho em partes.`,
    );
  }

  const out = await PDFDocument.create();
  const fonte = await out.embedFont(StandardFonts.HelveticaBold);
  const cor = rgb(r, g, b);
  const indices = doc.getPageIndices();

  for (let n = 0; n < quantidade; n += 1) {
    if (n % 20 === 0) {
      ctx.onProgress(n / quantidade, `Número ${inicio + n}`);
      await yieldToBrowser();
    }
    const texto = prefixo + String(inicio + n).padStart(digitos, '0');
    const largura = fonte.widthOfTextAtSize(texto, tamanho);

    const copiadas = await out.copyPages(doc, indices);
    for (const pagina of copiadas) {
      out.addPage(pagina);
      const onde = canto(pagina.getWidth(), pagina.getHeight(), margem, tamanho);
      pagina.drawText(texto, {
        x: onde.direita ? onde.x - largura : onde.x,
        y: onde.y,
        size: tamanho,
        font: fonte,
        color: cor,
      });
    }
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  const ultimo = prefixo + String(inicio + quantidade - 1).padStart(digitos, '0');

  return {
    files: [{ name: suffixName(source.name, 'numerado'), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      `${quantidade} números, de ${prefixo}${String(inicio).padStart(digitos, '0')} a ${ultimo}.`,
      doJogo > 1
        ? `Cada número saiu nas ${doJogo} páginas do jogo, com o mesmo valor — é o que faz o canhoto bater com a via.`
        : 'Uma página por número.',
    ],
  };
}

// --------------------------------------------------- espelhar e repetir ---

/**
 * Espelha a página.
 *
 * Serve para sublimação, transfer e serigrafia, onde o desenho é aplicado de
 * cara para baixo e sai invertido se for impresso normal. É transformação de
 * coordenada, não rasterização: o texto continua texto (invertido, que é o
 * que se pediu).
 */
export async function mirror(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await semGiro(await openWithPdfLib(source.bytes, source.senha));
  const eixo = String(ctx.options.eixo ?? 'horizontal');
  const viraX = eixo === 'horizontal' || eixo === 'ambos';
  const viraY = eixo === 'vertical' || eixo === 'ambos';

  const out = await PDFDocument.create();
  const embutidas = await out.embedPages(doc.getPages());

  for (let i = 0; i < embutidas.length; i += 1) {
    if (i % 20 === 0) {
      ctx.onProgress(i / embutidas.length, `Página ${i + 1}/${embutidas.length}`);
      await yieldToBrowser();
    }
    const item = embutidas[i];
    const pagina = out.addPage([item.width, item.height]);
    // Escala negativa é o `cm` do PDF com valor negativo: a origem vai para o
    // lado oposto e o desenho volta espelhado.
    pagina.drawPage(item, {
      x: viraX ? item.width : 0,
      y: viraY ? item.height : 0,
      xScale: viraX ? -1 : 1,
      yScale: viraY ? -1 : 1,
    });
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  const comoSaiu = { horizontal: 'da esquerda para a direita', vertical: 'de cima para baixo', ambos: 'nos dois eixos' };

  return {
    files: [{ name: suffixName(source.name, 'espelhado'), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      `Espelhado ${comoSaiu[eixo as keyof typeof comoSaiu] ?? comoSaiu.horizontal}.`,
      'Confira numa impressão de teste antes da tiragem: o lado certo depende de como o papel entra na máquina.',
    ],
  };
}

/**
 * Repete as páginas.
 *
 * "Cada página" serve para tirar N cópias de cada folha numa impressão só;
 * "documento inteiro" monta a tiragem já intercalada, que sai da máquina
 * pronta para grampear.
 */
export async function repeatPages(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const doc = await semGiro(await openWithPdfLib(source.bytes, source.senha));

  const vezes = Math.round(limitar(ctx.options.vezes, 2, 500, 2));
  const porPagina = String(ctx.options.modo ?? 'cada-pagina') === 'cada-pagina';
  const original = doc.getPageCount();
  if (original === 0) throw new Error('O documento não tem páginas.');

  const total = original * vezes;
  if (total > MAX_PAGINAS_GERADAS) {
    throw new Error(`Isso daria ${total} páginas, acima do limite de ${MAX_PAGINAS_GERADAS}. Reduza as repetições.`);
  }

  const out = await PDFDocument.create();
  const indices = doc.getPageIndices();

  if (porPagina) {
    for (const indice of indices) {
      ctx.onProgress(indice / original, `Página ${indice + 1}/${original}`);
      for (let v = 0; v < vezes; v += 1) {
        const [copia] = await out.copyPages(doc, [indice]);
        out.addPage(copia);
      }
      await yieldToBrowser();
    }
  } else {
    for (let v = 0; v < vezes; v += 1) {
      ctx.onProgress(v / vezes, `Cópia ${v + 1}/${vezes}`);
      const copiadas = await out.copyPages(doc, indices);
      for (const pagina of copiadas) out.addPage(pagina);
      await yieldToBrowser();
    }
  }

  const montado = await salvarPdf(out, source.senha);

  /*
   * O pdf-lib copia cada imagem de novo a cada cópia da página: 6 páginas com
   * uma foto, repetidas duas vezes, saíam com 12 cópias da mesma foto — 138 KB
   * virando 1,5 MB. A compactação sem perda deixa uma só e aponta as outras
   * para ela, sem mexer em nada do que está desenhado. É a mesma do Juntar.
   */
  ctx.onProgress(0.97, 'Compactando sem perder qualidade');
  const { compactarSemPerda } = await import('../motor-python');
  const blob = await compactarSemPerda(montado, source.senha);
  ctx.onProgress(1);

  return {
    files: [{ name: suffixName(source.name, `x${vezes}`), blob, pages: out.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      porPagina
        ? `Cada página saiu ${vezes} vezes seguidas: ${original} viraram ${total}.`
        : `O documento saiu ${vezes} vezes, um atrás do outro: ${original} páginas viraram ${total}.`,
    ],
  };
}
