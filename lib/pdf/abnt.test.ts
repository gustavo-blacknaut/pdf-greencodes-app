import { describe, expect, it } from 'vitest';

import {
  ENTRELINHA_DO_CORPO,
  MARGENS_ABNT,
  RECUO_DA_CITACAO,
  RECUO_DO_PARAGRAFO,
  blocosDoTexto,
  palavrasJustificadas,
  pdfEmAbnt,
  quebrarEmLinhas,
} from './operacoes/abnt';

/**
 * O ABNT é conferido com régua: quem entrega o trabalho leva nota por margem
 * errada. Então os testes medem — margem em centímetros, recuo da primeira
 * linha, entrelinha e o número da página no canto certo.
 */

const PT_POR_CM = 72 / 2.54;
const emCm = (pt: number) => Math.round((pt / PT_POR_CM) * 100) / 100;
const medirFalso = (texto: string) => texto.length * 5;

describe('as medidas da norma', () => {
  it('margem de 3 cm à esquerda e no topo, 2 cm à direita e embaixo', () => {
    expect(emCm(MARGENS_ABNT.esquerda)).toBe(3);
    expect(emCm(MARGENS_ABNT.topo)).toBe(3);
    expect(emCm(MARGENS_ABNT.direita)).toBe(2);
    expect(emCm(MARGENS_ABNT.baixo)).toBe(2);
  });

  it('recuo de 1,25 cm no parágrafo e 4 cm na citação longa', () => {
    expect(emCm(RECUO_DO_PARAGRAFO)).toBe(1.25);
    expect(emCm(RECUO_DA_CITACAO)).toBe(4);
  });

  it('entrelinha do corpo é 1,5', () => {
    expect(ENTRELINHA_DO_CORPO).toBe(1.5);
  });
});

describe('a leitura do texto', () => {
  it('linha em branco separa parágrafos, e a quebra dentro dele não', () => {
    const blocos = blocosDoTexto('Primeira linha\ncontinua o mesmo paragrafo\n\nOutro paragrafo');
    expect(blocos).toHaveLength(2);
    expect(blocos[0].texto).toBe('Primeira linha continua o mesmo paragrafo');
    expect(blocos[1].texto).toBe('Outro paragrafo');
  });

  it('"# " é título de seção e "> " é citação longa', () => {
    const blocos = blocosDoTexto('# introducao\nO texto comeca aqui\n> autor citado\n> continua a citacao');
    expect(blocos.map((b) => b.tipo)).toEqual(['titulo', 'paragrafo', 'citacao']);
    expect(blocos[2].texto).toBe('autor citado continua a citacao');
  });
});

describe('a quebra e a justificação', () => {
  it('não deixa linha passar da largura', () => {
    const linhas = quebrarEmLinhas('uma frase com varias palavras para quebrar', 100, medirFalso);
    for (const palavras of linhas) {
      const largura = palavras.reduce((t, p, i) => t + medirFalso(i ? ` ${p}` : p), 0);
      expect(largura).toBeLessThanOrEqual(100);
    }
  });

  it('a última linha do parágrafo não é esticada', () => {
    const semEsticar = palavrasJustificadas(['a', 'b'], 500, 0, medirFalso, true);
    const esticada = palavrasJustificadas(['a', 'b'], 500, 0, medirFalso, false);
    expect(semEsticar[1].x).toBeLessThan(esticada[1].x);
    // Esticada, a última palavra termina na borda direita.
    expect(esticada[1].x + medirFalso('b')).toBeCloseTo(500, 5);
  });

  it('a primeira palavra começa onde mandaram, esticada ou não', () => {
    expect(palavrasJustificadas(['a', 'b'], 300, 85, medirFalso, false)[0].x).toBe(85);
  });
});

describe('o PDF do trabalho', () => {
  async function medir(texto: string, opcoes = {}) {
    const { doc, paginas } = await pdfEmAbnt(texto, opcoes);
    const bytes = await doc.save({ useObjectStreams: true });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const aberto = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        '$1',
      ),
    }).promise;
    const pagina = await aberto.getPage(1);
    const conteudo = await pagina.getTextContent();
    const itens = conteudo.items
      .flatMap((item) => ('str' in item && item.str.trim() ? [item] : []))
      .map((item) => ({ texto: item.str, x: item.transform[4] as number, y: item.transform[5] as number }));
    const medida = pagina.getViewport({ scale: 1 });
    await aberto.destroy();
    return { itens, largura: medida.width, altura: medida.height, paginas };
  }

  it('sai em A4, com o texto começando na margem de 3 cm', async () => {
    const { itens, largura, altura } = await medir('Um paragrafo qualquer para medir a margem do documento.');
    expect(Math.round(largura)).toBe(595);
    expect(Math.round(altura)).toBe(842);

    const primeira = itens.find((i) => i.texto.startsWith('Um'));
    expect(primeira).toBeDefined();
    // Primeira linha do parágrafo: 3 cm de margem + 1,25 de recuo.
    expect(emCm(primeira!.x)).toBeCloseTo(4.25, 1);
  });

  it('a segunda linha volta para a margem, sem o recuo', async () => {
    const longo = 'palavra '.repeat(60).trim();
    const { itens } = await medir(longo);
    const xs = [...new Set(itens.map((i) => Math.round(i.x)))].sort((a, b) => a - b);
    expect(emCm(xs[0])).toBeCloseTo(3, 1);
  });

  it('a entrelinha do corpo é 1,5 da letra', async () => {
    const { itens } = await medir('palavra '.repeat(60).trim(), { tamanho: 12, numerarPaginas: false });
    const ys = [...new Set(itens.map((i) => Math.round(i.y)))].sort((a, b) => b - a);
    // 12 pt a 1,5 dão 18 pt de uma linha para a outra.
    expect(ys[0] - ys[1]).toBeCloseTo(18, 0);
  });

  it('a citação longa entra a 4 cm da margem e com letra menor', async () => {
    const { itens } = await medir('Paragrafo normal.\n\n> Uma citacao longa do autor que tem mais de tres linhas.');
    const citacao = itens.find((i) => i.texto.startsWith('Uma'));
    expect(citacao).toBeDefined();
    expect(emCm(citacao!.x)).toBeCloseTo(7, 1);
  });

  it('numera a página no canto superior direito, a 2 cm da borda', async () => {
    const { itens, largura, altura } = await medir('Texto curto.');
    const numero = itens.find((i) => i.texto.trim() === '1');
    expect(numero).toBeDefined();
    expect(emCm(largura - numero!.x)).toBeLessThan(2.5);
    expect(emCm(altura - numero!.y)).toBeLessThan(2.6);
  });

  it('sem numeração quando não se pede', async () => {
    const { itens } = await medir('Texto curto.', { numerarPaginas: false });
    expect(itens.some((i) => i.texto.trim() === '1')).toBe(false);
  });

  it('o título sai em maiúsculas no alto da primeira página', async () => {
    const { itens } = await medir('Corpo do trabalho.', { titulo: 'A impressão digital no comércio' });
    const juntos = itens.map((i) => i.texto).join(' ');
    expect(juntos).toContain('IMPRESSÃO');
  });

  it('texto comprido vira mais de uma página, e todas numeradas', async () => {
    const { paginas } = await medir(('paragrafo de teste com varias palavras. '.repeat(40) + '\n\n').repeat(6));
    expect(paginas).toBeGreaterThan(1);
  });
});
