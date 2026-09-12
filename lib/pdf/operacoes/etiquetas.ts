'use client';

/**
 * Montagem de folha: cartão de visita, etiqueta e adesivo.
 *
 * O serviço é sempre o mesmo — repetir a arte numa grade e dizer onde
 * cortar —, e são dois mundos: a folha em branco, onde a grade é calculada e
 * centrada, e a folha de etiqueta comprada pronta, onde a grade já vem
 * picotada e a arte precisa cair exatamente em cima do picote.
 *
 * Milímetro é a unidade de quem trabalha com papel. A conversão para ponto
 * (1/72 de polegada) acontece só na hora de desenhar.
 */

import { desenharPaginaDeImagem, mmParaPt, openWithPdfLib, salvarPdf } from '../nucleo';
import { pareceSerImagem } from '../guards';
import type { Ajuste, RunContext, RunResult } from '../tipos';
import { replaceExtension, suffixName, yieldToBrowser } from '../../utils';
import { loadPdfLib } from '../lazy';
import { folhaEmPontos, ligado, limitar, semGiro } from './grafica';

const PT_POR_MM = 72 / 25.4;
const emMm = (pt: number) => Math.round((pt / PT_POR_MM) * 10) / 10;


// ------------------------------------------------------------ imposição ---

type Grade = { colunas: number; linhas: number; margemX: number; margemY: number };

/**
 * Quantos itens cabem, e sobrando quanto.
 *
 * A margem informada é o mínimo; o que sobra é dividido igualmente dos dois
 * lados, para a grade sair centrada. Folha com tudo empurrado para um canto é
 * o erro clássico da montagem feita na mão.
 */
export function calcularGrade(
  folhaL: number,
  folhaA: number,
  itemL: number,
  itemA: number,
  margem: number,
  espaco: number,
): Grade | null {
  const uteisL = folhaL - margem * 2;
  const uteisA = folhaA - margem * 2;
  if (itemL <= 0 || itemA <= 0 || uteisL < itemL || uteisA < itemA) return null;

  const colunas = Math.floor((uteisL + espaco) / (itemL + espaco));
  const linhas = Math.floor((uteisA + espaco) / (itemA + espaco));
  const usadoL = colunas * itemL + (colunas - 1) * espaco;
  const usadoA = linhas * itemA + (linhas - 1) * espaco;

  return { colunas, linhas, margemX: (folhaL - usadoL) / 2, margemY: (folhaA - usadoA) / 2 };
}

/**
 * As folhas de etiqueta da Pimaco, que é o que a gráfica compra.
 *
 * Aqui a grade não pode ser calculada: ela já existe, picotada no papel. Cada
 * modelo traz a margem e o passo do fabricante, e a arte é posta exatamente
 * em cima de cada etiqueta — um milímetro de conta própria já imprime metade
 * do texto na borda picotada.
 *
 * Todas são folha Carta (215,9 x 279,4 mm). As medidas são as publicadas pela
 * Pimaco; o ajuste fino e a folha de conferência existem porque impressora
 * também puxa o papel um fio torto.
 */
export const MODELOS_DE_ETIQUETA = {
  '6180': {
    nome: 'Pimaco 6180 — 30 por folha',
    etiqueta: '25,4 x 66,7 mm',
    colunas: 3,
    linhas: 10,
    largura: 66.675,
    altura: 25.4,
    esquerda: 4.7625,
    topo: 12.7,
    passoX: 69.85,
    passoY: 25.4,
    redonda: false,
  },
  '6187': {
    nome: 'Pimaco 6187 — 80 por folha',
    etiqueta: '12,7 x 44,45 mm',
    colunas: 4,
    linhas: 20,
    largura: 44.45,
    altura: 12.7,
    esquerda: 7.14,
    topo: 12.7,
    passoX: 52.39,
    passoY: 12.7,
    redonda: false,
  },
  '6093': {
    nome: 'Pimaco 6093 — 24 redondas',
    etiqueta: 'Ø 42,33 mm',
    colunas: 4,
    linhas: 6,
    largura: 42.33,
    altura: 42.33,
    esquerda: 10.58,
    topo: 12.7,
    passoX: 50.8,
    passoY: 44.45,
    redonda: true,
  },
} as const;

export type ModeloDeEtiqueta = (typeof MODELOS_DE_ETIQUETA)[keyof typeof MODELOS_DE_ETIQUETA];

const FOLHA_CARTA = { largura: 215.9, altura: 279.4 };

/**
 * A arte do item, quando o que entrou foi uma imagem.
 *
 * Quem manda a arte do cartão em JPEG não tem PDF nenhum: a arte é a foto, e
 * ela precisa entrar na medida exata do item. "Proporção" deixa a foto
 * inteira e branco em volta; "esticar" deforma até encher; "preencher" amplia
 * e corta o que passar. A 300 DPI, porque cartão sai da guilhotina para a mão
 * de alguém — a 150 a trama aparece.
 */
async function arteDaImagem(
  imagem: RunContext['files'][number],
  itemL: number,
  itemA: number,
  opcoes: RunContext['options'],
): Promise<ArrayBuffer> {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  const bitmap = await createImageBitmap(
    new Blob([imagem.bytes.slice(0)], { type: imagem.type || 'image/jpeg' }),
  );
  const canvas = document.createElement('canvas');
  try {
    await desenharPaginaDeImagem(
      out,
      canvas,
      bitmap,
      { largura: itemL, altura: itemA, seguirImagem: false },
      0,
      (String(opcoes.ajusteDaImagem ?? 'proporcao') as Ajuste),
      300,
    );
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
  const bytes = await out.save({ useObjectStreams: true });
  return bytes.slice().buffer as ArrayBuffer;
}

/**
 * Repete a arte numa grade, com as marcas de corte nas bordas da folha.
 *
 * Serve cartão de visita, etiqueta e adesivo: muda o tamanho do item e o
 * nome, o serviço é o mesmo. As marcas ficam nas margens, alinhadas com as
 * ruas entre os itens — é assim que se corta na guilhotina, a pilha inteira
 * de uma vez, e não item por item.
 */
async function imporGrade(
  ctx: RunContext,
  config: { itemL: number; itemA: number; sufixo: string; oQueE: string },
): Promise<RunResult> {
  const { PDFDocument, rgb } = await loadPdfLib();
  const source = ctx.files[0];
  const arte = pareceSerImagem(source.name, source.type)
    ? await arteDaImagem(source, config.itemL, config.itemA, ctx.options)
    : source.bytes;
  const doc = await semGiro(await openWithPdfLib(arte, source.senha));

  const folha = folhaEmPontos(ctx.options);
  const margem = mmParaPt(limitar(ctx.options.margemMm, 0, 50, 5));
  const espaco = mmParaPt(limitar(ctx.options.espacoMm, 0, 30, 0));
  const marcas = ligado(ctx.options.marcas, true);
  const sequencia = String(ctx.options.modo ?? 'repetir') === 'sequencia';

  const grade = calcularGrade(folha.largura, folha.altura, config.itemL, config.itemA, margem, espaco);
  if (!grade) {
    throw new Error(
      `Um item de ${emMm(config.itemL)}x${emMm(config.itemA)} mm não cabe em ${emMm(folha.largura)}x` +
        `${emMm(folha.altura)} mm com ${emMm(margem)} mm de margem. Escolha um papel maior, deite a folha, ` +
        'ou diminua a margem.',
    );
  }

  const porFolha = grade.colunas * grade.linhas;
  const out = await PDFDocument.create();
  const embutidas = await out.embedPages(doc.getPages());
  if (embutidas.length === 0) throw new Error('O documento não tem páginas.');

  const preto = rgb(0, 0, 0);
  const comprimento = mmParaPt(3);
  const respiro = mmParaPt(1.5);
  // Marca precisa de margem onde caber. Sem espaço, ela sairia fora do papel
  // e sumiria sem avisar — pior que não ter marca, porque a folha parece
  // pronta para cortar.
  const cabemMarcas =
    grade.margemX >= respiro + comprimento && grade.margemY >= respiro + comprimento;
  const desenharMarcas = marcas && cabemMarcas;

  /** Onde fica a vaga, contando de cima para baixo como se lê. */
  const vaga = (indice: number) => {
    const coluna = indice % grade.colunas;
    const linha = Math.floor(indice / grade.colunas);
    return {
      x: grade.margemX + coluna * (config.itemL + espaco),
      y: folha.altura - grade.margemY - (linha + 1) * config.itemA - linha * espaco,
    };
  };

  const totalFolhas = sequencia ? Math.ceil(embutidas.length / porFolha) : embutidas.length;

  for (let f = 0; f < totalFolhas; f += 1) {
    ctx.onProgress(f / totalFolhas, `Folha ${f + 1}/${totalFolhas}`);
    const pagina = out.addPage([folha.largura, folha.altura]);

    for (let i = 0; i < porFolha; i += 1) {
      const item = sequencia ? embutidas[f * porFolha + i] : embutidas[f];
      if (!item) break;
      const onde = vaga(i);
      // A arte é encaixada no quadro sem deformar; o que sobra vira borda.
      const escala = Math.min(config.itemL / item.width, config.itemA / item.height);
      pagina.drawPage(item, {
        x: onde.x + (config.itemL - item.width * escala) / 2,
        y: onde.y + (config.itemA - item.height * escala) / 2,
        xScale: escala,
        yScale: escala,
      });
    }

    if (desenharMarcas) {
      const risco = (x1: number, y1: number, x2: number, y2: number) =>
        pagina.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.25, color: preto });

      // Uma marca por rua. Com espaço zero as colunas encostam, e a borda
      // direita de uma é a esquerda da seguinte: o Set tira a repetida.
      const xs = new Set<number>();
      const ys = new Set<number>();
      for (let c = 0; c < grade.colunas; c += 1) {
        const x = grade.margemX + c * (config.itemL + espaco);
        xs.add(Math.round(x * 100) / 100);
        xs.add(Math.round((x + config.itemL) * 100) / 100);
      }
      for (let l = 0; l < grade.linhas; l += 1) {
        const y = folha.altura - grade.margemY - (l + 1) * config.itemA - l * espaco;
        ys.add(Math.round(y * 100) / 100);
        ys.add(Math.round((y + config.itemA) * 100) / 100);
      }

      const baixo = folha.altura - grade.margemY - grade.linhas * config.itemA - (grade.linhas - 1) * espaco;
      const cima = folha.altura - grade.margemY;
      for (const x of xs) {
        risco(x, baixo - respiro, x, Math.max(0, baixo - respiro - comprimento));
        risco(x, cima + respiro, x, Math.min(folha.altura, cima + respiro + comprimento));
      }
      const esquerda = grade.margemX;
      const direita = grade.margemX + grade.colunas * config.itemL + (grade.colunas - 1) * espaco;
      for (const y of ys) {
        risco(esquerda - respiro, y, Math.max(0, esquerda - respiro - comprimento), y);
        risco(direita + respiro, y, Math.min(folha.largura, direita + respiro + comprimento), y);
      }
    }

    await yieldToBrowser();
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);

  const cabem = `${grade.colunas} x ${grade.linhas} = ${porFolha} por folha`;
  const notas = [
    `${config.oQueE} de ${emMm(config.itemL)}x${emMm(config.itemA)} mm: ${cabem}, em ${out.getPageCount()} folha` +
      `${out.getPageCount() > 1 ? 's' : ''} de ${emMm(folha.largura)}x${emMm(folha.altura)} mm.`,
    'Imprima em tamanho real, sem ajustar à página — senão o corte sai fora de medida.',
  ];
  if (marcas && !cabemMarcas) {
    notas.push(
      `Sem marcas de corte: a grade ocupa o papel inteiro e não sobra margem para elas. ` +
        `Aumente a margem para ${emMm(respiro + comprimento)} mm ou mais, ou use um papel maior.`,
    );
  }
  if (!sequencia && embutidas.length > 1) {
    notas.push(`O arquivo tem ${embutidas.length} páginas, e saiu uma folha para cada uma.`);
  }

  return {
    // A folha montada é sempre PDF: entrando um JPEG, o nome tem de mudar de
    // extensão junto, senão o arquivo sai chamado .jpg e ninguém abre.
    files: [
      { name: replaceExtension(suffixName(source.name, config.sufixo), 'pdf'), blob, pages: out.getPageCount() },
    ],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: notas,
  };
}

/** Cartão de visita. 90x50 mm é a medida usada no Brasil. */
export async function businessCards(ctx: RunContext): Promise<RunResult> {
  const medida = String(ctx.options.medida ?? '90x50');
  const conhecidas: Record<string, [number, number]> = {
    '90x50': [90, 50],
    '88x48': [88, 48],
    '85x55': [85, 55],
    '89x51': [88.9, 50.8],
  };
  const [largura, altura] =
    medida === 'personalizado'
      ? [limitar(ctx.options.larguraMm, 10, 300, 90), limitar(ctx.options.alturaMm, 10, 300, 50)]
      : (conhecidas[medida] ?? conhecidas['90x50']);

  const deitado = ligado(ctx.options.cartaoDeitado, true);
  return imporGrade(ctx, {
    itemL: mmParaPt(deitado ? largura : altura),
    itemA: mmParaPt(deitado ? altura : largura),
    sufixo: 'cartoes',
    oQueE: 'Cartão',
  });
}

/** Etiqueta e adesivo: mesma montagem, medida livre. */
export async function labels(ctx: RunContext): Promise<RunResult> {
  const modelo = MODELOS_DE_ETIQUETA[String(ctx.options.modelo ?? '') as keyof typeof MODELOS_DE_ETIQUETA];
  if (modelo) return imporModelo(ctx, modelo);

  return imporGrade(ctx, {
    itemL: mmParaPt(limitar(ctx.options.larguraMm, 5, 400, 50)),
    itemA: mmParaPt(limitar(ctx.options.alturaMm, 5, 400, 30)),
    sufixo: 'etiquetas',
    oQueE: 'Etiqueta',
  });
}

/**
 * Põe a arte em cima de uma folha de etiqueta que já vem picotada.
 *
 * Nada de grade calculada: a posição de cada etiqueta é a do fabricante, e a
 * arte entra exatamente ali. O deslocamento existe porque impressora puxa
 * papel torto — meio milímetro de sobra some na picotagem, dois já cortam o
 * texto —, e a folha de conferência existe para descobrir isso num papel
 * comum, antes de gastar a folha de etiqueta.
 */
async function imporModelo(ctx: RunContext, modelo: ModeloDeEtiqueta): Promise<RunResult> {
  const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, moveTo, appendBezierCurve, closePath, clip, endPath } =
    await loadPdfLib();

  const source = ctx.files[0];
  const itemL = mmParaPt(modelo.largura);
  const itemA = mmParaPt(modelo.altura);
  const arte = pareceSerImagem(source.name, source.type)
    ? await arteDaImagem(source, itemL, itemA, { ...ctx.options, ajusteDaImagem: modelo.redonda ? 'preencher' : ctx.options.ajusteDaImagem })
    : source.bytes;

  const doc = await semGiro(await openWithPdfLib(arte, source.senha));
  const out = await PDFDocument.create();
  const embutidas = await out.embedPages(doc.getPages());
  if (embutidas.length === 0) throw new Error('O documento não tem páginas.');

  const folha = { largura: mmParaPt(FOLHA_CARTA.largura), altura: mmParaPt(FOLHA_CARTA.altura) };
  const desloca = {
    x: mmParaPt(limitar(ctx.options.deslocaXmm, -10, 10, 0)),
    y: mmParaPt(limitar(ctx.options.deslocaYmm, -10, 10, 0)),
  };
  const conferir = ligado(ctx.options.conferir, false);
  const sequencia = String(ctx.options.modo ?? 'repetir') === 'sequencia';

  const porFolha = modelo.colunas * modelo.linhas;
  const totalFolhas = sequencia ? Math.ceil(embutidas.length / porFolha) : embutidas.length;

  for (let f = 0; f < totalFolhas; f += 1) {
    ctx.onProgress(f / totalFolhas, `Folha ${f + 1}/${totalFolhas}`);
    const pagina = out.addPage([folha.largura, folha.altura]);

    for (let i = 0; i < porFolha; i += 1) {
      const item = sequencia ? embutidas[f * porFolha + i] : embutidas[f];
      if (!item) break;

      const coluna = i % modelo.colunas;
      const linha = Math.floor(i / modelo.colunas);
      const x = mmParaPt(modelo.esquerda) + coluna * mmParaPt(modelo.passoX) + desloca.x;
      // O PDF conta de baixo para cima; a folha de etiqueta, de cima para baixo.
      const y = folha.altura - mmParaPt(modelo.topo) - linha * mmParaPt(modelo.passoY) - itemA - desloca.y;

      // Redonda: o desenho é cortado no círculo da etiqueta, senão o canto da
      // arte cai no picote e imprime no papel de trás.
      if (modelo.redonda) {
        const raio = Math.min(itemL, itemA) / 2;
        const curva = raio * 0.5523;
        const cx = x + itemL / 2;
        const cy = y + itemA / 2;
        pagina.pushOperators(
          pushGraphicsState(),
          moveTo(cx - raio, cy),
          appendBezierCurve(cx - raio, cy + curva, cx - curva, cy + raio, cx, cy + raio),
          appendBezierCurve(cx + curva, cy + raio, cx + raio, cy + curva, cx + raio, cy),
          appendBezierCurve(cx + raio, cy - curva, cx + curva, cy - raio, cx, cy - raio),
          appendBezierCurve(cx - curva, cy - raio, cx - raio, cy - curva, cx - raio, cy),
          closePath(),
          clip(),
          endPath(),
        );
      }

      // Redonda enche a etiqueta; retangular cabe inteira, com o que sobrar
      // virando borda.
      const escala = modelo.redonda
        ? Math.max(itemL / item.width, itemA / item.height)
        : Math.min(itemL / item.width, itemA / item.height);
      pagina.drawPage(item, {
        x: x + (itemL - item.width * escala) / 2,
        y: y + (itemA - item.height * escala) / 2,
        xScale: escala,
        yScale: escala,
      });

      if (modelo.redonda) pagina.pushOperators(popGraphicsState());

      if (conferir) {
        // O contorno de onde a etiqueta está: imprima numa folha comum e
        // ponha contra a luz junto com a folha de etiqueta.
        const risco = { borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.4, opacity: 0 };
        if (modelo.redonda) {
          pagina.drawEllipse({ x: x + itemL / 2, y: y + itemA / 2, xScale: itemL / 2, yScale: itemA / 2, ...risco });
        } else {
          pagina.drawRectangle({ x, y, width: itemL, height: itemA, ...risco });
        }
      }
    }
    await yieldToBrowser();
  }

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [
      { name: replaceExtension(suffixName(source.name, 'etiquetas'), 'pdf'), blob, pages: out.getPageCount() },
    ],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      `${modelo.nome}: ${modelo.colunas} x ${modelo.linhas} = ${porFolha} por folha, etiqueta de ${modelo.etiqueta}, folha Carta.`,
      'Imprima em tamanho real, sem "ajustar à página": o ajuste encolhe tudo e a arte sai fora do picote.',
      conferir
        ? 'A folha saiu com o contorno de cada etiqueta: imprima numa folha comum e confira contra a folha de etiqueta antes de gastar.'
        : 'Na dúvida, marque "Folha de conferência" e imprima antes num papel comum. Se sair torto, acerte com o deslocamento.',
    ],
  };
}
