import { isPasswordError, openWithPdfLib, toPdfBlob } from '../pdf/nucleo';

export async function desbloquearParaImpressao(origem: Blob, senha: string): Promise<{ blob: Blob; paginas: number }> {
  try {
    const documento = await openWithPdfLib(await origem.arrayBuffer(), senha);
    return {
      blob: toPdfBlob(await documento.save({ useObjectStreams: true })),
      paginas: documento.getPageCount(),
    };
  } catch (erro) {
    throw new Error(isPasswordError(erro)
      ? 'Senha incorreta para este arquivo.'
      : 'Não foi possível preparar este PDF para impressão.');
  }
}
