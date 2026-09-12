'use client';

/** Deixar o arquivo menor, mais leve ou legível de novo. */

import {
  canvasToBlob,
  copy,
  openWithPdfJs,
  openWithPdfLib,
  renderPageToCanvas,
  respirar,
  salvarPdf,
  senhaDaFila,
} from '../nucleo';
import { type OutputFile, type RunContext, type RunResult } from '../tipos';
import { suffixName } from '../../utils';
import { loadPdfLib } from '../lazy';
import { recomprimirFotos } from '../recomprimir';

/**
 * Níveis de compressão.
 *
 * `dpi: 0` significa não rasterizar: o documento é só reescrito com estrutura
 * compacta, e nem um pixel muda. Esse é o padrão de propósito.
 *
 * Rasterizar reduz muito mais, mas mexe na cor, e isso não é ajuste fino: o
 * canvas entrega tudo em sRGB e o JPEG ainda faz subamostragem de croma. Um PDF
 * em CMYK ou com perfil ICC embutido sai visivelmente diferente do original.
 * Quem pede "só comprimir" não espera a cor mudar, então isso virou escolha
 * explícita, com aviso na tela.
 */
export const COMPRESSION_PRESETS = {
  // O padrão: 300 DPI, a resolução em que a gráfica imprime. Encolhe muito e
  // não tira nada que o papel mostrasse — descer para 150 sem pedir seria
  // decidir sozinho estragar a foto de alguém.
  impressao: { dpi: 0, quality: 0, fotos: { dpi: 300, quality: 0.82 } },
  alta: { dpi: 0, quality: 0, fotos: { dpi: 600, quality: 0.88 } },
  // Para tela e e-mail: menor, mas no papel a foto amolece.
  recomendada: { dpi: 0, quality: 0, fotos: { dpi: 150, quality: 0.75 } },
  forte: { dpi: 0, quality: 0, fotos: { dpi: 100, quality: 0.6 } },
  'sem-perda': { dpi: 0, quality: 0, fotos: null },
  // O nome antigo do meio-termo, para quem ainda mandar.
  equilibrada: { dpi: 0, quality: 0, fotos: { dpi: 150, quality: 0.75 } },
  maxima: { dpi: 110, quality: 0.62, fotos: null },
} as const;

export type CompressionLevel = keyof typeof COMPRESSION_PRESETS;

export async function compress(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const level = (ctx.options.level as CompressionLevel) ?? 'impressao';
  const preset = COMPRESSION_PRESETS[level] ?? COMPRESSION_PRESETS.impressao;
  const notes: string[] = [];
  const outputs: OutputFile[] = [];
  const canvas = document.createElement('canvas');

  let inputBytes = 0;
  let outputBytes = 0;

  for (let f = 0; f < ctx.files.length; f += 1) {
    const source = ctx.files[f];
    inputBytes += source.size;
    const fileWeight = 1 / ctx.files.length;
    const fileBase = f * fileWeight;

    let rasterized: Blob | null = null;

    if (preset.dpi > 0) {
      const doc = await openWithPdfJs(source.bytes, source.senha);
      const out = await PDFDocument.create();
      for (let i = 1; i <= doc.numPages; i += 1) {
        ctx.onProgress(
          fileBase + (fileWeight * (i - 1)) / doc.numPages,
          `${source.name}: página ${i} de ${doc.numPages}`,
        );
        const page = await doc.getPage(i);
        const { widthPt, heightPt } = await renderPageToCanvas(page, preset.dpi, canvas);
        const jpeg = await canvasToBlob(canvas, 'image/jpeg', preset.quality);
        const embedded = await out.embedJpg(await jpeg.arrayBuffer());
        const target = out.addPage([widthPt, heightPt]);
        target.drawImage(embedded, { x: 0, y: 0, width: widthPt, height: heightPt });
        page.cleanup();
        await respirar(ctx);
      }
      await doc.destroy();
      rasterized = await salvarPdf(out, source.senha);
    }

    // O caminho do meio: as fotos encolhem e o resto fica. Arquivo com senha
    // fica de fora — as imagens dele estão cifradas lá dentro.
    let comFotosMenores: Blob | null = null;
    if (preset.fotos && !source.senha) {
      const doc = await openWithPdfLib(source.bytes);
      const { trocadas } = await recomprimirFotos(doc, preset.fotos.dpi, preset.fotos.quality, (fracao) =>
        ctx.onProgress(fileBase + fileWeight * 0.85 * fracao, `${source.name}: reduzindo as fotos`),
      );
      if (trocadas > 0) comFotosMenores = await salvarPdf(doc);
    }

    // Rasterizar destrói o texto vetorial: num PDF que já é só texto o arquivo
    // costuma crescer. Por isso comparamos com a reescrita sem perda e ficamos
    // com o menor dos dois.
    ctx.onProgress(fileBase + fileWeight * 0.9, `${source.name}: otimizando a estrutura`);
    const lossless = await openWithPdfLib(source.bytes, source.senha);
    const losslessBlob = await salvarPdf(lossless, source.senha);

    let chosen = rasterized && rasterized.size < losslessBlob.size ? rasterized : losslessBlob;
    if (comFotosMenores && comFotosMenores.size < chosen.size) {
      chosen = comFotosMenores;
      notes.push(`${source.name}: as fotos foram reduzidas e recomprimidas; o texto continua texto.`);
    }
    if (chosen.size >= source.size) {
      // Nenhum dos dois caminhos ganhou do arquivo que entrou.
      chosen = new Blob([copy(source.bytes)], { type: 'application/pdf' });
      notes.push(
        `${source.name}: neste nível a compressão deixaria o arquivo maior, então mantivemos o original. Tente um nível mais forte.`,
      );
    } else if (chosen === losslessBlob && rasterized) {
      notes.push(`${source.name}: converter em imagem deixaria maior, então preservamos o conteúdo original.`);
    } else if (chosen === rasterized) {
      notes.push(`${source.name}: as páginas viraram imagem, então a cor pode sair um pouco diferente do original.`);
    }

    outputBytes += chosen.size;
    outputs.push({ name: suffixName(source.name, 'comprimido'), blob: chosen, pages: source.pageCount ?? undefined });
  }

  ctx.onProgress(1);
  // Comprimir vários e receber vários arquivos separados obriga a juntar
  // depois, numa segunda passada. Com a opção ligada sai um documento só, na
  // ordem da fila.
  const juntar = ctx.options.juntar === true || ctx.options.juntar === 'true';
  if (juntar && outputs.length > 1) {
    ctx.onProgress(0.95, 'Juntando num arquivo só');
    const unido = await PDFDocument.create();
    let paginas = 0;

    for (const arquivo of outputs) {
      const parte = await PDFDocument.load(await arquivo.blob.arrayBuffer());
      const indices = parte.getPageIndices();
      for (const pagina of await unido.copyPages(parte, indices)) unido.addPage(pagina);
      paginas += indices.length;
      await respirar(ctx);
    }

    const blob = await salvarPdf(unido, senhaDaFila(ctx.files));
    ctx.onProgress(1);
    return {
      files: [{ name: suffixName(ctx.files[0].name, 'comprimido-unido'), blob, pages: paginas }],
      inputBytes,
      outputBytes: blob.size,
      notes: [...notes, `${outputs.length} arquivos comprimidos e unidos em ${paginas} páginas.`],
      highlightSavings: true,
    };
  }

  return { files: outputs, inputBytes, outputBytes, notes, highlightSavings: true };
}

/**
 * Não conserta um PDF corrompido de verdade: só reconstrói a estrutura
 * interna (tabela de referências, objetos) do zero a partir do que consegue
 * ler. É o mesmo caminho que a compressão "sem perda" usa, exposto como
 * ferramenta própria porque resolve boa parte dos "meu PDF não abre".
 */
export async function repair(ctx: RunContext): Promise<RunResult> {
  const source = ctx.files[0];
  ctx.onProgress(0.15, 'Lendo a estrutura do arquivo...');
  const doc = await openWithPdfLib(source.bytes, source.senha);
  ctx.onProgress(0.7, 'Reescrevendo o PDF do zero...');
  const blob = await salvarPdf(doc, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'reparado'), blob, pages: doc.getPageCount() }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: [
      'Reescrevemos toda a estrutura interna do arquivo. Isso resolve boa parte dos PDFs corrompidos ou gerados por programas com falhas, mas não recupera conteúdo que já estava perdido no original.',
    ],
  };
}

/**
 * Roda a mesma máquina em todas as ferramentas que mexem na cor: desenha a
 * página, transforma os pixels e devolve um PDF de imagens.
 *
 * Rasterizar descarta o texto vetorial, então o resultado deixa de ser
 * pesquisável. É o preço de garantir que a cor no papel seja a que aparece
 * na tela: mexer nas cores sem redesenhar exigiria reinterpretar cada objeto
 * do PDF, um por um, e ainda assim não pegaria o que está dentro de imagem.
 */
async function redesenharComFiltro(
  ctx: RunContext,
  filtro: (dados: Uint8ClampedArray) => void,
  sufixo: string,
  notas: string[],
): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const dpi = Math.max(72, Math.min(300, Number(ctx.options.dpi ?? 150)));
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const out = await PDFDocument.create();
  const canvas = document.createElement('canvas');

  for (let i = 1; i <= doc.numPages; i += 1) {
    ctx.onProgress((i - 1) / doc.numPages, `Página ${i} de ${doc.numPages}`);
    const page = await doc.getPage(i);
    const { widthPt, heightPt } = await renderPageToCanvas(page, dpi, canvas);

    const pincel = canvas.getContext('2d');
    if (pincel) {
      const imagem = pincel.getImageData(0, 0, canvas.width, canvas.height);
      filtro(imagem.data);
      pincel.putImageData(imagem, 0, 0);
    }

    const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.82);
    const embutida = await out.embedJpg(await jpeg.arrayBuffer());
    out.addPage([widthPt, heightPt]).drawImage(embutida, { x: 0, y: 0, width: widthPt, height: heightPt });

    page.cleanup();
    await respirar(ctx);
  }
  const paginas = doc.numPages;
  await doc.destroy();

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, sufixo), blob, pages: paginas }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: notas,
  };
}

/** Luminância perceptual: verde pesa mais que vermelho, que pesa mais que azul. */
function luz(dados: Uint8ClampedArray, p: number): number {
  return 0.2126 * dados[p] + 0.7152 * dados[p + 1] + 0.0722 * dados[p + 2];
}

/**
 * Inverte para preto e branco: escuro fica claro, claro fica escuro.
 *
 * Não é inverter cada canal de cor — isso devolve as complementares, que é
 * outra coisa e quase nunca é o que se quer. O uso real é ler um documento
 * de fundo escuro, ou economizar toner num que veio todo preto.
 *
 * Separada da operação para poder ser verificada sem montar um PDF inteiro.
 */
export function filtroInverter(dados: Uint8ClampedArray): void {
  for (let p = 0; p < dados.length; p += 4) {
    const cinza = Math.round(255 - luz(dados, p));
    dados[p] = cinza;
    dados[p + 1] = cinza;
    dados[p + 2] = cinza;
  }
}

/**
 * De que tom cada tom vira, nos dois modos do tons de preto.
 *
 * São 256 valores, um por tom possível — a mesma tabela do motor Python, para
 * o site e o aplicativo entregarem a mesma folha.
 *
 * No limiar não há meio-termo: cinza claro imprime falhado e texto
 * digitalizado costuma sair cinza, então ele vira preto cheio. O preço é
 * alto e foi o que fez o defeito: a borda suavizada de cada letra também
 * vira preta, o texto sai engrossado, e foto vira mancha preta.
 *
 * Na curva — o padrão — o escuro vai a preto cheio, o claro vai a branco de
 * papel e o meio-tom continua existindo, só que mais fundo.
 */
/**
 * Onde ficam as pontas da imagem, ignorando o pixel perdido.
 *
 * Um preto solto num canto não pode decidir o preto da página inteira, então
 * as pontas são percentis. A amostragem de sete em sete mantém a conta barata
 * numa página de dois milhões de pixels.
 */
export function pontasDaImagem(dados: Uint8ClampedArray, baixo = 0.005, alto = 0.995): [number, number] {
  const histograma = new Uint32Array(256);
  let total = 0;
  for (let p = 0; p < dados.length; p += 4 * 7) {
    histograma[dados[p]] += 1;
    total += 1;
  }
  if (!total) return [0, 255];

  const tomEm = (fracao: number) => {
    const alvo = total * fracao;
    let soma = 0;
    for (let tom = 0; tom < 256; tom += 1) {
      soma += histograma[tom];
      if (soma >= alvo) return tom;
    }
    return 255;
  };
  return [tomEm(baixo), tomEm(alto)];
}

/**
 * Estica a faixa usada até as pontas, com um S de leve.
 *
 * É a mesma tabela do motor Python. Esticar sozinho devolve o preto e o
 * branco, mas o meio continua mole — é o "ficou tudo cinza" de uma foto
 * convertida. O S dá corpo sem fechar sombra nem estourar luz.
 */
export function tabelaDeNiveis(preto: number, branco: number): Uint8ClampedArray {
  const tabela = new Uint8ClampedArray(256);
  if (branco - preto < 8) {
    for (let tom = 0; tom < 256; tom += 1) tabela[tom] = tom;
    return tabela;
  }
  const faixa = branco - preto;
  for (let tom = 0; tom < 256; tom += 1) {
    if (tom <= preto) continue;
    if (tom >= branco) {
      tabela[tom] = 255;
      continue;
    }
    const esticado = (tom - preto) / faixa;
    const doMeio = esticado - 0.5;
    tabela[tom] = Math.round((esticado + 0.24 * doMeio * (1 - 4 * doMeio * doMeio)) * 255);
  }
  return tabela;
}

/** Níveis automáticos sobre pixels já em cinza, no lugar. */
export function darContraste(dados: Uint8ClampedArray): void {
  const [preto, branco] = pontasDaImagem(dados);
  if (preto <= 2 && branco >= 252) return;
  const tabela = tabelaDeNiveis(preto, branco);
  for (let p = 0; p < dados.length; p += 4) {
    const valor = tabela[dados[p]];
    dados[p] = valor;
    dados[p + 1] = valor;
    dados[p + 2] = valor;
  }
}

export function tabelaDeTonsDePreto(limite: number, duro: boolean): Uint8ClampedArray {
  const tabela = new Uint8ClampedArray(256);
  if (duro) {
    for (let tom = 0; tom < 256; tom += 1) tabela[tom] = tom > limite ? 255 : 0;
    return tabela;
  }
  const branco = Math.max(limite + 1, Math.min(255, Math.round(limite * 1.15)));
  const preto = Math.max(0, Math.min(branco - 1, Math.round(limite * 0.6)));
  const faixa = branco - preto;
  for (let tom = 0; tom < 256; tom += 1) {
    tabela[tom] = tom <= preto ? 0 : tom >= branco ? 255 : Math.round(((tom - preto) * 255) / faixa);
  }
  return tabela;
}

export function filtroTonsDePreto(dados: Uint8ClampedArray, limite: number, duro = false): void {
  const tabela = tabelaDeTonsDePreto(limite, duro);
  for (let p = 0; p < dados.length; p += 4) {
    const valor = tabela[Math.round(luz(dados, p))];
    dados[p] = valor;
    dados[p + 1] = valor;
    dados[p + 2] = valor;
  }
}

/**
 * Inverte: o que era preto vira branco e o que era branco vira preto.
 *
 * Só em preto e branco, e não invertendo cada canal de cor. Inverter os
 * canais de um documento colorido devolve as cores complementares, que é
 * outra coisa e quase nunca é o que se quer — o uso real é ler um documento
 * de fundo escuro, ou economizar toner num que veio todo preto.
 */
export async function invertColors(ctx: RunContext): Promise<RunResult> {
  return redesenharComFiltro(
    ctx,
    filtroInverter,
    // "negativo", e não "invertido": esse é o nome do Inverter páginas, e os
    // dois resultados caíam com o mesmo nome na mesma pasta.
    'negativo',
    [
      'O documento vira preto e branco invertido: o que era escuro fica claro e o que era claro fica escuro.',
      'As páginas viraram imagem, então o texto deixa de ser selecionável e pesquisável.',
    ],
  );
}

/**
 * Tons de preto: o que é cinza vira preto.
 *
 * Cinza claro imprime falhado, e texto digitalizado costuma sair cinza. Aqui
 * tudo que passa do limite vira branco e o resto vira preto puro, sem meio
 * termo — o texto sai cheio, e não chapiscado.
 */
export async function blackTones(ctx: RunContext): Promise<RunResult> {
  // Acima disto é fundo; abaixo é conteúdo. 180 de 255 deixa o cinza claro
  // do papel digitalizado virar branco e o cinza do texto virar preto.
  const limite = Math.max(60, Math.min(240, Number(ctx.options.limite ?? 180)));
  // Duro só quando pedido: é o modo que estraga foto e engrossa texto.
  const duro = String(ctx.options.modo ?? 'curva') === 'limiar';

  return redesenharComFiltro(
    ctx,
    (dados) => filtroTonsDePreto(dados, limite, duro),
    'preto',
    notasDoTonsDePreto(String(ctx.options.tinta ?? 'rgb'), duro),
  );
}

/**
 * O que o resultado avisa, conforme a tinta pedida.
 *
 * Gravar DeviceCMYK exige o motor do aplicativo: aqui, no navegador, o canvas
 * só entrega RGB. Quem pediu K100 e recebeu preto comum precisa saber disso —
 * entregar quadricromia achando que é chapa preta é o tipo de erro que só
 * aparece na hora da impressão, com o trabalho já rodando.
 */
export function notasDoTonsDePreto(tinta: string, duro = false): string[] {
  const comuns = duro
    ? [
        'Cinza virou preto puro e o fundo virou branco, sem meio-tom. Texto claro de digitalização sai cheio em vez de falhado.',
        'Neste modo foto vira mancha e a borda da letra engrossa. Para documento com foto, use a curva.',
      ]
    : [
        'O escuro virou preto cheio e o fundo virou branco, com o meio-tom preservado.',
        'Foto continua foto: para jogar fora o meio-tom de propósito, escolha o limiar.',
      ];

  if (tinta !== 'k100' && tinta !== 'rico') return comuns;

  return [
    'O preto saiu em RGB comum, não em CMYK: gravar K100 ou preto rico só é possível no aplicativo para Windows, onde o motor grava DeviceCMYK de verdade.',
    ...comuns,
  ];
}

/**
 * Converte para tons de cinza rasterizando cada página. Isso descarta o texto
 * vetorial, então o resultado deixa de ser pesquisável — é o preço de garantir
 * que nada saia colorido na impressão.
 */
export async function grayscale(ctx: RunContext): Promise<RunResult> {
  const { PDFDocument } = await loadPdfLib();
  const source = ctx.files[0];
  const dpi = Math.max(72, Math.min(300, Number(ctx.options.dpi ?? 150)));
  const comContraste = String(ctx.options.contraste ?? 'auto') !== 'nenhum';
  const doc = await openWithPdfJs(source.bytes, source.senha);
  const out = await PDFDocument.create();
  const canvas = document.createElement('canvas');

  for (let i = 1; i <= doc.numPages; i += 1) {
    ctx.onProgress((i - 1) / doc.numPages, `Página ${i} de ${doc.numPages}`);
    const page = await doc.getPage(i);
    const { widthPt, heightPt } = await renderPageToCanvas(page, dpi, canvas);

    const pincel = canvas.getContext('2d');
    if (pincel) {
      const imagem = pincel.getImageData(0, 0, canvas.width, canvas.height);
      const dados = imagem.data;
      for (let p = 0; p < dados.length; p += 4) {
        // Luminância perceptual: verde pesa mais que vermelho, que pesa mais
        // que azul. A média simples achata contraste e suja o texto.
        const cinza = Math.round(0.2126 * dados[p] + 0.7152 * dados[p + 1] + 0.0722 * dados[p + 2]);
        dados[p] = cinza;
        dados[p + 1] = cinza;
        dados[p + 2] = cinza;
      }
      if (comContraste) darContraste(dados);
      pincel.putImageData(imagem, 0, 0);
    }

    const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.82);
    const embutida = await out.embedJpg(await jpeg.arrayBuffer());
    out.addPage([widthPt, heightPt]).drawImage(embutida, { x: 0, y: 0, width: widthPt, height: heightPt });

    page.cleanup();
    await respirar(ctx);
  }
  await doc.destroy();

  const blob = await salvarPdf(out, source.senha);
  ctx.onProgress(1);
  return {
    files: [{ name: suffixName(source.name, 'cinza'), blob, pages: doc.numPages }],
    inputBytes: source.size,
    outputBytes: blob.size,
    notes: ['As páginas viraram imagem em tons de cinza, então o texto deixa de ser selecionável e pesquisável.'],
  };
}

/**
 * RGB para CMYK.
 *
 * Não há implementação aqui: o canvas do navegador só entrega RGB, e gravar
 * DeviceCMYK exige o motor do aplicativo. A função existe para o registro de
 * ferramentas ficar completo e para quem chegar aqui receber a explicação, em
 * vez de um resultado errado em silêncio. No aplicativo, `runOperation` desvia
 * para o Python antes de chegar nesta linha.
 */
export async function rgbToCmyk(): Promise<RunResult> {
  throw new Error(
    'Converter para CMYK só funciona no aplicativo para Windows: o navegador não consegue gravar cor de separação.',
  );
}

/**
 * Separação de chapas e cobertura de tinta.
 *
 * Mesma razão do CMYK: as duas leem a página em quatro canais, e o canvas do
 * navegador só entrega RGB. No aplicativo, `runOperation` desvia para o
 * Python antes de chegar aqui.
 */
export async function separatePlates(): Promise<RunResult> {
  throw new Error(
    'Separar as chapas só funciona no aplicativo para Windows: o navegador não lê a página em CMYK.',
  );
}

export async function inkCoverage(): Promise<RunResult> {
  throw new Error(
    'Medir a cobertura de tinta só funciona no aplicativo para Windows: o navegador não lê a página em CMYK.',
  );
}
