import { salvarNumerado, type ResultadoSalvar } from './desktop';
import type { OutputFile } from './pdf/tipos';

const gravacoes = new WeakMap<OutputFile, Promise<ResultadoSalvar>>();

/** Compartilha a gravação automática com cliques e remontagens da mesma tela. */
export function salvarResultado(arquivo: OutputFile, apagarEm1Dia = false): Promise<ResultadoSalvar> {
  if (arquivo.caminho) return Promise.resolve({ ok: true, caminho: arquivo.caminho });
  const existente = gravacoes.get(arquivo);
  if (existente) return existente;
  const tarefa = salvarNumerado(arquivo.name, arquivo.blob, apagarEm1Dia)
    .catch((erro: unknown): ResultadoSalvar => ({
      ok: false, erro: erro instanceof Error ? erro.message : 'Não foi possível salvar o arquivo.',
    }))
    .then((resultado) => {
      if (!resultado.ok || !resultado.caminho) gravacoes.delete(arquivo);
      return resultado;
    });
  gravacoes.set(arquivo, tarefa);
  return tarefa;
}
