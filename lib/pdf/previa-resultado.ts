import type { OutputFile } from './tipos';

export type TipoDePrevia = 'pdf' | 'imagem' | 'texto' | 'word';

export function tipoDePrevia(arquivo: Pick<OutputFile, 'name' | 'blob'>): TipoDePrevia | null {
  const extensao = arquivo.name.split('.').pop()?.toLowerCase();
  if (extensao === 'pdf' || arquivo.blob.type === 'application/pdf') return 'pdf';
  if (extensao === 'docx') return 'word';
  if (/^(png|jpe?g|webp|gif|bmp|avif|svg)$/.test(extensao ?? '')) return 'imagem';
  if (/^(txt|csv|json|xml|log)$/.test(extensao ?? '')) return 'texto';
  return null;
}
