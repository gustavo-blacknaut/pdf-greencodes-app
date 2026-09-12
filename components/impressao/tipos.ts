/** O que a tela de impressão guarda de cada arquivo da fila. */
import type { Ajustes } from '@/lib/impressao/ajustes';

export type EstadoDoItem = 'esperando' | 'convertendo' | 'pronto' | 'erro' | 'impresso';

export type ItemFila = {
  id: string;
  nome: string;
  origem: File | Blob;
  nomeOriginal: string;
  blob: Blob | null;
  paginas: number;
  estado: EstadoDoItem;
  erro?: string;
  /** Brilho, contraste, cor, nitidez e giro deste arquivo. Cada um tem os seus. */
  ajustes?: Ajustes;
};
