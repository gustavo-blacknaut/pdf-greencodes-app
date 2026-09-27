'use client';
import { useEffect, useState } from 'react';
import { integracaoDoSistema } from '@/lib/desktop';

export function InicioAutomatico() {
  const [ligado, setLigado] = useState(false);
  const [ocupado, setOcupado] = useState(true);
  const [erro, setErro] = useState('');
  useEffect(() => {
    void integracaoDoSistema.inicioAutomatico.consultar().then(setLigado)
      .catch(() => setErro('Não foi possível consultar a inicialização.')).finally(() => setOcupado(false));
  }, []);
  return <label className="text-xs text-muted" title={erro || 'Abre na bandeja ao entrar no Windows'}>
    <input type="checkbox" checked={ligado} disabled={ocupado} className="mr-2" onChange={async (e) => {
      const valor = e.target.checked;
      setOcupado(true);
      try {
        if (!await integracaoDoSistema.inicioAutomatico.definir(valor)) throw new Error('O Windows não confirmou a alteração.');
        setLigado(valor); setErro('');
      } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao configurar.'); }
      finally { setOcupado(false); }
    }} />Iniciar com Windows{erro && <span role="alert"> · {erro}</span>}
  </label>;
}
