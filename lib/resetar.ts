'use client';

/**
 * Volta o programa ao estado de quem acabou de abrir.
 *
 * Arquivos escolhidos, filas, resultados na memória e opções lembradas ficam
 * espalhados pelas telas. Em vez de pedir a cada uma que se limpe — e
 * esquecer alguma —, o reset apaga o que é guardado e recarrega: estado de
 * tela que não existe não fica preso na próxima operação.
 *
 * As contagens de uso não entram: são do Rust, e têm o próprio "zerar".
 */

import { vault } from './ephemeral';

/** Tudo o que o programa guarda neste navegador começa com isto. */
const PREFIXO = 'greencodes:';

export function resetarTudo(destino = '/app'): void {
  try {
    const chaves: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const chave = localStorage.key(i);
      if (chave?.startsWith(PREFIXO)) chaves.push(chave);
    }
    chaves.forEach((chave) => localStorage.removeItem(chave));
  } catch {
    /* navegador sem localStorage: não há o que esquecer */
  }
  vault.purgeAll();
  window.location.assign(destino);
}
