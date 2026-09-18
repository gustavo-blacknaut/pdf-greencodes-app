/**
 * O leitor de PDF que a fila divide entre todos os arquivos.
 *
 * Sem ele, cada arquivo criava um Worker do pdf.js só para contar as páginas —
 * e recarregava o script inteiro a cada vez. Cem PDFs levavam 21 s; com um
 * leitor só, menos de 1 s. A economia só existe enquanto três coisas valem: a
 * fila usa a mesma instância, quem não é da fila continua com o seu próprio
 * (um cancelamento não pode derrubar o leitor dos outros), e um leitor
 * destruído é refeito em vez de quebrar a fila inteira.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pdfjsDeMentira = vi.hoisted(() => {
  class PDFWorker {
    static criados = 0;
    destroyed = false;
    constructor() {
      PDFWorker.criados += 1;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const chamadas: { worker?: unknown }[] = [];
  return {
    PDFWorker,
    chamadas,
    getDocument: (parametros: { worker?: unknown }) => {
      chamadas.push(parametros);
      return { promise: Promise.resolve({ numPages: 3 }), destroy: async () => {} };
    },
  };
});

vi.mock('./lazy', () => ({
  loadPdfJs: async () => pdfjsDeMentira,
  loadPdfLib: async () => ({}),
}));

import { openWithPdfJs } from './nucleo';

const bytes = () => new ArrayBuffer(8);

beforeEach(() => {
  pdfjsDeMentira.chamadas.length = 0;
  pdfjsDeMentira.PDFWorker.criados = 0;
});

describe('openWithPdfJs com o leitor da fila', () => {
  it('todos os arquivos da fila usam o mesmo leitor: um só é criado', async () => {
    for (let i = 0; i < 20; i += 1) await openWithPdfJs(bytes(), undefined, { leitorCompartilhado: true });

    const leitores = new Set(pdfjsDeMentira.chamadas.map((c) => c.worker));
    expect(pdfjsDeMentira.chamadas).toHaveLength(20);
    expect(leitores.size).toBe(1);
    expect([...leitores][0]).toBeDefined();
    expect(pdfjsDeMentira.PDFWorker.criados).toBeLessThanOrEqual(1);
  });

  it('quem não é da fila não recebe leitor: o pdf.js cria e destrói o seu, como antes', async () => {
    await openWithPdfJs(bytes());
    await openWithPdfJs(bytes(), 'senha');

    expect(pdfjsDeMentira.chamadas).toHaveLength(2);
    expect(pdfjsDeMentira.chamadas.every((c) => !('worker' in c))).toBe(true);
  });

  it('um leitor destruído é refeito, e a fila continua', async () => {
    await openWithPdfJs(bytes(), undefined, { leitorCompartilhado: true });
    const primeiro = pdfjsDeMentira.chamadas[0].worker as { destroy: () => void; destroyed: boolean };
    primeiro.destroy();

    const doc = await openWithPdfJs(bytes(), undefined, { leitorCompartilhado: true });
    const segundo = pdfjsDeMentira.chamadas[1].worker as { destroyed: boolean };

    expect(doc.numPages).toBe(3);
    expect(segundo).not.toBe(primeiro);
    expect(segundo.destroyed).toBe(false);
  });

  it('a cópia dos bytes continua sendo entregue ao leitor, e a original fica intacta', async () => {
    const original = bytes();
    await openWithPdfJs(original, undefined, { leitorCompartilhado: true });
    expect(original.byteLength).toBe(8);
  });
});
