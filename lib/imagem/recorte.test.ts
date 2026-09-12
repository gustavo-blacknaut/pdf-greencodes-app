/**
 * A área marcada com o mouse.
 *
 * Erro aqui não levanta exceção nenhuma: entrega um recorte que escapou da
 * imagem, ou que virou do avesso quando o canto passou do outro lado, ou uma
 * proporção travada que não é a que está escrita no botão. Tudo isso só
 * aparece na foto cortada errada, depois de impressa.
 */
import { describe, expect, it } from 'vitest';
import {
  emMilimetros,
  limitar,
  MINIMO,
  mover,
  naProporcao,
  proporcaoDe,
  proporcional,
  recorteInteiro,
  redimensionar,
} from './recorte';

const FOTO = { largura: 1200, altura: 1600 };

describe('limitar', () => {
  it('mantém o recorte dentro da imagem', () => {
    const dentro = limitar({ x: -50, y: -50, largura: 400, altura: 400 }, FOTO);
    expect(dentro).toEqual({ x: 0, y: 0, largura: 400, altura: 400 });

    const canto = limitar({ x: 1100, y: 1500, largura: 400, altura: 400 }, FOTO);
    expect(canto.x + canto.largura).toBeLessThanOrEqual(FOTO.largura);
    expect(canto.y + canto.altura).toBeLessThanOrEqual(FOTO.altura);
  });

  it('nunca deixa o recorte maior que a imagem', () => {
    const tudo = limitar({ x: 0, y: 0, largura: 9000, altura: 9000 }, FOTO);
    expect(tudo).toEqual({ x: 0, y: 0, largura: 1200, altura: 1600 });
  });

  it('segura o mínimo, para não sobrar um recorte de dois pixels', () => {
    const mirrado = limitar({ x: 10, y: 10, largura: 1, altura: 1 }, FOTO);
    expect(mirrado.largura).toBe(MINIMO);
    expect(mirrado.altura).toBe(MINIMO);
  });

  it('encolhe, e não corta um lado, quando a proporção está travada', () => {
    // 3:4 numa área que estouraria a altura: a largura é que cede.
    const preso = limitar({ x: 0, y: 0, largura: 1200, altura: 9000 }, FOTO, 3 / 4);
    expect(preso.largura / preso.altura).toBeCloseTo(3 / 4, 2);
    expect(preso.altura).toBeLessThanOrEqual(FOTO.altura);
  });

  it('devolve número inteiro: o corte é em pixel, não em fração de pixel', () => {
    const meio = limitar({ x: 10.6, y: 20.4, largura: 100.5, altura: 200.5 }, FOTO);
    expect(Object.values(meio).every(Number.isInteger)).toBe(true);
  });
});

describe('mover', () => {
  it('arrasta sem mudar de tamanho', () => {
    const antes = { x: 100, y: 100, largura: 300, altura: 400 };
    const depois = mover(antes, 50, -30, FOTO);
    expect(depois).toEqual({ x: 150, y: 70, largura: 300, altura: 400 });
  });

  it('para na borda em vez de sair pela metade', () => {
    const antes = { x: 1000, y: 100, largura: 300, altura: 400 };
    const depois = mover(antes, 500, 0, FOTO);
    expect(depois.x).toBe(FOTO.largura - 300);
    expect(depois.largura).toBe(300);
  });
});

describe('redimensionar', () => {
  it('puxa o canto e deixa o oposto onde estava', () => {
    const antes = { x: 200, y: 200, largura: 400, altura: 400 };
    const depois = redimensionar(antes, 'nw', -100, -100, FOTO);
    expect(depois).toEqual({ x: 100, y: 100, largura: 500, altura: 500 });
    // O canto de baixo à direita não se mexeu.
    expect(depois.x + depois.largura).toBe(antes.x + antes.largura);
    expect(depois.y + depois.altura).toBe(antes.y + antes.altura);
  });

  it('não vira do avesso quando o canto passa do outro lado', () => {
    const antes = { x: 200, y: 200, largura: 400, altura: 400 };
    const depois = redimensionar(antes, 'e', -900, 0, FOTO);
    expect(depois.largura).toBe(MINIMO);
    expect(depois.x).toBe(200);
  });

  it('guarda a proporção travada ao puxar um canto', () => {
    const antes = naProporcao(FOTO, 3 / 4);
    const depois = redimensionar(antes, 'se', -200, 0, FOTO, 3 / 4);
    expect(depois.largura / depois.altura).toBeCloseTo(3 / 4, 2);
    expect(depois.largura).toBeLessThan(antes.largura);
  });

  it('com proporção travada, a alça de lado cresce para os dois lados no outro eixo', () => {
    const antes = { x: 300, y: 300, largura: 300, altura: 400 };
    const centroY = antes.y + antes.altura / 2;
    const depois = redimensionar(antes, 'e', 150, 0, FOTO, 3 / 4);
    expect(depois.largura / depois.altura).toBeCloseTo(3 / 4, 2);
    expect(depois.y + depois.altura / 2).toBeCloseTo(centroY, 0);
    expect(depois.x).toBe(antes.x);
  });

  it('não deixa a alça arrastar o recorte para fora da imagem', () => {
    const antes = { x: 1000, y: 1400, largura: 200, altura: 200 };
    const depois = redimensionar(antes, 'se', 900, 900, FOTO);
    expect(depois.x + depois.largura).toBeLessThanOrEqual(FOTO.largura);
    expect(depois.y + depois.altura).toBeLessThanOrEqual(FOTO.altura);
  });
});

describe('naProporcao', () => {
  it('tira o maior pedaço daquela proporção, centrado', () => {
    // 1200x1600 em 1:1 dá o quadrado de 1200, centrado na altura.
    const quadrado = naProporcao(FOTO, 1);
    expect(quadrado).toEqual({ x: 0, y: 200, largura: 1200, altura: 1200 });
  });

  it('serve tanto para imagem em pé quanto deitada', () => {
    const deitada = naProporcao({ largura: 1600, altura: 1200 }, 3 / 4);
    expect(deitada.largura / deitada.altura).toBeCloseTo(3 / 4, 2);
    expect(deitada.altura).toBe(1200);
  });
});

describe('proporcional', () => {
  it('leva a mesma marcação para uma imagem de outro tamanho', () => {
    const metade = proporcional({ x: 300, y: 400, largura: 600, altura: 800 }, FOTO, { largura: 600, altura: 800 });
    expect(metade).toEqual({ x: 150, y: 200, largura: 300, altura: 400 });
  });
});

describe('medidas', () => {
  it('proporcaoDe entende o que está escrito no botão', () => {
    expect(proporcaoDe('3x4')).toBeCloseTo(0.75, 5);
    expect(proporcaoDe('16x9')).toBeCloseTo(16 / 9, 5);
    expect(proporcaoDe('livre')).toBeUndefined();
  });

  it('emMilimetros diz quanto sai no papel', () => {
    // 300 DPI: 300 pixels é uma polegada, 25,4 mm.
    expect(emMilimetros(300, 300)).toBeCloseTo(25.4, 5);
    expect(emMilimetros(1200, 300)).toBeCloseTo(101.6, 5);
  });

  it('recorteInteiro começa com a imagem toda', () => {
    expect(recorteInteiro(FOTO)).toEqual({ x: 0, y: 0, largura: 1200, altura: 1600 });
  });
});
