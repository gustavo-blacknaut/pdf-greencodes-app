import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lerCaminho } from '../desktop';
import { resultadoParaImpressao } from './resultado';

vi.mock('../desktop', () => ({ lerCaminho: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe('resultado encaminhado para impressão', () => {
  it('reaproveita bytes em memória sem reler o disco', async () => {
    const blob = new Blob(['%PDF-1.7']);
    expect(await resultadoParaImpressao({ name: 'foto.pdf', blob, caminho: 'foto.pdf' })).toBe(blob);
    expect(lerCaminho).not.toHaveBeenCalled();
  });
  it('carrega resultado grande representado por caminho e blob vazio', async () => {
    vi.mocked(lerCaminho).mockResolvedValue(new TextEncoder().encode('%PDF-1.7').buffer);
    const blob = await resultadoParaImpressao({ name: 'grande.pdf', blob: new Blob([]), caminho: 'C:/resultado.pdf' });
    expect(await blob.text()).toBe('%PDF-1.7');
    expect(blob.type).toBe('application/pdf');
    expect(lerCaminho).toHaveBeenCalledWith('C:/resultado.pdf');
  });
  it('informa falha de leitura em vez de enviar PDF vazio', async () => {
    vi.mocked(lerCaminho).mockRejectedValue(new Error('Arquivo indisponível'));
    await expect(resultadoParaImpressao({ name: 'sumiu.pdf', blob: new Blob([]), caminho: 'sumiu.pdf' })).rejects.toThrow('Arquivo indisponível');
  });
  it('recusa resultado vazio sem caminho', async () => {
    await expect(resultadoParaImpressao({ name: 'vazio.pdf', blob: new Blob([]) })).rejects.toThrow('está vazio');
  });
});
