'use client';

/**
 * Os ajustes da imagem, logo abaixo da prévia.
 *
 * Cada controle mexe na prévia na hora, e a prévia é a folha: o que está ali
 * é o que a impressora recebe. Por isso os ajustes moram por arquivo, e não
 * na fila inteira — cada foto tem a sua luz.
 */

import { useState } from 'react';
import { ChevronDown, RotateCcw, RotateCw, SlidersHorizontal, Undo2 } from 'lucide-react';
import { AJUSTES_NEUTROS, temAjuste, type Ajustes } from '@/lib/impressao/ajustes';
import { cx } from '@/lib/utils';

type Controle = { chave: keyof Ajustes; rotulo: string; dica: string };

const CONTROLES: Controle[] = [
  { chave: 'exposicao', rotulo: 'Exposição', dica: 'A luz inteira, como na câmera. Foto escura demais começa por aqui.' },
  { chave: 'brilho', rotulo: 'Brilho', dica: 'Clareia ou escurece por igual, sem abrir o contraste.' },
  { chave: 'contraste', rotulo: 'Contraste', dica: 'Afasta claro e escuro. Ajuda quando a impressão sai lavada.' },
  { chave: 'saturacao', rotulo: 'Saturação', dica: 'Força da cor. No papel comum, um pouco a mais costuma compensar.' },
  { chave: 'temperatura', rotulo: 'Temperatura', dica: 'Para a esquerda esfria (azul), para a direita esquenta (laranja).' },
  { chave: 'nitidez', rotulo: 'Nitidez', dica: 'Realça a borda. Pouco resolve foto mole; muito deixa halo em volta.' },
];

export function AjustesDaImagem({
  nome,
  ajustes,
  cinzaDaFila,
  outros,
  onMudar,
  onTodos,
}: {
  nome: string;
  ajustes: Ajustes;
  /** A fila inteira está em preto e branco: o cinza daqui já está decidido. */
  cinzaDaFila: boolean;
  /** Quantos outros arquivos prontos há na fila. */
  outros: number;
  onMudar: (ajustes: Ajustes) => void;
  onTodos: () => void;
}) {
  const [aberto, setAberto] = useState(true);
  const mexido = temAjuste(ajustes) || ajustes.girar !== 0;

  const mudar = <K extends keyof Ajustes>(chave: K, valor: Ajustes[K]) => onMudar({ ...ajustes, [chave]: valor });
  const girar = (quanto: number) =>
    mudar('girar', (((ajustes.girar + quanto) % 360) + 360) % 360 as Ajustes['girar']);

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-brand" />
          <span className="text-sm font-semibold tracking-tight">Ajustar a imagem</span>
          <span className="min-w-0 truncate text-xs text-muted">{nome}</span>
          <ChevronDown className={cx('ml-auto h-4 w-4 shrink-0 text-muted transition', aberto && 'rotate-180')} />
        </button>
      </div>

      {aberto && (
        <div className="mt-4 space-y-4">
          {CONTROLES.map((controle) => {
            const valor = Number(ajustes[controle.chave] ?? 0);
            const minimo = controle.chave === 'nitidez' ? 0 : -100;
            return (
              <div key={controle.chave}>
                <div className="flex items-baseline gap-2">
                  <label htmlFor={controle.chave} className="text-[13px] font-medium">
                    {controle.rotulo}
                  </label>
                  <span className="ml-auto text-xs tabular-nums text-muted">{valor > 0 ? `+${valor}` : valor}</span>
                  {valor !== 0 && (
                    <button
                      type="button"
                      onClick={() => mudar(controle.chave, 0 as never)}
                      className="text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline"
                    >
                      zerar
                    </button>
                  )}
                </div>
                <input
                  id={controle.chave}
                  type="range"
                  min={minimo}
                  max={100}
                  step={1}
                  value={valor}
                  onChange={(e) => mudar(controle.chave, Number(e.target.value) as never)}
                  className="mt-1.5 w-full accent-brand"
                />
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{controle.dica}</p>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="text-[13px] font-medium">Girar</span>
            <button type="button" onClick={() => girar(-90)} className="btn-ghost px-2.5 py-1.5" aria-label="Girar para a esquerda">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => girar(90)} className="btn-ghost px-2.5 py-1.5" aria-label="Girar para a direita">
              <RotateCw className="h-4 w-4" />
            </button>
            <span className="text-xs tabular-nums text-muted">{ajustes.girar}°</span>

            <label className="ml-auto flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={ajustes.cinza || cinzaDaFila}
                disabled={cinzaDaFila}
                onChange={(e) => mudar('cinza', e.target.checked)}
                className="h-4 w-4 accent-brand disabled:opacity-50"
              />
              Tons de cinza
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onMudar({ ...AJUSTES_NEUTROS })}
              disabled={!mexido}
              className="btn-ghost px-3 py-2 text-[13px] disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" /> Voltar ao original
            </button>
            {outros > 0 && (
              <button type="button" onClick={onTodos} className="btn-ghost px-3 py-2 text-[13px]">
                Aplicar nos outros {outros} arquivo{outros === 1 ? '' : 's'}
              </button>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-muted">
            {cinzaDaFila
              ? 'A fila está em preto e branco, então a prévia mostra o cinza que vai sair.'
              : 'A prévia acima é a folha: o que você vê ali é o que a impressora recebe, na melhor resolução.'}
          </p>
        </div>
      )}
    </div>
  );
}
