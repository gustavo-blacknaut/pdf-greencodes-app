import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { runOperation } from './engine';
import { nomesUnicos } from './resultados';
import { identidadeDaImagem } from './identidade-imagem';
import { renderPageToCanvas } from './nucleo';
import type { LoadedFile } from './tipos';

it('nomes repetidos e diferenças de caixa não fazem um resultado esconder outro', () => {
  const files = ['a.pdf', 'A.PDF', 'a (2).pdf', 'a.pdf'].map((name, i) => ({ name, blob: new Blob([String(i)]) }));
  const unicos = nomesUnicos(files);
  expect(unicos.map((file) => file.name)).toEqual(['a.pdf', 'A (3).PDF', 'a (2).pdf', 'a (4).pdf']);
  expect(unicos.map((file) => file.blob)).toEqual(files.map((file) => file.blob));
});

it('imagens do mesmo tamanho em bytes são distintas quando o conteúdo é diferente', async () => {
  const a = new Blob(['imagem A']);
  const b = new Blob(['imagem B']);
  expect(a.size).toBe(b.size);
  expect(await identidadeDaImagem(a)).not.toBe(await identidadeDaImagem(b));
  expect(await identidadeDaImagem(a)).toBe(await identidadeDaImagem(new Blob(['imagem A'])));
});

it.each(['6093', 'livre'])('a senha do segundo arquivo protege a montagem de etiquetas %s', async (modelo) => {
  const files: LoadedFile[] = [];
  for (let i = 0; i < 2; i += 1) {
    const doc = await PDFDocument.create();
    doc.addPage([120, 120]).drawText(`ARTE ${i}`);
    if (i) doc.encrypt({ userPassword: 'segredo', ownerPassword: 'segredo' });
    const bytes = (await doc.save({ useObjectStreams: !i })).slice().buffer;
    files.push({ id: String(i), name: `${i}.pdf`, bytes, size: bytes.byteLength,
      pageCount: 1, thumbnail: null, type: 'application/pdf', ...(i ? { senha: 'segredo' } : {}) });
  }
  const result = await runOperation('labels', { files, options: { modelo, modo: 'sequencia' }, onProgress() {} });
  const bytes = await result.files[0].blob.arrayBuffer();
  await expect(PDFDocument.load(bytes)).rejects.toThrow();
  expect((await PDFDocument.load(bytes, { password: 'segredo' })).getPageCount()).toBe(1);
});

it('uma operação cancelada não começa a ler documentos', async () => {
  await expect(runOperation('reverse', { files: [], options: {}, signal: AbortSignal.abort(), onProgress() {} }))
    .rejects.toThrow('Operação cancelada');
});

describe('resolução real da impressão', () => {
  it('renderiza A4 a 600 DPI sem passar pelo teto de miniaturas', async () => {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 210 / 25.4 * 72 * scale, height: 297 / 25.4 * 72 * scale }),
      render: () => ({ promise: Promise.resolve() }),
    } as unknown as Parameters<typeof renderPageToCanvas>[0];
    const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {}, fillStyle: '' }) } as unknown as HTMLCanvasElement;
    await renderPageToCanvas(page, 600, canvas, 16384);
    expect(canvas.width).toBeGreaterThanOrEqual(4960);
    expect(canvas.height).toBeGreaterThanOrEqual(7015);
    await renderPageToCanvas(page, 600, canvas);
    expect(canvas.height).toBe(4200);
  });
});
