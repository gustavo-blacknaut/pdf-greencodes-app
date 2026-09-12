'use client';

/**
 * Texto em formato ABNT (NBR 14724), do jeito que a faculdade cobra.
 *
 * As regras que importam num trabalho entregue:
 *
 * - A4, margem de 3 cm à esquerda e no topo, 2 cm à direita e embaixo.
 * - Times New Roman ou Arial, 12 pt no corpo.
 * - Entrelinha 1,5 no corpo; citação longa e nota em espaço simples.
 * - Recuo de 1,25 cm na primeira linha de cada parágrafo.
 * - Texto justificado.
 * - Citação com mais de três linhas: recuo de 4 cm, letra 10, espaço simples,
 *   sem aspas.
 * - Número da página no canto superior direito, a 2 cm da borda de cima.
 *
 * O arquivo de texto marca o que é o quê com dois sinais no começo da linha:
 * `# ` vira título de seção (maiúsculas, negrito) e `> ` vira citação longa.
 * Sem sinal nenhum, é parágrafo comum — que é o caso da maioria das linhas.
 */

import { loadPdfLib } from '../lazy';
import { sanitizeText } from '../nucleo';
import type { PdfDoc } from '../nucleo';

const PT_POR_CM = 72 / 2.54;

/** A4 em pontos. */
const A4 = { largura: 595.28, altura: 841.89 };

export const MARGENS_ABNT = {
  esquerda: 3 * PT_POR_CM,
  direita: 2 * PT_POR_CM,
  topo: 3 * PT_POR_CM,
  baixo: 2 * PT_POR_CM,
} as const;

export const RECUO_DO_PARAGRAFO = 1.25 * PT_POR_CM;
export const RECUO_DA_CITACAO = 4 * PT_POR_CM;
/** ABNT pede 1,5; o espaço simples da citação é 1,0. */
export const ENTRELINHA_DO_CORPO = 1.5;
export const ENTRELINHA_SIMPLES = 1.15;

export type TipoDeBloco = 'titulo' | 'paragrafo' | 'citacao';
export type Bloco = { tipo: TipoDeBloco; texto: string };

/**
 * Separa o texto em blocos.
 *
 * Linha em branco fecha o parágrafo. `# ` abre título e `> ` abre citação —
 * e duas linhas seguidas de citação continuam a mesma citação, porque quem
 * cola um parágrafo inteiro do autor quebra em várias linhas.
 */
export function blocosDoTexto(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  // `let atual: Bloco | null` faria o TypeScript estreitar para `never` depois
  // do `fechar()`, porque ele não vê que a função mexe na variável.
  let atual: { tipo: TipoDeBloco; texto: string } | undefined;

  const fechar = () => {
    if (atual && atual.texto.trim()) blocos.push({ tipo: atual.tipo, texto: atual.texto.trim() });
    atual = undefined;
  };

  // Quebra primeiro, limpa depois: o `sanitizeText` tira o que não é
  // imprimível, e a quebra de linha é uma dessas coisas — limpar antes
  // juntaria o trabalho inteiro num parágrafo só.
  for (const linhaBruta of texto.replace(/\r\n?/g, '\n').split('\n')) {
    const linha = sanitizeText(linhaBruta.replace(/\t/g, '    ')).trim();
    if (!linha) {
      fechar();
      continue;
    }
    if (linha.startsWith('# ')) {
      fechar();
      blocos.push({ tipo: 'titulo', texto: linha.slice(2).trim() });
      continue;
    }
    const eCitacao = linha.startsWith('> ');
    const tipo: TipoDeBloco = eCitacao ? 'citacao' : 'paragrafo';
    const conteudo = eCitacao ? linha.slice(2).trim() : linha;
    if (atual?.tipo === tipo) atual.texto += ` ${conteudo}`;
    else {
      fechar();
      atual = { tipo, texto: conteudo };
    }
  }
  fechar();
  return blocos;
}

/**
 * Quebra o texto em linhas que caibam na largura, palavra por palavra.
 *
 * Devolve as palavras de cada linha, e não a linha pronta: a justificação
 * precisa saber onde estão os espaços para distribuir a sobra neles.
 */
export function quebrarEmLinhas(
  texto: string,
  largura: number,
  medir: (texto: string) => number,
): string[][] {
  const linhas: string[][] = [];
  let atual: string[] = [];
  let usado = 0;
  const espaco = medir(' ');

  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const largaAssim = medir(palavra);
    const custo = atual.length ? espaco + largaAssim : largaAssim;
    if (atual.length && usado + custo > largura) {
      linhas.push(atual);
      atual = [palavra];
      usado = largaAssim;
      continue;
    }
    atual.push(palavra);
    usado += custo;
  }
  if (atual.length) linhas.push(atual);
  return linhas;
}

/**
 * Onde cada palavra da linha começa, já justificada.
 *
 * A sobra é dividida igualmente entre os espaços. A última linha do parágrafo
 * não é justificada — esticar a última linha é o erro que faz um trabalho
 * parecer feito no editor errado.
 */
export function palavrasJustificadas(
  palavras: string[],
  largura: number,
  x0: number,
  medir: (texto: string) => number,
  ultima: boolean,
): { palavra: string; x: number }[] {
  const espaco = medir(' ');
  const soma = palavras.reduce((total, palavra) => total + medir(palavra), 0);
  const vaos = palavras.length - 1;
  const sobra = largura - soma - espaco * vaos;
  const extra = ultima || vaos <= 0 || sobra <= 0 ? 0 : sobra / vaos;

  let x = x0;
  return palavras.map((palavra) => {
    const posicao = { palavra, x };
    x += medir(palavra) + espaco + extra;
    return posicao;
  });
}

export type OpcoesAbnt = {
  /** Times New Roman é o padrão da ABNT; Arial é a outra permitida. */
  fonte?: 'times' | 'arial';
  tamanho?: number;
  titulo?: string;
  numerarPaginas?: boolean;
};

/** Monta o documento inteiro. Devolve o PDF pronto e quantas páginas saíram. */
export async function pdfEmAbnt(texto: string, opcoes: OpcoesAbnt = {}): Promise<{ doc: PdfDoc; paginas: number }> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const tamanho = Math.max(8, Math.min(14, Number(opcoes.tamanho ?? 12)));
  const doc = await PDFDocument.create();
  const serifada = (opcoes.fonte ?? 'times') === 'times';
  const corpo = await doc.embedFont(serifada ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const negrito = await doc.embedFont(serifada ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const preto = rgb(0, 0, 0);

  const larguraUtil = A4.largura - MARGENS_ABNT.esquerda - MARGENS_ABNT.direita;
  const baseDoTexto = MARGENS_ABNT.baixo;

  let pagina = doc.addPage([A4.largura, A4.altura]);
  let y = A4.altura - MARGENS_ABNT.topo;
  const paginas: (typeof pagina)[] = [pagina];

  const novaPagina = () => {
    pagina = doc.addPage([A4.largura, A4.altura]);
    paginas.push(pagina);
    y = A4.altura - MARGENS_ABNT.topo;
  };

  const cabe = (altura: number) => {
    if (y - altura >= baseDoTexto) return;
    novaPagina();
  };

  if (opcoes.titulo?.trim()) {
    const texto = sanitizeText(opcoes.titulo).trim().toUpperCase();
    const linhas = quebrarEmLinhas(texto, larguraUtil, (t) => negrito.widthOfTextAtSize(t, tamanho));
    for (const palavras of linhas) {
      const largura = palavras.reduce(
        (total, palavra, i) => total + negrito.widthOfTextAtSize(i ? ` ${palavra}` : palavra, tamanho),
        0,
      );
      cabe(tamanho * ENTRELINHA_DO_CORPO);
      pagina.drawText(palavras.join(' '), {
        x: MARGENS_ABNT.esquerda + (larguraUtil - largura) / 2,
        y: y - tamanho,
        size: tamanho,
        font: negrito,
        color: preto,
      });
      y -= tamanho * ENTRELINHA_DO_CORPO;
    }
    y -= tamanho * ENTRELINHA_DO_CORPO;
  }

  for (const bloco of blocosDoTexto(texto)) {
    const daCitacao = bloco.tipo === 'citacao';
    const fonte = bloco.tipo === 'titulo' ? negrito : corpo;
    const tamanhoDoBloco = daCitacao ? Math.max(8, tamanho - 2) : tamanho;
    const entrelinha = daCitacao ? ENTRELINHA_SIMPLES : ENTRELINHA_DO_CORPO;
    const recuoEsquerdo = daCitacao ? RECUO_DA_CITACAO : 0;
    const largura = larguraUtil - recuoEsquerdo;
    const medir = (t: string) => fonte.widthOfTextAtSize(t, tamanhoDoBloco);
    const conteudo = bloco.tipo === 'titulo' ? bloco.texto.toUpperCase() : bloco.texto;

    // Título tem um respiro antes, como manda a norma para as seções.
    if (bloco.tipo === 'titulo') {
      y -= tamanho * ENTRELINHA_DO_CORPO * 0.5;
      cabe(tamanho * ENTRELINHA_DO_CORPO * 2);
    }

    const primeiraRecuada = bloco.tipo === 'paragrafo';
    const linhas = quebrarEmLinhas(conteudo, largura - (primeiraRecuada ? RECUO_DO_PARAGRAFO : 0), medir);

    linhas.forEach((palavras, i) => {
      const recuo = MARGENS_ABNT.esquerda + recuoEsquerdo + (primeiraRecuada && i === 0 ? RECUO_DO_PARAGRAFO : 0);
      const disponivel = MARGENS_ABNT.esquerda + larguraUtil - recuo;
      const ultima = i === linhas.length - 1;
      cabe(tamanhoDoBloco * entrelinha);
      const posicoes =
        bloco.tipo === 'titulo'
          ? palavrasJustificadas(palavras, disponivel, recuo, medir, true)
          : palavrasJustificadas(palavras, disponivel, recuo, medir, ultima);
      for (const { palavra, x } of posicoes) {
        pagina.drawText(palavra, { x, y: y - tamanhoDoBloco, size: tamanhoDoBloco, font: fonte, color: preto });
      }
      y -= tamanhoDoBloco * entrelinha;
    });

    // Depois do bloco, o espaço que separa um parágrafo do outro.
    y -= tamanhoDoBloco * (daCitacao ? ENTRELINHA_DO_CORPO : 0.35);
  }

  if (opcoes.numerarPaginas !== false) {
    // No canto de cima à direita, a 2 cm da borda: é onde a norma manda.
    paginas.forEach((folha, i) => {
      const numero = String(i + 1);
      const largura = corpo.widthOfTextAtSize(numero, tamanho);
      folha.drawText(numero, {
        x: A4.largura - 2 * PT_POR_CM - largura,
        y: A4.altura - 2 * PT_POR_CM - tamanho * 0.8,
        size: tamanho,
        font: corpo,
        color: preto,
      });
    });
  }

  return { doc, paginas: paginas.length };
}
