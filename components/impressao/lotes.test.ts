import { afterEach, expect, it, vi } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { fatiarParaImpressao } from './lotes';
import { lerOpcoesSalvas } from './fila';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('impressões antigas não restauram 150 ou 300 DPI como padrão', () => {
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ dpi: 150, impressora: 'Teste', papel: 'Letter' }) });
  expect(lerOpcoesSalvas()).toMatchObject({ dpi: 600, impressora: 'Teste', papel: 'Letter' });
});

it('produz os lotes sob demanda e preserva a ordem e as medidas das páginas', async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 5; i += 1) doc.addPage([100 + i, 200]).drawText(`P${i}`);
  const blob = new Blob([(await doc.save()).slice().buffer]);
  const criar = vi.spyOn(PDFDocument, 'create');
  const gerador = fatiarParaImpressao(blob, 2);
  expect(criar).not.toHaveBeenCalled();
  const primeiro = await gerador.next();
  expect(criar).toHaveBeenCalledTimes(1);
  expect(primeiro.value).toMatchObject({ indice: 1, total: 3 });
  const resultados = [primeiro.value!];
  for await (const lote of gerador) resultados.push(lote);
  const larguras: number[] = [];
  for (const parte of resultados) {
    const pdf = await PDFDocument.load(await parte.blob.arrayBuffer());
    larguras.push(...pdf.getPages().map((page) => page.getWidth()));
  }
  expect(larguras).toEqual([100, 101, 102, 103, 104]);
});
