import { expect, it } from 'vitest';
import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import { utils, write } from 'xlsx';
import { runOperation, inspectFile, type LoadedFile } from './engine';
import { lerPlanilha } from './operacoes/converter';

async function pdf(nome: string, larguras = [100, 200, 300]): Promise<LoadedFile> {
  const doc = await PDFDocument.create();
  for (const largura of larguras) {
    const pagina = doc.addPage([largura, 400]);
    pagina.drawText(nome, { x: 10, y: 20 });
    pagina.setRotation(degrees(90));
  }
  const bytes = (await doc.save()).slice().buffer;
  return { id: nome, name: nome, bytes, size: bytes.byteLength, type: 'application/pdf', thumbnail: null, pageCount: larguras.length };
}

it.each(['nao', 'sem-perda', 'alta'])('junta na ordem pedida com compressão %s', async compressaoApos => {
  const r = await runOperation('merge', { files: [await pdf('a.pdf'), await pdf('b.pdf', [500])],
    options: { compressaoApos }, onProgress() {} });
  const doc = await PDFDocument.load(await r.files[0].blob.arrayBuffer());
  expect(doc.getPages().map(p => p.getWidth())).toEqual([100, 200, 300, 500]);
  expect(r.notes.some(n => n.includes('conforme sua escolha'))).toBe(compressaoApos !== 'nao');
});

it('aplica ordem entre arquivos e gira somente as páginas escolhidas', async () => {
  const r = await runOperation('apply-plan', { files: [await pdf('a.pdf'), await pdf('b.pdf', [500])],
    options: { board: 'organize', plan: JSON.stringify([{ f: 1, i: 0, r: 270 }, { f: 0, i: 2, r: 0 }, { f: 0, i: 0, r: 180 }, { f: 0, i: 1, r: 90 }]) }, onProgress() {} });
  const doc = await PDFDocument.load(await r.files[0].blob.arrayBuffer());
  expect(doc.getPages().map(p => p.getWidth())).toEqual([500, 300, 100, 200]);
  expect(doc.getPages().map(p => p.getRotation().angle)).toEqual([0, 90, 270, 180]);
});

it.each(['xls', 'xlsx', 'xlsm'] as const)('inspeciona e converte um arquivo %s real, mantendo números formatados e texto longo', async formato => {
  const livro = utils.book_new();
  const folha = utils.aoa_to_sheet([['Descrição', '', 'Preço'], ['Texto que ultrapassa vinte e oito caracteres e deve permanecer completo', '', 12.5]]);
  folha.C2.z = '0.00';
  utils.book_append_sheet(livro, folha, 'Vendas');
  utils.book_append_sheet(livro, utils.aoa_to_sheet([['Outra aba']]), 'Resumo');
  const bytes = write(livro, { type: 'array', bookType: formato === 'xls' ? 'biff8' : formato }) as ArrayBuffer;
  const arquivo = await inspectFile(new File([bytes], `teste.${formato}`), 'excel');
  expect(arquivo.error).toBeUndefined();
  const abas = await lerPlanilha(bytes);
  expect(abas.map(a => a.nome)).toEqual(['Vendas', 'Resumo']);
  expect(abas[0].linhas[1][2]).toBe('12.50');
  expect(abas[0].linhas[1][0]).toContain('deve permanecer completo');
  const resultado = await runOperation('excel-to-pdf', { files: [arquivo], options: {}, onProgress() {} });
  const doc = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());
  expect(doc.getPageCount()).toBeGreaterThan(0);
});
