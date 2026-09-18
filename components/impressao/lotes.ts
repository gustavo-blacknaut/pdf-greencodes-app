import { loadPdfLib } from '../../lib/pdf/lazy';

/** Produz só o lote que será enviado agora, preservando texto e vetores. */
export async function* fatiarParaImpressao(blob: Blob, tamanho: number): AsyncGenerator<{
  blob: Blob; indice: number; total: number;
}> {
  if (!Number.isFinite(tamanho) || tamanho < 1) {
    yield { blob, indice: 1, total: 1 };
    return;
  }
  const { PDFDocument } = await loadPdfLib();
  const origem = await PDFDocument.load(await blob.arrayBuffer());
  const paginas = origem.getPageCount();
  const porLote = Math.floor(tamanho);
  const total = Math.ceil(paginas / porLote);
  if (total <= 1) {
    yield { blob, indice: 1, total: 1 };
    return;
  }
  for (let inicio = 0; inicio < paginas; inicio += porLote) {
    const indices = Array.from({ length: Math.min(porLote, paginas - inicio) }, (_, k) => inicio + k);
    const parte = await PDFDocument.create();
    for (const pagina of await parte.copyPages(origem, indices)) parte.addPage(pagina);
    const bytes = await parte.save({ useObjectStreams: true });
    yield { blob: new Blob([bytes.slice().buffer], { type: 'application/pdf' }),
      indice: Math.floor(inicio / porLote) + 1, total };
  }
}
