import { IMAGE_ACCEPT, PDF_ACCEPT, type Field, type Tool } from './tipos';

/**
 * Cartão de visita e etiqueta: as duas montagens de folha da gráfica.
 *
 * São a mesma ferramenta por dentro — repetir a arte numa grade e dizer onde
 * cortar —, e ficam juntas aqui por isso. A diferença que importa está na
 * folha: a do cartão é cortada na guilhotina, então a grade é calculada; a da
 * etiqueta vem picotada da Pimaco, e aí a grade é a do fabricante.
 */

/** Os papéis que a montagem do cartão oferece. */
const PAPEIS: Field = {
  key: 'papel',
  type: 'select',
  label: 'Papel',
  default: 'a4',
  options: [
    { value: 'a4', label: 'A4', hint: '210 x 297 mm' },
    { value: 'a3', label: 'A3', hint: '297 x 420 mm · rende mais por folha' },
    { value: 'carta', label: 'Carta', hint: '215,9 x 279,4 mm' },
    { value: 'oficio', label: 'Ofício', hint: '215,9 x 355,6 mm' },
    { value: 'a5', label: 'A5', hint: '148 x 210 mm' },
  ],
};

const DEITAR: Field = {
  key: 'deitado',
  type: 'toggle',
  label: 'Folha deitada',
  default: false,
  help: 'Vira o papel de lado. Costuma render mais itens quando o que você monta é largo.',
};

/** Como a foto entra na medida do item. Só vale quando a arte é imagem. */
const AJUSTE_DA_IMAGEM: Field = {
  key: 'ajusteDaImagem',
  type: 'select',
  label: 'Se a arte for uma imagem',
  default: 'proporcao',
  options: [
    { value: 'proporcao', label: 'Encaixar sem deformar', hint: 'a foto inteira aparece; o que sobra fica branco' },
    { value: 'preencher', label: 'Preencher e cortar', hint: 'amplia até encher e corta o que passa' },
    { value: 'esticar', label: 'Esticar até a medida', hint: 'ocupa tudo, mesmo deformando a foto' },
  ],
  help: 'A imagem vira a arte do item, na medida exata, desenhada a 300 DPI.',
};

export const ETIQUETAS: Tool[] = [
  {
    slug: 'cartao-de-visita',
    operation: 'business-cards',
    name: 'Cartão de visita',
    tagline: 'Enche a folha e marca onde cortar',
    description:
      'Repete o cartão na folha inteira, centralizado, com as marcas alinhadas nas ruas entre eles. É assim que se corta na guilhotina: a pilha toda de uma vez, e não cartão por cartão.',
    icon: 'CreditCard',
    accent: '139 92 246',
    category: 'Gráfica',
    busca: [
      'cartao',
      'visita',
      'montagem de cartao',
    ],
    accept: [...PDF_ACCEPT, ...IMAGE_ACCEPT],
    acceptLabel: 'PDF ou imagem',
    multiple: false,
    cta: 'Montar a folha',
    fields: [
      {
        key: 'medida',
        type: 'select',
        label: 'Tamanho do cartão',
        default: '90x50',
        options: [
          { value: '90x50', label: '90 x 50 mm', hint: 'o padrão brasileiro' },
          { value: '88x48', label: '88 x 48 mm', hint: 'cabe mais por folha' },
          { value: '85x55', label: '85 x 55 mm', hint: 'padrão europeu' },
          { value: '89x51', label: '88,9 x 50,8 mm', hint: 'padrão americano (3,5 x 2 pol)' },
          { value: 'personalizado', label: 'Outro', hint: 'você informa a medida' },
        ],
      },
      {
        key: 'larguraMm',
        type: 'number',
        label: 'Largura (mm)',
        default: 90,
        min: 10,
        max: 300,
        showIf: { key: 'medida', equals: 'personalizado' },
      },
      {
        key: 'alturaMm',
        type: 'number',
        label: 'Altura (mm)',
        default: 50,
        min: 10,
        max: 300,
        showIf: { key: 'medida', equals: 'personalizado' },
      },
      { key: 'cartaoDeitado', type: 'toggle', label: 'Cartão deitado', default: true },
      AJUSTE_DA_IMAGEM,
      PAPEIS,
      DEITAR,
      {
        key: 'margemMm',
        type: 'number',
        label: 'Margem da folha (mm)',
        default: 5,
        min: 0,
        max: 50,
        help: 'A borda que a impressora não alcança. O que sobrar além disso é dividido igual dos dois lados.',
      },
      {
        key: 'espacoMm',
        type: 'number',
        label: 'Espaço entre cartões (mm)',
        default: 0,
        min: 0,
        max: 30,
        help: 'Zero encosta um no outro e rende mais: um corte só serve aos dois vizinhos.',
      },
      { key: 'marcas', type: 'toggle', label: 'Marcas de corte', default: true },
      {
        key: 'modo',
        type: 'select',
        label: 'Com várias páginas',
        default: 'repetir',
        options: [
          { value: 'repetir', label: 'Uma folha por página', hint: 'frente numa folha, verso na outra' },
          { value: 'sequencia', label: 'Todas na mesma folha', hint: 'cartões diferentes lado a lado' },
        ],
      },
    ],
  },
  {
    slug: 'etiquetas',
    operation: 'labels',
    name: 'Etiquetas e adesivos',
    tagline: 'Folha Pimaco ou a medida que você quiser',
    description:
      'Escolha a folha da Pimaco que você comprou e a arte cai em cima de cada etiqueta picotada, na posição do fabricante. Ou informe a medida livre, para etiqueta de produto, adesivo, tag e senha de atendimento — aí ele diz quantas couberam antes de você mandar imprimir.',
    icon: 'Tags',
    accent: '234 88 12',
    category: 'Gráfica',
    busca: [
      'etiqueta',
      'adesivo',
      'label',
      'folha de etiquetas',
    ],
    accept: [...PDF_ACCEPT, ...IMAGE_ACCEPT],
    acceptLabel: 'PDF ou imagem',
    multiple: false,
    cta: 'Montar a folha',
    fields: [
      {
        key: 'modelo',
        type: 'select',
        label: 'Folha de etiqueta',
        default: '6180',
        options: [
          { value: '6180', label: 'Pimaco 6180 — 30 por folha', hint: '25,4 x 66,7 mm · Carta' },
          { value: '6187', label: 'Pimaco 6187 — 80 por folha', hint: '12,7 x 44,45 mm · Carta' },
          { value: '6093', label: 'Pimaco 6093 — 24 redondas', hint: 'Ø 42,33 mm · Carta' },
          { value: 'livre', label: 'Medida livre', hint: 'você informa o tamanho e ele calcula a grade' },
        ],
        help: 'Nas folhas da Pimaco a grade já vem picotada, então a arte é posta na posição do fabricante — nada de grade calculada. Imprima sempre em tamanho real.',
      },
      {
        key: 'larguraMm',
        type: 'number',
        label: 'Largura da etiqueta (mm)',
        default: 50,
        min: 5,
        max: 400,
        showIf: { key: 'modelo', equals: 'livre' },
      },
      {
        key: 'alturaMm',
        type: 'number',
        label: 'Altura da etiqueta (mm)',
        default: 30,
        min: 5,
        max: 400,
        showIf: { key: 'modelo', equals: 'livre' },
      },
      AJUSTE_DA_IMAGEM,
      { ...PAPEIS, showIf: { key: 'modelo', equals: 'livre' } },
      { ...DEITAR, showIf: { key: 'modelo', equals: 'livre' } },
      {
        key: 'margemMm',
        type: 'number',
        label: 'Margem da folha (mm)',
        default: 5,
        min: 0,
        max: 50,
        showIf: { key: 'modelo', equals: 'livre' },
      },
      {
        key: 'espacoMm',
        type: 'number',
        label: 'Espaço entre etiquetas (mm)',
        default: 2,
        min: 0,
        max: 30,
        showIf: { key: 'modelo', equals: 'livre' },
      },
      {
        key: 'marcas',
        type: 'toggle',
        label: 'Marcas de corte',
        default: true,
        showIf: { key: 'modelo', equals: 'livre' },
      },
      {
        key: 'deslocaXmm',
        type: 'number',
        label: 'Deslocar para a direita (mm)',
        default: 0,
        min: -10,
        max: 10,
        help: 'Acerto fino quando a impressora puxa o papel um fio torto. Negativo empurra para a esquerda.',
      },
      {
        key: 'deslocaYmm',
        type: 'number',
        label: 'Deslocar para baixo (mm)',
        default: 0,
        min: -10,
        max: 10,
      },
      {
        key: 'conferir',
        type: 'toggle',
        label: 'Folha de conferência',
        default: false,
        help: 'Desenha o contorno de cada etiqueta. Imprima numa folha comum e ponha contra a luz junto com a folha de etiqueta: se bater, pode gastar a folha boa.',
      },
      {
        key: 'modo',
        type: 'select',
        label: 'Com várias páginas',
        default: 'repetir',
        options: [
          { value: 'repetir', label: 'Uma folha por página', hint: 'a mesma etiqueta enchendo a folha' },
          { value: 'sequencia', label: 'Todas na mesma folha', hint: 'etiquetas diferentes lado a lado' },
        ],
      },
    ],
  },
];
