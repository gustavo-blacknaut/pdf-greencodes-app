import { describe, expect, it, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFArray, rgb } from '@cantoo/pdf-lib';
import { labels } from './operacoes/etiquetas';
import { prepararArtes } from './operacoes/artes-etiquetas';
import type { LoadedFile, RunContext } from './tipos';
import { rasterizar, faixasDaLinha, TEM_RASTERIZADOR } from './raster-de-teste';
import { opcoesParaFolhaMontada } from '../../components/impressao/fila';
import { montagemDe } from '../desktop';
import { planoDaFolha } from '../impressao/folha';

async function arquivo(id: string, largura = 120, paginas = 1): Promise<LoadedFile> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) {
    doc.addPage([largura, 120]).drawRectangle({ x: 0, y: 0, width: largura, height: 120, color: rgb(0, 0, 0) });
  }
  const bytes = (await doc.save()).slice().buffer;
  return { id, name: `${id}.pdf`, bytes, size: bytes.byteLength, type: 'application/pdf', pageCount: paginas, thumbnail: null };
}

function contexto(files: LoadedFile[], options: RunContext['options'] = {}): RunContext {
  return { files, options: { modelo: '6093', modo: 'sequencia', ...options }, onProgress: () => {} };
}

/** Referências das artes realmente desenhadas, na ordem de cada folha. */
async function desenhos(blob: Blob): Promise<string[][]> {
  const doc = await PDFDocument.load(await blob.arrayBuffer());
  return doc.getPages().map((page) => {
    const resources = page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    const contents = page.node.Contents()!;
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    const texto = refs.map((ref) => {
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) throw new Error('Fluxo de desenho ausente');
      return inflateSync(stream.getContents()).toString('latin1');
    }).join('\n');
    return [...texto.matchAll(/\/(\S+) Do/g)].map((match) => resources.get(PDFName.of(match[1]))!.toString());
  });
}

describe('várias artes de etiqueta', () => {
  it('a impressão recebe Carta em tamanho real sem herdar reduções ou deslocamentos', async () => {
    const result = await labels(contexto([await arquivo('a')]));
    const doc = await PDFDocument.load(await result.files[0].blob.arrayBuffer());
    const page = doc.getPage(0);
    const medida = { largura: page.getWidth() * 25.4 / 72, altura: page.getHeight() * 25.4 / 72 };
    const opcoes = opcoesParaFolhaMontada({
      papel: 'A4', escala: 'porcento', escalaPorcento: 80, orientacao: 'paisagem',
      deslocaXmm: 4, deslocaYmm: 5, margemLadosMm: 5, espelho: 'horizontal', impressora: 'Teste',
    }, result.papelImpressao ?? null);
    expect(opcoes.papel).toBe('Letter');
    expect(opcoes.impressora).toBe('Teste');
    const plano = planoDaFolha(medida, montagemDe({ ...opcoes,
      bordaMm: { esquerda: 3, direita: 3, cima: 3, baixo: 3 } }));
    expect(plano.arte.x).toBeCloseTo(0, 5);
    expect(plano.arte.y).toBeCloseTo(0, 5);
    expect(plano.arte.largura / plano.pontosPorMm).toBeCloseTo(215.9, 3);
    expect(plano.arte.altura / plano.pontosPorMm).toBeCloseTo(279.4, 3);
  });

  it.each(['6093', 'livre'])('respeita 3 de uma arte e 26 de outra no modelo %s, reutilizando as artes', async (modelo) => {
    const files = [await arquivo('a'), await arquivo('b', 200)];
    const result = await labels(contexto(files, {
      modelo, larguraMm: 42.33, alturaMm: 42.33, 'quantidade:a': 3, 'quantidade:b': 26,
    }));
    const folhas = await desenhos(result.files[0].blob);
    const todas = folhas.flat();
    expect(todas).toHaveLength(29);
    expect(new Set(todas).size).toBe(2);
    expect(todas.filter((ref) => ref === todas[0])).toHaveLength(3);
    expect(todas.slice(3).every((ref) => ref === todas[3])).toBe(true);
    expect(folhas.map((folha) => folha.length)).toEqual([24, 5]);
    expect(result.inputBytes).toBe(files[0].size + files[1].size);
  });

  it('uma folha por arte também inclui todos os arquivos', async () => {
    const result = await labels(contexto([await arquivo('a'), await arquivo('b')], { modo: 'repetir' }));
    const folhas = await desenhos(result.files[0].blob);
    expect(folhas.map((folha) => folha.length)).toEqual([24, 24]);
    expect(folhas[0][0]).not.toBe(folhas[1][0]);
  });

  it('quantidade zero exclui uma arte; PDFs com várias páginas repetem cada página', async () => {
    const result = await labels(contexto([await arquivo('a'), await arquivo('b', 120, 2)], {
      'quantidade:a': 0, 'quantidade:b': 3,
    }));
    const itens = (await desenhos(result.files[0].blob)).flat();
    expect(itens).toHaveLength(6);
    expect(itens.slice(0, 3).every((ref) => ref === itens[0])).toBe(true);
    expect(itens.slice(3).every((ref) => ref === itens[3])).toBe(true);
    expect(itens[0]).not.toBe(itens[3]);
  });

  it('converte todas as imagens uma única vez mesmo com muitas cópias', async () => {
    const files = [await arquivo('a'), await arquivo('b')].map((file) => ({ ...file, name: `${file.id}.png`, type: 'image/png' }));
    const converter = vi.fn(async (file: LoadedFile) => file.bytes);
    const itens = await prepararArtes(contexto(files, { 'quantidade:a': 10, 'quantidade:b': 20 }),
      await PDFDocument.create(), 24, converter);
    expect(converter.mock.calls.map(([file]) => file.id)).toEqual(['a', 'b']);
    expect(itens).toHaveLength(30);
    expect(new Set(itens).size).toBe(2);
  });

  it.each([0, -1, 1.5, 5001])('recusa quantidades vazias ou inválidas: %s', async (quantidade) => {
    await expect(labels(contexto([await arquivo('a')], { 'quantidade:a': quantidade }))).rejects.toThrow(/quantidade|pelo menos/);
  });

  it('recusa um lote que ultrapassa o limite total', async () => {
    await expect(labels(contexto([await arquivo('a'), await arquivo('b')], {
      'quantidade:a': 3000, 'quantidade:b': 3000,
    }))).rejects.toThrow(/5000 etiquetas/);
  });

  it('interrompe antes de preparar arquivos quando cancelado', async () => {
    const ctx = contexto([await arquivo('a')]);
    ctx.signal = AbortSignal.abort();
    await expect(labels(ctx)).rejects.toThrow();
  });
});

it.skipIf(!TEM_RASTERIZADOR)('a borda esquerda deixa 2 mm de papel livre, sem deslocar a grade', async () => {
  const file = await arquivo('a');
  const padrao = await labels(contexto([file], { modo: 'repetir' }));
  const semBorda = await labels(contexto([file], { modo: 'repetir', bordaEsquerdaMm: 0 }));
  const render = async (blob: Blob) => rasterizar(new Uint8Array(await blob.arrayBuffer()), 127);
  const [com, sem] = await Promise.all([render(padrao.files[0].blob), render(semBorda.files[0].blob)]);
  // 127 DPI = 5 pixels/mm. Mede o diâmetro horizontal na primeira fileira.
  const linha = Math.round((7.976 + 42.33 / 2) * 5);
  const antes = faixasDaLinha(sem.escuro[linha]);
  const depois = faixasDaLinha(com.escuro[linha]);
  expect(antes).toHaveLength(4);
  expect(depois).toHaveLength(4);
  for (let coluna = 0; coluna < 4; coluna += 1) {
    expect(depois[coluna].inicio - antes[coluna].inicio).toBeCloseTo(10, 0);
    expect(depois[coluna].inicio + depois[coluna].largura)
      .toBe(antes[coluna].inicio + antes[coluna].largura);
  }
});
