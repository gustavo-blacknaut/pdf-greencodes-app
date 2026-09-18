import { aplicarNosPixels, raioDaNitidez, type Ajustes } from './ajustes';
import type { Caixa } from './layout';

/** Processa uma faixa por vez sem ler de volta vizinhos já modificados. */
export function ajustarArea(
  pincel: CanvasRenderingContext2D,
  area: Caixa,
  pixelsPorMm: number,
  ajustes: Ajustes,
  pixelsPorFaixa = 1_000_000,
): void {
  const x = Math.max(0, Math.floor(area.x));
  const y = Math.max(0, Math.floor(area.y));
  const largura = Math.min(pincel.canvas.width - x, Math.ceil(area.largura + area.x - x));
  const altura = Math.min(pincel.canvas.height - y, Math.ceil(area.altura + area.y - y));
  if (largura <= 0 || altura <= 0) return;

  const sobra = ajustes.nitidez > 0 ? raioDaNitidez(pixelsPorMm) + 1 : 0;
  const porFaixa = Math.max(1, sobra, Math.floor(pixelsPorFaixa / largura));
  let anteriores: Uint8ClampedArray | undefined;
  for (let inicio = 0; inicio < altura; inicio += porFaixa) {
    const de = Math.max(0, inicio - sobra);
    const fim = Math.min(altura, inicio + porFaixa);
    const ate = Math.min(altura, fim + sobra);
    const faixa = pincel.getImageData(x, y + de, largura, ate - de);
    if (anteriores) faixa.data.set(anteriores);
    // A próxima faixa precisa destas linhas originais para calcular a
    // nitidez. Relê-las após putImageData criava uma emenda com ajuste duplo.
    anteriores = sobra && fim < altura
      ? faixa.data.slice((fim - sobra - de) * largura * 4, (fim - de) * largura * 4)
      : undefined;
    aplicarNosPixels(faixa.data, largura, ate - de, ajustes, pixelsPorMm);
    pincel.putImageData(faixa, x, y + de, 0, inicio - de, largura, fim - inicio);
  }
}
