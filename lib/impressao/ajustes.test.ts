import { describe, expect, it } from 'vitest';

import {
  AJUSTES_NEUTROS,
  aplicarNosPixels,
  afiar,
  luminancia,
  medidaGirada,
  pintarPixels,
  tabelasDeCor,
  temAjuste,
  type Ajustes,
} from './ajustes';

/**
 * Estes testes são o contrato entre a prévia e o papel.
 *
 * A conta é a mesma nos dois lugares, então basta prová-la uma vez — mas ela
 * precisa ser provada com números, e não "parece mais claro": ajuste de cor
 * errado não estoura em lugar nenhum, sai na tiragem inteira.
 */

function ajustes(extras: Partial<Ajustes> = {}): Ajustes {
  return { ...AJUSTES_NEUTROS, ...extras };
}

/** Uma imagem de um pixel só, para conferir a conta de cor. */
function pixel(r: number, g: number, b: number, extras: Partial<Ajustes> = {}): [number, number, number] {
  const pixels = new Uint8ClampedArray([r, g, b, 255]);
  pintarPixels(pixels, ajustes(extras));
  return [pixels[0], pixels[1], pixels[2]];
}

describe('nada a fazer', () => {
  it('o neutro não mexe em pixel nenhum', () => {
    expect(temAjuste(ajustes())).toBe(false);
    expect(pixel(10, 128, 240)).toEqual([10, 128, 240]);
  });

  it('girar sozinho não é ajuste de imagem: só muda a folha', () => {
    expect(temAjuste(ajustes({ girar: 90 }))).toBe(false);
    expect(temAjuste(ajustes({ brilho: 1 }))).toBe(true);
  });
});

describe('luz', () => {
  it('brilho soma luz nos três canais, e o preto deixa de ser preto', () => {
    const [r, g, b] = pixel(0, 100, 200, { brilho: 20 });
    expect(r).toBeGreaterThan(0);
    expect(g).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(200);
    // A mesma soma em todos: o que era diferença entre canais continua igual.
    expect(g - r).toBe(100);
  });

  it('exposição multiplica, então o escuro anda pouco e o claro anda muito', () => {
    const [escuroAntes] = pixel(20, 20, 20);
    const [escuroDepois] = pixel(20, 20, 20, { exposicao: 50 });
    const [claroAntes] = pixel(100, 100, 100);
    const [claroDepois] = pixel(100, 100, 100, { exposicao: 50 });
    expect(escuroDepois - escuroAntes).toBeLessThan(claroDepois - claroAntes);
    // Meio ponto de luz: 2^(50/50) = o dobro em cima de 100.
    expect(claroDepois).toBeCloseTo(200, -1);
  });

  it('contraste afasta do meio, e o meio fica onde está', () => {
    expect(pixel(128, 128, 128, { contraste: 50 })).toEqual([128, 128, 128]);
    expect(pixel(200, 200, 200, { contraste: 50 })[0]).toBeGreaterThan(200);
    expect(pixel(60, 60, 60, { contraste: 50 })[0]).toBeLessThan(60);
  });

  it('contraste negativo aproxima do cinza médio', () => {
    expect(pixel(240, 240, 240, { contraste: -50 })[0]).toBeLessThan(240);
    expect(pixel(16, 16, 16, { contraste: -50 })[0]).toBeGreaterThan(16);
  });
});

describe('cor', () => {
  it('temperatura quente puxa o vermelho e segura o azul', () => {
    const [r, g, b] = pixel(120, 120, 120, { temperatura: 60 });
    expect(r).toBeGreaterThan(120);
    expect(g).toBe(120);
    expect(b).toBeLessThan(120);
  });

  it('temperatura fria faz o contrário', () => {
    const [r, , b] = pixel(120, 120, 120, { temperatura: -60 });
    expect(r).toBeLessThan(120);
    expect(b).toBeGreaterThan(120);
  });

  it('saturação em -100 deixa os três canais iguais, no cinza que o olho vê', () => {
    const [r, g, b] = pixel(200, 100, 50, { saturacao: -100 });
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeCloseTo(Math.round(luminancia(200, 100, 50)), 0);
  });

  it('tons de cinza não depende da saturação escolhida', () => {
    const [r, g, b] = pixel(200, 100, 50, { cinza: true, saturacao: 80 });
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('saturação positiva separa mais as cores', () => {
    const [r, , b] = pixel(200, 120, 60, { saturacao: 60 });
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(60);
  });

  it('a tabela de cada canal tem os 256 valores e não decresce', () => {
    const [tr] = tabelasDeCor(ajustes({ contraste: 30 }));
    expect(tr).toHaveLength(256);
    for (let v = 1; v < 256; v += 1) expect(tr[v]).toBeGreaterThanOrEqual(tr[v - 1]);
  });
});

describe('nitidez', () => {
  /** Uma faixa escura no meio de um fundo claro: a borda é o que a nitidez realça. */
  function faixa(largura: number, altura: number): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(largura * altura * 4);
    for (let y = 0; y < altura; y += 1) {
      for (let x = 0; x < largura; x += 1) {
        const claro = x < largura / 2 ? 200 : 80;
        const i = (y * largura + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = claro;
        pixels[i + 3] = 255;
      }
    }
    return pixels;
  }

  it('aumenta o degrau na borda, e deixa a área lisa quieta', () => {
    const largura = 40;
    const altura = 8;
    const pixels = faixa(largura, altura);
    const antes = [...pixels];
    afiar(pixels, largura, altura, 80, 4);

    const meio = 4 * (4 * largura + largura / 2);
    const degrauAntes = antes[meio - 4] - antes[meio];
    const degrauDepois = pixels[meio - 4] - pixels[meio];
    expect(degrauDepois).toBeGreaterThan(degrauAntes);
    // Longe da borda, nada muda.
    expect(pixels[4 * (4 * largura + 2)]).toBe(antes[4 * (4 * largura + 2)]);
  });

  it('nitidez zero não encosta na imagem', () => {
    const pixels = faixa(20, 6);
    const antes = [...pixels];
    afiar(pixels, 20, 6, 0, 4);
    expect([...pixels]).toEqual(antes);
  });

  it('o raio acompanha a resolução: na folha grande o realce não some', () => {
    const largura = 60;
    const altura = 8;
    const naTela = faixa(largura, altura);
    const naFolha = faixa(largura, altura);
    afiar(naTela, largura, altura, 100, 4);
    afiar(naFolha, largura, altura, 100, 24);
    const meio = 4 * (4 * largura + largura / 2);
    // Raio maior espalha mais, então a diferença na borda cresce.
    expect(naFolha[meio - 4]).toBeGreaterThanOrEqual(naTela[meio - 4]);
  });
});

describe('tudo junto', () => {
  it('aplicar nos pixels pinta e afia numa passada só', () => {
    const largura = 12;
    const altura = 4;
    const pixels = new Uint8ClampedArray(largura * altura * 4).fill(120);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    aplicarNosPixels(pixels, largura, altura, ajustes({ brilho: 30, cinza: true }), 4);
    expect(pixels[0]).toBeGreaterThan(120);
    expect(pixels[0]).toBe(pixels[2]);
  });

  it('girar 90 troca largura por altura; 180 deixa como está', () => {
    expect(medidaGirada({ largura: 297, altura: 210 }, 90)).toEqual({ largura: 210, altura: 297 });
    expect(medidaGirada({ largura: 297, altura: 210 }, 180)).toEqual({ largura: 297, altura: 210 });
  });
});
