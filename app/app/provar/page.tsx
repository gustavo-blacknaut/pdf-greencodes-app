'use client';

/**
 * Tela de diagnóstico: roda cada ferramenta e diz o que saiu.
 *
 * Existe porque metade das ferramentas desenha em tela — rasterizar página,
 * ler imagem, OCR — e isso não roda fora de um navegador. O provador de linha
 * de comando cobre o resto; este cobre justamente as que faltavam, no lugar
 * onde elas rodam de verdade.
 *
 * Não está ligada em nenhum menu: é uma tela de conferência, aberta pelo
 * endereço `/app/provar` quando alguém quer saber se aquela máquina roda tudo.
 */

import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Play } from 'lucide-react';
import { TOOLS, defaultOptions } from '@/lib/tools';
import { OPERATIONS, runOperation, type LoadedFile, type OperationId } from '@/lib/pdf/engine';
import { loadPdfLib } from '@/lib/pdf/lazy';
import { cx, formatBytes } from '@/lib/utils';

type Linha = {
  slug: string;
  nome: string;
  operacao: string;
  ok: boolean;
  arquivos?: { nome: string; bytes: number }[];
  paginas?: number;
  notas?: string[];
  motivo?: string;
  ms?: number;
};

/** As opções que dão a cada ferramenta algo para fazer com o exemplo. */
const OPCOES: Record<string, Record<string, string | number | boolean>> = {
  'comprimir-pdf': { level: 'impressao' },
  'dividir-pdf': { mode: 'extract', extractRanges: '1-2' },
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
  'gerar-qrcode': { tipo: 'link', url: 'https://exemplo.com.br', saida: 'pdf' },
  'gerar-codigo-de-barras': { conteudo: '7891234567895', simbologia: 'ean13', saida: 'pdf' },
  'gerar-codigo-barras': { conteudo: '7891234567895', simbologia: 'ean13', saida: 'pdf' },
  'texto-para-pdf': { formato: 'abnt', titulo: 'Trabalho de exemplo' },
  'criar-carimbo': { formato: 'redondo', arcoTopo: 'GRAFICA EXEMPLO', arcoBaixo: 'CNPJ 00.000.000/0001-00', linhas: 'CONFERIDO', diametroMm: 40, borda: 'dupla' },
  'cartao-de-visita': { medida: '90x50' },
  etiquetas: { larguraMm: 50, alturaMm: 30 },
  'marcas-de-corte': { sangriaMm: 3 },
  'numeracao-sequencial': { de: 1, ate: 3 },
  'varias-por-folha': { perSheet: 4 },
  'dividir-ao-meio': { onde: 'vertical' },
  'cartaz-em-partes': { colunas: 2, linhas: 2 },
  'folha-de-fotos': { modelo: '3x4', papelFoto: '10x15' },
  ocr: { idioma: 'por' },
  'pdf-para-word': { ocr: 'nunca' },
  // As que trabalham com um plano de páginas montado na grade.
  'organizar-paginas': { plan: JSON.stringify([{ i: 1, r: 0 }, { i: 0, r: 0 }, { i: 2, r: 0 }, { i: 3, r: 0 }]) },
  'remover-paginas': { plan: JSON.stringify([{ i: 0, r: 0 }, { i: 2, r: 0 }, { i: 3, r: 0 }]) },
  'extrair-paginas': { plan: JSON.stringify([{ i: 1, r: 0 }, { i: 3, r: 0 }]) },
  'girar-pdf': { plan: JSON.stringify([0, 1, 2, 3].map((i) => ({ i, r: 90 }))) },
  // As do editor: um texto posto na primeira página.
  'assinar-pdf': {
    elementos: JSON.stringify([
      { id: 'a1', tipo: 'texto', pagina: 1, x: 60, y: 600, largura: 220, altura: 40, texto: 'Assinado — exemplo', tamanho: 16 },
    ]),
  },
  'editar-pdf': {
    elementos: JSON.stringify([
      { id: 'e1', tipo: 'texto', pagina: 1, x: 60, y: 520, largura: 260, altura: 40, texto: 'Texto inserido', tamanho: 14 },
      { id: 'e2', tipo: 'retangulo', pagina: 1, x: 60, y: 470, largura: 200, altura: 24, cor: '#ffd400', opacidade: 0.4 },
    ]),
  },
};

/** Um PDF de exemplo: texto, retângulo e um CNPJ que não é de ninguém. */
async function pdfDeExemplo(paginas = 4): Promise<ArrayBuffer> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= paginas; n += 1) {
    const pagina = doc.addPage([595.28, 841.89]);
    pagina.drawText(`Pagina ${n} de ${paginas}`, { x: 72, y: 740, size: 22, font: fonte });
    pagina.drawText('Documento de exemplo do PDF.GreenCodes', { x: 72, y: 700, size: 12, font: fonte });
    pagina.drawText('CNPJ 00.000.000/0001-00 - dados ficticios', { x: 72, y: 680, size: 10, font: fonte });
    pagina.drawRectangle({
      x: 72,
      y: 420,
      width: 450,
      height: 220,
      color: rgb(0.85, 0.92, 1),
      borderWidth: 1.5,
      borderColor: rgb(0.1, 0.4, 0.9),
    });
  }
  return (await doc.save({ useObjectStreams: true })).slice().buffer as ArrayBuffer;
}

/** Uma "foto" desenhada no canvas: degradê com formas, para ter detalhe. */
async function fotoDeExemplo(): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1600;
  const pincel = canvas.getContext('2d');
  if (!pincel) throw new Error('sem canvas');
  const fundo = pincel.createLinearGradient(0, 0, 0, canvas.height);
  fundo.addColorStop(0, '#2d6cdf');
  fundo.addColorStop(1, '#f0b429');
  pincel.fillStyle = fundo;
  pincel.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 40; i += 1) {
    pincel.fillStyle = `hsl(${(i * 37) % 360} 70% ${40 + (i % 5) * 8}%)`;
    pincel.beginPath();
    pincel.arc((i * 137) % canvas.width, (i * 211) % canvas.height, 20 + (i % 6) * 14, 0, Math.PI * 2);
    pincel.fill();
  }
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.9));
  if (!blob) throw new Error('o navegador não gerou o JPEG');
  return blob.arrayBuffer();
}

function arquivoPara(nome: string, bytes: ArrayBuffer): LoadedFile {
  return {
    id: nome,
    name: nome,
    size: bytes.byteLength,
    type: nome.endsWith('.pdf') ? 'application/pdf' : nome.endsWith('.txt') ? 'text/plain' : 'image/jpeg',
    bytes,
    pageCount: null,
    thumbnail: null,
  };
}

/**
 * Documentos mínimos de Word, Excel e PowerPoint.
 *
 * Os três são o mesmo pacote: um zip com XML dentro. Montar o menor possível
 * aqui é o que permite provar as conversões sem depender de um arquivo real
 * de alguém — e é também o teste de que o leitor aguenta um pacote enxuto.
 */
async function arquivosDeOffice(): Promise<Record<'docx' | 'xlsx' | 'pptx', ArrayBuffer>> {
  const JSZip = (await import('jszip')).default;

  const docx = new JSZip();
  docx.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Documento de exemplo</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Segunda linha, para a conversao ter o que escrever.</w:t></w:r></w:p>` +
      `</w:body></w:document>`,
  );

  const xlsx = new JSZip();
  // O leitor entra pelo workbook: é dele que saem os nomes das abas.
  xlsx.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Tabela" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  xlsx.file(
    'xl/sharedStrings.xml',
    `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>Produto</t></si><si><t>Preco</t></si></sst>`,
  );
  xlsx.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
      `<row r="2"><c r="A2" t="inlineStr"><is><t>Cartao de visita</t></is></c><c r="B2"><v>90</v></c></row>` +
      `</sheetData></worksheet>`,
  );

  const pptx = new JSZip();
  pptx.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>` +
      `<p:sp><p:txBody><a:p><a:r><a:t>Slide de exemplo</a:t></a:r></a:p></p:txBody></p:sp>` +
      `</p:spTree></p:cSld></p:sld>`,
  );

  const zipar = async (zip: InstanceType<typeof JSZip>) =>
    (await zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer;
  return { docx: await zipar(docx), xlsx: await zipar(xlsx), pptx: await zipar(pptx) };
}

/** Que arquivos entregar a cada ferramenta, pelo que ela aceita. */
function entradaDaFerramenta(
  tool: (typeof TOOLS)[number],
  exemplos: {
    pdf: ArrayBuffer;
    foto: ArrayBuffer;
    txt: ArrayBuffer;
    comFoto: ArrayBuffer;
    office: Record<'docx' | 'xlsx' | 'pptx', ArrayBuffer>;
  },
): LoadedFile[] {
  if (tool.semArquivo) return [];
  const aceita = (final: string) => tool.accept.some((t) => t.endsWith(final));

  if (aceita('.docx')) return [arquivoPara('exemplo.docx', exemplos.office.docx)];
  if (aceita('.xlsx')) return [arquivoPara('exemplo.xlsx', exemplos.office.xlsx)];
  if (aceita('.pptx')) return [arquivoPara('exemplo.pptx', exemplos.office.pptx)];
  if (tool.accept.includes('.txt')) return [arquivoPara('exemplo.txt', exemplos.txt)];

  // O carimbo de logo quer os dois: o documento e a imagem por cima.
  if (tool.operation === 'stamp-image') {
    return [arquivoPara('documento-exemplo.pdf', exemplos.pdf), arquivoPara('logo-exemplo.jpg', exemplos.foto)];
  }
  if (tool.operation === 'extract-images') return [arquivoPara('com-foto.pdf', exemplos.comFoto)];
  // O cartão aceita PDF e imagem; a imagem é o caminho novo, e é o que vale
  // provar: ela tem que esticar ou caber na medida do cartão.
  if (tool.slug === 'cartao-de-visita') return [arquivoPara('foto-exemplo.jpg', exemplos.foto)];

  const soImagem = tool.accept.some((t) => t.startsWith('image/')) && !tool.accept.includes('.pdf');
  if (soImagem) {
    // Juntar imagens precisa de duas; as outras trabalham com uma.
    return tool.multiple
      ? [arquivoPara('foto-exemplo.jpg', exemplos.foto), arquivoPara('foto-exemplo-2.jpg', exemplos.foto)]
      : [arquivoPara('foto-exemplo.jpg', exemplos.foto)];
  }
  return [
    arquivoPara('documento-exemplo.pdf', exemplos.pdf),
    ...(tool.multiple ? [arquivoPara('documento-exemplo-2.pdf', exemplos.pdf)] : []),
  ];
}

/** Junta tudo o que saiu num zip e manda baixar, para conferir fora daqui. */
async function baixarAsProvas(saidas: { nome: string; blob: Blob }[], linhas: Linha[]) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('resultado.json', JSON.stringify(linhas, null, 2));
  for (const saida of saidas) zip.file(saida.nome, saida.blob);
  const pacote = await zip.generateAsync({ type: 'blob' });

  const endereco = URL.createObjectURL(pacote);
  const link = document.createElement('a');
  link.href = endereco;
  link.download = 'provas-navegador.zip';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(endereco), 30_000);
}

export default function ProvarTudo() {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [rodando, setRodando] = useState(false);
  const [andamento, setAndamento] = useState('');
  /*
   * O HEIC é o único exemplo que não dá para inventar: o formato guarda uma
   * imagem codificada em HEVC, e nada aqui codifica HEVC. Quem tem um iPhone
   * fecha as 75 escolhendo uma foto — ela é lida na aba e nada dela entra no
   * zip, que é o que sai desta tela.
   */
  const [heic, setHeic] = useState<File | null>(null);

  const provar = useCallback(async (guardarArquivos: boolean) => {
    setRodando(true);
    setLinhas([]);
    const resultados: Linha[] = [];
    const saidas: { nome: string; blob: Blob }[] = [];
    try {
      const pdf = await pdfDeExemplo();
      const foto = await fotoDeExemplo();
      const txt = new TextEncoder().encode(
        '# INTRODUCAO\nTexto de exemplo para provar a conversao.\n\n' +
          'O segundo paragrafo mostra o recuo e o texto justificado.\n\n' +
          '> Uma citacao longa de exemplo, com mais de tres linhas, para sair com recuo de quatro centimetros.\n',
      ).buffer as ArrayBuffer;
      // Um PDF que tem imagem dentro, para o "extrair imagens" ter o que achar.
      const comFoto = await runOperation('images-to-pdf', {
        files: [arquivoPara('foto-exemplo.jpg', foto)],
        options: {},
        onProgress: () => {},
      })
        .then(async (r) => (await r.files[0].blob.arrayBuffer()) as ArrayBuffer)
        .catch(() => pdf);
      const office = await arquivosDeOffice();

      for (const tool of TOOLS) {
        const operacao = tool.operation as OperationId | undefined;
        setAndamento(tool.name);
        if (!operacao || !(operacao in OPERATIONS)) {
          resultados.push({ slug: tool.slug, nome: tool.name, operacao: String(tool.operation ?? '—'), ok: false, motivo: 'tem tela própria' });
          continue;
        }

        const entrada =
          tool.operation === 'heic-to-image' && heic
            ? // Nome trocado de propósito: o nome do arquivo dele não entra no
              // relatório, e a ferramenta olha só a extensão.
              [{ ...arquivoPara('foto-do-iphone.heic', await heic.arrayBuffer()), type: 'image/heic' }]
            : entradaDaFerramenta(tool, { pdf, foto, txt, comFoto, office });

        const inicio = performance.now();
        try {
          const resultado = await runOperation(operacao, {
            files: entrada,
            // Os padrões da ferramenta primeiro, como a tela manda: é deles
            // que saem `board`, `editor` e o valor de cada campo.
            options: { ...defaultOptions(tool), ...(OPCOES[tool.slug] ?? {}) },
            onProgress: () => {},
          });
          const arquivos = resultado.files.map((s) => ({
            nome: `${tool.slug}__${s.name}`.replace(/[^\w.\-]+/g, '-'),
            bytes: s.blob.size,
          }));
          // Só os três primeiros de cada: "PDF para imagem" sozinho traz uma
          // imagem por página, e o zip viraria um despejo.
          // A foto do iPhone é de quem abriu a tela: ela não vai para o zip.
          if (guardarArquivos && tool.operation !== 'heic-to-image') {
            resultado.files.slice(0, 3).forEach((s, i) => saidas.push({ nome: arquivos[i].nome, blob: s.blob }));
          }
          resultados.push({
            slug: tool.slug,
            nome: tool.name,
            operacao,
            ok: true,
            arquivos,
            paginas: resultado.files[0]?.pages,
            notas: resultado.notes.slice(0, 2),
            ms: Math.round(performance.now() - inicio),
          });
        } catch (erro) {
          resultados.push({
            slug: tool.slug,
            nome: tool.name,
            operacao,
            ok: false,
            motivo: erro instanceof Error ? erro.message.slice(0, 200) : String(erro),
            ms: Math.round(performance.now() - inicio),
          });
        }
        setLinhas([...resultados]);
      }
      if (guardarArquivos) {
        setAndamento('juntando o zip');
        await baixarAsProvas(saidas, resultados);
      }
    } finally {
      setRodando(false);
      setAndamento('');
      // Para quem está dirigindo a página de fora: o resultado fica aqui.
      (window as unknown as { __provas?: Linha[] }).__provas = resultados;
    }
    return resultados;
  }, [heic]);

  /*
   * Deixa a função à mão de quem abre a página pelo depurador.
   *
   * Dentro do efeito, e não no corpo: o Next pré-renderiza esta página no
   * servidor para gerar o `out/`, e lá não existe `window` — no corpo isso
   * derrubava a página inteira com 500, e o `next build` junto.
   */
  useEffect(() => {
    (window as unknown as { __provar?: typeof provar }).__provar = provar;
  }, [provar]);

  const certas = linhas.filter((l) => l.ok).length;

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Provar as ferramentas</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Roda cada ferramenta do catálogo com um documento, uma foto e um texto de exemplo — nada de arquivo seu — e
        diz o que saiu de cada uma. Serve para conferir uma máquina nova, ou depois de uma mudança grande.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => void provar(false)} disabled={rodando} className="btn-primary px-4 py-2.5">
          {rodando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {rodando ? `Rodando ${andamento}...` : 'Rodar em todas'}
        </button>
        <button type="button" onClick={() => void provar(true)} disabled={rodando} className="btn-ghost px-4 py-2.5">
          <Download className="h-4 w-4" />
          Rodar e baixar tudo
        </button>
      </div>

      <label className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <span>Para fechar as 75, escolha uma foto .HEIC do iPhone:</span>
        <input
          type="file"
          accept=".heic,.heif,image/heic,image/heif"
          onChange={(e) => setHeic(e.target.files?.[0] ?? null)}
          className="text-[13px]"
        />
        <span>{heic ? 'escolhida — ela fica na aba e não entra no zip.' : 'sem ela, o HEIC fica de fora.'}</span>
      </label>

      {linhas.length > 0 && (
        <p className="mt-4 text-sm">
          <strong>{certas}</strong> de {linhas.length} entregaram arquivo.
        </p>
      )}

      <div className="mt-4 space-y-1.5">
        {linhas.map((linha) => (
          <div
            key={linha.slug}
            className={cx(
              'flex items-start gap-3 rounded-lg border px-3 py-2 text-[13px]',
              linha.ok ? 'border-emerald-500/30' : 'border-rose-500/30',
            )}
          >
            <span className={cx('mt-0.5 h-2 w-2 shrink-0 rounded-full', linha.ok ? 'bg-emerald-500' : 'bg-rose-500')} />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{linha.nome}</span>
              <span className="ml-2 text-muted">{linha.slug}</span>
              {linha.ok ? (
                <span className="ml-2 text-muted">
                  {linha.arquivos?.length ?? 0} arquivo(s) ·{' '}
                  {formatBytes(linha.arquivos?.reduce((t, a) => t + a.bytes, 0) ?? 0)}
                  {linha.paginas ? ` · ${linha.paginas} página(s)` : ''} · {linha.ms} ms
                </span>
              ) : (
                <span className="ml-2 text-rose-400">{linha.motivo}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
