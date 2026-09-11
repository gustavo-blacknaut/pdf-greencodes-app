'use client';

/**
 * Recomprime as fotos JPEG de dentro do PDF, sem tocar no resto.
 *
 * É o nível "Recomendada" do site. Texto, linhas e vetores não mudam; só as
 * fotos grandes são reduzidas para a resolução pedida e regravadas em JPEG.
 * É onde mora quase todo o peso de um PDF de verdade — o celular fotografa
 * em 4000 pixels o que vai ser impresso em 10 centímetros.
 *
 * Conservador de propósito: só entra JPEG em RGB ou cinza, com 8 bits e sem
 * `/Decode`. CMYK o navegador decodifica com a cor errada, e máscara ou
 * decodificação invertida sairiam diferentes — esses ficam como estão. E cada
 * foto só é trocada se a nova ficar menor.
 */

import type { PDFDocument } from '@cantoo/pdf-lib';
import { canvasToBlob } from './nucleo';

/** O maior lado de uma A4 em polegadas: é a medida que a foto vai ocupar, no máximo. */
const LADO_MAIOR_EM_POLEGADAS = 11.7;

export type ResultadoDaRecompressao = { trocadas: number; economizados: number };

export async function recomprimirFotos(
  doc: PDFDocument,
  dpi: number,
  qualidade: number,
  aoAndar?: (fracao: number) => void,
): Promise<ResultadoDaRecompressao> {
  const { PDFArray, PDFName, PDFNumber, PDFRawStream, PDFRef } = await import('@cantoo/pdf-lib');
  const contexto = doc.context;
  const teto = Math.round(LADO_MAIOR_EM_POLEGADAS * dpi);

  const resolver = (valor: unknown) => (valor instanceof PDFRef ? contexto.lookup(valor) : valor);
  const nome = (valor: unknown) => {
    const resolvido = resolver(valor);
    return resolvido instanceof PDFName ? resolvido.asString() : undefined;
  };
  const numero = (valor: unknown) => {
    const resolvido = resolver(valor);
    return resolvido instanceof PDFNumber ? resolvido.asNumber() : 0;
  };
  // `/Filter /DCTDecode` e `/Filter [/DCTDecode]` são a mesma coisa.
  const filtroUnico = (valor: unknown) => {
    const resolvido = resolver(valor);
    if (resolvido instanceof PDFArray) return resolvido.size() === 1 ? nome(resolvido.get(0)) : undefined;
    return nome(resolvido);
  };
  // Celular e scanner costumam gravar a foto com perfil ICC em vez de
  // DeviceRGB. Com 1 ou 3 canais é cinza ou RGB do mesmo jeito.
  const espacoAceito = (valor: unknown) => {
    const resolvido = resolver(valor);
    const simples = nome(resolvido);
    if (simples) return simples === '/DeviceRGB' || simples === '/DeviceGray';
    if (!(resolvido instanceof PDFArray) || nome(resolvido.get(0)) !== '/ICCBased') return false;
    const perfil = resolver(resolvido.get(1));
    const canais = perfil instanceof PDFRawStream ? numero(perfil.dict.get(PDFName.of('N'))) : 0;
    return canais === 1 || canais === 3;
  };

  const objetos = contexto.enumerateIndirectObjects();
  let trocadas = 0;
  let economizados = 0;

  for (let i = 0; i < objetos.length; i += 1) {
    const [ref, objeto] = objetos[i];
    if (i % 20 === 0) aoAndar?.(i / objetos.length);
    if (!(objeto instanceof PDFRawStream)) continue;

    const dict = objeto.dict;
    if (nome(dict.get(PDFName.of('Subtype'))) !== '/Image') continue;
    if (filtroUnico(dict.get(PDFName.of('Filter'))) !== '/DCTDecode') continue;
    if (dict.get(PDFName.of('Decode')) || dict.get(PDFName.of('ImageMask'))) continue;
    if (numero(dict.get(PDFName.of('BitsPerComponent'))) !== 8) continue;
    if (!espacoAceito(dict.get(PDFName.of('ColorSpace')))) continue;

    const largura = numero(dict.get(PDFName.of('Width')));
    const altura = numero(dict.get(PDFName.of('Height')));
    if (!largura || !altura) continue;

    const original = objeto.getContents();
    const fator = Math.min(1, teto / Math.max(largura, altura));
    // Foto já pequena e já leve: recomprimir só perderia qualidade.
    const bytesPorPixel = original.length / (largura * altura);
    if (fator === 1 && bytesPorPixel < 0.35) continue;

    try {
      const bitmap = await createImageBitmap(new Blob([original.slice().buffer as ArrayBuffer], { type: 'image/jpeg' }));
      const novaLargura = Math.max(1, Math.round(largura * fator));
      const novaAltura = Math.max(1, Math.round(altura * fator));
      const canvas = document.createElement('canvas');
      canvas.width = novaLargura;
      canvas.height = novaAltura;
      const pincel = canvas.getContext('2d');
      if (!pincel) {
        bitmap.close();
        continue;
      }
      pincel.imageSmoothingEnabled = true;
      pincel.imageSmoothingQuality = 'high';
      pincel.drawImage(bitmap, 0, 0, novaLargura, novaAltura);
      bitmap.close();

      const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', qualidade)).arrayBuffer());
      canvas.width = 0;
      canvas.height = 0;
      if (jpeg.length >= original.length) continue;

      // O canvas sempre devolve JPEG em RGB, mesmo de uma foto em cinza.
      const novo = contexto.stream(jpeg, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: novaLargura,
        Height: novaAltura,
        ColorSpace: 'DeviceRGB',
        BitsPerComponent: 8,
        Filter: 'DCTDecode',
      });
      const mascara = dict.get(PDFName.of('SMask'));
      if (mascara) novo.dict.set(PDFName.of('SMask'), mascara);
      contexto.assign(ref, novo);

      trocadas += 1;
      economizados += original.length - jpeg.length;
    } catch {
      // JPEG que o navegador não decodifica fica como estava.
    }
  }

  aoAndar?.(1);
  return { trocadas, economizados };
}
