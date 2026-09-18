'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';

export function useArrastePaginas(mover: (de: number, para: number) => void) {
  const lista = useRef<HTMLUListElement>(null);
  const previa = useRef<HTMLDivElement>(null);
  const [origem, setOrigem] = useState<number | null>(null);
  const [destino, setDestino] = useState<number | null>(null);
  const ativo = useRef<{ de: number; para: number; x: number; y: number; inicioX: number; inicioY: number; moveu: boolean } | null>(null);
  const moverRef = useRef(mover);
  moverRef.current = mover;

  useEffect(() => {
    let quadro = 0;
    function atualizar() {
      const a = ativo.current;
      const grade = lista.current;
      if (!a || !grade) return;
      if (previa.current) previa.current.style.transform = `translate(${a.x + 12}px, ${a.y + 12}px)`;
      const caixa = grade.getBoundingClientRect();
      const topo = Math.max(0, caixa.top);
      const base = Math.min(window.innerHeight, caixa.bottom);
      const limite = 55;
      const velocidade = a.y < topo + limite ? -Math.min(18, (topo + limite - a.y) / 3)
        : a.y > base - limite ? Math.min(18, (a.y - base + limite) / 3) : 0;
      if (a.moveu) grade.scrollTop += velocidade;
      const alvo = document.elementFromPoint(a.x, Math.max(topo + 1, Math.min(base - 1, a.y)))?.closest<HTMLElement>('[data-pagina-posicao]');
      if (alvo && grade.contains(alvo)) {
        a.para = Number(alvo.dataset.paginaPosicao);
        setDestino(a.para);
      }
      quadro = requestAnimationFrame(atualizar);
    }
    function movimento(e: globalThis.PointerEvent) {
      const a = ativo.current;
      if (!a) return;
      a.x = e.clientX; a.y = e.clientY;
      a.moveu ||= Math.hypot(a.x - a.inicioX, a.y - a.inicioY) > 5;
      e.preventDefault();
      if (!quadro) quadro = requestAnimationFrame(atualizar);
    }
    function terminar(e?: Event) {
      const a = ativo.current;
      if (a?.moveu && e?.type === 'pointerup' && a.de !== a.para) moverRef.current(a.de, a.para);
      ativo.current = null;
      cancelAnimationFrame(quadro); quadro = 0;
      setOrigem(null); setDestino(null);
    }
    window.addEventListener('pointermove', movimento, { passive: false });
    window.addEventListener('pointerup', terminar);
    window.addEventListener('pointercancel', terminar);
    window.addEventListener('blur', terminar);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('pointermove', movimento);
      window.removeEventListener('pointerup', terminar);
      window.removeEventListener('pointercancel', terminar);
      window.removeEventListener('blur', terminar);
    };
  }, []);

  function iniciar(e: PointerEvent<HTMLElement>, de: number) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button,input,select,textarea')) return;
    e.preventDefault();
    ativo.current = { de, para: de, x: e.clientX, y: e.clientY, inicioX: e.clientX, inicioY: e.clientY, moveu: false };
    setOrigem(de); setDestino(de);
  }
  return { lista, previa, origem, destino, iniciar };
}
