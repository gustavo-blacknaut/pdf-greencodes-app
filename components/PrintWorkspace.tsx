'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Plus,
  Printer,
  X,
  SlidersHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Dropzone } from './Dropzone';
import { FilaDeArquivos } from './impressao/FilaDeArquivos';
import {
  ACEITA,
  OPCOES_PADRAO,
  conversaoPara,
  esquecerOpcoes,
  filaTerminada,
  guardarOpcoes,
  lerOpcoesSalvas,
  proximoId,
} from './impressao/fila';
import { AjustesDaImagem } from './impressao/AjustesDaImagem';
import { folhaNaTela as calcularFolhaNaTela } from './impressao/folhaNaTela';
import { OpcoesDeImpressao } from './impressao/OpcoesDeImpressao';
import { PreviaDaPagina, type FolhaNaTela } from './impressao/PreviaDaPagina';
import type { EstadoDoItem, ItemFila } from './impressao/tipos';
import { usePrevia } from './impressao/usePrevia';
import { AJUSTES_NEUTROS, ajustesDe, type Ajustes } from '@/lib/impressao/ajustes';
import { avisoDaFolha } from '@/lib/impressao/folha';
import { atividade } from '@/lib/atividade';
import { vault } from '@/lib/ephemeral';
import { inspectFile, runOperation } from '@/lib/pdf/engine';
import { loadPdfJs, loadPdfLib } from '@/lib/pdf/lazy';
import { validarFila } from '@/lib/pdf/guards';
import {
  aoSoltarArquivos,
  estaNoAplicativo,
  abrirPreferenciasDaImpressora,
  imprimirArquivo,
  lerArquivoEscolhido,
  listarImpressoras,
  materializar,
  montagemDe,
  registrarUso,
  tamanhoDe,
  type Impressora,
  type OpcoesImpressao,
} from '@/lib/desktop';
import { cx, formatBytes, replaceExtension } from '@/lib/utils';

export function PrintWorkspace() {
  const parametros = useSearchParams();
  const noAppPelaRota = usePathname().startsWith('/app');

  const [fila, setFila] = useState<ItemFila[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  // 0 = ajustar à largura disponível; acima disso é zoom fixo (1 = 100%).
  const [zoom, setZoom] = useState(0);
  const [larguraDisponivel, setLarguraDisponivel] = useState(0);
  const [alturaDisponivel, setAlturaDisponivel] = useState(0);

  // 1 = uma página por folha, sem montagem. Acima disso o documento é
  // remontado antes da prévia, para o que aparece ser o que sai impresso.
  // Vazio = todas. Aceita "1-5, 8, 11-" como a ferramenta de dividir.
  const [intervalo, setIntervalo] = useState('');
  const [porFolha, setPorFolha] = useState(1);
  const [montado, setMontado] = useState<{
    id: string;
    porFolha: number;
    intervalo: string;
    blob: Blob;
    paginas: number;
  } | null>(null);
  const [montando, setMontando] = useState(false);

  // 0 = manda o arquivo inteiro de uma vez. Acima disso ele é fatiado e vai
  // em lotes, na ordem.
  const [lote, setLote] = useState(0);

  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [noApp, setNoApp] = useState(false);
  const [impressoras, setImpressoras] = useState<Impressora[] | null>(null);
  const [opcoes, setOpcoes] = useState<OpcoesImpressao>(OPCOES_PADRAO);

  /*
   * O que vai para a folha: as opções da pessoa mais a beirada da impressora
   * escolhida, que só o driver sabe. A prévia e a impressão usam o mesmo.
   */
  const bordaDaImpressora = impressoras?.find((i) => i.nome === opcoes.impressora)?.margens;
  const item = fila.find((i) => i.id === selecionado) ?? null;
  /*
   * Os ajustes são de cada arquivo — cada foto precisa dos seus. O "preto e
   * branco" da fila entra junto: na prévia e no papel ele é o mesmo cinza.
   */
  const ajustes = useMemo<Ajustes>(
    () => ajustesDe({ ...item?.ajustes, cinza: item?.ajustes?.cinza || opcoes.colorido === false }),
    [item?.ajustes, opcoes.colorido],
  );
  const opcoesDaFolha = useMemo<OpcoesImpressao>(
    () => ({ ...opcoes, bordaMm: bordaDaImpressora }),
    [opcoes, bordaDaImpressora],
  );
  const montagem = useMemo(() => ({ ...montagemDe(opcoesDaFolha), ajustes }), [opcoesDaFolha, ajustes]);

  const [imprimindo, setImprimindo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const telaRef = useRef<HTMLCanvasElement>(null);
  const molduraRef = useRef<HTMLDivElement>(null);
  const convertendoRef = useRef(false);
  /*
   * O desenho da folha, visto de dentro do efeito que renderiza.
   *
   * O efeito não pode depender de `folhaNaTela`: ela muda a cada ajuste, e o
   * documento seria redesenhado a cada clique numa seta de milímetro. A ref
   * dá o valor de agora sem entrar na lista de dependências.
   */
  const desenhaFolhaRef = useRef(false);

  /** O que vale para prévia e impressão: o montado, quando há montagem. */
  // Pelas partes, e não pelo objeto: a fila inteira é reconstruída a cada
  // mudança de estado, e um item novo com o mesmo conteúdo reabria o
  // documento no meio do desenho — a prévia ficava em branco.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saida = useMemo(() => paraSaida(item), [item?.id, item?.blob, montado, porFolha, intervalo]);

  const { pagina, setPagina, renderizando, escalaAtual, arteMm } = usePrevia({
    saida,
    zoom,
    larguraDisponivel,
    ajustes,
    telaRef,
    desenhaFolhaRef,
  });

  /**
   * A folha e a arte em cima dela, em pixels de tela — com a orientação que a
   * página pede, a beirada que a impressora não alcança e o cinza do preto e
   * branco. Quem olha confere ali o que vai sair, antes de gastar papel.
   */
  const folhaNaTela = useMemo<FolhaNaTela | null>(
    () =>
      arteMm && larguraDisponivel
        ? calcularFolhaNaTela(arteMm, montagem, { largura: larguraDisponivel, altura: alturaDisponivel }, zoom)
        : null,
    [arteMm, larguraDisponivel, alturaDisponivel, zoom, montagem],
  );
  desenhaFolhaRef.current = Boolean(folhaNaTela);

  /** O aviso de que parte da arte não vai sair impressa. */
  const avisoDeSobra = useMemo(() => (arteMm ? avisoDaFolha(arteMm, montagem) : null), [arteMm, montagem]);

  useEffect(() => {
    setNoApp(estaNoAplicativo());
    setOpcoes(lerOpcoesSalvas());
    void listarImpressoras().then((lista) => {
      setImpressoras(lista);
      setOpcoes((atual) => {
        const existe = lista.some((i) => i.nome === atual.impressora);
        return { ...atual, impressora: existe ? atual.impressora : (lista.find((i) => i.padrao) ?? lista[0])?.nome };
      });
    });
  }, []);

  // A fila é lida por ref porque quem chama pode ser a inscrição no arrastar,
  // montada uma vez só.
  const filaRef = useRef(fila);
  filaRef.current = fila;

  const adicionar = useCallback((arquivos: (File | Blob)[], nomes?: string[]) => {
    setErroGeral(null);
    const novos = arquivos.map((arquivo, i) => {
      const nomeOriginal = nomes?.[i] ?? (arquivo instanceof File ? arquivo.name : 'documento.pdf');
      return {
        id: proximoId(),
        nome: replaceExtension(nomeOriginal, 'pdf'),
        origem: arquivo,
        nomeOriginal,
        blob: null,
        paginas: 0,
        estado: 'esperando' as EstadoDoItem,
      };
    });
    // Depois de imprimir, o arquivo novo começa outra fila: o que já saiu
    // não vai de novo, e as páginas escolhidas para o documento anterior não
    // valem para este.
    if (filaTerminada(filaRef.current)) {
      setIntervalo('');
      setAviso(null);
    }
    setFila((atual) => (filaTerminada(atual) ? novos : [...atual, ...novos]));
  }, []);

  /**
   * O que chega do seletor ou arrastado para a janela.
   *
   * A prévia desenha a página, então precisa dos bytes: o PDF grande que o
   * seletor deixou no disco é lido aqui.
   */
  const receberArquivos = useCallback(
    async (arquivos: File[]) => {
      try {
        const ficam = filaTerminada(filaRef.current) ? [] : filaRef.current;
        validarFila(
          arquivos.map((a) => ({ name: a.name, size: tamanhoDe(a) })),
          ficam.map((i) => ({ size: i.origem.size })),
        );
        adicionar(await Promise.all(arquivos.map(materializar)));
      } catch (e) {
        setErroGeral(e instanceof Error ? e.message : 'Arquivos recusados.');
      }
    },
    [adicionar],
  );

  // Soltar na janela do aplicativo: vem o caminho, como no seletor.
  useEffect(
    () =>
      aoSoltarArquivos((lista) => {
        void (async () => {
          try {
            receberArquivos(await Promise.all(lista.map(lerArquivoEscolhido)));
          } catch (e) {
            setErroGeral(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
          }
        })();
      }),
    [receberArquivos],
  );

  /** Arquivos vindos de outra ferramenta, guardados no cofre. */
  useEffect(() => {
    const fonte = parametros.get('fonte');
    if (!fonte) return;
    const entrada = vault.get(fonte);
    if (!entrada?.files.length) {
      setErroGeral('O resultado expirou ou já foi apagado da memória. Escolha os arquivos de novo.');
      return;
    }
    const alvo = parametros.get('arquivo');
    const escolhidos = alvo ? entrada.files.filter((f) => f.name === alvo) : entrada.files;
    const lista = escolhidos.length ? escolhidos : entrada.files;
    adicionar(
      lista.map((f) => f.blob),
      lista.map((f) => f.name),
    );
    // Só na montagem: depois disso quem manda é a fila na tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Converte um item por vez.
   *
   * Em série de propósito: converter cinco Words de uma vez em máquina fraca
   * trava a aba. Cada item vira PDF, conta as páginas e só então o próximo
   * entra.
   */
  useEffect(() => {
    if (convertendoRef.current) return;
    const alvo = fila.find((item) => item.estado === 'esperando');
    if (!alvo) return;

    convertendoRef.current = true;
    const atualizar = (mudanca: Partial<ItemFila>) =>
      setFila((atual) => atual.map((item) => (item.id === alvo.id ? { ...item, ...mudanca } : item)));

    void (async () => {
      atualizar({ estado: 'convertendo' });
      const tarefaConv = atividade.abrir(`Preparar ${alvo.nomeOriginal}`, 'ferramenta');
      try {
        let pdf = alvo.origem;
        let nomeFinal = alvo.nomeOriginal;

        const operacao = conversaoPara(alvo.nomeOriginal);
        if (operacao) {
          const arquivo =
            alvo.origem instanceof File ? alvo.origem : new File([alvo.origem], alvo.nomeOriginal);
          const carregado = await inspectFile(arquivo, alvo.id);
          if (carregado.error) throw new Error(carregado.error);
          const resultado = await runOperation(operacao, {
            files: [carregado],
            options: {},
            onProgress: () => {},
          });
          pdf = resultado.files[0].blob;
          // O nome da conversão é genérico ("imagens.pdf"): na fila o que
          // importa é reconhecer de qual arquivo veio.
          nomeFinal = replaceExtension(alvo.nomeOriginal, 'pdf');
        }

        const pdfjs = await loadPdfJs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await pdf.arrayBuffer()) }).promise;
        const paginas = doc.numPages;
        await doc.destroy();

        atualizar({ estado: 'pronto', blob: pdf, paginas, nome: nomeFinal });
        atividade.fechar(tarefaConv, 'concluida', `${paginas} página(s)`);
      } catch (e) {
        atualizar({ estado: 'erro', erro: e instanceof Error ? e.message : 'Não foi possível preparar o arquivo.' });
        atividade.fechar(tarefaConv, 'erro', e instanceof Error ? e.message : undefined);
      } finally {
        convertendoRef.current = false;
        // Empurra o laço: o próximo "esperando" entra na rodada seguinte.
        setFila((atual) => [...atual]);
      }
    })();
  }, [fila]);

  // O primeiro que ficar pronto vira a prévia, se ainda não há escolhido.
  useEffect(() => {
    if (selecionado && fila.some((i) => i.id === selecionado && i.estado !== 'erro')) return;
    const primeiro = fila.find((i) => i.blob);
    setSelecionado(primeiro?.id ?? null);
  }, [fila, selecionado]);

  /** O que vale para prévia e impressão: o montado, quando há montagem. */
  function paraSaida(alvo: ItemFila | null): { blob: Blob; paginas: number } | null {
    if (!alvo?.blob) return null;
    if (
      montado &&
      montado.id === alvo.id &&
      montado.porFolha === porFolha &&
      montado.intervalo === intervalo
    ) {
      return { blob: montado.blob, paginas: montado.paginas };
    }
    // Enquanto a montagem não termina, não vale desenhar o original: a
    // prévia mostraria uma coisa e a impressora sairia com outra.
    // Enquanto o preparo não termina, não vale desenhar o original: a prévia
    // mostraria uma coisa e a impressora sairia com outra.
    return porFolha > 1 || intervalo.trim() ? null : { blob: alvo.blob, paginas: alvo.paginas };
  }

  /**
   * Prepara o que vai sair: primeiro escolhe as páginas, depois monta as
   * folhas.
   *
   * Nessa ordem, e não na contrária: escolher "1-4" com 4 por folha tem que
   * dar uma folha com as quatro primeiras páginas, não a primeira folha de um
   * documento já montado.
   *
   * O preparo acontece antes de desenhar, e não na hora de imprimir, para a
   * prévia mostrar o que sai da impressora.
   */
  useEffect(() => {
    const semPreparo = porFolha <= 1 && !intervalo.trim();
    if (!item?.blob || semPreparo) {
      setMontado(null);
      return;
    }
    if (montado?.id === item.id && montado.porFolha === porFolha && montado.intervalo === intervalo) return;

    let vivo = true;
    void (async () => {
      setMontando(true);
      try {
        const { blob, paginas } = await prepararSaida(item, porFolha, intervalo);
        if (!vivo) return;
        setMontado({ id: item.id, porFolha, intervalo, blob, paginas });
        setErroGeral(null);
      } catch (e) {
        if (!vivo) return;
        setMontado(null);
        setErroGeral(e instanceof Error ? e.message : 'Não foi possível preparar as páginas.');
      } finally {
        if (vivo) setMontando(false);
      }
    })();

    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.blob, porFolha, intervalo]);

  // A prévia acompanha o tamanho da janela: sem isso ela fica pequena no
  // monitor grande e estourada no pequeno.
  useEffect(() => {
    const moldura = molduraRef.current;
    if (!moldura) return;
    const medir = () => {
      // Sem o recuo da moldura: medir com ele deixava a folha 32 px mais
      // larga que o espaço, e a prévia "ajustada" rolava de lado.
      const estilo = getComputedStyle(moldura);
      const lados = parseFloat(estilo.paddingLeft) + parseFloat(estilo.paddingRight);
      const cimaBaixo = parseFloat(estilo.paddingTop) + parseFloat(estilo.paddingBottom);
      setLarguraDisponivel(Math.max(0, moldura.clientWidth - lados));
      // A moldura cresce até 70% da janela: a folha inteira cabe nisso.
      setAlturaDisponivel(Math.max(0, window.innerHeight * 0.7 - cimaBaixo));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(moldura);
    window.addEventListener('resize', medir);
    return () => {
      observador.disconnect();
      window.removeEventListener('resize', medir);
    };
  }, [item?.id]);

  function mudar<K extends keyof OpcoesImpressao>(chave: K, valor: OpcoesImpressao[K]) {
    setOpcoes((atual) => ({ ...atual, [chave]: valor }));
  }

  function remover(id: string) {
    setFila((atual) => atual.filter((i) => i.id !== id));
  }

  /** Os ajustes são de cada arquivo: mexer num não mexe no outro. */
  function mudarAjustes(id: string, novos: Ajustes) {
    setFila((atual) => atual.map((i) => (i.id === id ? { ...i, ajustes: novos } : i)));
  }

  /** Mesma foto tirada no mesmo lugar: o que serviu para uma serve para as outras. */
  function aplicarAjustesEmTodos(id: string) {
    setFila((atual) => {
      const modelo = atual.find((i) => i.id === id)?.ajustes ?? AJUSTES_NEUTROS;
      return atual.map((i) => (i.blob ? { ...i, ajustes: { ...modelo } } : i));
    });
  }

  /**
   * Fatia um PDF em blocos de N páginas, na ordem.
   *
   * Documento grande num único trabalho é o que trava fila de impressora em
   * rede de 100 Mbps: o spool recebe dezenas de megabytes de uma vez e a
   * impressora fica sem resposta até digerir tudo. Em blocos, cada um cabe na
   * memória dela e a próxima parte só sai depois que a anterior entrou.
   */
  async function fatiar(blob: Blob, paginas: number, tamanho: number): Promise<Blob[]> {
    if (tamanho <= 0 || paginas <= tamanho) return [blob];

    const { PDFDocument } = await loadPdfLib();
    const origem = await PDFDocument.load(await blob.arrayBuffer());
    const partes: Blob[] = [];

    for (let inicio = 0; inicio < paginas; inicio += tamanho) {
      const indices = Array.from(
        { length: Math.min(tamanho, paginas - inicio) },
        (_, k) => inicio + k,
      );
      const parte = await PDFDocument.create();
      for (const pagina of await parte.copyPages(origem, indices)) parte.addPage(pagina);
      const bytes = await parte.save({ useObjectStreams: true });
      partes.push(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }));
    }
    return partes;
  }

  /**
   * Manda a fila inteira, um arquivo por vez, e cada arquivo em lotes quando
   * está configurado assim. A ordem é sempre a da fila e a das páginas.
   *
   * Erro num item não derruba o resto: ele fica marcado e a fila segue.
   */
  async function imprimirTudo() {
    const prontos = aImprimir;
    if (!prontos.length) return;

    setAviso(null);
    setErroGeral(null);
    guardarOpcoes(opcoes);

    let enviados = 0;
    let trabalhos = 0;
    let cancelou = false;

    for (const alvo of prontos) {
      setImprimindo(alvo.id);
      const tarefa = atividade.abrir(`Imprimir ${alvo.nomeOriginal}`, 'impressao');
      atividade.registrar(
        tarefa,
        `${opcoes.impressora ?? 'impressora padrão'} · ${opcoes.papel} · ${montagem.dpi} DPI · ${opcoes.colorido === false ? 'preto e branco' : 'colorido'}`,
        0,
      );
      // A montagem da prévia só existe para o arquivo que está nela. Os outros
      // da fila são preparados aqui, com as mesmas páginas e o mesmo arranjo —
      // antes eles eram pulados em silêncio.
      let saida = paraSaida(alvo);
      if (!saida) {
        try {
          saida = await prepararSaida(alvo, porFolha, intervalo);
        } catch (e) {
          const erro = e instanceof Error ? e.message : 'Não foi possível preparar as páginas.';
          setFila((atual) => atual.map((i) => (i.id === alvo.id ? { ...i, estado: 'erro', erro } : i)));
          atividade.fechar(tarefa, 'erro', erro);
          continue;
        }
      }

      let falhou: string | undefined;
      const partes = await fatiar(saida.blob, saida.paginas, lote);

      for (let n = 0; n < partes.length; n += 1) {
        const nome = partes.length > 1 ? alvo.nome.replace(/.pdf$/i, `-parte${n + 1}.pdf`) : alvo.nome;
        const paraEste = { ...opcoesDaFolha, ajustes: ajustesDe(alvo.ajustes) };
        const r = await imprimirArquivo(nome, partes[n], paraEste, (feitas, total) =>
          atividade.registrar(
            tarefa,
            `Desenhando página ${feitas} de ${total}` + (partes.length > 1 ? ` (lote ${n + 1}/${partes.length})` : ''),
            feitas / total,
          ),
        );

        if (r.cancelado) {
          cancelou = true;
          atividade.fechar(tarefa, 'cancelada');
          break;
        }
        if (!r.ok) {
          falhou = r.erro;
          break;
        }
        trabalhos += 1;
      }

      if (cancelou) break;
      if (falhou) {
        setFila((atual) => atual.map((i) => (i.id === alvo.id ? { ...i, estado: 'erro', erro: falhou } : i)));
        atividade.fechar(tarefa, 'erro', falhou);
      } else {
        enviados += 1;
        // Só a quantidade: folhas e cópias, nunca o nome do arquivo.
        registrarUso({ tipo: 'impressao', folhas: saida.paginas, copias: opcoes.copias ?? 1 });
        setFila((atual) => atual.map((i) => (i.id === alvo.id ? { ...i, estado: 'impresso' } : i)));
        atividade.fechar(tarefa, 'concluida', `${partes.length} trabalho(s) na impressora`);
      }
    }

    setImprimindo(null);
    const emLotes = trabalhos > enviados ? ` em ${trabalhos} lotes` : '';
    setAviso(
      cancelou
        ? `Fila interrompida. ${enviados} de ${prontos.length} foram enviados.`
        : `${enviados} arquivo${enviados === 1 ? '' : 's'} enviado${enviados === 1 ? '' : 's'}${emLotes}.`,
    );
  }

  /** Tira os arquivos e o que estava preso a eles: prévia, montagem, avisos. */
  function limparFila() {
    setFila([]);
    setSelecionado(null);
    setMontado(null);
    setIntervalo('');
    setAviso(null);
    setErroGeral(null);
  }

  /** Volta tudo ao padrão: arquivos, opções e as escolhas guardadas. */
  function resetar() {
    esquecerOpcoes();
    const padrao = impressoras?.find((i) => i.padrao) ?? impressoras?.[0];
    setOpcoes({ ...OPCOES_PADRAO, impressora: padrao?.nome });
    setPorFolha(1);
    setLote(0);
    setZoom(0);
    limparFila();
  }

  const raiz = noAppPelaRota ? '/app' : '/';
  const prontos = fila.filter((i) => i.blob);
  // O que o botão manda: só o que ainda não saiu. Com tudo impresso, manda
  // de novo — é o "imprimir outra vez" de quem precisa de mais uma cópia.
  const pendentes = prontos.filter((i) => i.estado !== 'impresso');
  const aImprimir = pendentes.length ? pendentes : prontos;
  const totalPaginas = prontos.reduce((soma, i) => soma + i.paginas, 0);
  const preparando = fila.some((i) => i.estado === 'esperando' || i.estado === 'convertendo');

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-12 sm:px-6">
      <header className={cx('pb-6', noAppPelaRota ? 'pt-5' : 'pt-10')}>
        <Link href={raiz} className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Ferramentas
        </Link>
        <div className="mt-4 flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-line bg-elevated text-brand">
            <Printer className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Imprimir</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">
              Solte fotos, PDFs, Word, Excel e texto de uma vez. Cada arquivo entra na fila, é convertido aqui mesmo e
              sai como um trabalho próprio na impressora — sem precisar juntar tudo num documento antes.
            </p>
          </div>
        </div>
      </header>

      {erroGeral && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erroGeral}</span>
        </div>
      )}

      {fila.length === 0 ? (
        <div className="card p-5">
          <Dropzone
            accept={ACEITA}
            acceptLabel="PDF, JPG, PNG, WebP, DOCX, XLSX, PPTX ou TXT"
            multiple
            onFiles={(arquivos) => void receberArquivos(arquivos)}
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            {item?.blob && saida ? (
              <>
                <PreviaDaPagina
                  nome={item.nomeOriginal}
                  paginas={saida.paginas}
                  pagina={pagina}
                  zoom={zoom}
                  escalaAtual={escalaAtual}
                  renderizando={renderizando}
                  folha={folhaNaTela}
                  aviso={avisoDeSobra}
                  telaRef={telaRef}
                  molduraRef={molduraRef}
                  onZoom={setZoom}
                  onPagina={setPagina}
                />
                <AjustesDaImagem
                  nome={item.nomeOriginal}
                  ajustes={ajustesDe(item.ajustes)}
                  cinzaDaFila={opcoes.colorido === false}
                  outros={fila.filter((i) => i.id !== item.id && i.blob).length}
                  onMudar={(novos) => mudarAjustes(item.id, novos)}
                  onTodos={() => aplicarAjustesEmTodos(item.id)}
                />
              </>
            ) : null}
            <FilaDeArquivos
              fila={fila}
              selecionado={selecionado}
              imprimindo={imprimindo}
              totalPaginas={totalPaginas}
              preparando={preparando}
              aceita={ACEITA}
              onSelecionar={setSelecionado}
              onRemover={remover}
              onAdicionar={(arquivos) => void receberArquivos(arquivos)}
            />

          </div>

          <OpcoesDeImpressao
            opcoes={opcoes}
            impressoras={impressoras}
            noApp={noApp}
            intervalo={intervalo}
            porFolha={porFolha}
            montando={montando}
            lote={lote}
            prontos={aImprimir.length}
            deNovo={!pendentes.length && prontos.length > 0}
            imprimindo={imprimindo}
            preparando={preparando}
            aviso={aviso}
            onMudar={mudar}
            onIntervalo={setIntervalo}
            onPorFolha={setPorFolha}
            onLote={setLote}
            onImprimir={() => void imprimirTudo()}
            onLimpar={limparFila}
            onResetar={resetar}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Escolhe as páginas e monta as folhas de um arquivo da fila.
 *
 * Nessa ordem, e não na contrária: escolher "1-4" com 4 por folha tem que dar
 * uma folha com as quatro primeiras páginas, não a primeira folha de um
 * documento já montado.
 */
async function prepararSaida(
  alvo: ItemFila,
  porFolha: number,
  intervalo: string,
): Promise<{ blob: Blob; paginas: number }> {
  if (!alvo.blob) throw new Error('O arquivo ainda não está pronto.');
  let blob: Blob = alvo.blob;

  if (intervalo.trim()) {
    const carregado = await inspectFile(new File([blob], alvo.nome, { type: 'application/pdf' }), alvo.id);
    const r = await runOperation('split', {
      files: [carregado],
      options: { mode: 'extract', extractRanges: intervalo },
      onProgress: () => {},
    });
    blob = r.files[0].blob;
  }

  if (porFolha > 1) {
    const carregado = await inspectFile(new File([blob], alvo.nome, { type: 'application/pdf' }), alvo.id);
    const r = await runOperation('n-up', {
      files: [carregado],
      options: { perSheet: porFolha, espacamentoMm: 2, margemMm: 4, border: false },
      onProgress: () => {},
    });
    blob = r.files[0].blob;
  }

  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const paginas = doc.numPages;
  await doc.destroy();
  return { blob, paginas };
}
