'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import { loadPdfJs } from '@/lib/pdf/lazy';
import { ajustarCanvas } from '@/lib/impressao/folha';
import type { Ajustes } from '@/lib/impressao/ajustes';

type Medida = { largura: number; altura: number };

/** Um documento e um desenho por vez; ajustes reaproveitam o desenho cru. */
export function usePrevia({
  saida, zoom, larguraDisponivel, ajustes, telaRef, desenhaFolhaRef,
}: {
  saida: { blob: Blob; paginas: number } | null;
  zoom: number;
  larguraDisponivel: number;
  ajustes: Ajustes;
  telaRef: RefObject<HTMLCanvasElement | null>;
  desenhaFolhaRef: RefObject<boolean>;
}) {
  const [pagina, setPagina] = useState(1);
  const [renderizando, setRenderizando] = useState(false);
  const [escalaAtual, setEscalaAtual] = useState(1);
  const [arteMm, setArteMm] = useState<Medida | null>(null);
  const [documento, setDocumento] = useState<PDFDocumentProxy | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const tarefaRef = useRef<RenderTask | null>(null);
  const cruRef = useRef<HTMLCanvasElement | null>(null);
  const prontoRef = useRef(false);
  const arteRef = useRef<Medida | null>(null);
  const ajustesRef = useRef(ajustes);
  ajustesRef.current = ajustes;

  const repintar = useCallback(() => {
    const tela = telaRef.current;
    const cru = cruRef.current;
    if (!prontoRef.current || !tela || !cru?.width || !cru.height) return;
    if (tela.width !== cru.width) tela.width = cru.width;
    if (tela.height !== cru.height) tela.height = cru.height;
    const pincel = tela.getContext('2d');
    if (!pincel) return;
    pincel.clearRect(0, 0, tela.width, tela.height);
    pincel.drawImage(cru, 0, 0);
    const mm = arteRef.current?.largura;
    if (mm) ajustarCanvas(tela, ajustesRef.current, cru.width / mm);
  }, [telaRef]);

  const blob = saida?.blob;
  useEffect(() => {
    let vivo = true;
    let carregamento: PDFDocumentLoadingTask | undefined;
    setDocumento(null);
    setArteMm(null);
    setErro(null);
    prontoRef.current = false;
    if (!blob) return;

    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        if (!vivo) return;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!vivo) return;
        carregamento = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
        const doc = await carregamento.promise;
        if (!vivo) return;
        setPagina(1);
        setDocumento(doc);
      } catch (falha) {
        if (vivo) setErro(falha instanceof Error ? falha.message : 'Não foi possível abrir a prévia.');
      }
    })();
    return () => {
      vivo = false;
      prontoRef.current = false;
      tarefaRef.current?.cancel();
      // Encerra também o worker e o documento anterior. Só trocar a referência
      // deixava PDFs inteiros acumulados ao navegar pela fila.
      void carregamento?.destroy().catch(() => {});
    };
  }, [blob]);

  useEffect(() => {
    if (!documento || !larguraDisponivel) {
      setRenderizando(false);
      return;
    }
    let vivo = true;
    let tarefa: RenderTask | undefined;
    prontoRef.current = false;
    setRenderizando(true);
    void (async () => {
      try {
        // Espera o cancelamento antes de redimensionar o canvas compartilhado.
        const anterior = tarefaRef.current;
        anterior?.cancel();
        await anterior?.promise.catch(() => {});
        if (!vivo) return;
        const p = await documento.getPage(Math.min(pagina, documento.numPages));
        if (!vivo) return;
        const natural = p.getViewport({ scale: 1 });
        const medida = { largura: natural.width / 72 * 25.4, altura: natural.height / 72 * 25.4 };
        arteRef.current = medida;
        setArteMm(medida);
        const escalaCss = zoom > 0 ? zoom : Math.min(larguraDisponivel / natural.width, 2);
        setEscalaAtual(escalaCss);
        let escala = escalaCss * Math.min(window.devicePixelRatio || 1, 2);
        const pixels = natural.width * natural.height * escala * escala;
        if (pixels > 6_000_000) escala *= Math.sqrt(6_000_000 / pixels);

        const viewport = p.getViewport({ scale: escala });
        const tela = telaRef.current;
        if (!tela) return;
        const cru = (cruRef.current ??= document.createElement('canvas'));
        cru.width = Math.max(1, Math.floor(viewport.width));
        cru.height = Math.max(1, Math.floor(viewport.height));
        if (!desenhaFolhaRef.current) {
          tela.style.width = Math.round(natural.width * escalaCss) + 'px';
          tela.style.height = Math.round(natural.height * escalaCss) + 'px';
        }
        const contexto = cru.getContext('2d');
        if (!contexto) throw new Error('Não foi possível desenhar a prévia.');
        tarefa = p.render({ canvasContext: contexto, viewport });
        tarefaRef.current = tarefa;
        await tarefa.promise;
        if (!vivo) return;
        prontoRef.current = true;
        repintar();
        setErro(null);
        p.cleanup();
      } catch (falha) {
        if (vivo) setErro(falha instanceof Error ? falha.message : 'Não foi possível desenhar a prévia.');
      } finally {
        if (tarefaRef.current === tarefa) tarefaRef.current = null;
        if (vivo) setRenderizando(false);
      }
    })();
    return () => {
      vivo = false;
      tarefa?.cancel();
    };
  }, [documento, pagina, zoom, larguraDisponivel, telaRef, desenhaFolhaRef, repintar]);

  useEffect(() => {
    // Vários eventos do controle no mesmo quadro pedem só uma pintura.
    const quadro = requestAnimationFrame(repintar);
    return () => cancelAnimationFrame(quadro);
  }, [ajustes, repintar]);

  useEffect(() => () => {
    const cru = cruRef.current;
    cruRef.current = null;
    const tarefa = tarefaRef.current;
    tarefa?.cancel();
    void Promise.resolve(tarefa?.promise).catch(() => {}).then(() => {
      if (cru) { cru.width = 0; cru.height = 0; }
    });
  }, []);

  return { pagina, setPagina, renderizando, escalaAtual, arteMm, setArteMm, erro, totalDoDoc: documento?.numPages ?? 0 };
}
