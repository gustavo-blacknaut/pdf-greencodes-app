import { describe, expect, it } from 'vitest';
import { afiar, AJUSTES_NEUTROS, aplicarNosPixels } from './ajustes';
import { ajustarArea } from './faixas';

/** Referência anterior, com a imagem inteira, para conferir até o arredondamento. */
function referencia(pixels: Uint8ClampedArray, largura: number, altura: number, raio: number, forca: number) {
  const meio = new Float32Array(pixels.length);
  const borrado = new Uint8ClampedArray(pixels.length);
  const dentro = (n: number, fim: number) => Math.max(0, Math.min(n, fim - 1));
  const janela = raio * 2 + 1;
  for (let y = 0; y < altura; y += 1) {
    for (let c = 0; c < 3; c += 1) {
      let soma = 0;
      for (let x = -raio; x <= raio; x += 1) soma += pixels[(y * largura + dentro(x, largura)) * 4 + c];
      for (let x = 0; x < largura; x += 1) {
        meio[(y * largura + x) * 4 + c] = soma / janela;
        soma += pixels[(y * largura + dentro(x + raio + 1, largura)) * 4 + c]
          - pixels[(y * largura + dentro(x - raio, largura)) * 4 + c];
      }
    }
  }
  for (let x = 0; x < largura; x += 1) {
    for (let c = 0; c < 3; c += 1) {
      let soma = 0;
      for (let y = -raio; y <= raio; y += 1) soma += meio[(dentro(y, altura) * largura + x) * 4 + c];
      for (let y = 0; y < altura; y += 1) {
        borrado[(y * largura + x) * 4 + c] = soma / janela;
        soma += meio[(dentro(y + raio + 1, altura) * largura + x) * 4 + c]
          - meio[(dentro(y - raio, altura) * largura + x) * 4 + c];
      }
    }
  }
  for (let i = 0; i < pixels.length; i += 4) {
    for (let c = 0; c < 3; c += 1) pixels[i + c] += (pixels[i + c] - borrado[i + c]) * (forca / 100) * 1.5;
  }
}

function foto(l: number, a: number) {
  let semente = 937;
  return Uint8ClampedArray.from({ length: l * a * 4 }, () => {
    semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0;
    return semente >>> 24;
  });
}

describe('nitidez sem perda de qualidade', () => {
  it.each([[3, 3, 1], [3, 5, 8], [17, 31, 6], [47, 25, 2], [97, 61, 12]])(
    '%s × %s, raio %s: pixels idênticos, inclusive alfa e bordas', (l, a, raio) => {
      for (const forca of [1, 37, 100]) {
        const original = foto(l, a);
        const esperado = original.slice();
        referencia(esperado, l, a, raio, forca);
        afiar(original, l, a, forca, raio * 4);
        expect(Buffer.from(original).equals(Buffer.from(esperado))).toBe(true);
      }
    },
  );

  it('mede 4 megapixels e compara a saída completa', () => {
    const l = 2000, a = 2000, raio = 6;
    const anterior = foto(l, a);
    const atual = anterior.slice();
    const inicio = performance.now();
    referencia(anterior, l, a, raio, 70);
    const meio = performance.now();
    afiar(atual, l, a, 70, 24);
    const fim = performance.now();
    expect(Buffer.from(atual).equals(Buffer.from(anterior))).toBe(true);
    console.info(JSON.stringify({ teste: 'nitidez 4 MP', anteriorMs: Math.round(meio - inicio), atualMs: Math.round(fim - meio),
      memoriaAuxiliarAntes: l * a * 20, memoriaAuxiliarAgora: l * 3 * ((2 * raio + 1) * 4 + 4 + 8 + 1) }));
  });
});

describe('emendas entre faixas', () => {
  it.each([0, 4, 24, 48])('equivale à imagem inteira a %s pixels/mm', (resolucao) => {
    const l = 29, a = 73;
    const dados = foto(l, a);
    const esperado = dados.slice();
    const ajustes = { ...AJUSTES_NEUTROS, brilho: 23, contraste: 17, saturacao: -35, nitidez: resolucao ? 70 : 0 };
    aplicarNosPixels(esperado, l, a, ajustes, resolucao);
    const contexto = {
      canvas: { width: l, height: a },
      getImageData: (x: number, y: number, w: number, h: number) => {
        expect(x).toBe(0);
        expect(w).toBe(l);
        return { data: dados.slice(y * l * 4, (y + h) * l * 4), width: w, height: h };
      },
      putImageData: (faixa: ImageData, x: number, y: number, dx: number, dy: number, w: number, h: number) => {
        dados.set(faixa.data.subarray(dy * l * 4, (dy + h) * l * 4), (y + dy) * l * 4);
      },
    } as unknown as CanvasRenderingContext2D;
    ajustarArea(contexto, { x: 0, y: 0, largura: l, altura: a }, resolucao, ajustes, l * 8);
    expect(Buffer.from(dados).equals(Buffer.from(esperado))).toBe(true);
  });
});
