import { describe, expect, it } from 'vitest';

import { criarCarimbo, letrasNoArco, linhasCentradas, linhasDoCarimbo, tamanhoQueCabe } from './operacoes/carimbo';
import type { RunContext } from './tipos';

/**
 * Carimbo é medida fechada: quem pediu 38x14 vai gravar numa borracha de
 * 38x14. Por isso os testes medem a página em milímetros e leem o texto de
 * volta — um carimbo com a letra vazando ou a página 1 mm fora não serve, e
 * isso não aparece em teste que só olha se rodou sem erro.
 */

const PT_POR_MM = 72 / 25.4;
const emMm = (pt: number) => Math.round((pt / PT_POR_MM) * 10) / 10;

function contexto(options: Record<string, string | number | boolean>): RunContext {
  return { files: [], options, onProgress: () => {} };
}

/** Largura de mentira, proporcional ao tamanho: serve para a conta pura. */
const medirFalso = (texto: string, tamanho: number) => texto.length * tamanho * 0.5;

async function textoDoPdf(blob: Blob): Promise<{ texto: string; largura: number; altura: number }> {
  // O pdf.js "legacy", que e o que roda fora do navegador: o normal pede um
  // worker que o Node nao tem.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    isEvalSupported: false,
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    ),
  }).promise;
  const pagina = await doc.getPage(1);
  const conteudo = await pagina.getTextContent();
  const medida = pagina.getViewport({ scale: 1 });
  const texto = conteudo.items.map((item) => ('str' in item ? item.str : '')).join('');
  await doc.destroy();
  return { texto, largura: medida.width, altura: medida.height };
}

describe('as linhas do carimbo', () => {
  it('uma por linha, sem as vazias', () => {
    expect(linhasDoCarimbo('  GRÁFICA \n\n CNPJ 00.000.000/0001-00 \n')).toEqual([
      'GRÁFICA',
      'CNPJ 00.000.000/0001-00',
    ]);
  });

  it('para em oito linhas: carimbo com mais que isso não se lê', () => {
    expect(linhasDoCarimbo(Array.from({ length: 20 }, (_, i) => `linha ${i}`).join('\n'))).toHaveLength(8);
  });
});

describe('o tamanho da letra', () => {
  it('cabe na largura quando a linha é comprida', () => {
    const tamanho = tamanhoQueCabe(['UM NOME BEM COMPRIDO DE EMPRESA'], 100, 100, medirFalso);
    expect(medirFalso('UM NOME BEM COMPRIDO DE EMPRESA', tamanho)).toBeLessThanOrEqual(100.01);
  });

  it('cabe na altura quando há muitas linhas', () => {
    const tamanho = tamanhoQueCabe(['a', 'b', 'c', 'd'], 1000, 40, medirFalso);
    expect(tamanho * 4 * 1.25).toBeLessThanOrEqual(40.01);
  });

  it('mais linhas nunca dão letra maior', () => {
    const duas = tamanhoQueCabe(['a', 'b'], 100, 40, medirFalso);
    const cinco = tamanhoQueCabe(['a', 'b', 'c', 'd', 'e'], 100, 40, medirFalso);
    expect(cinco).toBeLessThan(duas);
  });

  it('as linhas ficam centradas e em ordem, de cima para baixo', () => {
    const posicoes = linhasCentradas(3, 10, 100);
    expect(posicoes[0]).toBeGreaterThan(posicoes[1]);
    expect(posicoes[1]).toBeGreaterThan(posicoes[2]);
    const meio = (posicoes[0] + posicoes[2]) / 2;
    expect(meio).toBeCloseTo(50 - 10 * 1.25 * 0.35, 0);
  });
});

describe('o texto em volta do carimbo redondo', () => {
  it('em cima começa pela esquerda e termina à direita', () => {
    const letras = letrasNoArco('ABCDE', 50, 8, false, medirFalso);
    expect(letras).toHaveLength(5);
    expect(letras[0].x).toBeLessThan(letras[4].x);
    // Todas acima do centro do círculo.
    expect(Math.min(...letras.map((l) => l.y))).toBeGreaterThan(0);
  });

  it('embaixo também se lê da esquerda para a direita, e fica embaixo', () => {
    const letras = letrasNoArco('ABCDE', 50, 8, true, medirFalso);
    expect(letras[0].x).toBeLessThan(letras[4].x);
    expect(Math.max(...letras.map((l) => l.y))).toBeLessThan(0);
  });

  it('a letra do meio sai em pé, e as das pontas inclinadas para lados opostos', () => {
    const letras = letrasNoArco('ABCDE', 50, 8, false, medirFalso);
    expect(Math.abs(letras[2].giro)).toBeLessThan(6);
    expect(letras[0].giro).toBeGreaterThan(0);
    expect(letras[4].giro).toBeLessThan(0);
  });

  it('embaixo o giro é o espelho do de cima: é o que impede o texto de cabeça para baixo', () => {
    const cima = letrasNoArco('ABCDE', 50, 8, false, medirFalso);
    const baixo = letrasNoArco('ABCDE', 50, 8, true, medirFalso);
    expect(baixo[0].giro).toBeLessThan(0);
    expect(baixo[4].giro).toBeGreaterThan(0);
    expect(Math.abs(baixo[0].giro)).toBeCloseTo(Math.abs(cima[0].giro), 5);
  });

  it('texto que daria a volta inteira não cabe, e o raio manda na abertura', () => {
    const curto = letrasNoArco('AB', 50, 8, false, medirFalso);
    const longo = letrasNoArco('ABCDEFGHIJKLMNOP', 50, 8, false, medirFalso);
    expect(Math.abs(longo[0].giro)).toBeGreaterThan(Math.abs(curto[0].giro));
  });
});

describe('o PDF que sai', () => {
  it('sai na medida exata, em milímetros, com o texto dentro', async () => {
    const r = await criarCarimbo(
      contexto({ formato: 'retangulo', larguraMm: 38, alturaMm: 14, linhas: 'GRAFICA GREENCODES\nCNPJ 00.000.000/0001-00' }),
    );
    const { texto, largura, altura } = await textoDoPdf(r.files[0].blob);

    expect(emMm(largura)).toBe(38);
    expect(emMm(altura)).toBe(14);
    expect(texto).toContain('GRAFICA GREENCODES');
    expect(texto).toContain('CNPJ 00.000.000/0001-00');
  });

  it('o redondo sai quadrado, com o texto de cima e o de baixo', async () => {
    const r = await criarCarimbo(
      contexto({
        formato: 'redondo',
        diametroMm: 40,
        arcoTopo: 'GREENCODES',
        arcoBaixo: 'CNPJ 000',
        linhas: 'GRAFICA',
        borda: 'dupla',
      }),
    );
    const { texto, largura, altura } = await textoDoPdf(r.files[0].blob);

    expect(emMm(largura)).toBe(40);
    expect(emMm(altura)).toBe(40);
    // O arco é desenhado letra por letra: o texto volta com as letras soltas.
    for (const letra of 'GREENCODES') expect(texto).toContain(letra);
    expect(texto).toContain('GRAFICA');
  });

  it('a folha A4 repete o carimbo e diz quantos couberam', async () => {
    const r = await criarCarimbo(
      contexto({ formato: 'retangulo', larguraMm: 38, alturaMm: 14, linhas: 'TESTE', saida: 'folha' }),
    );
    const { largura, altura } = await textoDoPdf(r.files[0].blob);

    expect(emMm(largura)).toBe(210);
    expect(emMm(altura)).toBe(297);
    expect(r.notes.some((nota) => /carimbos na folha A4/.test(nota))).toBe(true);
  });

  it('carimbo sem texto é recusado com recado, e não com PDF vazio', async () => {
    await expect(criarCarimbo(contexto({ formato: 'retangulo', linhas: '   ' }))).rejects.toThrow(/Escreva/);
  });
});
