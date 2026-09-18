'use client';

import type { LoadedFile, RunContext } from '@/lib/pdf/tipos';

export function QuantidadesEtiquetas({ arquivos, opcoes, onChange, disabled }: {
  arquivos: LoadedFile[];
  opcoes: RunContext['options'];
  onChange: (key: string, value: number) => void;
  disabled: boolean;
}) {
  if (opcoes.modo !== 'sequencia' || arquivos.length === 0) return null;
  const total = arquivos.reduce((soma, arquivo) =>
    soma + Number(opcoes[`quantidade:${arquivo.id}`] ?? 1) * (arquivo.pageCount ?? 1), 0);
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-xl border p-3">
      <legend className="px-1 text-sm font-semibold">Quantidade de cada arte</legend>
      <p className="text-xs text-muted">As artes entram juntas, na ordem da lista. Zero deixa a arte de fora. Em PDFs, a quantidade vale para cada página.</p>
      {arquivos.map((arquivo) => {
        const key = `quantidade:${arquivo.id}`;
        return (
          <label key={arquivo.id} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm" title={arquivo.name}>{arquivo.name}</span>
            <input type="number" className="input w-24" min={0} max={5000} step={1}
              aria-label={`Quantidade de ${arquivo.name}`} value={Number(opcoes[key] ?? 1)}
              onChange={(event) => onChange(key, Math.max(0, Math.min(5000, Math.trunc(Number(event.target.value) || 0))))} />
          </label>
        );
      })}
      <p className="text-xs font-medium">Total: {total} etiqueta{total === 1 ? '' : 's'}</p>
    </fieldset>
  );
}
