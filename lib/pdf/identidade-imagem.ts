/** Deduplicação por conteúdo, nunca só pelas dimensões ou pelo tamanho do PNG. */
export async function identidadeDaImagem(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
