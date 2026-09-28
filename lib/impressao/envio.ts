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
  let proximoFim = 0;
  let parte = 0;
  let totalDePartes = 1;
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
      if (!proximoFim) {
        const primeiro = tamanho > 0 ? Math.min(tamanho, total) : total;
        const seguintes = Math.max(16, tamanho * 4);
        proximoFim = primeiro;
        totalDePartes = tamanho > 0 ? 1 + Math.ceil((total - primeiro) / seguintes) : 1;
      }
      atual ??= await transporte.preparar();
      await transporte.pagina(atual, indice, bytes);
      if (indice !== proximoFim && indice !== total) return;
      await esperar();
      const id = atual;
      atual = undefined;
      quantidadePendente = indice - enviadas;
      parte += 1;
      proximoFim = Math.min(total, proximoFim + Math.max(16, tamanho * 4));
      pendente = transporte.enviar(id, nomeDaParte(nome, parte, totalDePartes))
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
