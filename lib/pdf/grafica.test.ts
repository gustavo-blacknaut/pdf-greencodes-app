/**
 * As ferramentas de gráfica.
 *
 * Todas mexem em geometria, e geometria errada não quebra: entrega um PDF
 * bonito com a medida trocada, que só aparece depois de cortado. Por isso os
 * testes medem a folha e contam as páginas de volta, em vez de conferir que a
 * operação não estourou.
 */
import { describe, expect, it } from 'vitest';
import { runOperation, type LoadedFile, type RunContext } from './engine';
import { CANTOS } from './operacoes/grafica';
import { calcularGrade } from './operacoes/etiquetas';
import { loadPdfLib } from './lazy';

const PT_POR_MM = 72 / 25.4;
const mm = (pt: number) => Math.round((pt / PT_POR_MM) * 10) / 10;

async function pdfDe(paginas: number, largura = 595, altura = 842): Promise<ArrayBuffer> {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= paginas; i += 1) {
    doc.addPage([largura, altura]).drawText(`P${i}`, { x: 20, y: 20, size: 12, font: fonte });
  }
  return (await doc.save()).buffer as ArrayBuffer;
}

function ctx(bytes: ArrayBuffer, options: Record<string, string | number | boolean> = {}): RunContext {
  const file: LoadedFile = {
    id: 'a',
    name: 'arte.pdf',
    size: bytes.byteLength,
    type: 'application/pdf',
    bytes,
    pageCount: null,
    thumbnail: null,
  };
  return { files: [file], options, onProgress: () => {} };
}

async function abrir(blob: Blob) {
  const { PDFDocument } = await loadPdfLib();
  return PDFDocument.load(await blob.arrayBuffer());
}

describe('marcas de corte', () => {
  it('a folha cresce a sangria mais a marca mais o respiro, dos dois lados', async () => {
    const resultado = await runOperation('crop-marks', ctx(await pdfDe(1, 300, 400), { sangriaMm: 3, marcasMm: 4 }));
    const doc = await abrir(resultado.files[0].blob);
    const { width, height } = doc.getPage(0).getSize();

    // 3 de sangria + 4 de marca + 2 de respiro = 9 mm de cada lado.
    const borda = 9 * PT_POR_MM;
    expect(width).toBeCloseTo(300 + borda * 2, 1);
    expect(height).toBeCloseTo(400 + borda * 2, 1);
  });

  it('sangria zero encosta as marcas na linha de corte', async () => {
    const resultado = await runOperation('crop-marks', ctx(await pdfDe(1, 300, 400), { sangriaMm: 0, marcasMm: 4 }));
    const doc = await abrir(resultado.files[0].blob);
    const borda = 6 * PT_POR_MM;
    expect(doc.getPage(0).getWidth()).toBeCloseTo(300 + borda * 2, 1);
  });

  it('mantém uma folha para cada página', async () => {
    const resultado = await runOperation('crop-marks', ctx(await pdfDe(5)));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(5);
  });

  it('avisa que contou com a sangria vinda do arquivo', async () => {
    const resultado = await runOperation('crop-marks', ctx(await pdfDe(1), { sangriaMm: 3 }));
    expect(resultado.notes.join(' ')).toMatch(/já tenha 3 mm de sangria/);
  });

  it('ampliar avisa que é remendo, e não sangria de verdade', async () => {
    const resultado = await runOperation('crop-marks', ctx(await pdfDe(1), { sangriaMm: 3, origem: 'ampliar' }));
    expect(resultado.notes.join(' ')).toMatch(/remendo/);
  });
});

describe('calcularGrade', () => {
  const a4 = { l: 210 * PT_POR_MM, a: 297 * PT_POR_MM };

  it('cabem 10 cartões de 90x50 num A4 com 5 mm de margem', () => {
    const grade = calcularGrade(a4.l, a4.a, 90 * PT_POR_MM, 50 * PT_POR_MM, 5 * PT_POR_MM, 0);
    expect(grade).not.toBeNull();
    expect(grade!.colunas).toBe(2);
    expect(grade!.linhas).toBe(5);
  });

  it('centra a grade dividindo a sobra pelos dois lados', () => {
    const grade = calcularGrade(a4.l, a4.a, 90 * PT_POR_MM, 50 * PT_POR_MM, 5 * PT_POR_MM, 0)!;
    const usado = grade.colunas * 90 * PT_POR_MM;
    expect(grade.margemX).toBeCloseTo((a4.l - usado) / 2, 4);
    // E a margem calculada nunca pode ser menor que a pedida.
    expect(grade.margemX).toBeGreaterThanOrEqual(5 * PT_POR_MM - 0.01);
  });

  it('o espaço entre itens tira uma coluna quando não sobra rua', () => {
    const semEspaco = calcularGrade(a4.l, a4.a, 90 * PT_POR_MM, 50 * PT_POR_MM, 5 * PT_POR_MM, 0)!;
    const comEspaco = calcularGrade(a4.l, a4.a, 90 * PT_POR_MM, 50 * PT_POR_MM, 5 * PT_POR_MM, 25 * PT_POR_MM)!;
    expect(comEspaco.colunas).toBeLessThan(semEspaco.colunas);
  });

  it('devolve nulo quando o item não cabe', () => {
    expect(calcularGrade(a4.l, a4.a, 400 * PT_POR_MM, 50 * PT_POR_MM, 5 * PT_POR_MM, 0)).toBeNull();
    expect(calcularGrade(a4.l, a4.a, 0, 50, 5, 0)).toBeNull();
  });
});

describe('cartão de visita', () => {
  it('enche o A4 com o mesmo cartão e diz quantos couberam', async () => {
    const resultado = await runOperation('business-cards', ctx(await pdfDe(1, 255, 142), { papel: 'a4' }));
    const doc = await abrir(resultado.files[0].blob);

    expect(doc.getPageCount()).toBe(1);
    expect(mm(doc.getPage(0).getWidth())).toBeCloseTo(210, 0);
    expect(resultado.notes.join(' ')).toMatch(/2 x 5 = 10 por folha/);
  });

  it('frente e verso saem em duas folhas', async () => {
    const resultado = await runOperation('business-cards', ctx(await pdfDe(2, 255, 142), { modo: 'repetir' }));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(2);
  });

  it('A3 rende mais que A4', async () => {
    const arte = await pdfDe(1, 255, 142);
    const emA4 = await runOperation('business-cards', ctx(arte, { papel: 'a4' }));
    const emA3 = await runOperation('business-cards', ctx(arte, { papel: 'a3' }));
    const quantos = (notas: string[]) => Number(notas.join(' ').match(/= (\d+) por folha/)?.[1]);
    expect(quantos(emA3.notes)).toBeGreaterThan(quantos(emA4.notes));
  });

  it('recusa um cartão maior que o papel, dizendo o que fazer', async () => {
    await expect(
      runOperation('business-cards', ctx(await pdfDe(1), { medida: 'personalizado', larguraMm: 250, alturaMm: 250 })),
    ).rejects.toThrow(/não cabe|papel maior/);
  });
});

describe('etiquetas', () => {
  it('a grade obedece a medida informada', async () => {
    const resultado = await runOperation('labels', ctx(await pdfDe(1, 142, 85), { larguraMm: 50, alturaMm: 30, espacoMm: 0, margemMm: 5 }));
    // (210-10)/50 = 4 colunas; (297-10)/30 = 9 linhas
    expect(resultado.notes.join(' ')).toMatch(/4 x 9 = 36 por folha/);
  });

  it('junta páginas diferentes na mesma folha no modo sequência', async () => {
    const resultado = await runOperation('labels', ctx(await pdfDe(8, 142, 85), { larguraMm: 50, alturaMm: 30, modo: 'sequencia' }));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(1);
  });
});

/**
 * As folhas da Pimaco.
 *
 * Aqui a grade não é calculada: ela vem picotada no papel, e a arte tem que
 * cair exatamente em cima. Meio milímetro de conta própria imprime metade do
 * texto no picote, e isso só aparece com a folha de etiqueta já gasta — por
 * isso o teste confere a posição de cada etiqueta, e não só a contagem.
 */
describe('etiquetas em folha Pimaco', () => {
  /** O fluxo de desenho da primeira página, em texto. */
  async function conteudo(blob: Blob): Promise<string> {
    const { inflateSync } = await import('node:zlib');
    const doc = await abrir(blob);
    const pagina = doc.getPage(0);
    const fluxos = pagina.node.Contents() as unknown as { asArray?: () => unknown[] };
    const refs = fluxos?.asArray ? fluxos.asArray() : [fluxos];
    let texto = '';
    for (const ref of refs) {
      const stream = doc.context.lookup(ref as never) as unknown as {
        getContents(): Uint8Array;
        dict: { toString(): string };
      };
      const bruto = Buffer.from(stream.getContents());
      const comprimido = stream.dict.toString().includes('FlateDecode');
      texto += (comprimido ? inflateSync(bruto) : bruto).toString('latin1');
    }
    return texto;
  }

  /** Onde cada desenho foi assentado, lido do fluxo da página. */
  async function posicoes(blob: Blob): Promise<{ x: number; y: number }[]> {
    const texto = await conteudo(blob);
    // O pdf-lib escreve giro e inclinação junto, e os dois viram a matriz
    // neutra em 0,0: só interessa a translação de verdade.
    return [...texto.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) cm/g)]
      .map((m) => ({ x: mm(Number(m[1])), y: mm(Number(m[2])) }))
      .filter((p) => p.x !== 0 || p.y !== 0);
  }

  it('a 6180 põe 30 por folha, na margem e no passo do fabricante', async () => {
    const resultado = await runOperation('labels', ctx(await pdfDe(1, 189, 72), { modelo: '6180' }));
    const doc = await abrir(resultado.files[0].blob);

    expect(mm(doc.getPage(0).getWidth())).toBeCloseTo(215.9, 0);
    expect(mm(doc.getPage(0).getHeight())).toBeCloseTo(279.4, 0);
    expect(resultado.notes.join(' ')).toMatch(/3 x 10 = 30 por folha/);

    const onde = await posicoes(resultado.files[0].blob);
    expect(onde).toHaveLength(30);
    // Três colunas: 4,8 mm da esquerda, com passo de 69,85.
    const colunas = [...new Set(onde.map((p) => p.x))].sort((a, b) => a - b);
    expect(colunas).toHaveLength(3);
    expect(colunas[0]).toBeCloseTo(4.8, 0);
    expect(colunas[1] - colunas[0]).toBeCloseTo(69.9, 0);
    // A primeira linha começa 12,7 mm abaixo do topo.
    const topo = Math.max(...onde.map((p) => p.y));
    expect(279.4 - (topo + 25.4)).toBeCloseTo(12.7, 0);
  });

  it('a 6187 põe 80 por folha', async () => {
    const resultado = await runOperation('labels', ctx(await pdfDe(1, 126, 36), { modelo: '6187' }));
    expect(resultado.notes.join(' ')).toMatch(/4 x 20 = 80 por folha/);
    expect(await posicoes(resultado.files[0].blob)).toHaveLength(80);
  });

  it('a 6093 é redonda: o desenho sai recortado no círculo', async () => {
    const resultado = await runOperation('labels', ctx(await pdfDe(1, 120, 120), { modelo: '6093' }));
    const texto = await conteudo(resultado.files[0].blob);

    expect(resultado.notes.join(' ')).toMatch(/4 x 6 = 24 por folha/);
    // Um recorte por etiqueta, cada um fechado com W n.
    expect(texto.match(/W\s*\n?\s*n/g) ?? []).toHaveLength(24);
    expect(texto.match(/c\s/g)?.length ?? 0).toBeGreaterThanOrEqual(24 * 4);
  });

  it('o deslocamento move a folha inteira, para acertar a impressora', async () => {
    const arte = await pdfDe(1, 189, 72);
    const reto = await posicoes((await runOperation('labels', ctx(arte, { modelo: '6180' }))).files[0].blob);
    const movido = await posicoes(
      (await runOperation('labels', ctx(arte, { modelo: '6180', deslocaXmm: 2, deslocaYmm: 3 }))).files[0].blob,
    );
    expect(movido[0].x - reto[0].x).toBeCloseTo(2, 0);
    // Para baixo no papel é para baixo no eixo do PDF, que conta ao contrário.
    expect(reto[0].y - movido[0].y).toBeCloseTo(3, 0);
  });

  it('a medida livre continua calculando a grade', async () => {
    const resultado = await runOperation(
      'labels',
      ctx(await pdfDe(1, 142, 85), { modelo: 'livre', larguraMm: 50, alturaMm: 30, espacoMm: 0, margemMm: 5 }),
    );
    expect(resultado.notes.join(' ')).toMatch(/4 x 9 = 36 por folha/);
  });
});

describe('numeração sequencial', () => {
  it('uma página por número quando o jogo tem uma página', async () => {
    const resultado = await runOperation('sequential-numbering', ctx(await pdfDe(1), { quantidade: 25 }));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(25);
  });

  it('o jogo inteiro repete por número, para o canhoto bater com a via', async () => {
    const resultado = await runOperation('sequential-numbering', ctx(await pdfDe(2), { quantidade: 10 }));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(20);
    expect(resultado.notes.join(' ')).toMatch(/canhoto/);
  });

  it('conta a partir do início pedido, com zero à esquerda', async () => {
    const resultado = await runOperation('sequential-numbering', ctx(await pdfDe(1), { quantidade: 3, inicio: 98, digitos: 5, prefixo: 'A' }));
    expect(resultado.notes[0]).toBe('3 números, de A00098 a A00100.');
  });

  it('recusa antes de gerar quando o total estoura o limite', async () => {
    await expect(
      runOperation('sequential-numbering', ctx(await pdfDe(3), { quantidade: 4000 })),
    ).rejects.toThrow(/acima do limite/);
  });
});

describe('espelhar', () => {
  it('mantém o tamanho da página', async () => {
    const resultado = await runOperation('mirror', ctx(await pdfDe(3, 300, 400)));
    const doc = await abrir(resultado.files[0].blob);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(300, 1);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(400, 1);
  });

  it('diz em que sentido espelhou', async () => {
    const vertical = await runOperation('mirror', ctx(await pdfDe(1), { eixo: 'vertical' }));
    expect(vertical.notes[0]).toMatch(/de cima para baixo/);
  });
});

describe('repetir páginas', () => {
  it('cada página seguida: 1,1,2,2,3,3', async () => {
    const resultado = await runOperation('repeat-pages', ctx(await pdfDe(3), { vezes: 2, modo: 'cada-pagina' }));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(6);
    expect(resultado.notes[0]).toMatch(/Cada página saiu 2 vezes/);
  });

  it('documento inteiro: 1,2,3,1,2,3', async () => {
    const resultado = await runOperation('repeat-pages', ctx(await pdfDe(3), { vezes: 4, modo: 'documento-inteiro' }));
    expect((await abrir(resultado.files[0].blob)).getPageCount()).toBe(12);
    expect(resultado.notes[0]).toMatch(/o documento saiu 4 vezes/i);
  });

  it('recusa quando o total estoura o limite', async () => {
    await expect(runOperation('repeat-pages', ctx(await pdfDe(20), { vezes: 400 }))).rejects.toThrow(/acima do limite/);
  });
});

describe('as que só existem no aplicativo', () => {
  it.each([
    ['photo-sheet', /aplicativo para Windows/],
    ['separate-plates', /aplicativo para Windows/],
    ['ink-coverage', /aplicativo para Windows/],
  ] as const)('%s explica por que não roda no site', async (id, mensagem) => {
    await expect(runOperation(id, ctx(await pdfDe(1)))).rejects.toThrow(mensagem);
  });
});

describe('páginas com /Rotate', () => {
  async function pdfGirado(giro: number): Promise<ArrayBuffer> {
    const { PDFDocument, degrees, rgb } = await loadPdfLib();
    const doc = await PDFDocument.create();
    const pagina = doc.addPage([300, 400]);
    pagina.drawRectangle({ x: 0, y: 0, width: 60, height: 60, color: rgb(0, 0, 0) });
    if (giro) pagina.setRotation(degrees(giro));
    return (await doc.save()).buffer as ArrayBuffer;
  }

  /**
   * O XObject da página tem que existir de verdade no arquivo final.
   *
   * O documento intermediário que aplica o giro precisa ser gravado e
   * reaberto: sem isso o pdf-lib entrega uma referência que não resolve, o
   * leitor reclama de "cannot find object in xref" e a folha sai EM BRANCO —
   * com o tamanho todo certo, que é o que torna o defeito traiçoeiro.
   */
  async function temDesenhoDeVerdade(blob: Blob): Promise<boolean> {
    const { PDFDocument } = await loadPdfLib();
    const doc = await PDFDocument.load(await blob.arrayBuffer());
    const xobjects = doc.getPage(0).node.normalizedEntries().XObject;
    if (!xobjects || xobjects.asMap().size === 0) return false;

    // Um XObject é stream, não dicionário: o que importa é a referência
    // resolver para alguma coisa. Antes ela apontava para o vazio.
    for (const [, referencia] of xobjects.asMap()) {
      if (doc.context.lookup(referencia) === undefined) return false;
    }
    return true;
  }

  it.each([0, 90, 180, 270])('/Rotate %i: a folha sai na medida que o leitor mostra', async (giro) => {
    const resultado = await runOperation('crop-marks', ctx(await pdfGirado(giro), { sangriaMm: 0, marcasMm: 3 }));
    const doc = await abrir(resultado.files[0].blob);
    const { width, height } = doc.getPage(0).getSize();

    const deitada = giro === 90 || giro === 270;
    const borda = 5 * PT_POR_MM; // 3 de marca + 2 de respiro
    expect(Math.round(width)).toBe(Math.round((deitada ? 400 : 300) + borda * 2));
    expect(Math.round(height)).toBe(Math.round((deitada ? 300 : 400) + borda * 2));
  });

  it.each([90, 180, 270])('/Rotate %i: a folha não sai em branco', async (giro) => {
    const resultado = await runOperation('crop-marks', ctx(await pdfGirado(giro)));
    expect(await temDesenhoDeVerdade(resultado.files[0].blob)).toBe(true);
  });

  it('espelhar também respeita o giro', async () => {
    const resultado = await runOperation('mirror', ctx(await pdfGirado(90)));
    const doc = await abrir(resultado.files[0].blob);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(400);
    expect(await temDesenhoDeVerdade(resultado.files[0].blob)).toBe(true);
  });

  it('documento reto não paga nada por isso', async () => {
    const resultado = await runOperation('crop-marks', ctx(await pdfGirado(0), { sangriaMm: 0, marcasMm: 3 }));
    expect(Math.round(await abrir(resultado.files[0].blob).then((d) => d.getPage(0).getWidth()))).toBe(328);
  });
});


describe('onde o número é assentado', () => {
  const L = 300;
  const A = 400;

  it('no topo, desconta a altura da letra da margem de cima', () => {
    expect(CANTOS['topo-direita'](L, A, 10, 72)).toEqual({ x: 290, y: 318, direita: true });
    expect(CANTOS['topo-esquerda'](L, A, 10, 72)).toEqual({ x: 10, y: 318, direita: false });
  });

  it('no rodapé, a margem já É a linha de base', () => {
    expect(CANTOS['rodape-direita'](L, A, 10, 72)).toEqual({ x: 290, y: 10, direita: true });
    expect(CANTOS['rodape-esquerda'](L, A, 10, 72)).toEqual({ x: 10, y: 10, direita: false });
  });

  it('letra grande com margem mínima continua dentro da folha', () => {
    // O caso que estourava: descontar o tamanho também no rodapé punha a
    // linha de base em 5,7 - 72 = -66, e o número saía fora do papel.
    for (const posicao of Object.keys(CANTOS) as (keyof typeof CANTOS)[]) {
      const { x, y } = CANTOS[posicao](L, A, 5.7, 72);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + 72).toBeLessThanOrEqual(A);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(L);
    }
  });
});
