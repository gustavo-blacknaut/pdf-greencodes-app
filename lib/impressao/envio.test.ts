import { expect, it, vi } from 'vitest';
import { enviarEmFluxo, nomeDaParte, type Transporte } from './envio';

it('começa a enviar antes do fim do desenho e mantém a ordem com no máximo dois lotes', async () => {
  let liberar!: () => void;
  const barreira = new Promise<void>((r) => { liberar = r; });
  const eventos: string[] = [];
  let id = 0;
  const transporte: Transporte = {
    preparar: async () => String(++id),
    pagina: async (_, indice) => { eventos.push(`p${indice}`); },
    enviar: vi.fn(async (_, nome) => { eventos.push(nome); await barreira; return { ok: true }; }),
    descartar: vi.fn(),
  };
  const resultado = enviarEmFluxo('foto.pdf', 4, transporte, async (entregar) => {
    for (let i = 1; i <= 9; i++) {
      if (i === 8) {
        expect(transporte.enviar).toHaveBeenCalledTimes(1);
        expect(eventos).toContain('foto - parte 1 de 3.pdf');
        liberar();
      }
      await entregar(i, new ArrayBuffer(1), 9);
    }
    return 9;
  });
  expect(await resultado).toEqual({ ok: true });
  expect(transporte.enviar).toHaveBeenCalledTimes(3);
  expect(eventos.indexOf('foto - parte 1 de 3.pdf')).toBeLessThan(eventos.indexOf('p5'));
});

it('descarta o lote preparado e informa envio parcial quando o desenho falha', async () => {
  let id = 0;
  const descartar = vi.fn(async () => {});
  const resultado = await enviarEmFluxo('x', 2, {
    preparar: async () => String(++id), pagina: async () => {}, enviar: async () => ({ ok: true }), descartar,
  }, async (entregar) => {
    for (let i = 1; i <= 3; i++) await entregar(i, new ArrayBuffer(1), 5);
    throw new Error('desenho falhou');
  });
  expect(resultado.ok).toBe(false);
  expect(resultado.erro).toContain('2 página(s) já enviadas');
  expect(descartar).toHaveBeenCalledWith('2');
});

it('identifica partes mesmo quando o nome não termina em PDF', () => {
  expect(nomeDaParte('foto.jpg', 2, 3)).toBe('foto - parte 2 de 3.pdf');
  expect(nomeDaParte('Documento', 1, 2)).toBe('Documento - parte 1 de 2.pdf');
});
