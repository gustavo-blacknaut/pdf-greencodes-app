import { loadPdfLib } from '../lazy';
import { openWithPdfLib, respirar, salvarPdf } from '../nucleo';
import type { RunContext, RunResult } from '../tipos';
import { suffixName } from '../../utils';

/** Usa a área visível e a rotação, sem converter a página em imagem. */
function medida(pagina: { getCropBox(): { width: number; height: number }; getRotation(): { angle: number } }) {
  const caixa = pagina.getCropBox();
  const giro = ((pagina.getRotation().angle % 360) + 360) % 360;
  const troca = giro === 90 || giro === 270;
  return { largura: troca ? caixa.height : caixa.width, altura: troca ? caixa.width : caixa.height, giro };
}

export async function padronizarOrientacao(ctx: RunContext): Promise<RunResult> {
  const { degrees } = await loadPdfLib();
  const paisagem = ctx.options.orientacao === 'paisagem';
  const giroExtra = ctx.options.sentido === 'anti-horario' ? 270 : 90;
  const files: RunResult['files'] = [];
  let alteradas = 0;
  for (let f = 0; f < ctx.files.length; f += 1) {
    const arquivo = ctx.files[f];
    const doc = await openWithPdfLib(arquivo.bytes, arquivo.senha);
    for (const pagina of doc.getPages()) {
      const m = medida(pagina);
      if (Math.abs(m.largura - m.altura) > 0.01 && (m.largura > m.altura) !== paisagem) {
        pagina.setRotation(degrees((m.giro + giroExtra) % 360));
        alteradas += 1;
      }
      await respirar(ctx);
    }
    const blob = await salvarPdf(doc, arquivo.senha);
    files.push({ name: suffixName(arquivo.name, paisagem ? 'paisagem' : 'retrato'), blob, pages: doc.getPageCount() });
    ctx.onProgress((f + 1) / ctx.files.length, `Preparando ${arquivo.name}`);
  }
  return { files, inputBytes: ctx.files.reduce((n, f) => n + f.size, 0),
    outputBytes: files.reduce((n, f) => n + f.blob.size, 0),
    notes: [`${alteradas} página(s) girada(s), sem redimensionar nem rasterizar. Páginas quadradas mantêm a orientação.`] };
}

/** Impede que nomes de arquivo sejam interpretados como fórmulas na planilha. */
export function celulaCsv(valor: string): string {
  const texto = /^[\s]*[=+@-]/.test(valor) ? `'${valor}` : valor;
  return `"${texto.replace(/"/g, '""')}"`;
}

export async function relatorioPaginas(ctx: RunContext): Promise<RunResult> {
  const linhas = ['Arquivo;Pagina;Largura_mm;Altura_mm;Orientacao;Rotacao_graus'];
  let paginas = 0;
  for (let f = 0; f < ctx.files.length; f += 1) {
    const arquivo = ctx.files[f];
    const doc = await openWithPdfLib(arquivo.bytes, arquivo.senha);
    for (const [indice, pagina] of doc.getPages().entries()) {
      const m = medida(pagina);
      const sentido = Math.abs(m.largura - m.altura) <= 0.01 ? 'Quadrada' : m.largura > m.altura ? 'Paisagem' : 'Retrato';
      const mm = (pt: number) => (pt * 25.4 / 72).toFixed(2).replace('.', ',');
      linhas.push([celulaCsv(arquivo.name), indice + 1, mm(m.largura), mm(m.altura), sentido, m.giro].join(';'));
      paginas += 1;
      if (indice % 25 === 0) await respirar(ctx);
    }
    ctx.onProgress((f + 1) / ctx.files.length, `Conferindo ${arquivo.name}`);
  }
  const blob = new Blob(['\uFEFF', linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  return { files: [{ name: 'relatorio-paginas.csv', blob }],
    inputBytes: ctx.files.reduce((n, f) => n + f.size, 0), outputBytes: blob.size,
    notes: [`${paginas} página(s) conferida(s). Medidas da área visível, considerando a rotação.`,
      'O CSV pode ser aberto no Excel. O relatório não tem senha e contém os nomes dos arquivos.'] };
}
