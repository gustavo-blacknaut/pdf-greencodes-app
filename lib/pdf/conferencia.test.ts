import { expect, it } from 'vitest';
import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import { runOperation } from './engine';
import { openWithPdfJs } from './nucleo';
import { loadPdfJs } from './lazy';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { LoadedFile } from './tipos';
import { rasterizar, faixasDaLinha, TEM_RASTERIZADOR } from './raster-de-teste';

async function mixed(): Promise<LoadedFile> {
  const doc = await PDFDocument.create();
  for (const [width, height, giro, texto] of [
    [210, 297, 0, 'A4 PRIMEIRA'], [297, 420, 0, 'A3'],
    [210, 297, 90, 'A4 DEITADA'], [210.2, 297.1, 0, 'A4 ULTIMA'],
  ] as const) {
    const page = doc.addPage([width * 72 / 25.4, height * 72 / 25.4]);
    page.drawText(texto, { x: 40, y: 40 });
    page.setRotation(degrees(giro));
  }
  const bytes = (await doc.save()).slice().buffer;
  return { id: 'a', name: 'misto.pdf', bytes, size: bytes.byteLength, type: 'application/pdf', thumbnail: null, pageCount: 4 };
}

it('separa A3 de A4, conserva o texto e respeita a rotação de paisagem', async () => {
  const result = await runOperation('split-by-size', { files: [await mixed()], options: {}, onProgress() {} });
  expect(result.files.map((file) => [file.name, file.pages])).toEqual([['paginas-A4.pdf', 3], ['paginas-A3.pdf', 1]]);
  const pdfjs = await loadPdfJs();
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(createRequire(import.meta.url).resolve('pdfjs-dist/build/pdf.worker.min.mjs')).href;
  const doc = await openWithPdfJs(await result.files[0].blob.arrayBuffer());
  try {
    const textos: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      textos.push((await page.getTextContent()).items.filter((item) => 'str' in item).map((item) => 'str' in item ? item.str : '').join(' '));
    }
    expect(textos).toEqual(['A4 PRIMEIRA', 'A4 DEITADA', 'A4 ULTIMA']);
  } finally { await doc.destroy(); }
});

it('separa sentidos quando pedido e aceita tolerância zero', async () => {
  const result = await runOperation('split-by-size', { files: [await mixed()],
    options: { orientacoes: true, toleranciaMm: 0 }, onProgress() {} });
  expect(result.files).toHaveLength(4);
  const deitada = result.files.find((file) => file.name.includes('paisagem'))!;
  const pdf = await PDFDocument.load(await deitada.blob.arrayBuffer());
  expect(pdf.getPage(0).getRotation().angle).toBe(90);
  expect(new Set(result.files.map((file) => file.name)).size).toBe(4);
});

it.each(['6093', '6180', '6187', 'regua'])('gera uma referência válida para %s no papel correto', async (modelo) => {
  const result = await runOperation('print-calibration', { files: [], options: { modelo }, onProgress() {} });
  const pdf = await PDFDocument.load(await result.files[0].blob.arrayBuffer());
  const regua = modelo === 'regua';
  expect(pdf.getPageCount()).toBe(regua ? 1 : 2);
  expect(pdf.getPage(0).getWidth() * 25.4 / 72).toBeCloseTo(regua ? 210 : 215.9, 3);
  expect(result.papelImpressao).toBe(regua ? 'A4' : 'Letter');
});

it.skipIf(!TEM_RASTERIZADOR)('a referência da 6093 desenha quatro contornos nas medidas do molde', async () => {
  const result = await runOperation('print-calibration', { files: [], options: { modelo: '6093' }, onProgress() {} });
  const mapa = rasterizar(new Uint8Array(await result.files[0].blob.arrayBuffer()), 127, 0, 240);
  // No diâmetro da primeira fileira há os oito contornos e quatro cruzes centrais.
  const faixas = faixasDaLinha(mapa.escuro[Math.round((7.976 + 42.33 / 2) * 5)]);
  expect(faixas).toHaveLength(12);
  for (let coluna = 0; coluna < 4; coluna += 1) {
    expect(faixas[coluna * 3].inicio / 5).toBeCloseTo(7.976 + coluna * 52.541, 0);
  }
});
