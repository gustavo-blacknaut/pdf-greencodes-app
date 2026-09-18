'use client';

import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { miniaturaSobDemanda } from './entradaDeArquivos';
import type { ArquivoNaFila } from './FilaDeArquivos';

/**
 * O pedido de miniatura de uma linha da fila, feito quando ela aparece na tela.
 *
 * `itemsRef` e não `items`: o pedido sai de um observador montado uma vez, e
 * ler o estado dali devolveria a lista de quando ele nasceu. `pedidas` evita
 * pedir de novo o que não tem imagem (texto, Office) a cada renderização.
 */
export function useMiniaturas(items: ArquivoNaFila[], setItems: Dispatch<SetStateAction<ArquivoNaFila[]>>) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pedidas = useRef(new Set<string>());

  return useCallback(
    (id: string) => {
      if (pedidas.current.has(id)) return;
      const arquivo = itemsRef.current.find((item) => item.id === id)?.data;
      if (!arquivo) return;
      pedidas.current.add(id);
      void miniaturaSobDemanda(arquivo).then((miniatura) => {
        if (!miniatura) return;
        setItems((atuais) =>
          atuais.map((item) =>
            item.id === id && item.data ? { ...item, data: { ...item.data, thumbnail: miniatura } } : item,
          ),
        );
      });
    },
    [setItems],
  );
}
