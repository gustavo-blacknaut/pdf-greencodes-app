import type { PDFDocument, PDFEmbeddedPage } from '@cantoo/pdf-lib';
import type { RunContext } from '../tipos';
import { openWithPdfLib } from '../nucleo';
import { pareceSerImagem } from '../guards';
import { semGiro } from './grafica';
import { yieldToBrowser } from '../../utils';

/** Incorpora cada arte uma vez; as cópias reutilizam o mesmo objeto no PDF. */
export async function prepararArtes(
  ctx: RunContext,
  out: PDFDocument,
  porFolha: number,
  converterImagem: (arquivo: RunContext['files'][number]) => Promise<ArrayBuffer>,
): Promise<PDFEmbeddedPage[]> {
  const sequencia = ctx.options.modo === 'sequencia';
  const artes: PDFEmbeddedPage[] = [];
  let total = 0;
  for (const arquivo of ctx.files) {
    ctx.signal?.throwIfAborted();
    const quantidade = sequencia ? Number(ctx.options[`quantidade:${arquivo.id}`] ?? 1) : 1;
    if (!Number.isInteger(quantidade) || quantidade < 0 || quantidade > 5000) {
      throw new Error(`Informe uma quantidade inteira de 0 a 5000 para ${arquivo.name}.`);
    }
    if (quantidade === 0) continue;
    ctx.onProgress(0, `Preparando ${arquivo.name}`);
    const bytes = pareceSerImagem(arquivo.name, arquivo.type)
      ? await converterImagem(arquivo)
      : arquivo.bytes;
    const doc = await semGiro(await openWithPdfLib(bytes, arquivo.senha));
    total += doc.getPageCount() * quantidade * (sequencia ? 1 : porFolha);
    if (total > 5000) throw new Error('A montagem ultrapassa 5000 etiquetas. Divida em lotes menores.');
    const paginas = await out.embedPages(doc.getPages());
    for (const pagina of paginas) {
      for (let copia = 0; copia < quantidade; copia += 1) artes.push(pagina);
    }
    await yieldToBrowser();
  }
  if (artes.length === 0) throw new Error('Escolha pelo menos uma etiqueta para montar.');
  return artes;
}
