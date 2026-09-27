import { decodificarImagem } from './decodificar';
import { loadPdfLib } from '../pdf/lazy';
import { canvasToBlob } from '../pdf/nucleo';

export async function imagemParaImpressao(arquivo: Blob, nome: string): Promise<Blob> {
  const { bitmap, largura, altura } = await decodificarImagem({ name: nome, bytes: await arquivo.arrayBuffer(), type: arquivo.type });
  const canvas = document.createElement('canvas');
  try {
    canvas.width = largura; canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível preparar a foto.');
    ctx.drawImage(bitmap, 0, 0);
    const png = await canvasToBlob(canvas, 'image/png');
    const { PDFDocument } = await loadPdfLib();
    const pdf = await PDFDocument.create();
    const imagem = await pdf.embedPng(await png.arrayBuffer());
    const pagina = pdf.addPage([largura * 72 / 600, altura * 72 / 600]);
    pagina.drawImage(imagem, { x: 0, y: 0, width: pagina.getWidth(), height: pagina.getHeight() });
    return new Blob([(await pdf.save()).slice().buffer], { type: 'application/pdf' });
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}
