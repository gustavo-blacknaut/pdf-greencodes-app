'use client';

/**
 * A prévia da impressão: abre o documento, desenha a página escolhida e
 * aplica os ajustes de imagem por cima.
 *
 * O desenho cru fica guardado num canvas escondido, e o que aparece na tela é
 * uma cópia dele com os ajustes. É isso que faz o controle de brilho responder
 * na hora: mexer no controle não abre o PDF de novo nem redesenha a página —
 * só repinta a cópia, que é a mesma conta que a folha do papel usa.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPdfJs } from '@/lib/pdf/lazy';
import { ajustarCanvas } from '@/lib/impressao/folha';
import { type Ajustes } from '@/lib/impressao/ajustes';

type Documento = { numPages: number; getPage: (n: number) => Promise<any>; destroy: () => Promise<void> };
type Medida = { largura: number; altura: number };

export function usePrevia({
  saida,
  zoom,
  larguraDisponivel,
  ajustes,
  telaRef,
  desenhaFolhaRef,
}: {
  saida: { blob: Blob; paginas: number } | null;
  zoom: number;
  larguraDisponivel: number;
  ajustes: Ajustes;
  telaRef: React.RefObject<HTMLCanvasElement | null>;
  /** Quando a folha é desenhada, quem manda no tamanho de fora é o layout. */
  desenhaFolhaRef: React.RefObject<boolean>;
}) {
  const [pagina, setPagina] = useState(1);
  const [renderizando, setRenderizando] = useState(false);
  const [escalaAtual, setEscalaAtual] = useState(1);
  const [arteMm, setArteMm] = useState<Medida | null>(null);
  const [docPronto, setDocPronto] = useState(0);

  const docRef = useRef<Documento | null>(null);
  const tarefaRef = useRef<{ cancel: () => void; promise: Promise<void> } | null>(null);
  const cruRef = useRef<HTMLCanvasElement | null>(null);
  const arteRef = useRef<Medida | null>(null);

  /** Copia o desenho cru para a tela e aplica os ajustes por cima. */
  const repintar = useCallback(() => {
    const tela = telaRef.current;
    const cru = cruRef.current;
    if (!tela || !cru?.width || !cru.height) return;
    tela.width = cru.width;
    tela.height = cru.height;
    const pincel = tela.getContext('2d');
    if (!pincel) return;
    pincel.drawImage(cru, 0, 0);
    // A resolução deste desenho, em pixels por milímetro: é ela que dá à
    // nitidez o mesmo raio que ela vai ter no papel.
    const mm = arteRef.current?.largura;
    if (mm) ajustarCanvas(tela, ajustes, cru.width / mm);
  }, [ajustes, telaRef]);

  // Abre o documento escolhido uma vez e guarda a referência.
  useEffect(() => {
    if (!saida) {
      void docRef.current?.destroy();
      docRef.current = null;
      return;
    }
    let vivo = true;
    void (async () => {
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await saida.blob.arrayBuffer()) }).promise;
      if (!vivo) {
        await doc.destroy();
        return;
      }
      docRef.current = doc;
      setPagina(1);
      setDocPronto((n) => n + 1);
    })();
    return () => {
      vivo = false;
    };
  }, [saida]);

  /**
   * Desenha a página escolhida.
   *
   * A nitidez vem de desenhar na densidade real da tela: antes o canvas saía
   * em 1x e o texto ficava borrado em qualquer monitor moderno. O fator é
   * limitado a 2, e a área a 6 megapixels, para a conta não explodir em
   * máquina fraca nem em zoom alto.
   */
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !larguraDisponivel) return;
    let vivo = true;

    void (async () => {
      setRenderizando(true);
      try {
        const p = await doc.getPage(Math.min(pagina, doc.numPages));
        const natural = p.getViewport({ scale: 1 });
        // Escala 1 do pdf.js é ponto tipográfico: 72 por polegada.
        const medida = { largura: (natural.width / 72) * 25.4, altura: (natural.height / 72) * 25.4 };
        arteRef.current = medida;
        setArteMm(medida);

        // Quanto a página ocupa na tela, em pixels de CSS.
        const ajuste = larguraDisponivel / natural.width;
        const escalaCss = zoom > 0 ? zoom : Math.min(ajuste, 2);
        setEscalaAtual(escalaCss);

        const densidade = Math.min(window.devicePixelRatio || 1, 2);
        let escala = escalaCss * densidade;
        const megapixels = (natural.width * escala * natural.height * escala) / 1_000_000;
        if (megapixels > 6) escala *= Math.sqrt(6 / megapixels);

        const viewport = p.getViewport({ scale: escala });
        const tela = telaRef.current;
        if (!tela || !vivo) return;

        const cru = (cruRef.current ??= document.createElement('canvas'));
        cru.width = Math.floor(viewport.width);
        cru.height = Math.floor(viewport.height);
        /*
         * O canvas é grande por dentro e do tamanho certo por fora: é isso
         * que dá texto nítido em vez de ampliado. Com a folha desenhada, quem
         * manda no tamanho de fora é o layout — o canvas é esticado para
         * dentro da caixa da arte, na posição e na escala que vão para o papel.
         */
        if (!desenhaFolhaRef.current) {
          tela.style.width = `${Math.round(natural.width * escalaCss)}px`;
          tela.style.height = `${Math.round(natural.height * escalaCss)}px`;
        }

        const contexto = cru.getContext('2d');
        if (contexto) {
          /*
           * Clicar rápido em "próxima" empilha desenhos: o anterior é
           * cortado. E é preciso **esperar** o corte terminar antes de pedir
           * o próximo: o pdf.js guarda um desenho por página, e pedir outro
           * enquanto o primeiro ainda está sendo cancelado deixa o novo
           * pendente para sempre — a prévia ficava em branco sem erro nenhum.
           */
          const anterior = tarefaRef.current;
          if (anterior) {
            anterior.cancel();
            await anterior.promise.catch(() => {});
          }
          if (!vivo) return;
          contexto.fillStyle = '#ffffff';
          contexto.fillRect(0, 0, cru.width, cru.height);
          const tarefa = p.render({ canvasContext: contexto, viewport });
          tarefaRef.current = tarefa;
          await tarefa.promise;
          tarefaRef.current = null;
          if (vivo) repintar();
        }
        p.cleanup();
      } catch {
        /* cancelamento de desenho não é erro para mostrar */
      } finally {
        if (vivo) setRenderizando(false);
      }
    })();

    return () => {
      vivo = false;
    };
    // `repintar` muda a cada ajuste, e redesenhar a página a cada milímetro de
    // controle seria lento: quem cuida disso é o efeito abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, docPronto, zoom, larguraDisponivel]);

  // Mexeu num controle: só repinta.
  useEffect(() => {
    repintar();
  }, [repintar]);

  return { pagina, setPagina, renderizando, escalaAtual, arteMm, setArteMm, totalDoDoc: docRef.current?.numPages ?? 0 };
}
