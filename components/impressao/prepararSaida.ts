import { runOperation, type LoadedFile, type RunContext } from '../../lib/pdf/engine';
import { loadPdfJs } from '../../lib/pdf/lazy';
import type { ItemFila } from './tipos';

/** O PDF já foi validado na fila. Não abre workers nem gera miniaturas de novo. */
export async function prepararSaida(
  alvo: ItemFila,
  porFolha: number,
  intervalo: string,
  papel = 'A4',
  signal?: AbortSignal,
): Promise<{ blob: Blob; paginas: number }> {
  if (!alvo.blob) throw new Error('O arquivo ainda não está pronto.');
  let blob = alvo.blob;
  let paginas: number | undefined = alvo.paginas;
  const etapas: { id: 'split' | 'n-up'; options: RunContext['options'] }[] = [
    ...(intervalo.trim() ? [{ id: 'split' as const, options: { mode: 'extract', extractRanges: intervalo } }] : []),
    ...(porFolha > 1 ? [{ id: 'n-up' as const, options: { perSheet: porFolha, papel, espacamentoMm: 0, margemMm: 0, border: false } }] : []),
  ];
  for (const etapa of etapas) {
    signal?.throwIfAborted();
    const arquivo: LoadedFile = {
      id: alvo.id, name: alvo.nome, size: blob.size, type: 'application/pdf',
      bytes: await blob.arrayBuffer(), pageCount: paginas ?? null, thumbnail: null,
    };
    signal?.throwIfAborted();
    const resultado = await runOperation(etapa.id, {
      files: [arquivo], options: etapa.options, onProgress: () => {}, signal,
    });
    blob = resultado.files[0].blob;
    paginas = resultado.files[0].pages;
  }
  signal?.throwIfAborted();
  if (paginas === undefined) {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    try { paginas = doc.numPages; } finally { await doc.destroy(); }
  }
  return { blob, paginas };
}
