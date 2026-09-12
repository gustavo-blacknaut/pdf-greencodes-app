'use client';

/**
 * A tela onde se marca, com o mouse, o pedaço que fica.
 *
 * A marcação é guardada em **pixels da imagem de origem**, e é isso que o
 * corte recebe: o que sai é exatamente o retângulo que estava na tela, sem
 * reamostragem no meio do caminho. A tela pode estar mostrando a foto em
 * terço do tamanho — a conta de converter o arrasto para pixel de origem é
 * uma divisão, e mora aqui.
 *
 * A geometria em si (encaixar na imagem, travar proporção, não virar do
 * avesso) está em `lib/imagem/recorte.ts`, medida por teste.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Maximize2, Plus, Scissors } from 'lucide-react';
import { decodificarImagem } from '@/lib/imagem/decodificar';
import {
  emMilimetros,
  limitar,
  mover,
  naProporcao,
  proporcaoDe,
  proporcional,
  recorteInteiro,
  redimensionar,
  type Alca,
  type Medida,
  type Recorte,
} from '@/lib/imagem/recorte';
import type { LoadedFile } from '@/lib/pdf/engine';
import { cx, formatBytes } from '@/lib/utils';

export type RecorteDeArquivo = Recorte & { id: string };

/** As proporções que a gráfica pede todo dia, mais a livre. */
const PROPORCOES = [
  { valor: 'livre', rotulo: 'Livre' },
  { valor: '3x4', rotulo: '3:4' },
  { valor: '4x3', rotulo: '4:3' },
  { valor: '1x1', rotulo: '1:1' },
  { valor: '2x3', rotulo: '2:3' },
  { valor: '3x2', rotulo: '3:2' },
  { valor: '16x9', rotulo: '16:9' },
];

/** As oito alças, com o canto da tela em que cada uma fica. */
const ALCAS: { alca: Alca; classe: string; cursor: string }[] = [
  { alca: 'nw', classe: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'nwse-resize' },
  { alca: 'n', classe: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'ns-resize' },
  { alca: 'ne', classe: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cursor: 'nesw-resize' },
  { alca: 'e', classe: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { alca: 'se', classe: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2', cursor: 'nwse-resize' },
  { alca: 's', classe: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2', cursor: 'ns-resize' },
  { alca: 'sw', classe: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2', cursor: 'nesw-resize' },
  { alca: 'w', classe: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
];

type Arrasto = {
  tipo: 'mover' | 'alca';
  alca: Alca;
  /** Onde o dedo entrou, em pixels de origem. */
  de: { x: number; y: number };
  base: Recorte;
};

const DPI_DA_CONTA = 300;

const medir = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1)).replace('.', ',');

export function RecorteDaImagem({
  arquivos,
  recortes,
  onRecortes,
  onTrocarArquivo,
}: {
  arquivos: LoadedFile[];
  recortes: RecorteDeArquivo[];
  onRecortes: (recortes: RecorteDeArquivo[]) => void;
  onTrocarArquivo: () => void;
}) {
  const [atual, setAtual] = useState(0);
  const [medidas, setMedidas] = useState<Record<string, Medida>>({});
  const [proporcao, setProporcao] = useState('livre');
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [aplicando, setAplicando] = useState(false);

  const tela = useRef<HTMLCanvasElement | null>(null);
  const area = useRef<HTMLDivElement | null>(null);
  const espacoRef = useRef<HTMLDivElement | null>(null);
  const arrasto = useRef<Arrasto | null>(null);
  const [espaco, setEspaco] = useState({ largura: 0, altura: 0 });

  const arquivo = arquivos[Math.min(atual, arquivos.length - 1)];
  const medida = arquivo ? medidas[arquivo.id] : undefined;
  const recorte = useMemo(
    () => recortes.find((r) => r.id === arquivo?.id),
    [recortes, arquivo?.id],
  );
  const travada = proporcaoDe(proporcao);

  /** Guarda a marcação do arquivo aberto, deixando as dos outros como estão. */
  const guardar = useCallback(
    (novo: Recorte) => {
      if (!arquivo) return;
      const semEste = recortes.filter((r) => r.id !== arquivo.id);
      onRecortes([...semEste, { ...novo, id: arquivo.id }]);
    },
    [arquivo, recortes, onRecortes],
  );

  /*
   * Abre a imagem escolhida e desenha na tela.
   *
   * Uma de cada vez, e o bitmap é fechado no fim: uma fila de trinta fotos de
   * celular aberta de uma vez trava a máquina da loja — é a mesma disciplina
   * do `porArquivo`, do lado das ferramentas.
   */
  useEffect(() => {
    if (!arquivo) return;
    let cancelado = false;
    setErro(null);
    setLendo(true);

    (async () => {
      try {
        const imagem = await decodificarImagem(arquivo);
        try {
          if (cancelado) return;
          const canvas = tela.current;
          if (canvas) {
            canvas.width = imagem.largura;
            canvas.height = imagem.altura;
            canvas.getContext('2d')?.drawImage(imagem.bitmap, 0, 0);
          }
          const tamanho = { largura: imagem.largura, altura: imagem.altura };
          setMedidas((atuais) => ({ ...atuais, [arquivo.id]: tamanho }));

          /*
           * A marcação guardada é encaixada no tamanho de verdade.
           *
           * Ela pode ter vindo de "usar em todas" antes desta imagem ter sido
           * aberta: um retângulo de 1200x1200 numa foto de 900 de altura. Sem
           * este encaixe, a tela mostraria uma medida que o corte não entrega.
           */
          const guardada = recortes.find((r) => r.id === arquivo.id);
          const valida = guardada ? limitar(guardada, tamanho) : recorteInteiro(tamanho);
          const mudou =
            !guardada ||
            valida.x !== guardada.x ||
            valida.y !== guardada.y ||
            valida.largura !== guardada.largura ||
            valida.altura !== guardada.altura;
          if (mudou) {
            onRecortes([...recortes.filter((r) => r.id !== arquivo.id), { ...valida, id: arquivo.id }]);
          }
        } finally {
          imagem.bitmap.close();
        }
      } catch (falha) {
        if (!cancelado) setErro(falha instanceof Error ? falha.message : 'Não consegui abrir esta imagem.');
      } finally {
        if (!cancelado) setLendo(false);
      }
    })();

    return () => {
      cancelado = true;
    };
    // De propósito só pelo arquivo: `recortes` muda a cada arrasto, e relê a
    // imagem inteira a cada pixel arrastado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arquivo?.id]);

  /*
   * Quanto espaço a imagem tem para ocupar.
   *
   * Medido, e não deixado para o CSS: com `max-height` numa imagem de proporção
   * alta, o navegador encolhe a figura dentro de uma caixa que continua larga —
   * e a marcação, que é desenhada em porcentagem da caixa, deixa de cair em
   * cima da foto. Medindo, a caixa tem o tamanho exato da imagem na tela.
   */
  useEffect(() => {
    const alvo = espacoRef.current;
    if (!alvo) return;
    const medirEspaco = () =>
      setEspaco((atual) => {
        const largura = alvo.clientWidth;
        const altura = Math.max(240, window.innerHeight * 0.62);
        return atual.largura === largura && atual.altura === altura ? atual : { largura, altura };
      });

    medirEspaco();
    // E de novo no quadro seguinte: a primeira medida pode cair antes de o
    // navegador ter desenhado o painel, e aí a caixa ainda mede zero — a
    // imagem ficaria parada num quadradinho até alguém mexer na janela.
    const quadro = requestAnimationFrame(medirEspaco);
    const observador = new ResizeObserver(medirEspaco);
    observador.observe(alvo);
    window.addEventListener('resize', medirEspaco);
    return () => {
      cancelAnimationFrame(quadro);
      observador.disconnect();
      window.removeEventListener('resize', medirEspaco);
    };
  }, [arquivo?.id]);

  /** O tamanho com que a imagem aparece, cabendo inteira no espaço. */
  const naTela = useMemo(() => {
    if (!medida || espaco.largura === 0) return null;
    // Até o dobro para imagem pequena: menos que isso vira selo de correio na
    // tela, e marcar um pedaço de um selo não dá.
    const fator = Math.min(espaco.largura / medida.largura, espaco.altura / medida.altura, 2);
    return { largura: medida.largura * fator, altura: medida.altura * fator };
  }, [medida, espaco]);

  /** De pixel de tela para pixel da imagem: é a régua entre os dois mundos. */
  const escala = useCallback(() => {
    const caixa = area.current?.getBoundingClientRect();
    if (!caixa || !medida || caixa.width === 0) return 1;
    return medida.largura / caixa.width;
  }, [medida]);

  const comecar = useCallback(
    (evento: React.PointerEvent, tipo: Arrasto['tipo'], alca: Alca) => {
      if (!medida || !recorte) return;
      evento.preventDefault();
      evento.stopPropagation();
      (evento.currentTarget as HTMLElement).setPointerCapture(evento.pointerId);
      const razao = escala();
      arrasto.current = {
        tipo,
        alca,
        de: { x: evento.clientX * razao, y: evento.clientY * razao },
        base: recorte,
      };
    },
    [medida, recorte, escala],
  );

  /** Clicar no vazio começa uma marcação nova, já puxando o canto. */
  const comecarDoZero = useCallback(
    (evento: React.PointerEvent) => {
      if (!medida) return;
      const caixa = area.current?.getBoundingClientRect();
      if (!caixa) return;
      evento.preventDefault();
      (evento.currentTarget as HTMLElement).setPointerCapture(evento.pointerId);
      const razao = escala();
      const x = (evento.clientX - caixa.left) * razao;
      const y = (evento.clientY - caixa.top) * razao;
      const base = limitar({ x, y, largura: 1, altura: 1 }, medida, travada);
      arrasto.current = { tipo: 'alca', alca: 'se', de: { x: evento.clientX * razao, y: evento.clientY * razao }, base };
      guardar(base);
    },
    [medida, escala, travada, guardar],
  );

  const arrastar = useCallback(
    (evento: React.PointerEvent) => {
      const atual = arrasto.current;
      if (!atual || !medida) return;
      const razao = escala();
      const dx = evento.clientX * razao - atual.de.x;
      const dy = evento.clientY * razao - atual.de.y;
      guardar(
        atual.tipo === 'mover'
          ? mover(atual.base, dx, dy, medida)
          : redimensionar(atual.base, atual.alca, dx, dy, medida, travada),
      );
    },
    [medida, escala, travada, guardar],
  );

  const soltar = useCallback(() => {
    arrasto.current = null;
  }, []);

  const trocarProporcao = useCallback(
    (escolha: string) => {
      setProporcao(escolha);
      const razao = proporcaoDe(escolha);
      if (!razao || !medida || !recorte) return;
      // Encaixa o que já estava marcado na proporção nova, pelo centro dele.
      const centroX = recorte.x + recorte.largura / 2;
      const centroY = recorte.y + recorte.altura / 2;
      const largura = Math.min(recorte.largura, recorte.altura * razao);
      const altura = largura / razao;
      guardar(limitar({ x: centroX - largura / 2, y: centroY - altura / 2, largura, altura }, medida, razao));
    },
    [medida, recorte, guardar],
  );

  /**
   * A mesma marcação nas outras imagens da fila, em proporção ao tamanho.
   *
   * Abre as que ainda não foram abertas, só para saber a medida delas: o
   * mesmo retângulo em pixels não serve para uma foto de outro tamanho, e
   * copiá-lo cru daria uma marcação maior que a imagem.
   */
  const usarEmTodas = useCallback(async () => {
    if (!medida || !recorte || !arquivo) return;
    setAplicando(true);
    const tamanhos = { ...medidas };
    for (const outro of arquivos) {
      if (outro.id === arquivo.id || tamanhos[outro.id]) continue;
      try {
        const imagem = await decodificarImagem(outro);
        tamanhos[outro.id] = { largura: imagem.largura, altura: imagem.altura };
        imagem.bitmap.close();
      } catch {
        // Uma que não abre fica com o que já tinha; as outras seguem.
      }
    }
    setMedidas(tamanhos);
    onRecortes(
      arquivos.map((outro) => {
        if (outro.id === arquivo.id) return { ...recorte, id: outro.id };
        const tamanho = tamanhos[outro.id];
        return tamanho
          ? { ...proporcional(recorte, medida, tamanho), id: outro.id }
          : (recortes.find((r) => r.id === outro.id) ?? { ...recorte, id: outro.id });
      }),
    );
    setAplicando(false);
  }, [arquivos, arquivo, medida, medidas, recorte, recortes, onRecortes]);

  if (!arquivo) return null;

  const porcento = (valor: number, total: number) => `${(valor / total) * 100}%`;
  const caixa =
    medida && recorte
      ? {
          left: porcento(recorte.x, medida.largura),
          top: porcento(recorte.y, medida.altura),
          width: porcento(recorte.largura, medida.largura),
          height: porcento(recorte.altura, medida.altura),
        }
      : null;

  return (
    <div className="card min-w-0 space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Scissors className="h-4 w-4 shrink-0 text-muted" />
        <p className="text-[13px] font-medium">Marque o pedaço que fica</p>
        <button type="button" onClick={onTrocarArquivo} className="btn-ghost ml-auto shrink-0 px-3 py-2 text-xs">
          <Plus className="h-3.5 w-3.5" /> Trocar arquivo
        </button>
      </div>

      {/* A imagem, com a marcação por cima. */}
      <div className="rounded-xl bg-elevated p-2">
        <div ref={espacoRef} className="flex justify-center">
        <div
          ref={area}
          className="relative select-none touch-none"
          style={naTela ? { width: naTela.largura, height: naTela.altura } : { height: 240 }}
          onPointerDown={comecarDoZero}
          onPointerMove={arrastar}
          onPointerUp={soltar}
          onPointerCancel={soltar}
        >
          <canvas ref={tela} className="block h-full w-full" />

          {caixa && (
            <>
              {/* O escuro em volta: quatro faixas, para o miolo ficar limpo. */}
              <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/55" style={{ height: caixa.top }} />
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55"
                style={{ top: `calc(${caixa.top} + ${caixa.height})` }}
              />
              <div
                className="pointer-events-none absolute left-0 bg-black/55"
                style={{ top: caixa.top, height: caixa.height, width: caixa.left }}
              />
              <div
                className="pointer-events-none absolute right-0 bg-black/55"
                style={{ top: caixa.top, height: caixa.height, left: `calc(${caixa.left} + ${caixa.width})` }}
              />

              <div
                className="absolute cursor-move border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                style={caixa}
                onPointerDown={(e) => comecar(e, 'mover', 'se')}
                onPointerMove={arrastar}
                onPointerUp={soltar}
                onPointerCancel={soltar}
              >
                {/* Os terços: a régua que todo mundo usa para enquadrar. */}
                <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <div key={n} className="border border-white/25" />
                  ))}
                </div>
                {ALCAS.map(({ alca, classe, cursor }) => (
                  <span
                    key={alca}
                    role="presentation"
                    className={cx('absolute h-3.5 w-3.5 rounded-sm border-2 border-white bg-black/70', classe)}
                    style={{ cursor }}
                    onPointerDown={(e) => comecar(e, 'alca', alca)}
                    onPointerMove={arrastar}
                    onPointerUp={soltar}
                    onPointerCancel={soltar}
                  />
                ))}
              </div>
            </>
          )}

          {lendo && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-surface/70 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Abrindo a imagem...
            </div>
          )}
        </div>
        </div>
      </div>

      {erro && <p className="text-[13px] text-rose-400">{erro}</p>}

      {/* Proporção e atalhos. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PROPORCOES.map((opcao) => (
          <button
            key={opcao.valor}
            type="button"
            onClick={() => trocarProporcao(opcao.valor)}
            className={cx(
              'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              proporcao === opcao.valor ? 'border-transparent bg-ink text-surface' : 'text-muted hover:bg-elevated',
            )}
          >
            {opcao.rotulo}
          </button>
        ))}
        <button
          type="button"
          onClick={() => medida && guardar(travada ? naProporcao(medida, travada) : recorteInteiro(medida))}
          className="btn-ghost ml-auto px-3 py-1.5 text-xs"
        >
          <Maximize2 className="h-3.5 w-3.5" /> {travada ? 'Maior nessa proporção' : 'Imagem inteira'}
        </button>
      </div>

      {/* O que vai sair, medido. */}
      <div className="rounded-xl border border-dashed px-3 py-2.5 text-[13px]">
        {medida && recorte ? (
          <>
            <p>
              Sai <strong>{recorte.largura} × {recorte.altura} px</strong>
              <span className="text-muted">
                {' '}— {medir(emMilimetros(recorte.largura, DPI_DA_CONTA))} × {medir(emMilimetros(recorte.altura, DPI_DA_CONTA))} mm a {DPI_DA_CONTA} DPI
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted">
              De {medida.largura} × {medida.altura} px · {formatBytes(arquivo.size)} · começa em x {recorte.x}, y{' '}
              {recorte.y}
            </p>
          </>
        ) : (
          <p className="text-muted">Lendo a imagem...</p>
        )}
      </div>

      {/* A fila, quando é mais de uma foto. */}
      {arquivos.length > 1 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {arquivos.map((outro, indice) => (
              <button
                key={outro.id}
                type="button"
                onClick={() => setAtual(indice)}
                title={outro.name}
                className={cx(
                  'max-w-[11rem] truncate rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                  indice === atual ? 'border-transparent bg-ink text-surface' : 'text-muted hover:bg-elevated',
                )}
              >
                {indice + 1}. {outro.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void usarEmTodas()}
            disabled={aplicando}
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            {aplicando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {arquivos.length === 2
              ? 'Usar este recorte na outra imagem'
              : `Usar este recorte nas outras ${arquivos.length - 1}`}
          </button>
          <p className="text-xs leading-relaxed text-muted">
            Cada imagem guarda a sua marcação. As que você não mexer saem inteiras.
          </p>
        </div>
      )}
    </div>
  );
}
