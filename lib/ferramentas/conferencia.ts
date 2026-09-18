import { PDF_ACCEPT, type Tool } from './tipos';

export const CONFERENCIA: Tool[] = [
  {
    slug: 'padronizar-orientacao', operation: 'normalize-orientation', name: 'Padronizar orientação',
    tagline: 'Coloque as páginas em retrato ou paisagem',
    description: 'Gira somente as páginas que precisam mudar de orientação. Mantém texto, imagens e tamanho original, sem rasterizar. Não reconhece se o texto está de cabeça para baixo.',
    icon: 'Scaling', accent: '16 185 129', category: 'Organizar', accept: PDF_ACCEPT,
    acceptLabel: 'PDF', multiple: true, cta: 'Padronizar as páginas',
    fields: [
      { key: 'orientacao', type: 'select', label: 'Orientação desejada', default: 'retrato', options: [
        { value: 'retrato', label: 'Retrato' }, { value: 'paisagem', label: 'Paisagem' },
      ] },
      { key: 'sentido', type: 'select', label: 'Sentido do giro', default: 'horario', options: [
        { value: 'horario', label: 'Horário' }, { value: 'anti-horario', label: 'Anti-horário' },
      ] },
    ],
  },
  {
    slug: 'relatorio-paginas', operation: 'page-report', name: 'Relatório das páginas',
    tagline: 'Confira as medidas antes de imprimir',
    description: 'Gera um CSV com arquivo, número da página, largura e altura visíveis em milímetros, orientação e rotação. Útil para conferir trabalhos que misturam formatos. O relatório contém os nomes dos arquivos e não é protegido por senha.',
    icon: 'Layers', accent: '234 88 12', category: 'Gráfica', accept: PDF_ACCEPT,
    acceptLabel: 'PDF', multiple: true, orderable: true, cta: 'Gerar relatório', fields: [],
    busca: ['medidas', 'inventario', 'csv', 'tamanho de papel'],
  },
  {
    slug: 'calibrar-impressao', operation: 'print-calibration', name: 'Calibrar impressão',
    tagline: 'Confira a escala e o alinhamento da Pimaco',
    description: 'Gera réguas em milímetros e uma grade de conferência. Imprima em papel comum, em tamanho real, para medir a escala e comparar com o picote antes de gastar etiquetas.',
    icon: 'Scaling', accent: '234 88 12', category: 'Gráfica',
    busca: ['calibracao', 'regua', 'alinhamento', 'teste de impressao', 'pimaco'],
    accept: [], acceptLabel: '', semArquivo: true, multiple: false, cta: 'Gerar a conferência',
    fields: [
      { key: 'modelo', type: 'select', label: 'O que conferir', default: '6093', options: [
        { value: '6093', label: 'Pimaco 6093 — 24 redondas' },
        { value: '6180', label: 'Pimaco 6180 — 30 etiquetas' },
        { value: '6187', label: 'Pimaco 6187 — 80 etiquetas' },
        { value: 'regua', label: 'Somente escala e alinhamento' },
      ] },
      { key: 'papel', type: 'select', label: 'Papel', default: 'A4',
        showIf: { key: 'modelo', equals: 'regua' }, options: [
          { value: 'A4', label: 'A4 — 210 × 297 mm' },
          { value: 'Letter', label: 'Carta — 215,9 × 279,4 mm' },
        ] },
    ],
  },
  {
    slug: 'separar-por-tamanho', operation: 'split-by-size', name: 'Separar por tamanho de papel',
    tagline: 'A4, A3 e outros formatos em arquivos separados',
    description: 'Agrupa páginas com a mesma medida, preservando o conteúdo e a ordem dentro de cada grupo. Ajuda a preparar trabalhos que misturam papéis diferentes.',
    icon: 'Layers', accent: '16 185 129', category: 'Organizar',
    busca: ['separar formatos', 'tamanho de papel', 'a4 a3', 'paginas mistas'],
    accept: PDF_ACCEPT, acceptLabel: 'PDF', multiple: true, orderable: true,
    cta: 'Separar os formatos', fields: [
      { key: 'orientacoes', type: 'toggle', label: 'Separar retrato e paisagem', default: false,
        help: 'Desligado mantém os dois sentidos do mesmo papel no mesmo arquivo.' },
      { key: 'toleranciaMm', type: 'number', label: 'Tolerância da medida (mm)', default: 0.5,
        min: 0, max: 2, step: 0.1, help: 'Agrupa pequenas diferenças de arredondamento sem redimensionar as páginas.' },
    ],
  },
];
