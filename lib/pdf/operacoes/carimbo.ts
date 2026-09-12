'use client';

/**
 * Carimbos: o texto, a medida em milímetros, e um PDF do tamanho exato.
 *
 * O que uma loja de carimbo precisa é sempre o mesmo: um retângulo de 38x14
 * com três linhas, ou um redondo de 40 mm com o nome dando a volta por cima e
 * o CNPJ por baixo. Isso é desenho vetorial puro — nada de rasterizar —, então
 * roda igual no site e no aplicativo, e a borracha sai com traço limpo.
 *
 * Tudo em milímetros. A conversão para ponto (1/72 de polegada) acontece só na
 * hora de desenhar, e a página sai na medida exata: quem manda para a máquina
 * de gravação não pode ter escala no meio do caminho.
 */

import { FORMATOS_MM, mmParaPt, salvarPdf, sanitizeText } from '../nucleo';
import { loadPdfLib } from '../lazy';
import type { RunContext, RunResult } from '../tipos';

type Fonte = 'helv' | 'times' | 'cour';

/** As três fontes que todo leitor de PDF tem, em normal e negrito. */
const NOMES_DE_FONTE = {
  helv: ['Helvetica', 'HelveticaBold'],
  times: ['TimesRoman', 'TimesRomanBold'],
  cour: ['Courier', 'CourierBold'],
} as const satisfies Record<Fonte, readonly [string, string]>;

/** Entre uma linha e a outra: 1,25 da altura da letra é o que se lê bem. */
const ENTRELINHA = 1.25;

function limitar(valor: unknown, minimo: number, maximo: number, padrao: number): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.min(Math.max(numero, minimo), maximo);
}

/** As linhas que a pessoa escreveu, sem as vazias das pontas. */
export function linhasDoCarimbo(texto: unknown, maximo = 8): string[] {
  return String(texto ?? '')
    .split(/\r?\n/)
    .map((linha) => sanitizeText(linha).trim())
    .filter((linha) => linha.length > 0)
    .slice(0, maximo);
}

/**
 * O maior tamanho de letra em que o texto ainda cabe.
 *
 * Carimbo é medida fechada: quem escolheu 38x14 vai gravar 38x14, então é a
 * letra que se ajusta, e não a borracha. A busca é direta — mede a linha mais
 * larga e a pilha de linhas, e fica no menor dos dois limites.
 */
export function tamanhoQueCabe(
  linhas: string[],
  largura: number,
  altura: number,
  medir: (texto: string, tamanho: number) => number,
  teto = 72,
): number {
  if (!linhas.length || largura <= 0 || altura <= 0) return 0;

  // A largura é linear no tamanho: mede a 100 e escala.
  const maisLarga = Math.max(...linhas.map((linha) => medir(linha, 100)));
  const porLargura = maisLarga > 0 ? (largura / maisLarga) * 100 : teto;
  const porAltura = altura / (linhas.length * ENTRELINHA);

  return Math.max(3, Math.min(teto, porLargura, porAltura));
}

/** Onde cada linha assenta, de cima para baixo, centrado no bloco. */
export function linhasCentradas(quantas: number, tamanho: number, altura: number): number[] {
  const bloco = quantas * tamanho * ENTRELINHA;
  const topo = (altura + bloco) / 2;
  return Array.from({ length: quantas }, (_, i) => topo - (i + 0.85) * tamanho * ENTRELINHA);
}

/**
 * O texto dando a volta no carimbo redondo.
 *
 * Letra por letra, cada uma girada para ficar em pé em relação ao centro. No
 * arco de baixo o sentido se inverte, senão o nome sai de cabeça para baixo —
 * é o detalhe que separa um carimbo redondo de verdade de um texto torto.
 */
export function letrasNoArco(
  texto: string,
  raio: number,
  tamanho: number,
  embaixo: boolean,
  medir: (letra: string, tamanho: number) => number,
): { letra: string; x: number; y: number; giro: number }[] {
  const letras = [...texto];
  if (!letras.length || raio <= 0) return [];

  const larguras = letras.map((letra) => medir(letra, tamanho));
  // O quanto o texto ocupa do círculo, em radianos: comprimento sobre raio.
  const abertura = larguras.reduce((soma, largura) => soma + largura, 0) / raio;
  // Em cima o texto corre no sentido do relógio a partir da esquerda; embaixo,
  // no contrário — é isso que faz o CNPJ sair de pé, e não de cabeça para
  // baixo. O giro de cada letra é a distância angular até o topo (ou a base).
  const centro = embaixo ? -Math.PI / 2 : Math.PI / 2;
  const sentido = embaixo ? -1 : 1;

  let andado = 0;
  return letras.map((letra, i) => {
    const meio = andado + larguras[i] / 2;
    andado += larguras[i];
    const angulo = centro + sentido * (abertura / 2 - meio / raio);
    const giro = angulo - centro;
    return {
      letra,
      // A linha de base assenta no círculo, e o ponto devolvido é onde a letra
      // começa: meio caractere para trás, na direção em que ela está virada.
      x: Math.cos(angulo) * raio - (larguras[i] / 2) * Math.cos(giro),
      y: Math.sin(angulo) * raio - (larguras[i] / 2) * Math.sin(giro),
      giro: (giro * 180) / Math.PI,
    };
  });
}

export async function criarCarimbo(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await loadPdfLib();

  const redondo = String(ctx.options.formato ?? 'retangulo') === 'redondo';
  const fonte = (String(ctx.options.fonte ?? 'helv') as Fonte) in NOMES_DE_FONTE
    ? (String(ctx.options.fonte ?? 'helv') as Fonte)
    : 'helv';
  const negrito = ctx.options.negrito !== false && ctx.options.negrito !== 'false';
  const borda = String(ctx.options.borda ?? 'simples');
  const espessura = mmParaPt(limitar(ctx.options.espessuraMm, 0.1, 3, 0.5));
  const respiro = mmParaPt(limitar(ctx.options.margemMm, 0, 20, 2));

  const linhas = linhasDoCarimbo(ctx.options.linhas);
  const arcoTopo = sanitizeText(String(ctx.options.arcoTopo ?? '')).trim();
  const arcoBaixo = sanitizeText(String(ctx.options.arcoBaixo ?? '')).trim();
  if (!linhas.length && !arcoTopo && !arcoBaixo) {
    throw new Error('Escreva o que vai no carimbo: uma linha por linha do texto.');
  }

  const doc = await PDFDocument.create();
  const letra = await doc.embedFont(StandardFonts[NOMES_DE_FONTE[fonte][negrito ? 1 : 0]]);
  const medir = (texto: string, tamanho: number) => letra.widthOfTextAtSize(texto, tamanho);
  const preto = rgb(0, 0, 0);

  const larguraMm = redondo
    ? limitar(ctx.options.diametroMm, 10, 200, 40)
    : limitar(ctx.options.larguraMm, 5, 250, 38);
  const alturaMm = redondo ? larguraMm : limitar(ctx.options.alturaMm, 5, 250, 14);
  const largura = mmParaPt(larguraMm);
  const altura = mmParaPt(alturaMm);

  const pagina = doc.addPage([largura, altura]);
  const notas: string[] = [];

  if (redondo) {
    const centroX = largura / 2;
    const centroY = altura / 2;
    const raioExterno = largura / 2 - espessura / 2;

    /*
     * A geometria do carimbo redondo, de fora para dentro: o aro, o texto
     * dando a volta, o aro de dentro e o miolo.
     *
     * O aro de dentro é posicionado **depois** de saber o tamanho da letra do
     * arco — fixá-lo antes fazia o nome da empresa encostar no traço, que é o
     * jeito mais rápido de um carimbo parecer amador.
     */
    const tamanhoDoArco = limitar(ctx.options.tamanhoArcoPt, 0, 72, 0) || Math.max(4, largura * 0.075);
    const temArco = Boolean(arcoTopo || arcoBaixo);
    const folga = espessura + mmParaPt(0.6);
    const raioDoTexto = raioExterno - folga - tamanhoDoArco * 0.78;
    const raioInterno = temArco
      ? Math.max(raioExterno * 0.35, raioDoTexto - tamanhoDoArco * 0.45 - folga)
      : raioExterno - espessura * 2.5;

    if (borda !== 'sem') {
      pagina.drawCircle({ x: centroX, y: centroY, size: raioExterno, borderWidth: espessura, borderColor: preto });
      if (borda === 'dupla') {
        pagina.drawCircle({
          x: centroX,
          y: centroY,
          size: raioInterno,
          borderWidth: espessura * 0.6,
          borderColor: preto,
        });
      }
    }

    for (const [texto, embaixo] of [
      [arcoTopo, false],
      [arcoBaixo, true],
    ] as [string, boolean][]) {
      if (!texto) continue;
      for (const posicao of letrasNoArco(texto, raioDoTexto, tamanhoDoArco, embaixo, medir)) {
        pagina.drawText(posicao.letra, {
          x: centroX + posicao.x,
          y: centroY + posicao.y,
          size: tamanhoDoArco,
          font: letra,
          color: preto,
          rotate: degrees(posicao.giro),
        });
      }
    }

    if (linhas.length) {
      // O miolo é o quadrado que cabe dentro do círculo de dentro.
      const lado = (borda === 'dupla' || temArco ? raioInterno : raioExterno) * Math.SQRT2 - respiro * 2;
      const tamanho = tamanhoQueCabe(linhas, lado, lado, medir);
      linhasCentradas(linhas.length, tamanho, altura).forEach((y, i) => {
        pagina.drawText(linhas[i], {
          x: centroX - medir(linhas[i], tamanho) / 2,
          y,
          size: tamanho,
          font: letra,
          color: preto,
        });
      });
    }
    notas.push(`Carimbo redondo de ${larguraMm} mm, no tamanho exato. Imprima sem ajustar à página.`);
  } else {
    if (borda !== 'sem') {
      pagina.drawRectangle({
        x: espessura / 2,
        y: espessura / 2,
        width: largura - espessura,
        height: altura - espessura,
        borderWidth: espessura,
        borderColor: preto,
      });
      if (borda === 'dupla') {
        const recuo = espessura * 2.5;
        pagina.drawRectangle({
          x: recuo,
          y: recuo,
          width: largura - recuo * 2,
          height: altura - recuo * 2,
          borderWidth: espessura * 0.6,
          borderColor: preto,
        });
      }
    }

    const recuo = (borda === 'sem' ? 0 : espessura * (borda === 'dupla' ? 3.2 : 1.2)) + respiro;
    const tamanho = tamanhoQueCabe(linhas, largura - recuo * 2, altura - recuo * 2, medir);
    linhasCentradas(linhas.length, tamanho, altura).forEach((y, i) => {
      pagina.drawText(linhas[i], {
        x: (largura - medir(linhas[i], tamanho)) / 2,
        y,
        size: tamanho,
        font: letra,
        color: preto,
      });
    });
    notas.push(
      `Carimbo de ${larguraMm} x ${alturaMm} mm, no tamanho exato, com letra de ${tamanho.toFixed(1)} pt. ` +
        'Imprima sem ajustar à página.',
    );
  }

  // A folha A4 com vários: é o que vai para a máquina de gravação, que
  // aproveita a chapa inteira de uma vez.
  if (String(ctx.options.saida ?? 'um') === 'folha') {
    const folha = await PDFDocument.create();
    const [larguraA4, alturaA4] = [mmParaPt(FORMATOS_MM.a4.largura), mmParaPt(FORMATOS_MM.a4.altura)];
    const espaco = mmParaPt(limitar(ctx.options.espacoMm, 0, 30, 4));
    const margem = mmParaPt(limitar(ctx.options.margemFolhaMm, 0, 40, 10));

    const colunas = Math.max(1, Math.floor((larguraA4 - margem * 2 + espaco) / (largura + espaco)));
    const linhasNaFolha = Math.max(1, Math.floor((alturaA4 - margem * 2 + espaco) / (altura + espaco)));
    const [embutido] = await folha.embedPdf(await doc.save());
    const paginaA4 = folha.addPage([larguraA4, alturaA4]);

    for (let l = 0; l < linhasNaFolha; l += 1) {
      for (let c = 0; c < colunas; c += 1) {
        paginaA4.drawPage(embutido, {
          x: margem + c * (largura + espaco),
          y: alturaA4 - margem - (l + 1) * altura - l * espaco,
          width: largura,
          height: altura,
        });
      }
    }
    notas.push(`${colunas * linhasNaFolha} carimbos na folha A4, em grade de ${colunas} por ${linhasNaFolha}.`);
    const blob = await salvarPdf(folha);
    ctx.onProgress(1);
    return {
      files: [{ name: 'carimbos-folha.pdf', blob, pages: 1 }],
      inputBytes: 0,
      outputBytes: blob.size,
      notes: notas,
    };
  }

  const blob = await salvarPdf(doc);
  ctx.onProgress(1);
  return {
    files: [{ name: redondo ? 'carimbo-redondo.pdf' : 'carimbo.pdf', blob, pages: 1 }],
    inputBytes: 0,
    outputBytes: blob.size,
    notes: notas,
  };
}
