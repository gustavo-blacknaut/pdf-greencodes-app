import { beforeEach, expect, it, vi } from 'vitest';
import type { ItemFila } from './tipos';
import { prepararSaida } from './prepararSaida';
import { runOperation } from '../../lib/pdf/engine';
import { loadPdfJs } from '../../lib/pdf/lazy';

vi.mock('../../lib/pdf/engine', () => ({ runOperation: vi.fn() }));
vi.mock('../../lib/pdf/lazy', () => ({ loadPdfJs: vi.fn() }));

const origem = new Blob(['pdf validado pela fila'], { type: 'application/pdf' });
const alvo: ItemFila = { id: '1', nome: 'prova.pdf', nomeOriginal: 'prova.pdf', origem, blob: origem, paginas: 5, estado: 'pronto' };

beforeEach(() => vi.resetAllMocks());

it('reutiliza o PDF e a contagem sem abrir outro leitor quando não há montagem', async () => {
  expect(await prepararSaida(alvo, 1, '')).toEqual({ blob: origem, paginas: 5 });
  expect(runOperation).not.toHaveBeenCalled();
  expect(loadPdfJs).not.toHaveBeenCalled();
});

it('extrai antes de montar, sem margens escondidas e sem gerar miniaturas', async () => {
  const extraido = new Blob(['paginas escolhidas']);
  const montado = new Blob(['duas A5 em A4']);
  vi.mocked(runOperation).mockResolvedValueOnce({ files: [{ name: 'extraido.pdf', blob: extraido, pages: 3 }], notes: [], inputBytes: 0, outputBytes: 0 });
  vi.mocked(runOperation).mockResolvedValueOnce({ files: [{ name: 'montado.pdf', blob: montado, pages: 2 }], notes: [], inputBytes: 0, outputBytes: 0 });
  expect(await prepararSaida(alvo, 2, '1-3')).toEqual({ blob: montado, paginas: 2 });
  const [extracao, montagem] = vi.mocked(runOperation).mock.calls;
  expect(extracao[0]).toBe('split');
  expect(montagem[0]).toBe('n-up');
  expect(montagem[1].options).toEqual({ perSheet: 2, papel: 'A4', margemMm: 0, espacamentoMm: 0, border: false });
  expect(new TextDecoder().decode(montagem[1].files[0].bytes)).toBe('paginas escolhidas');
  expect(loadPdfJs).not.toHaveBeenCalled();
});

it('não inicia trabalho que já ficou obsoleto', async () => {
  const cancelamento = new AbortController();
  cancelamento.abort();
  await expect(prepararSaida(alvo, 2, '', 'A4', cancelamento.signal)).rejects.toThrow();
  expect(runOperation).not.toHaveBeenCalled();
});
