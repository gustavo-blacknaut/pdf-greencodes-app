import { describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  ouvintes: new Map<string, (evento: { payload: unknown }) => void>(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: mock.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  TauriEvent: { DRAG_DROP: 'tauri://drag-drop', DRAG_ENTER: 'tauri://drag-enter', DRAG_LEAVE: 'tauri://drag-leave' },
  listen: async (nome: string, callback: (evento: { payload: unknown }) => void) => {
    mock.ouvintes.set(nome, callback);
    return () => mock.ouvintes.delete(nome);
  },
}));

import { aoSoltarArquivos } from './desktop';

describe('arquivos arrastados do Explorador', () => {
  it('usa o evento nativo e recebe apenas os arquivos validados pelo Rust', async () => {
    const permitido = { nome: 'foto.png', caminho: 'C:\\foto.png', tamanho: 120 };
    mock.invoke.mockResolvedValueOnce([permitido]);
    const receber = vi.fn();
    const desligar = aoSoltarArquivos(receber);

    mock.ouvintes.get('tauri://drag-drop')?.({ payload: { paths: ['C:\\foto.png'] } });
    await vi.waitFor(() => expect(receber).toHaveBeenCalledWith([permitido]));
    expect(mock.invoke).toHaveBeenCalledWith('arquivos_soltos', { caminhos: ['C:\\foto.png'] }, undefined);

    desligar();
  });
});
