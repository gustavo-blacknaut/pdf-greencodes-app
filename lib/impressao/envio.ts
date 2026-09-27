export type RespostaEnvio = { ok: boolean; erro?: string; cancelado?: boolean };
export type Transporte = {
  preparar: () => Promise<string>;
  pagina: (id: string, indice: number, bytes: ArrayBuffer) => Promise<unknown>;
  enviar: (id: string, nome: string) => Promise<RespostaEnvio>;
  descartar: (id: string) => Promise<unknown>;
};

export function nomeDaParte(nome: string, indice: number, total: number): string {
  return total > 1 ? `${nome.replace(/\.[^.]+$/, '')} - parte ${indice} de ${total}.pdf` : nome;
}

export async function enviarEmFluxo(
  nome: string,
  tamanho: number,
  transporte: Transporte,
  desenhar: (entregar: (indice: number, bytes: ArrayBuffer, total: number) => Promise<unknown>) => Promise<number>,
): Promise<RespostaEnvio> {
  let atual: string | undefined;
  let pendente: Promise<RespostaEnvio> | undefined;
  let enviadas = 0;
  let quantidadePendente = 0;
  let cancelado = false;
  const esperar = async () => {
    if (!pendente) return;
    const resposta = await pendente;
    pendente = undefined;
    if (resposta.cancelado) { cancelado = true; throw new Error('Envio cancelado na impressora.'); }
    if (!resposta.ok) throw new Error(resposta.erro ?? 'A impressora recusou o trabalho.');
    enviadas += quantidadePendente;
  };
  try {
    await desenhar(async (indice, bytes, total) => {
      atual ??= await transporte.preparar();
      await transporte.pagina(atual, indice, bytes);
      const limite = tamanho > 0 ? tamanho : total;
      if (indice % limite !== 0 && indice !== total) return;
      await esperar();
      const id = atual;
      atual = undefined;
      quantidadePendente = indice % limite || limite;
      pendente = transporte.enviar(id, nomeDaParte(nome, Math.ceil(indice / limite), Math.ceil(total / limite)))
        .catch((e) => ({ ok: false, erro: e instanceof Error ? e.message : String(e) }));
    });
    await esperar();
    return { ok: true };
  } catch (e) {
    await esperar().catch(() => {});
    return { ok: false, cancelado, erro: `${e instanceof Error ? e.message : String(e)}${enviadas ? ` ${enviadas} página(s) já enviadas; confira a fila antes de repetir.` : ''}` };
  } finally {
    if (atual) await transporte.descartar(atual).catch(() => {});
  }
}
