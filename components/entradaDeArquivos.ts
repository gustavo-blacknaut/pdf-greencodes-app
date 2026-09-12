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

import { abrirNaMemoria, inspectFile } from '@/lib/pdf/engine';
import { pareceSerImagem } from '@/lib/pdf/guards';
import type { Tool } from '@/lib/tools';
import type { ArquivoNaFila } from './FilaDeArquivos';

const OFFICE = ['.docx', '.xlsx', '.pptx'];

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
    const ehOffice = /\.(docx|xlsx|pptx)$/.test(nome);
    const ehTxt = nome.endsWith('.txt');
    return (aceitaPdf && ehPdf) || (aceitaImagem && ehImagem) || (aceitaOffice && ehOffice) || (aceitaTxt && ehTxt);
  });

  if (!aceitos.length) return { aceitos, recusa: `Esta ferramenta aceita apenas ${tool.acceptLabel}.` };
  if (aceitos.length < chegando.length) {
    return { aceitos, recusa: `${chegando.length - aceitos.length} arquivo(s) ignorado(s): formato incompatível.` };
  }
  return { aceitos, recusa: null };
}

/**
 * Lê a leva inteira, avisando a tela a cada arquivo que fica pronto.
 *
 * É pré-carregamento: enquanto a pessoa ajusta as opções, o arquivo já foi
 * aberto, as páginas contadas e a miniatura feita. Um a um, e não todos de
 * uma vez: trinta fotos de celular abertas juntas travam a máquina da loja.
 */
export async function lerNaFila(
  leva: { file: File; item: ArquivoNaFila }[],
  tool: Tool,
  aoMudar: (id: string, mudanca: Partial<ArquivoNaFila>) => void,
): Promise<void> {
  for (const { file, item } of leva) {
    try {
      let data = await inspectFile(file, item.id);
      // A grade de páginas, o editor e o recorte desenham o documento na
      // hora: o arquivo grande que ficou no disco precisa vir para a memória.
      if ((tool.board || tool.editor || tool.recorte) && data.caminho && !data.error) {
        data = await abrirNaMemoria(data);
      }
      aoMudar(item.id, { loading: false, data, error: data.error });
    } catch (erro) {
      aoMudar(item.id, {
        loading: false,
        error: erro instanceof Error ? erro.message : 'Falha ao ler o arquivo.',
      });
    }
  }
}
