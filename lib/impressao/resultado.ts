import { lerCaminho } from '../desktop';
import type { OutputFile } from '../pdf/engine';

export async function resultadoParaImpressao(arquivo: OutputFile): Promise<Blob> {
  if (arquivo.blob.size) return arquivo.blob;
  if (!arquivo.caminho) throw new Error(`O resultado ${arquivo.name} está vazio. Gere o arquivo novamente.`);
  const bytes = await lerCaminho(arquivo.caminho);
  if (!bytes.byteLength) throw new Error(`O arquivo ${arquivo.name} está vazio no disco.`);
  return new Blob([bytes], { type: arquivo.blob.type || 'application/pdf' });
}
