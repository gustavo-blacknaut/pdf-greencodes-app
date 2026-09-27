'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { resultadoParaImpressao } from '@/lib/impressao/resultado';
import { PreviaPdf } from './PreviaPdf';

export function PreviaWord({ blob, nome }: { blob: Blob; nome: string }) {
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const controle = useRef<AbortController | null>(null);
  useEffect(() => () => controle.current?.abort(), []);

  async function gerar() {
    const atual = new AbortController();
    controle.current?.abort();
    controle.current = atual;
    setOcupado(true);
    setErro('');
    try {
      const { inspectFile, runOperation } = await import('@/lib/pdf/engine');
      const arquivo = await inspectFile(new File([blob], nome), 'previa-word');
      if (arquivo.error) throw new Error(arquivo.error);
      const resultado = await runOperation('word-to-pdf', {
        files: [arquivo], options: {}, signal: atual.signal, onProgress: () => {},
      });
      if (!resultado.files[0]) throw new Error('Não foi possível gerar a prévia.');
      const convertido = await resultadoParaImpressao(resultado.files[0]);
      if (!atual.signal.aborted) setPdf(convertido);
    } catch (falha) {
      if (!atual.signal.aborted) setErro(falha instanceof Error ? falha.message : 'Não foi possível gerar a prévia.');
    } finally {
      if (!atual.signal.aborted) setOcupado(false);
    }
  }

  return <div>
    <p className="px-5 py-3 text-xs text-muted">Prévia pela conversão para PDF. A diagramação pode variar no Word; o DOCX original permanece disponível.</p>
    {pdf ? <PreviaPdf blob={pdf} nome={nome} /> : <div className="px-5 pb-4">
      <button type="button" disabled={ocupado} onClick={() => void gerar()} className="btn-ghost">
        {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
        {ocupado ? 'Preparando prévia...' : 'Gerar prévia do Word'}
      </button>
      {erro && <p role="alert" className="mt-2 text-sm text-rose-500">{erro}</p>}
    </div>}
  </div>;
}
