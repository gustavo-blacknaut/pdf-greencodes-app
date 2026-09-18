import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openWithPdfJs, renderPageToCanvas } from './nucleo';
import { createOcrWorker } from './ocr';
import { pdfToText, pdfToWord, ocr } from './operacoes/texto';
import { pdfToImages } from './operacoes/converter';
import { grayscale, compress } from './operacoes/otimizar';
import type { RunContext } from './tipos';

vi.mock('./nucleo', async (original) => ({
  ...await original<typeof import('./nucleo')>(), openWithPdfJs: vi.fn(), renderPageToCanvas: vi.fn(),
}));
vi.mock('./ocr', () => ({ createOcrWorker: vi.fn() }));

const canvas = { width: 120, height: 200 };
const destroy = vi.fn(async () => {});
const page = { getTextContent: vi.fn(async () => { throw new Error('página corrompida'); }) };
const doc = { numPages: 1, getPage: vi.fn(async () => page), destroy };
const ctx: RunContext = { files: [{ id: 'a', name: 'a.pdf', bytes: new ArrayBuffer(0), size: 0,
  type: 'application/pdf', pageCount: 1, thumbnail: null }], options: {}, onProgress() {} };

beforeEach(() => {
  vi.clearAllMocks();
  canvas.width = 120; canvas.height = 200;
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.mocked(openWithPdfJs).mockResolvedValue(doc as unknown as Awaited<ReturnType<typeof openWithPdfJs>>);
  vi.mocked(renderPageToCanvas).mockRejectedValue(new Error('canvas indisponível'));
});
afterEach(() => vi.unstubAllGlobals());

it.each([pdfToText, pdfToWord, pdfToImages, grayscale].map(operacao => ({ nome: operacao.name, operacao })))('encerra o documento quando $nome falha', async ({ operacao }) => {
  await expect(operacao(ctx)).rejects.toThrow();
  expect(destroy).toHaveBeenCalledTimes(1);
  if (operacao === pdfToImages || operacao === grayscale) expect(canvas.width).toBe(0);
});

it('libera os recursos quando a compressão rasterizada falha', async () => {
  await expect(compress({ ...ctx, options: { level: 'maxima' } })).rejects.toThrow();
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(canvas.width).toBe(0);
});

it('falha ao iniciar OCR também libera o documento e o canvas', async () => {
  vi.mocked(createOcrWorker).mockRejectedValue(new Error('OCR indisponível'));
  await expect(ocr(ctx)).rejects.toThrow('OCR indisponível');
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(canvas.width).toBe(0);
});
