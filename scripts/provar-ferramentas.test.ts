import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { TOOLS } from '../lib/tools';
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
  'extrair-paginas': { pages: '2,4' },
  'remover-paginas': { pages: '1' },
  'girar-pdf': { angle: 90 },
  'marca-dagua': { text: 'EXEMPLO', opacity: 0.2 },
  'numerar-paginas': { position: 'bottom-right' },
  'proteger-pdf': { password: '1234' },
  'cabecalho-rodape': { header: 'EXEMPLO', footer: 'PDF.GreenCodes' },
  'cortar-pdf': { top: 10, bottom: 10, left: 10, right: 10 },
  'comprimir-imagem': { alvo: '300 KB' },
  'marca-dagua-imagem': { texto: 'EXEMPLO' },
  'ler-boleto': { codigo: '34191790010104351004791020150008291070026000' },
  'boleto-para-impressao': { codigo: '34191790010104351004791020150008291070026000' },
  'imprimir-boleto': { codigos: '34191790010104351004791020150008291070026000' },
  'gerar-codigo-de-barras': { conteudo: '7891234567895', simbologia: 'ean13', saida: 'pdf' },
  'gerar-codigo-barras': { conteudo: '7891234567895', simbologia: 'ean13', saida: 'pdf' },
  'texto-para-pdf': { formato: 'abnt', titulo: 'Trabalho de exemplo' },
  'criar-carimbo': { formato: 'retangulo', linhas: 'GRAFICA EXEMPLO\nCNPJ 00.000.000/0001-00', larguraMm: 38, alturaMm: 14 },
  'gerar-qrcode': { conteudo: 'https://exemplo.com.br', saida: 'pdf' },
  'cartao-de-visita': { medida: '90x50' },
  etiquetas: { larguraMm: 50, alturaMm: 30 },
  'marcas-de-corte': { sangriaMm: 3 },
  'numeracao-sequencial': { de: 1, ate: 3 },
  'varias-por-folha': { perSheet: 4 },
  'dividir-ao-meio': { onde: 'vertical' },
  'cartaz-em-partes': { colunas: 2, linhas: 2 },
  'frente-e-verso': { inverter: false },
};

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

      const resultados: Resultado[] = [];

      for (const tool of TOOLS) {
        const operacao = tool.operation as OperationId | undefined;
        if (!operacao || !(operacao in OPERATIONS)) {
          resultados.push({ slug: tool.slug, nome: tool.name, operacao: String(tool.operation ?? '—'), ok: false, motivo: 'tem tela própria' });
          continue;
        }

        const querImagem = tool.accept.some((tipo) => tipo.startsWith('image/'));
        const querTexto = tool.accept.includes('.txt');
        const entrada = tool.semArquivo
          ? []
          : querTexto
            ? [arquivo('exemplo.txt', txt)]
            : querImagem && !tool.accept.includes('.pdf')
              ? foto
                ? [arquivo('foto-exemplo.jpg', foto)]
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
            options: OPCOES[tool.slug] ?? {},
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
