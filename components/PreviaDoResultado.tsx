'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { lerCaminho } from '@/lib/desktop';
import type { OutputFile } from '@/lib/pdf/engine';
import { tipoDePrevia } from '@/lib/pdf/previa-resultado';
import { formatBytes } from '@/lib/utils';
import { PreviaPdf } from './PreviaPdf';
import { PreviaWord } from './PreviaWord';

const LIMIAR_AUTOMATICO = 64 * 1024 * 1024;
const LIMITE_TEXTO = 256 * 1024;

export function PreviaDoResultado({ arquivos }: { arquivos: OutputFile[] }) {
  const [indice, setIndice] = useState(() => Math.max(0, arquivos.findIndex((arquivo) => tipoDePrevia(arquivo))));
  const [aberta, setAberta] = useState(true);
  const arquivo = arquivos[indice] ?? arquivos[0];
  if (!arquivo) return null;

  return <section className="border-b" aria-label="Prévia do resultado">
    <div className="flex flex-wrap items-center gap-3 bg-elevated/40 px-5 py-3">
      <h2 className="flex items-center gap-2 text-sm font-medium"><Eye className="h-4 w-4" /> Prévia do resultado</h2>
      {arquivos.length > 1 && <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
        Arquivo
        <select className="input min-w-0 flex-1 py-1.5" value={indice} onChange={(evento) => setIndice(Number(evento.target.value))}>
          {arquivos.map((item, i) => <option key={`${i}:${item.name}`} value={i}>{item.name}</option>)}
        </select>
      </label>}
      <button type="button" className="btn-ghost ml-auto px-2 py-1.5 text-xs" onClick={() => setAberta((valor) => !valor)}
        aria-expanded={aberta}>{aberta ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{aberta ? 'Ocultar' : 'Mostrar'}</button>
    </div>
    {aberta && <ArquivoNaPrevia key={`${indice}:${arquivo.name}`} arquivo={arquivo} />}
  </section>;
}

function ArquivoNaPrevia({ arquivo }: { arquivo: OutputFile }) {
  const tipo = tipoDePrevia(arquivo);
  const tamanho = arquivo.tamanho ?? arquivo.blob.size;
  const [carregar, setCarregar] = useState(tamanho <= LIMIAR_AUTOMATICO);
  const [blob, setBlob] = useState<Blob | null>(arquivo.caminho ? null : arquivo.blob);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!tipo || !carregar || !arquivo.caminho) return;
    let vivo = true;
    void lerCaminho(arquivo.caminho).then((bytes) => {
      if (vivo) setBlob(new Blob([bytes], { type: arquivo.blob.type }));
    }).catch((falha) => {
      if (vivo) setErro(falha instanceof Error ? falha.message : 'Não foi possível ler o arquivo.');
    });
    return () => { vivo = false; };
  }, [arquivo, carregar, tipo]);

  if (!tipo) return <p className="px-5 py-4 text-sm text-muted">Este formato precisa do programa correspondente para visualizar. O arquivo está disponível abaixo.</p>;
  if (!carregar) return <div className="px-5 py-4"><button type="button" className="btn-ghost" onClick={() => setCarregar(true)}>
    <Eye className="h-4 w-4" /> Carregar prévia ({formatBytes(tamanho)})</button></div>;
  if (erro) return <p role="alert" className="px-5 py-4 text-sm text-rose-500">{erro}</p>;
  if (!blob) return <p role="status" className="flex items-center gap-2 px-5 py-4 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Lendo prévia...</p>;
  if (tipo === 'pdf') return <PreviaPdf blob={blob} nome={arquivo.name} />;
  if (tipo === 'word') return <PreviaWord blob={blob} nome={arquivo.name} />;
  if (tipo === 'imagem') return <PreviaImagem blob={blob} nome={arquivo.name} />;
  return <PreviaTexto blob={blob} />;
}

function PreviaImagem({ blob, nome }: { blob: Blob; nome: string }) {
  const [url, setUrl] = useState('');
  const [zoom, setZoom] = useState(1);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    const local = URL.createObjectURL(blob);
    setUrl(local);
    return () => URL.revokeObjectURL(local);
  }, [blob]);
  return <div>
    <div className="flex items-center justify-end gap-1 border-b p-2">
      <button type="button" className="btn-ghost px-2 py-1.5" disabled={zoom <= 0.25}
        onClick={() => setZoom((atual) => Math.max(0.25, atual - 0.25))} aria-label="Diminuir zoom da imagem"><ZoomOut className="h-4 w-4" /></button>
      <span className="w-12 text-center text-xs">{Math.round(zoom * 100)}%</span>
      <button type="button" className="btn-ghost px-2 py-1.5" disabled={zoom >= 4}
        onClick={() => setZoom((atual) => Math.min(4, atual + 0.25))} aria-label="Aumentar zoom da imagem"><ZoomIn className="h-4 w-4" /></button>
      <button type="button" className="btn-ghost px-2 py-1.5 text-xs" onClick={() => setZoom(1)}><Maximize2 className="h-4 w-4" /> Ajustar</button>
    </div>
    <div className="max-h-[65vh] overflow-auto bg-elevated p-3">
      {url && <div style={{ width: `${zoom * 100}%` }} className="mx-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`Prévia de ${nome}`} className="mx-auto block h-auto w-full object-contain" onError={() => setErro(true)} />
      </div>}
      {erro && <p role="alert" className="text-sm text-rose-500">O navegador não conseguiu visualizar esta imagem. O arquivo original permanece disponível.</p>}
    </div>
  </div>;
}

function PreviaTexto({ blob }: { blob: Blob }) {
  const [texto, setTexto] = useState('');
  useEffect(() => {
    let vivo = true;
    void blob.slice(0, LIMITE_TEXTO).text().then((conteudo) => { if (vivo) setTexto(conteudo); });
    return () => { vivo = false; };
  }, [blob]);
  return <div className="p-3">
    <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-elevated p-3 text-xs">{texto}</pre>
    {blob.size > LIMITE_TEXTO && <p className="mt-2 text-xs text-muted">A prévia mostra os primeiros 256 KB. O arquivo salvo contém o relatório completo.</p>}
  </div>;
}
