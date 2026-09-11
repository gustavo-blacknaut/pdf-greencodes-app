'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarChart3, RotateCcw } from 'lucide-react';
import { versaoDoAplicativo } from '@/lib/desktop';
import { resetarTudo } from '@/lib/resetar';
import { PainelDeAtividade } from './PainelDeAtividade';

export function AppBar() {
  const [versao, setVersao] = useState('');
  // Resetar tira arquivos que podem estar no meio de um trabalho: o primeiro
  // clique só pergunta, e a pergunta some sozinha se ninguém confirmar.
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    void versaoDoAplicativo().then(setVersao);
  }, []);

  useEffect(() => {
    if (!confirmando) return;
    const prazo = setTimeout(() => setConfirmando(false), 4000);
    return () => clearTimeout(prazo);
  }, [confirmando]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-5">
        {/* A logo leva de volta às ferramentas, de qualquer tela. */}
        <Link href="/app" className="flex items-center gap-3" title="Voltar para as ferramentas">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-128.png" alt="" className="h-7 w-7 shrink-0" />
          <span className="text-[15px] font-semibold tracking-tight">PDF.GreenCodes</span>
        </Link>
        {versao && <span className="text-xs tabular-nums text-muted">{versao}</span>}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => (confirmando ? resetarTudo() : setConfirmando(true))}
            className="btn-ghost px-3 py-1.5 text-[13px]"
            title="Tira os arquivos de todas as ferramentas e volta as opções ao padrão."
          >
            <RotateCcw className="h-4 w-4" />
            {confirmando ? 'Confirmar reset?' : 'Resetar configurações'}
          </button>
          <Link href="/app/uso" className="btn-ghost px-3 py-1.5 text-[13px]">
            <BarChart3 className="h-4 w-4" /> Seu uso
          </Link>
          <PainelDeAtividade />
        </div>
      </div>
    </header>
  );
}
