import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { desbloquearParaImpressao } from './desbloquear';

async function protegido() {
  const documento = await PDFDocument.create();
  const fonte = await documento.embedFont(StandardFonts.Helvetica);
  documento.addPage([283.46, 425.2]).drawText('Foto e texto preservados', { font: fonte, x: 20, y: 100 });
  documento.addPage([425.2, 283.46]).drawText('Verso preservado', { font: fonte, x: 20, y: 100 });
  documento.encrypt({ userPassword: '123teste', ownerPassword: 'dono', permissions: { printing: 'highResolution' } });
  return new Blob([(await documento.save({ useObjectStreams: false })).slice().buffer], { type: 'application/pdf' });
}

describe('PDF com senha na impressão', () => {
  it('desbloqueia todas as páginas mantendo medidas e conteúdo vetorial para montar e imprimir', async () => {
    const origem = await protegido();
    const { blob, paginas } = await desbloquearParaImpressao(origem, '123teste');
    const aberto = await PDFDocument.load(await blob.arrayBuffer());
    expect(paginas).toBe(2);
    expect(aberto.isEncrypted).toBe(false);
    expect(aberto.getPages().map((pagina) => pagina.getSize())).toEqual([
      { width: 283.46, height: 425.2 }, { width: 425.2, height: 283.46 },
    ]);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const leitura = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    try {
      const textos = [];
      for (let pagina = 1; pagina <= leitura.numPages; pagina += 1) {
        const conteudo = await (await leitura.getPage(pagina)).getTextContent();
        textos.push(conteudo.items.map((item) => 'str' in item ? item.str : '').join(''));
      }
      expect(textos).toEqual(['Foto e texto preservados', 'Verso preservado']);
    } finally { await leitura.destroy(); }
    await expect(PDFDocument.load(await origem.arrayBuffer())).rejects.toThrow();
  });

  it('recusa a senha errada, permitindo nova tentativa sem modificar a origem', async () => {
    const origem = await protegido();
    await expect(desbloquearParaImpressao(origem, 'incorreta')).rejects.toThrow('Senha incorreta');
    await expect(desbloquearParaImpressao(origem, '123teste')).resolves.toMatchObject({ paginas: 2 });
  });

  it('informa documento inválido sem confundir com senha incorreta', async () => {
    await expect(desbloquearParaImpressao(new Blob(['invalido']), '123teste')).rejects.toThrow('Não foi possível preparar');
  });
});
