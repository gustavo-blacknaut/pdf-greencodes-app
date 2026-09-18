import { loadPdfLib } from '../lazy';
import { mmParaPt, openWithPdfLib, respirar, salvarPdf, senhaDaFila } from '../nucleo';
import type { RunContext, RunResult } from '../tipos';
import { MODELOS_DE_ETIQUETA } from './etiquetas';
import { ligado, limitar } from './grafica';
import { PAPEIS } from '../../impressao/layout';

export async function calibrarImpressao(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const modelo = MODELOS_DE_ETIQUETA[String(ctx.options.modelo) as keyof typeof MODELOS_DE_ETIQUETA];
  const papel = modelo || ctx.options.papel === 'Letter' ? 'Letter' : 'A4';
  const { largura, altura } = PAPEIS[papel];
  const tamanho: [number, number] = [mmParaPt(largura), mmParaPt(altura)];
  const cor = rgb(0.25, 0.25, 0.25);
  if (modelo) {
    const folha = doc.addPage(tamanho);
    for (let linha = 0; linha < modelo.linhas; linha += 1) {
      for (let coluna = 0; coluna < modelo.colunas; coluna += 1) {
        const x = mmParaPt(modelo.esquerda + coluna * modelo.passoX);
        const y = mmParaPt(altura - modelo.topo - linha * modelo.passoY - modelo.altura);
        const w = mmParaPt(modelo.largura);
        const h = mmParaPt(modelo.altura);
        const contorno = { borderWidth: 0.4, borderColor: cor };
        if (modelo.redonda) folha.drawEllipse({ x: x + w / 2, y: y + h / 2, xScale: w / 2, yScale: h / 2, ...contorno });
        else folha.drawRectangle({ x, y, width: w, height: h, ...contorno });
        const cx = x + w / 2;
        const cy = y + h / 2;
        folha.drawLine({ start: { x: cx - 4, y: cy }, end: { x: cx + 4, y: cy }, thickness: 0.4, color: cor });
        folha.drawLine({ start: { x: cx, y: cy - 4 }, end: { x: cx, y: cy + 4 }, thickness: 0.4, color: cor });
        const texto = `${linha + 1}.${coluna + 1}`;
        folha.drawText(texto, { x: cx - fonte.widthOfTextAtSize(texto, 7) / 2, y: cy + 6, size: 7, font: fonte, color: cor });
      }
      await respirar(ctx);
    }
  }
  const folha = doc.addPage(tamanho);
  const texto = (valor: string, x: number, topo: number, size = 10) =>
    folha.drawText(valor, { x: mmParaPt(x), y: mmParaPt(altura - topo), size, font: fonte, color: cor });
  texto('Conferência de escala e alinhamento', 15, 20, 17);
  texto(`${papel === 'Letter' ? 'Carta' : 'A4'}: ${largura} x ${altura} mm. Imprima em tamanho real (100%).`, 15, 29);
  texto('A distância entre as marcas 0 e 100 deve medir exatamente 100 mm.', 15, 39);
  const linha = (x1: number, y1: number, x2: number, y2: number) => folha.drawLine({
    start: { x: mmParaPt(x1), y: mmParaPt(altura - y1) },
    end: { x: mmParaPt(x2), y: mmParaPt(altura - y2) }, thickness: 0.5, color: cor,
  });
  linha(25, 55, 125, 55);
  linha(25, 55, 25, 155);
  for (let mm = 0; mm <= 100; mm += 1) {
    const traco = mm % 10 === 0 ? 4 : mm % 5 === 0 ? 2.5 : 1.5;
    linha(25 + mm, 55, 25 + mm, 55 - traco);
    linha(25, 55 + mm, 25 - traco, 55 + mm);
    if (mm % 10 === 0) {
      texto(String(mm), 23 + mm, 48, 8);
      texto(String(mm), 12, 56 + mm, 8);
    }
  }
  folha.drawRectangle({ x: mmParaPt(50), y: mmParaPt(altura - 140), width: mmParaPt(50), height: mmParaPt(50), borderWidth: 0.5, borderColor: cor });
  texto('50 x 50 mm', 61, 118);
  texto('Se a régua sair menor ou maior, desative o ajuste à página no driver.', 15, 175);
  texto('Nas etiquetas, compare a primeira e a última coluna contra a luz.', 15, 183);
  texto('Escala errada acumula desvio; deslocamento move a grade inteira.', 15, 191);
  texto('Nas opções das etiquetas: positivo move para a direita; negativo, esquerda.', 15, 199, 9);
  if (modelo) texto(`Grade de referência: ${modelo.nome}.`, 15, 215);
  await respirar(ctx);
  const blob = await salvarPdf(doc);
  return { files: [{ name: 'conferencia-impressao.pdf', blob, pages: doc.getPageCount() }],
    inputBytes: 0, outputBytes: blob.size, papelImpressao: papel,
    notes: ['Use papel comum para a conferência. As réguas medem 100 mm e o quadrado mede 50 x 50 mm.',
      ...(modelo ? ['A primeira página contém a grade; a segunda, as réguas. Nenhum ajuste da impressora foi aplicado à referência.'] : [])] };
}

export async function separarPorTamanho(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const tolerancia = limitar(ctx.options.toleranciaMm, 0, 2, 0.5);
  const separarSentidos = ligado(ctx.options.orientacoes, false);
  type Grupo = { largura: number; altura: number; paisagem: boolean; doc: Awaited<ReturnType<typeof PDFDocument.create>> };
  const grupos: Grupo[] = [];
  for (let f = 0; f < ctx.files.length; f += 1) {
    const arquivo = ctx.files[f];
    const origem = await openWithPdfLib(arquivo.bytes, arquivo.senha);
    const indices = new Map<Grupo, number[]>();
    for (let i = 0; i < origem.getPageCount(); i += 1) {
      const pagina = origem.getPage(i);
      const caixa = pagina.getCropBox();
      const girada = Math.abs(pagina.getRotation().angle) % 180 === 90;
      const w = (girada ? caixa.height : caixa.width) * 25.4 / 72;
      const h = (girada ? caixa.width : caixa.height) * 25.4 / 72;
      const largura = Math.min(w, h);
      const altura = Math.max(w, h);
      const paisagem = w > h;
      let grupo = grupos.find((g) => Math.abs(g.largura - largura) <= tolerancia + 1e-6
        && Math.abs(g.altura - altura) <= tolerancia + 1e-6 && (!separarSentidos || g.paisagem === paisagem));
      if (!grupo) {
        grupo = { largura, altura, paisagem, doc: await PDFDocument.create() };
        grupos.push(grupo);
      }
      const lista = indices.get(grupo) ?? [];
      lista.push(i);
      indices.set(grupo, lista);
      if (i % 25 === 0) await respirar(ctx);
    }
    for (const [grupo, paginas] of indices) {
      for (const pagina of await grupo.doc.copyPages(origem, paginas)) grupo.doc.addPage(pagina);
    }
    ctx.onProgress((f + 1) / ctx.files.length, `Agrupando ${arquivo.name}`);
    await respirar(ctx);
  }
  if (!grupos.length) throw new Error('Nenhuma página encontrada para separar.');
  const files: RunResult['files'] = [];
  for (const grupo of grupos) {
    const conhecido = Object.entries(PAPEIS).find(([, medida]) =>
      Math.abs(medida.largura - grupo.largura) < 0.6 && Math.abs(medida.altura - grupo.altura) < 0.6)?.[0];
    const nome = conhecido === 'Letter' ? 'Carta' : conhecido ?? `${grupo.largura.toFixed(1)}x${grupo.altura.toFixed(1)}mm`;
    const sentido = separarSentidos ? (grupo.paisagem ? '-paisagem' : '-retrato') : '';
    const blob = await salvarPdf(grupo.doc, senhaDaFila(ctx.files));
    files.push({ name: `paginas-${nome}${sentido}.pdf`, blob, pages: grupo.doc.getPageCount() });
    await respirar(ctx);
  }
  return { files, inputBytes: ctx.files.reduce((soma, file) => soma + file.size, 0),
    outputBytes: files.reduce((soma, file) => soma + file.blob.size, 0),
    notes: [`${grupos.length} grupo(s) de medidas. As páginas mantêm o tamanho e o conteúdo originais.`] };
}
