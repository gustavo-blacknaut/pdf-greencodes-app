/**
 * Cada quantidade por folha tem uma grade e uma orientação. O teste confere o
 * número de folhas e o tamanho delas, que é onde a orientação aparece.
 */
import { describe, expect, it } from 'vitest';
import { runOperation, type LoadedFile, type RunContext } from './engine';
import { loadPdfLib } from './lazy';
import { rasterizar, TEM_RASTERIZADOR, tintaEm } from './raster-de-teste';

async function pdfDe(paginas: number): Promise<ArrayBuffer> {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= paginas; i += 1) {
    doc.addPage([595, 842]).drawText(`P${i}`, { x: 40, y: 400, size: 30, font: f });
  }
  const b = await doc.save();
  return b.buffer as ArrayBuffer;
}

function ctx(bytes: ArrayBuffer, perSheet: number): RunContext {
  const file: LoadedFile = { id: 'a', name: 'doc.pdf', size: bytes.byteLength, type: 'application/pdf', bytes, pageCount: null, thumbnail: null };
  return { files: [file], options: { perSheet }, onProgress: () => {} };
}

async function medir(blob: Blob) {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.load(await blob.arrayBuffer());
  const { width, height } = doc.getPage(0).getSize();
  return { folhas: doc.getPageCount(), deitada: width > height };
}

describe('várias por folha', () => {
  it('mantém a posição de uma página em branco entre as artes', async () => {
    const { PDFDocument } = await loadPdfLib();
    const origem = await PDFDocument.create();
    origem.addPage([595, 842]);
    origem.addPage([595, 842]).drawText('SEGUNDA');
    origem.addPage([595, 842]).drawText('TERCEIRA');
    const resultado = await runOperation('n-up', ctx((await origem.save()).slice().buffer, 2));
    const pdf = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());
    expect(pdf.getPageCount()).toBe(2);
  });

  it.skipIf(!TEM_RASTERIZADOR).each([0, 90, 180, 270])('duas metades A5 em A4, inclusive /Rotate %s', async (giro) => {
    const { PDFDocument, rgb, degrees } = await loadPdfLib();
    const origem = await PDFDocument.create();
    for (let i = 0; i < 2; i += 1) {
      const p = origem.addPage(i === 0 ? [595.28, 841.89] : [841.89, 595.28]);
      p.drawRectangle({ x: 0, y: 0, width: p.getWidth(), height: p.getHeight(), color: rgb(0, 0, 0) });
      p.setRotation(degrees(giro));
    }
    const r = await runOperation('n-up', ctx((await origem.save()).buffer as ArrayBuffer, 2));
    const doc = await PDFDocument.load(await r.files[0].blob.arrayBuffer());
    expect(doc.getPage(0).getWidth() * 25.4 / 72).toBeCloseTo(297, 2);
    expect(doc.getPage(0).getHeight() * 25.4 / 72).toBeCloseTo(210, 2);
    const imagem = rasterizar(new Uint8Array(await r.files[0].blob.arrayBuffer()), 36);
    // Cada página precisa ocupar a altura toda e a sua metade da largura.
    // A grade antiga 1×2 deixaria quase toda esta região branca.
    for (const x of [5, 215]) {
      expect(tintaEm(imagem, { x, y: 5, largura: 195, altura: 285 })).toBeGreaterThan(0.98);
    }
  });

  const casos: [number, number, boolean][] = [
    // [por folha, folhas esperadas para 24 páginas, deitada]
    [2, 12, true],
    [4, 6, false],
    [6, 4, false],
    [8, 3, false],
    [9, 3, false],
    [12, 2, false],
    [16, 2, false],
  ];

  for (const [porFolha, folhas, deitada] of casos) {
    it(`${porFolha} por folha: 24 páginas viram ${folhas} folha(s)`, async () => {
      const r = await runOperation('n-up', ctx(await pdfDe(24), porFolha));
      const medida = await medir(r.files[0].blob);
      expect(medida.folhas).toBe(folhas);
      expect(medida.deitada).toBe(deitada);
    });
  }

  it('quantidade fora da lista cai em 2, em vez de quebrar', async () => {
    const r = await runOperation('n-up', ctx(await pdfDe(4), 7));
    expect((await medir(r.files[0].blob)).folhas).toBe(2);
  });
});
