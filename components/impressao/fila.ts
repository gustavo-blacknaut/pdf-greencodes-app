/**
 * O que entra na fila de impressão, e como cada formato vira PDF.
 *
 * Mora aqui, e não no PrintWorkspace, porque é regra da fila e não da tela:
 * a tela só pergunta "isto entra?", "vira PDF como?" e "com que opções a
 * pessoa imprimiu da última vez?".
 */

import type { OpcoesImpressao } from '@/lib/desktop';
import { IMAGE_ACCEPT } from '@/lib/ferramentas/tipos';
import type { OperationId } from '@/lib/pdf/engine';
import { pareceSerImagem } from '@/lib/pdf/guards';

/** Onde as opções da última impressão ficam guardadas. */
export const CHAVE_DAS_OPCOES = 'greencodes:impressao';

export const OPCOES_PADRAO: OpcoesImpressao = {
  copias: 1,
  colorido: true,
  orientacao: 'auto',
  paisagem: false,
  duplex: 'simplex',
  papel: 'A4',
};

export const ACEITA = [
  'application/pdf',
  '.pdf',
  // A mesma lista do resto do programa: sem isso, o imprimir recusava um
  // WEBP que a ferramenta de converter abre sem reclamar.
  ...IMAGE_ACCEPT,
  '.docx',
  '.xlsx',
  '.pptx',
  '.txt',
];

/** Qual operação transforma cada formato em PDF. PDF já chega pronto. */
export function conversaoPara(nome: string): OperationId | null {
  const n = nome.toLowerCase();
  if (n.endsWith('.pdf')) return null;
  if (pareceSerImagem(n)) return 'images-to-pdf';
  if (n.endsWith('.docx')) return 'word-to-pdf';
  if (n.endsWith('.xlsx')) return 'excel-to-pdf';
  if (n.endsWith('.pptx')) return 'powerpoint-to-pdf';
  if (n.endsWith('.txt')) return 'text-to-pdf';
  return null;
}

/** As opções da última impressão, ou as padrão se não houver nada guardado. */
export function lerOpcoesSalvas(): OpcoesImpressao {
  try {
    const bruto = localStorage.getItem(CHAVE_DAS_OPCOES);
    return bruto ? { ...OPCOES_PADRAO, ...JSON.parse(bruto) } : OPCOES_PADRAO;
  } catch {
    return OPCOES_PADRAO;
  }
}

/** Guarda as opções para a próxima vez — menos a beirada, que é da impressora. */
export function guardarOpcoes(opcoes: OpcoesImpressao): void {
  try {
    const daPessoa = { ...opcoes };
    delete daPessoa.bordaMm;
    localStorage.setItem(CHAVE_DAS_OPCOES, JSON.stringify(daPessoa));
  } catch {
    /* modo anônimo: imprime do mesmo jeito */
  }
}

/** Esquece as opções guardadas: a próxima impressão parte do padrão. */
export function esquecerOpcoes(): void {
  try {
    localStorage.removeItem(CHAVE_DAS_OPCOES);
  } catch {
    /* nada guardado para esquecer */
  }
}

/**
 * A fila já foi toda impressa?
 *
 * É o que decide se um arquivo novo entra no fim da fila ou começa outra: a
 * pessoa que imprimiu e escolhe outro arquivo quer imprimir **esse**, e não
 * mandar de novo o que já saiu.
 */
export function filaTerminada(fila: { estado: string }[]): boolean {
  return (
    fila.some((i) => i.estado === 'impresso') &&
    fila.every((i) => i.estado === 'impresso' || i.estado === 'erro')
  );
}

let contador = 0;
export const proximoId = () => `i${(contador += 1)}_${Date.now().toString(36)}`;
