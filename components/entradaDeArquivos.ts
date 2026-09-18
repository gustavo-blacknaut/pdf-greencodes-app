'use client';

/**
 * O que pode entrar na fila, e como cada arquivo é lido antes do clique.
 *
 * Sai da tela porque são dois assuntos diferentes: a tela cuida do que a
 * pessoa vê e do que ela pode apertar; aqui é só "isto serve?" e "leia isto".
 * A regra do que serve já errou antes — o "aceita PDF" tratado como "só
 * aceita PDF" deixava o Juntar recusar imagem —, e é do tipo que se confere
 * melhor com a lista na frente do que no meio de uma tela de oitocentas
 * linhas.
 */

import { arquivoNoDisco } from '@/lib/desktop';
import { abrirNaMemoria, gerarMiniatura, inspectFile, type LoadedFile } from '@/lib/pdf/engine';
import { pareceSerImagem } from '@/lib/pdf/guards';
import type { Tool } from '@/lib/tools';
import { limitarConcorrencia } from '@/lib/utils';
import type { ArquivoNaFila } from './FilaDeArquivos';

const OFFICE = ['.docx', '.xls', '.xlsx', '.xlsm', '.pptx'];

/**
 * Separa o que a ferramenta aceita, e diz o que ficou de fora.
 *
 * O Juntar aceita PDF **e** imagem ao mesmo tempo, então cada formato é
 * perguntado por si: quem aceita PDF não recusa imagem por isso.
 */
export function filtrarAceitos(tool: Tool, chegando: File[]): { aceitos: File[]; recusa: string | null } {
  const aceitaPdf = tool.accept.includes('.pdf');
  const aceitaImagem = tool.accept.some((tipo) => tipo.startsWith('image/'));
  const aceitaOffice = tool.accept.some((tipo) => OFFICE.includes(tipo));
  const aceitaTxt = tool.accept.includes('.txt');

  const aceitos = chegando.filter((arquivo) => {
    const nome = arquivo.name.toLowerCase();
    const ehPdf = nome.endsWith('.pdf') || arquivo.type === 'application/pdf';
    const ehImagem = pareceSerImagem(nome, arquivo.type);
    const ehOffice = OFFICE.some(ext => nome.endsWith(ext) && tool.accept.includes(ext));
    const ehTxt = nome.endsWith('.txt');
    return (aceitaPdf && ehPdf) || (aceitaImagem && ehImagem) || (aceitaOffice && ehOffice) || (aceitaTxt && ehTxt);
  });

  if (!aceitos.length) return { aceitos, recusa: `Esta ferramenta aceita apenas ${tool.acceptLabel}.` };
  if (aceitos.length < chegando.length) {
    return { aceitos, recusa: `${chegando.length - aceitos.length} arquivo(s) ignorado(s): formato incompatível.` };
  }
  return { aceitos, recusa: null };
}

/** Aplica um lote de mudanças à fila, de uma vez: uma renderização, e não uma por arquivo. */
export function aplicarMudancas(
  fila: ArquivoNaFila[],
  mudancas: [id: string, mudanca: Partial<ArquivoNaFila>][],
): ArquivoNaFila[] {
  const porId = new Map<string, Partial<ArquivoNaFila>>();
  // Duas mudanças no mesmo arquivo dentro do lote valem juntas, na ordem em que vieram.
  for (const [id, mudanca] of mudancas) porId.set(id, { ...porId.get(id), ...mudanca });
  return fila.map((item) => {
    const mudanca = porId.get(item.id);
    return mudanca ? { ...item, ...mudanca } : item;
  });
}

/**
 * Quantos arquivos são abertos ao mesmo tempo.
 *
 * Abrir é conferir a assinatura e contar as páginas, e quase todo o custo está
 * em esperar o leitor de PDF, que roda fora da tela: um de cada vez deixava
 * esse leitor parado entre um arquivo e o seguinte. Seis mantêm ele ocupado
 * sem abrir cem documentos juntos.
 */
const ABERTURAS_AO_MESMO_TEMPO = 6;

/** O motor Python atende um trabalho de cada vez: os que vão a ele fazem fila. */
const vezDoMotor = limitarConcorrencia(1);

/** Duas por vez: desenhar é o que custa, e a lista só precisa das que aparecem. */
const vezDaMiniatura = limitarConcorrencia(2);

/**
 * Lê a leva inteira, avisando a tela a cada arquivo que fica pronto.
 *
 * É pré-carregamento: enquanto a pessoa ajusta as opções, o arquivo já foi
 * aberto e as páginas contadas. Vários ao mesmo tempo, com limite — cem PDFs
 * levavam 26 s abertos um a um. A miniatura não entra aqui: cada linha pede a
 * sua quando aparece na tela (`miniaturaSobDemanda`).
 */
export async function lerNaFila(
  leva: { file: File; item: ArquivoNaFila }[],
  tool: Tool,
  aoMudar: (mudancas: [id: string, mudanca: Partial<ArquivoNaFila>][]) => void,
): Promise<void> {
  /*
   * As mudanças saem em lotes, e não uma por arquivo.
   *
   * Cada arquivo pronto refazia a lista inteira na tela: com cem, eram cem
   * atualizações de cem linhas, e era isso — e não o leitor de PDF — que
   * segurava a janela. Agrupadas a cada 50 ms, viram poucas dezenas, e a
   * lista ainda enche a olhos vistos.
   */
  let pendentes: [string, Partial<ArquivoNaFila>][] = [];
  let agendado: ReturnType<typeof setTimeout> | null = null;
  const descarregar = () => {
    if (agendado) clearTimeout(agendado);
    agendado = null;
    if (!pendentes.length) return;
    const lote = pendentes;
    pendentes = [];
    aoMudar(lote);
  };
  const avisar = (id: string, mudanca: Partial<ArquivoNaFila>) => {
    pendentes.push([id, mudanca]);
    agendado ??= setTimeout(descarregar, 50);
  };

  // A grade de páginas, o editor e o recorte trazem o documento inteiro para a
  // memória: com eles a fila volta a ser de um por vez.
  const trazParaMemoria = Boolean(tool.board || tool.editor || tool.recorte);
  const vez = limitarConcorrencia(trazParaMemoria ? 1 : ABERTURAS_AO_MESMO_TEMPO);

  await Promise.all(
    leva.map(({ file, item }) =>
      vez(async () => {
        try {
          // Arquivo grande no disco é lido pelo motor, que só atende um por vez.
          let data = arquivoNoDisco(file)
            ? await vezDoMotor(() => inspectFile(file, item.id))
            : await inspectFile(file, item.id);
          // O arquivo grande que ficou no disco precisa vir para a memória.
          if (trazParaMemoria && data.caminho && !data.error) {
            data = await abrirNaMemoria(data);
          }
          avisar(item.id, { loading: false, data, error: data.error });
        } catch (erro) {
          avisar(item.id, {
            loading: false,
            error: erro instanceof Error ? erro.message : 'Falha ao ler o arquivo.',
          });
        }
      }),
    ),
  );
  // O que sobrou no último intervalo.
  descarregar();
}

/** A miniatura de um arquivo já aberto, na vez dela. Devolve nada se não há o que desenhar. */
export function miniaturaSobDemanda(arquivo: LoadedFile): Promise<string | null> {
  return vezDaMiniatura(() => gerarMiniatura(arquivo));
}
