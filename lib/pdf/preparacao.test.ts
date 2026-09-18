import { expect, it } from 'vitest';
import { PDFDocument, PDFName, degrees } from '@cantoo/pdf-lib';
import { runOperation, type LoadedFile } from './engine';
import { celulaCsv } from './operacoes/preparacao';

async function exemplo(): Promise<LoadedFile> {
  const doc = await PDFDocument.create();
  for (const giro of [0, 90, 180, 270]) {
    const pagina = doc.addPage([600, 800]);
    pagina.drawText(`Pagina ${giro}`, { x: 30, y: 60 });
    pagina.setCropBox(10, 20, 400, 600);
    pagina.setRotation(degrees(giro));
  }
  doc.addPage([200, 200]);
  const bytes = (await doc.save()).slice().buffer;
  return { id: 'a', name: 'exemplo.pdf', type: 'application/pdf', size: bytes.byteLength,
    bytes, thumbnail: null, pageCount: 5 };
}

it.each(['retrato', 'paisagem'])('padroniza %s preservando área visível, conteúdo vetorial e página quadrada', async (orientacao) => {
  const entrada = await exemplo();
  const resultado = await runOperation('normalize-orientation', { files: [entrada], options: { orientacao }, onProgress() {} });
  const doc = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());
  expect(doc.getPageCount()).toBe(5);
  for (const pagina of doc.getPages().slice(0, 4)) {
    expect(pagina.getCropBox()).toEqual({ x: 10, y: 20, width: 400, height: 600 });
    expect(pagina.getRotation().angle % 180).toBe(orientacao === 'paisagem' ? 90 : 0);
    expect(pagina.node.Contents()).toBeDefined();
    expect(pagina.node.Resources()?.get(PDFName.of('Font'))).toBeDefined();
  }
  expect(doc.getPage(4).getRotation().angle).toBe(0);
});

it('usa o sentido anti-horário solicitado', async () => {
  const resultado = await runOperation('normalize-orientation', { files: [await exemplo()],
    options: { orientacao: 'paisagem', sentido: 'anti-horario' }, onProgress() {} });
  const doc = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());
  expect(doc.getPages().map(p => p.getRotation().angle)).toEqual([270, 90, 90, 270, 0]);
});

it('relatório usa as medidas do recorte, considera rotação e conserva ordem dos arquivos', async () => {
  const entrada = await exemplo();
  const resultado = await runOperation('page-report', { files: [entrada, { ...entrada, id: 'b', name: '=SOMA(1).pdf' }],
    options: {}, onProgress() {} });
  const texto = await resultado.files[0].blob.text();
  const linhas = texto.split('\r\n');
  expect(linhas).toHaveLength(11);
  expect(linhas[1]).toBe('"exemplo.pdf";1;141,11;211,67;Retrato;0');
  expect(linhas[2]).toBe('"exemplo.pdf";2;211,67;141,11;Paisagem;90');
  expect(linhas[5]).toContain(';Quadrada;0');
  expect(linhas[6]).toContain('"\'=SOMA(1).pdf";1;');
});

it.each(['=1+1', '+1', '-1', '@A1', '\t=1'])('neutraliza fórmula em nome de arquivo %s', (valor) => {
  expect(celulaCsv(valor)).toBe(`"'${valor}"`);
});

it('escapa aspas e delimitadores no CSV', () => {
  expect(celulaCsv('arquivo;"teste".pdf')).toBe('"arquivo;""teste"".pdf"');
});
