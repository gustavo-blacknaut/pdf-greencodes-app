'use client';
import { useEffect } from 'react';
import { alvoEditavel } from '@/lib/atalhos';

export function useColarArquivos(receber: (arquivos: File[]) => void, ativo = true, abrir?: () => void) {
  useEffect(() => {
    if (!ativo) return;
    const colar = (e: ClipboardEvent) => {
      if (e.defaultPrevented || alvoEditavel(e.target)) return;
      const arquivos = Array.from(e.clipboardData?.files ?? []);
      if (!arquivos.length) return;
      e.preventDefault();
      receber(arquivos);
    };
    window.addEventListener('paste', colar);
    const tecla = (e: KeyboardEvent) => {
      if (abrir && !e.defaultPrevented && !alvoEditavel(e.target) && !e.isComposing
        && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault(); abrir();
      }
    };
    window.addEventListener('keydown', tecla);
    return () => {
      window.removeEventListener('paste', colar);
      window.removeEventListener('keydown', tecla);
    };
  }, [receber, ativo, abrir]);
}
