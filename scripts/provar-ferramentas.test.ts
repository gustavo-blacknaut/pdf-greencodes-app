import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import JSZip from 'jszip';

import { TOOLS, defaultOptions } from '../lib/tools';
import { OPERATIONS, runOperation, type OperationId, type LoadedFile } from '../lib/pdf/engine';
import { loadPdfLib } from '../lib/pdf/lazy';

/**
 * Prova cada ferramenta do catálogo e grava o que sai, para alguém abrir e
 * olhar. Não é teste de comportamento — os testes de verdade estão nos outros
 * arquivos; isto é a demonstração, ferramenta por ferramenta.
 *
 * Só roda quando pedido, com a pasta de saída na variável PROVAS:
 *
 *     PROVAS=C:/Users/geren/Desktop/provas npx vitest run scripts/provar-ferramentas.test.ts
 *
 * Fora disso ele passa sem fazer nada, para não escrever arquivo no meio do
 * `npm test`.
 *
 * Tudo que entra é inventado aqui: páginas com texto de exemplo e um CNPJ
 * fictício. As ferramentas que precisam de canvas (rasterizar página, ler
 * imagem, OCR) não rodam fora do navegador — elas ficam marcadas no relatório,
 * e no aplicativo quem faz esse trabalho é o motor Python, provado à parte.
 */

const PASTA = process.env.PROVAS ?? '';

type Resultado = {
  slug: string;
  nome: string;
  operacao: string;
  ok: boolean;
  arquivos?: string[];
  bytes?: number;
  paginas?: number;
  notas?: string[];
  motivo?: string;
  segundos?: number;
};

async function pdfDeExemplo(paginas = 4): Promise<ArrayBuffer> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= paginas; n += 1) {
    const pagina = doc.addPage([595.28, 841.89]);
    pagina.drawText(`Pagina ${n} de ${paginas}`, { x: 72, y: 740, size: 22, font: fonte });
    pagina.drawText('Documento de exemplo do PDF.GreenCodes', { x: 72, y: 700, size: 12, font: fonte });
    pagina.drawText('CNPJ 00.000.000/0001-00 - dados ficticios', { x: 72, y: 680, size: 10, font: fonte });
    pagina.drawRectangle({ x: 72, y: 420, width: 450, height: 220, color: rgb(0.85, 0.92, 1), borderWidth: 1.5, borderColor: rgb(0.1, 0.4, 0.9) });
  }
  const bytes = await doc.save({ useObjectStreams: true });
  return bytes.slice().buffer as ArrayBuffer;
}

function arquivo(nome: string, bytes: ArrayBuffer, extras: Partial<LoadedFile> = {}): LoadedFile {
  return {
    id: nome,
    name: nome,
    size: bytes.byteLength,
    type: nome.endsWith('.pdf') ? 'application/pdf' : nome.endsWith('.txt') ? 'text/plain' : 'image/jpeg',
    bytes,
    pageCount: null,
    thumbnail: null,
    ...extras,
  };
}

/** As opções que fazem cada ferramenta ter o que fazer com o exemplo. */
const OPCOES: Partial<Record<string, Record<string, string | number | boolean>>> = {
  'comprimir-pdf': { level: 'impressao' },
  'dividir-pdf': { mode: 'extract', extractRanges: '1-2' },
  'marca-dagua': { text: 'EXEMPLO', opacity: 0.2 },
  'numerar-paginas': { position: 'bottom-right' },
  'proteger-pdf': { password: '1234' },
  'cabecalho-rodape': { header: 'EXEMPLO', footer: 'PDF.GreenCodes' },
  'cortar-pdf': { top: 10, bottom: 10, left: 10, right: 10 },
  'comprimir-imagem': { alvo: '300 KB' },
  'cortar-imagem': {
    recorte: JSON.stringify([{ id: 'foto-exemplo.jpg', x: 100, y: 150, largura: 800, altura: 1000 }]),
  },
  'marca-dagua-imagem': { texto: 'EXEMPLO' },
  'ler-boleto': { codigo: '34191790010104351004791020150008291070026000' },
  'boleto-para-impressao': { codigo: '34191790010104351004791020150008291070026000' },
  'imprimir-boleto': { codigos: '34191790010104351004791020150008291070026000' },
  'gerar-codigo-de-barras': { conteudo: '7891234567895', simbologia: 'ean13', saida: 'pdf' },
  'gerar-codigo-barras': { conteudo: '7891234567895', simbologia: 'ean13', saida: 'pdf' },
  'texto-para-pdf': { formato: 'abnt', titulo: 'Trabalho de exemplo' },
  'criar-carimbo': { formato: 'retangulo', linhas: 'GRAFICA EXEMPLO\nCNPJ 00.000.000/0001-00', larguraMm: 38, alturaMm: 14 },
  'gerar-qrcode': { tipo: 'link', url: 'https://exemplo.com.br', saida: 'pdf' },
  'cartao-de-visita': { medida: '90x50' },
  etiquetas: { larguraMm: 50, alturaMm: 30 },
  'marcas-de-corte': { sangriaMm: 3 },
  'numeracao-sequencial': { de: 1, ate: 3 },
  'varias-por-folha': { perSheet: 4 },
  'dividir-ao-meio': { onde: 'vertical' },
  'cartaz-em-partes': { colunas: 2, linhas: 2 },
  'frente-e-verso': { inverter: false },
  // A grade de páginas publica um plano; sem ele a ferramenta não tem o que
  // remontar e reclama com razão.
  'organizar-paginas': { plan: JSON.stringify([{ i: 1, r: 0 }, { i: 0, r: 0 }, { i: 2, r: 0 }, { i: 3, r: 0 }]) },
  'remover-paginas': { plan: JSON.stringify([{ i: 0, r: 0 }, { i: 2, r: 0 }, { i: 3, r: 0 }]) },
  'extrair-paginas': { plan: JSON.stringify([{ i: 1, r: 0 }, { i: 3, r: 0 }]) },
  'girar-pdf': { plan: JSON.stringify([0, 1, 2, 3].map((i) => ({ i, r: 90 }))) },
  // As do editor: um texto posto na primeira página.
  'assinar-pdf': {
    elementos: JSON.stringify([
      { id: 'a1', tipo: 'texto', pagina: 1, x: 60, y: 600, largura: 220, altura: 40, texto: 'Assinado - exemplo', tamanho: 16 },
    ]),
  },
  'editar-pdf': {
    elementos: JSON.stringify([
      { id: 'e1', tipo: 'texto', pagina: 1, x: 60, y: 520, largura: 260, altura: 40, texto: 'Texto inserido', tamanho: 14 },
    ]),
  },
};

/**
 * Documentos mínimos de Word, Excel e PowerPoint: um zip com o XML que o
 * leitor procura. Assim as conversões são provadas sem usar arquivo de alguém.
 */
async function arquivosDeOffice(): Promise<Record<'docx' | 'xlsx' | 'pptx', ArrayBuffer>> {
  const docx = new JSZip();
  docx.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Documento de exemplo</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Segunda linha, para a conversao ter o que escrever.</w:t></w:r></w:p>' +
      '</w:body></w:document>',
  );

  const xlsx = new JSZip();
  xlsx.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Tabela" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  xlsx.file(
    'xl/sharedStrings.xml',
    '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>Produto</t></si><si><t>Preco</t></si></sst>',
  );
  xlsx.file(
    'xl/worksheets/sheet1.xml',
    '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Cartao de visita</t></is></c><c r="B2"><v>90</v></c></row>' +
      '</sheetData></worksheet>',
  );

  const pptx = new JSZip();
  pptx.file(
    'ppt/slides/slide1.xml',
    '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>' +
      '<p:sp><p:txBody><a:p><a:r><a:t>Slide de exemplo</a:t></a:r></a:p></p:txBody></p:sp>' +
      '</p:spTree></p:cSld></p:sld>',
  );

  const zipar = async (zip: JSZip) => (await zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer;
  return { docx: await zipar(docx), xlsx: await zipar(xlsx), pptx: await zipar(pptx) };
}

describe('prova de todas as ferramentas', () => {
  it(
    PASTA ? 'roda cada ferramenta e grava o resultado' : 'só roda com a variável PROVAS apontando a pasta',
    async () => {
      if (!PASTA) return;
      mkdirSync(PASTA, { recursive: true });

      const pdf = await pdfDeExemplo();
      const txt = new TextEncoder().encode(
        '# INTRODUCAO\nEste e um texto de exemplo para provar a conversao.\n\n' +
          'O segundo paragrafo mostra o recuo da primeira linha e o texto justificado.\n\n' +
          '> Uma citacao longa de exemplo, com mais de tres linhas, para aparecer com recuo de quatro centimetros.\n',
      ).buffer as ArrayBuffer;

      // A foto vem do provador do motor, que a desenha antes. Sem ela, as
      // ferramentas de imagem ficam marcadas como sem exemplo.
      const caminhoDaFoto = path.join(PASTA, '..', 'motor', '_entradas', 'foto-exemplo.jpg');
      const foto = existsSync(caminhoDaFoto)
        ? (readFileSync(caminhoDaFoto).buffer as ArrayBuffer)
        : null;

      const office = await arquivosDeOffice();
      const resultados: Resultado[] = [];

      for (const tool of TOOLS) {
        const operacao = tool.operation as OperationId | undefined;
        if (!operacao || !(operacao in OPERATIONS)) {
          resultados.push({ slug: tool.slug, nome: tool.name, operacao: String(tool.operation ?? '—'), ok: false, motivo: 'tem tela própria' });
          continue;
        }

        const querImagem = tool.accept.some((tipo) => tipo.startsWith('image/'));
        const querTexto = tool.accept.includes('.txt');
        const aceita = (final: string) => tool.accept.some((tipo) => tipo.endsWith(final));
        const entrada = tool.semArquivo
          ? []
          : aceita('.docx')
            ? [arquivo('exemplo.docx', office.docx)]
            : aceita('.xlsx')
              ? [arquivo('exemplo.xlsx', office.xlsx)]
              : aceita('.pptx')
                ? [arquivo('exemplo.pptx', office.pptx)]
                : querTexto
                  ? [arquivo('exemplo.txt', txt)]
                  : tool.operation === 'stamp-image' && foto
                    ? [arquivo('documento-exemplo.pdf', pdf), arquivo('logo-exemplo.jpg', foto)]
                    : tool.slug === 'cartao-de-visita' && foto
                      ? [arquivo('foto-exemplo.jpg', foto)]
                    : querImagem && !tool.accept.includes('.pdf')
                      ? foto
                        ? [
                            arquivo('foto-exemplo.jpg', foto),
                            ...(tool.multiple ? [arquivo('foto-exemplo-2.jpg', foto)] : []),
                          ]
                        : []
                      : [arquivo('documento-exemplo.pdf', pdf), ...(tool.multiple ? [arquivo('documento-exemplo-2.pdf', pdf)] : [])];

        if (!tool.semArquivo && entrada.length === 0) {
          resultados.push({ slug: tool.slug, nome: tool.name, operacao, ok: false, motivo: 'sem arquivo de exemplo para este formato' });
          continue;
        }

        const inicio = Date.now();
        try {
          const resultado = await runOperation(operacao, {
            files: entrada,
            // Os padrões da ferramenta primeiro, como a tela manda.
            options: { ...defaultOptions(tool), ...(OPCOES[tool.slug] ?? {}) },
            onProgress: () => {},
          });
          const nomes: string[] = [];
          let bytes = 0;
          for (const saida of resultado.files) {
            const nome = `${tool.slug}__${saida.name}`.replace(/[^\w.\-]+/g, '-');
            writeFileSync(path.join(PASTA, nome), Buffer.from(await saida.blob.arrayBuffer()));
            nomes.push(nome);
            bytes += saida.blob.size;
          }
          resultados.push({
            slug: tool.slug,
            nome: tool.name,
            operacao,
            ok: true,
            arquivos: nomes,
            bytes,
            paginas: resultado.files[0]?.pages,
            notas: resultado.notes.slice(0, 2),
            segundos: Math.round((Date.now() - inicio) / 100) / 10,
          });
        } catch (erro) {
          const mensagem = erro instanceof Error ? erro.message : String(erro);
          const precisaDeNavegador = /document|canvas|createImageBitmap|Image|OffscreenCanvas|window/i.test(mensagem);
          resultados.push({
            slug: tool.slug,
            nome: tool.name,
            operacao,
            ok: false,
            motivo: precisaDeNavegador ? 'desenha na tela: roda no navegador, e no aplicativo vai pelo motor' : mensagem.slice(0, 160),
          });
        }
      }

      writeFileSync(path.join(PASTA, 'resultado.json'), JSON.stringify(resultados, null, 2));
      const certas = resultados.filter((r) => r.ok).length;
      console.log(`${certas} de ${resultados.length} ferramentas gravaram arquivo em ${PASTA}`);
      expect(resultados.length).toBeGreaterThan(60);
    },
    600_000,
  );
});
