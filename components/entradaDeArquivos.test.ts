/**
 * A abertura dos arquivos da fila.
 *
 * Cem PDFs levavam 26 s porque eram abertos um de cada vez e cada um redesenhava
 * a lista inteira. O ganho só vale se três coisas continuarem verdadeiras: o
 * paralelismo tem teto (cem documentos juntos travam a máquina), o motor Python
 * continua atendendo um por vez, e nenhum arquivo se perde no meio dos lotes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@/lib/tools';

const estado = vi.hoisted(() => ({
  emAndamento: 0,
  maior: 0,
  noMotor: 0,
  maiorNoMotor: 0,
  miniaturasAoMesmoTempo: 0,
  maiorMiniatura: 0,
}));

const esperar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

vi.mock('@/lib/desktop', () => ({
  arquivoNoDisco: (arquivo: File) => (arquivo.name.startsWith('disco-') ? { caminho: 'no-disco', tamanho: 1 } : null),
}));

vi.mock('@/lib/pdf/engine', () => ({
  abrirNaMemoria: async (dados: unknown) => dados,
  inspectFile: async (arquivo: File, id: string) => {
    const doMotor = arquivo.name.startsWith('disco-');
    estado.emAndamento += 1;
    estado.maior = Math.max(estado.maior, estado.emAndamento);
    if (doMotor) {
      estado.noMotor += 1;
      estado.maiorNoMotor = Math.max(estado.maiorNoMotor, estado.noMotor);
    }
    await esperar(2);
    estado.emAndamento -= 1;
    if (doMotor) estado.noMotor -= 1;
    if (arquivo.name.startsWith('quebra-')) throw new Error('não abriu');
    return { id, name: arquivo.name, size: 1, type: 'application/pdf', bytes: new ArrayBuffer(1), pageCount: 3, thumbnail: null };
  },
  gerarMiniatura: async () => {
    estado.miniaturasAoMesmoTempo += 1;
    estado.maiorMiniatura = Math.max(estado.maiorMiniatura, estado.miniaturasAoMesmoTempo);
    await esperar(2);
    estado.miniaturasAoMesmoTempo -= 1;
    return 'data:image/jpeg;base64,x';
  },
}));

import { aplicarMudancas, lerNaFila, miniaturaSobDemanda } from './entradaDeArquivos';
import type { ArquivoNaFila } from './FilaDeArquivos';

const ferramenta = (extras: Partial<Tool> = {}) =>
  ({ multiple: true, accept: ['.pdf'], acceptLabel: 'PDF', ...extras }) as Tool;

function leva(nomes: string[]) {
  return nomes.map((nome, i) => ({
    file: new File(['x'], nome),
    item: { id: `id${i}`, name: nome, size: 1, loading: true } as ArquivoNaFila,
  }));
}

beforeEach(() => {
  Object.assign(estado, {
    emAndamento: 0,
    maior: 0,
    noMotor: 0,
    maiorNoMotor: 0,
    miniaturasAoMesmoTempo: 0,
    maiorMiniatura: 0,
  });
});

describe('aplicarMudancas', () => {
  const fila: ArquivoNaFila[] = [
    { id: 'a', name: 'a.pdf', size: 1, loading: true },
    { id: 'b', name: 'b.pdf', size: 1, loading: true },
    { id: 'c', name: 'c.pdf', size: 1, loading: true },
  ];

  it('muda só os arquivos do lote e mantém a ordem da fila', () => {
    const nova = aplicarMudancas(fila, [
      ['c', { loading: false }],
      ['a', { loading: false }],
    ]);
    expect(nova.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(nova.map((i) => i.loading)).toEqual([false, true, false]);
  });

  it('junta duas mudanças do mesmo arquivo, na ordem em que vieram', () => {
    const nova = aplicarMudancas(fila, [
      ['b', { etapa: 'lendo' }],
      ['b', { loading: false, error: 'x' }],
    ]);
    expect(nova[1]).toMatchObject({ etapa: 'lendo', loading: false, error: 'x' });
  });

  it('não mexe na fila que recebeu, e devolve o mesmo objeto do que não mudou', () => {
    const nova = aplicarMudancas(fila, [['a', { loading: false }]]);
    expect(fila[0].loading).toBe(true);
    expect(nova[1]).toBe(fila[1]);
  });
});

describe('lerNaFila', () => {
  const nomes = (n: number, prefixo = 'arquivo') => Array.from({ length: n }, (_, i) => `${prefixo}-${i}.pdf`);

  it('abre vários ao mesmo tempo, mas nunca passa de seis', async () => {
    await lerNaFila(leva(nomes(40)), ferramenta(), () => {});
    expect(estado.maior).toBeGreaterThan(1);
    expect(estado.maior).toBeLessThanOrEqual(6);
  });

  it('nenhum arquivo se perde: todos chegam à tela, prontos', async () => {
    const chegou = new Map<string, Partial<ArquivoNaFila>>();
    await lerNaFila(leva(nomes(40)), ferramenta(), (lote) => lote.forEach(([id, m]) => chegou.set(id, m)));
    expect(chegou.size).toBe(40);
    expect([...chegou.values()].every((m) => m.loading === false && m.data?.pageCount === 3)).toBe(true);
  });

  it('agrupa as atualizações: bem menos avisos à tela do que arquivos', async () => {
    let avisos = 0;
    await lerNaFila(leva(nomes(60)), ferramenta(), () => {
      avisos += 1;
    });
    expect(avisos).toBeGreaterThan(0);
    expect(avisos).toBeLessThan(15);
  });

  it('o que sobra do último intervalo também sai, sem esperar o relógio', async () => {
    let recebidos = 0;
    await lerNaFila(leva(['um.pdf']), ferramenta(), (lote) => {
      recebidos += lote.length;
    });
    expect(recebidos).toBe(1);
  });

  it('um arquivo que não abre vira erro só dele, e os outros seguem', async () => {
    const chegou = new Map<string, Partial<ArquivoNaFila>>();
    await lerNaFila(leva(['bom-1.pdf', 'quebra-2.pdf', 'bom-3.pdf']), ferramenta(), (lote) =>
      lote.forEach(([id, m]) => chegou.set(id, m)),
    );
    expect(chegou.get('id1')).toMatchObject({ loading: false, error: 'não abriu' });
    expect(chegou.get('id0')?.error).toBeUndefined();
    expect(chegou.get('id2')?.data?.pageCount).toBe(3);
  });

  it('o que está no disco passa pelo motor um por vez, mesmo com a fila em paralelo', async () => {
    await lerNaFila(leva([...nomes(10, 'disco'), ...nomes(10, 'memoria')]), ferramenta(), () => {});
    expect(estado.maiorNoMotor).toBe(1);
    expect(estado.maior).toBeGreaterThan(1);
  });

  it('a grade de páginas volta a abrir um de cada vez: ela traz o documento para a memória', async () => {
    await lerNaFila(leva(nomes(10)), ferramenta({ board: 'organize' }), () => {});
    expect(estado.maior).toBe(1);
  });
});

describe('miniaturaSobDemanda', () => {
  it('desenha duas de cada vez, por mais que peçam', async () => {
    const arquivo = {
      id: 'x',
      name: 'x.pdf',
      size: 1,
      type: 'application/pdf',
      bytes: new ArrayBuffer(1),
      pageCount: 1,
      thumbnail: null,
    };
    const feitas = await Promise.all(Array.from({ length: 12 }, () => miniaturaSobDemanda(arquivo)));
    expect(feitas.every((m) => m === 'data:image/jpeg;base64,x')).toBe(true);
    expect(estado.maiorMiniatura).toBe(2);
  });
});
