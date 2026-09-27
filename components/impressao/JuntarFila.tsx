'use client';
import { useState } from 'react';
import type { ItemFila } from './tipos';
import { loadPdfLib } from '@/lib/pdf/lazy';
import { ajustesDe, temAjuste } from '@/lib/impressao/ajustes';

export function JuntarFila({ fila, desabilitado, onJuntar }: {
  fila: ItemFila[]; desabilitado: boolean; onJuntar: (item: ItemFila) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  async function juntar() {
    setOcupado(true); setErro('');
    try {
      if (fila.some((i) => temAjuste(ajustesDe(i.ajustes)) || i.ajustes?.girar)) {
        throw new Error('Restaure os ajustes individuais antes de juntar. Você poderá ajustar o PDF unido depois.');
      }
      const { PDFDocument } = await loadPdfLib();
      const destino = await PDFDocument.create();
      for (const item of fila) {
        if (!item.blob) throw new Error('Aguarde a preparação de todos os arquivos.');
        const origem = await PDFDocument.load(await item.blob.arrayBuffer());
        for (const pagina of await destino.copyPages(origem, origem.getPageIndices())) destino.addPage(pagina);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const blob = new Blob([(await destino.save()).slice().buffer], { type: 'application/pdf' });
      onJuntar({ id: crypto.randomUUID(), nome: 'fila-unida.pdf', nomeOriginal: 'fila-unida.pdf',
        origem: blob, blob, paginas: destino.getPageCount(), estado: 'pronto' });
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível juntar.'); }
    finally { setOcupado(false); }
  }
  return <div className="card p-3">
    <button className="btn-ghost" disabled={desabilitado || ocupado || fila.length < 2}
      onClick={() => void juntar()}>{ocupado ? 'Juntando…' : 'Juntar fila em um PDF antes de imprimir'}</button>
    <p className="text-xs text-muted">Une na ordem da lista. O frente e verso passa a seguir as páginas do documento unido.</p>
    {erro && <p role="alert" className="text-sm text-rose-400">{erro}</p>}
  </div>;
}
