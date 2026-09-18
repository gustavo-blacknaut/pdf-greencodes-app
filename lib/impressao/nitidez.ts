/**
 * Nitidez por linhas: guarda somente a vizinhança necessária ao borrão.
 * As médias horizontais continuam em Float32 e o borrão é arredondado como
 * Uint8ClampedArray, preservando os pixels da implementação anterior.
 */
export function afiarPorLinhas(
  pixels: Uint8ClampedArray,
  largura: number,
  altura: number,
  raio: number,
  quanto: number,
): void {
  const canais = largura * 3;
  const janela = raio * 2 + 1;
  const linhas = Math.min(altura, janela);
  const memoria = new Float32Array(linhas * canais);
  const nova = new Float32Array(canais);
  const somas = new Float64Array(canais);
  const borrado = new Uint8ClampedArray(canais);
  const dentro = (valor: number, fim: number) => Math.max(0, Math.min(valor, fim - 1));

  function horizontal(y: number, destino: Float32Array, base: number) {
    const inicio = y * largura * 4;
    for (let c = 0; c < 3; c += 1) {
      let soma = 0;
      for (let x = -raio; x <= raio; x += 1) soma += pixels[inicio + dentro(x, largura) * 4 + c];
      for (let x = 0; x < largura; x += 1) {
        destino[base + x * 3 + c] = soma / janela;
        soma += pixels[inicio + dentro(x + raio + 1, largura) * 4 + c]
          - pixels[inicio + dentro(x - raio, largura) * 4 + c];
      }
    }
  }

  for (let y = 0; y <= Math.min(raio, altura - 1); y += 1) horizontal(y, memoria, y * canais);
  for (let y = -raio; y <= raio; y += 1) {
    const base = dentro(y, altura) * canais;
    for (let i = 0; i < canais; i += 1) somas[i] += memoria[base + i];
  }

  for (let y = 0; y < altura; y += 1) {
    for (let i = 0; i < canais; i += 1) borrado[i] = somas[i] / janela;
    for (let x = 0; x < largura; x += 1) {
      const indice = (y * largura + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const original = pixels[indice + c];
        pixels[indice + c] = original + (original - borrado[x * 3 + c]) * quanto * 1.5;
      }
    }
    if (y === altura - 1) break;

    const sai = (dentro(y - raio, altura) % linhas) * canais;
    const entra = (dentro(y + raio + 1, altura) % linhas) * canais;
    const temNova = y + raio + 1 < altura;
    // A linha que entra ainda não foi alterada. A que sai fica guardada até
    // a soma ser atualizada, mesmo quando ambas ocupam a mesma vaga circular.
    if (temNova) horizontal(y + raio + 1, nova, 0);
    for (let i = 0; i < canais; i += 1) {
      somas[i] += (temNova ? nova[i] : memoria[entra + i]) - memoria[sai + i];
    }
    if (temNova) memoria.set(nova, entra);
  }
}
