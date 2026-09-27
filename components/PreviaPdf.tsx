'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { loadPdfJs } from '@/lib/pdf/lazy';
import { isPasswordError } from '@/lib/pdf/nucleo';
import { DesbloquearArquivo } from './DesbloquearArquivo';

export function PreviaPdf({ blob, nome }: { blob: Blob; nome: string }) {
  const [documento, setDocumento] = useState<PDFDocumentProxy | null>(null);
  const [pagina, setPagina] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [largura, setLargura] = useState(0);
  const [ocupado, setOcupado] = useState(true);
  const [protegido, setProtegido] = useState(false);
  const [erro, setErro] = useState('');
  const molduraRef = useRef<HTMLDivElement>(null);
  const telaRef = useRef<HTMLCanvasElement>(null);
  const leituraRef = useRef<PDFDocumentLoadingTask | null>(null);
  const desenhoRef = useRef<RenderTask | null>(null);
  const versaoRef = useRef(0);

  const abrir = useCallback(async (senha?: string) => {
    const versao = ++versaoRef.current;
    const pdfjs = await loadPdfJs();
    const bytes = await blob.arrayBuffer();
    if (versao !== versaoRef.current) return;
    const tarefa = pdfjs.getDocument({ data: new Uint8Array(bytes), password: senha, isEvalSupported: false });
    leituraRef.current = tarefa;
    try {
      const doc = await tarefa.promise;
      if (versao !== versaoRef.current) { await tarefa.destroy(); return; }
      setDocumento(doc);
      setProtegido(false);
      setErro('');
    } catch (falha) {
      await tarefa.destroy().catch(() => {});
      if (versao !== versaoRef.current) return;
      if (isPasswordError(falha)) {
        setProtegido(true);
        if (senha) throw new Error('Senha incorreta para este arquivo.');
      } else {
        setErro('Não foi possível abrir a prévia deste PDF.');
      }
    } finally {
      if (versao === versaoRef.current) setOcupado(false);
    }
  }, [blob]);

  useEffect(() => {
    void abrir().catch(() => setErro('Não foi possível carregar a prévia.'));
    return () => {
      versaoRef.current += 1;
      desenhoRef.current?.cancel();
      void leituraRef.current?.destroy().catch(() => {});
    };
  }, [abrir]);

  useEffect(() => {
    const moldura = molduraRef.current;
    if (!moldura) return;
    const medir = () => setLargura(moldura.clientWidth);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(moldura);
    return () => observador.disconnect();
  }, []);

  useEffect(() => {
    if (!documento || !largura) return;
    let vivo = true;
    let tarefa: RenderTask | undefined;
    setOcupado(true);
    void (async () => {
      try {
        const anterior = desenhoRef.current;
        anterior?.cancel();
        await anterior?.promise.catch(() => {});
        if (!vivo) return;
        const folha = await documento.getPage(pagina);
        if (!vivo) return;
        const natural = folha.getViewport({ scale: 1 });
        const ajuste = Math.min((largura - 24) / natural.width, window.innerHeight * 0.6 / natural.height);
        const escalaCss = Math.max(0.01, ajuste * zoom);
        const escala = Math.min(escalaCss * Math.min(window.devicePixelRatio || 1, 2), Math.sqrt(4_000_000 / (natural.width * natural.height)));
        const viewport = folha.getViewport({ scale: escala });
        const tela = telaRef.current;
        if (!tela) return;
        tela.width = Math.ceil(viewport.width);
        tela.height = Math.ceil(viewport.height);
        tela.style.width = `${natural.width * escalaCss}px`;
        tela.style.height = `${natural.height * escalaCss}px`;
        const contexto = tela.getContext('2d');
        if (!contexto) throw new Error('Não foi possível desenhar esta página.');
        tarefa = folha.render({ canvasContext: contexto, viewport, intent: 'print', background: '#ffffff' });
        desenhoRef.current = tarefa;
        await tarefa.promise;
        folha.cleanup();
        if (vivo) setErro('');
      } catch (falha) {
        if (vivo) setErro(falha instanceof Error ? falha.message : 'Não foi possível desenhar esta página.');
      } finally {
        if (vivo) setOcupado(false);
      }
    })();
    return () => { vivo = false; tarefa?.cancel(); };
  }, [documento, pagina, largura, zoom]);

  return <div>
    {documento && <div className="flex flex-wrap items-center justify-between gap-2 border-b p-2">
      <div className="flex items-center gap-2">
        <button type="button" className="btn-ghost px-2 py-1.5" disabled={pagina <= 1}
          onClick={() => setPagina((atual) => atual - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button>
        <label className="flex items-center gap-1 text-xs">Página <input type="number" min={1} max={documento.numPages}
          className="input w-16 px-2 py-1" value={pagina} onChange={(evento) => {
            const valor = Number(evento.target.value);
            if (Number.isInteger(valor) && valor >= 1 && valor <= documento.numPages) setPagina(valor);
          }} /> de {documento.numPages}</label>
        <button type="button" className="btn-ghost px-2 py-1.5" disabled={pagina >= documento.numPages}
          onClick={() => setPagina((atual) => atual + 1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className="btn-ghost px-2 py-1.5" disabled={zoom <= 0.25}
          onClick={() => setZoom((atual) => Math.max(0.25, atual - 0.25))} aria-label="Diminuir zoom da prévia"><ZoomOut className="h-4 w-4" /></button>
        <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn-ghost px-2 py-1.5" disabled={zoom >= 4}
          onClick={() => setZoom((atual) => Math.min(4, atual + 0.25))} aria-label="Aumentar zoom da prévia"><ZoomIn className="h-4 w-4" /></button>
        <button type="button" className="btn-ghost px-2 py-1.5 text-xs" onClick={() => setZoom(1)}><Maximize2 className="h-4 w-4" /> Ajustar</button>
      </div>
    </div>}
    {protegido && <div className="p-3"><DesbloquearArquivo nomeDoArquivo={nome} onDesbloquear={abrir} /></div>}
    <div ref={molduraRef} className="max-h-[65vh] overflow-auto bg-elevated p-3">
      {ocupado && <p className="mb-2 flex items-center gap-2 text-xs text-muted" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Preparando prévia...</p>}
      <canvas ref={telaRef} className="mx-auto block shadow" aria-label={`Prévia de ${nome}, página ${pagina}`} hidden={!documento} />
    </div>
    {erro && <p className="p-3 text-sm text-rose-500" role="alert">{erro}</p>}
  </div>;
}
