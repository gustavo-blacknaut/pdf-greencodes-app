import { afterEach, describe, expect, it, vi } from 'vitest';
import { vault, SEM_PRAZO } from './ephemeral';

afterEach(() => { vault.purgeAll(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('resultado entre ferramentas', () => {
  it('sobrevive à saída da ferramenta e pode ser consumido pela impressão', async () => {
    const blob = new Blob(['arquivo de teste']);
    const original = vault.store([{ name: 'saida.pdf', blob }], SEM_PRAZO);
    const transferencia = vault.transfer(original.id, 'saida.pdf');
    vault.purge(original.id, 'saiu');
    expect(vault.get(original.id)).toBeUndefined();
    const recebido = vault.get(transferencia.id)!.files[0].blob;
    expect(recebido).toBe(blob);
    vault.purge(transferencia.id, 'saiu');
    expect(await recebido.text()).toBe('arquivo de teste');
  });

  it('não mantém transferências abandonadas para sempre', () => {
    vi.useFakeTimers();
    const original = vault.store([{ name: 'a.pdf', blob: new Blob() }], SEM_PRAZO);
    const transferencia = vault.transfer(original.id, 'a.pdf');
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(vault.get(transferencia.id)).toBeUndefined();
    expect(vault.get(original.id)).toBeDefined();
  });

  it('revoga todas as URLs mesmo em downloads repetidos antes do timeout', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:primeiro').mockReturnValueOnce('blob:segundo');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('document', { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } });
    const item = vault.store([{ name: 'a.pdf', blob: new Blob() }], SEM_PRAZO);
    vault.download(item.id, 'a.pdf');
    vault.download(item.id, 'a.pdf');
    vault.purge(item.id);
    expect(create).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith('blob:primeiro');
    expect(revoke).toHaveBeenCalledWith('blob:segundo');
    vi.runAllTimers();
  });
});
