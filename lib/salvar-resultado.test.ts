import { beforeEach, expect, it, vi } from 'vitest';
import { salvarResultado } from './salvar-resultado';
import { salvarNumerado } from './desktop';
vi.mock('./desktop', () => ({ salvarNumerado: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

it('a gravação automática e um clique simultâneo compartilham a mesma escrita', async () => {
  const arquivo = { name: 'a.pdf', blob: new Blob(['teste']) };
  vi.mocked(salvarNumerado).mockResolvedValue({ ok: true, caminho: 'C:/resultado.pdf' });
  const primeira = salvarResultado(arquivo);
  const segunda = salvarResultado(arquivo);
  expect(primeira).toBe(segunda);
  await Promise.all([primeira, segunda]);
  await salvarResultado(arquivo);
  expect(salvarNumerado).toHaveBeenCalledTimes(1);
});

it('uma falha permite tentar salvar novamente, sem rejeição não tratada', async () => {
  const arquivo = { name: 'a.pdf', blob: new Blob() };
  vi.mocked(salvarNumerado).mockRejectedValueOnce(new Error('disco cheio'))
    .mockResolvedValueOnce({ ok: true, caminho: 'C:/resultado.pdf' });
  expect(await salvarResultado(arquivo)).toMatchObject({ ok: false, erro: 'disco cheio' });
  expect(await salvarResultado(arquivo)).toMatchObject({ ok: true });
  expect(salvarNumerado).toHaveBeenCalledTimes(2);
});

it('um resultado do motor que já está no disco não é regravado como blob vazio', async () => {
  const arquivo = { name: 'a.pdf', blob: new Blob(), caminho: 'C:/pronto.pdf' };
  expect(await salvarResultado(arquivo)).toEqual({ ok: true, caminho: arquivo.caminho });
  expect(salvarNumerado).not.toHaveBeenCalled();
});
