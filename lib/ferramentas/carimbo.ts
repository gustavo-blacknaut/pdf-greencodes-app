import type { Tool } from './tipos';

/**
 * Carimbo: a ferramenta que não precisa de arquivo nenhum.
 *
 * Mora em arquivo próprio porque o catálogo de gráfica já está no limite de
 * tamanho, e porque carimbo é assunto fechado: texto, medida e sai o PDF.
 */
export const CARIMBO: Tool[] = [
  {
    slug: 'criar-carimbo',
    operation: 'stamp',
    name: 'Criar carimbo',
    tagline: 'Escreva, escolha a medida, saia em PDF',
    description:
      'O carimbo desenhado na medida exata: retangular de 38x14 com as linhas do CNPJ, ou redondo de 40 mm com o nome dando a volta por cima e o documento por baixo. A letra se ajusta sozinha ao espaço, a borda pode ser simples ou dupla, e o PDF sai no tamanho de verdade — é o que a máquina de gravação espera receber.',
    icon: 'Stamp',
    accent: '244 63 94',
    category: 'Gráfica',
    busca: [
      'carimbo',
      'carimbo redondo',
      'carimbo de cnpj',
      'auto entintado',
      'borracha',
      'chancela',
    ],
    accept: [],
    acceptLabel: '',
    multiple: false,
    semArquivo: true,
    cta: 'Gerar o carimbo',
    fields: [
      {
        key: 'formato',
        type: 'select',
        label: 'Formato',
        default: 'retangulo',
        options: [
          { value: 'retangulo', label: 'Retangular', hint: 'o de CNPJ e endereço, com linhas' },
          { value: 'redondo', label: 'Redondo', hint: 'texto dando a volta, em cima e embaixo' },
        ],
      },
      {
        key: 'linhas',
        type: 'texto-longo',
        label: 'Texto',
        default: '',
        placeholder: 'GRÁFICA GREENCODES LTDA\nCNPJ 00.000.000/0001-00\nRua das Flores, 123 — Centro',
        help: 'Uma linha por linha do carimbo, até oito. A letra se ajusta sozinha para caber na medida.',
      },
      {
        key: 'arcoTopo',
        type: 'text',
        label: 'Texto em volta, por cima',
        default: '',
        placeholder: 'GRÁFICA GREENCODES LTDA',
        showIf: { key: 'formato', equals: 'redondo' },
      },
      {
        key: 'arcoBaixo',
        type: 'text',
        label: 'Texto em volta, por baixo',
        default: '',
        placeholder: 'CNPJ 00.000.000/0001-00',
        showIf: { key: 'formato', equals: 'redondo' },
      },
      {
        key: 'larguraMm',
        type: 'number',
        label: 'Largura (mm)',
        default: 38,
        min: 5,
        max: 250,
        showIf: { key: 'formato', equals: 'retangulo' },
        help: 'As medidas mais pedidas: 38x14, 47x18 e 58x22 — as mesmas dos auto-entintados.',
      },
      {
        key: 'alturaMm',
        type: 'number',
        label: 'Altura (mm)',
        default: 14,
        min: 5,
        max: 250,
        showIf: { key: 'formato', equals: 'retangulo' },
      },
      {
        key: 'diametroMm',
        type: 'number',
        label: 'Diâmetro (mm)',
        default: 40,
        min: 10,
        max: 200,
        showIf: { key: 'formato', equals: 'redondo' },
      },
      {
        key: 'borda',
        type: 'select',
        label: 'Borda',
        default: 'simples',
        options: [
          { value: 'simples', label: 'Simples' },
          { value: 'dupla', label: 'Dupla', hint: 'duas linhas, com o texto em volta entre elas' },
          { value: 'sem', label: 'Sem borda' },
        ],
      },
      { key: 'espessuraMm', type: 'number', label: 'Espessura da borda (mm)', default: 0.5, min: 0.1, max: 3, step: 0.1 },
      {
        key: 'fonte',
        type: 'select',
        label: 'Letra',
        default: 'helv',
        options: [
          { value: 'helv', label: 'Sem serifa', hint: 'Helvetica — a mais usada em carimbo' },
          { value: 'times', label: 'Com serifa', hint: 'Times — ar de documento' },
          { value: 'cour', label: 'Máquina de escrever', hint: 'Courier — largura fixa' },
        ],
      },
      { key: 'negrito', type: 'toggle', label: 'Negrito', default: true, help: 'Carimbo fino borra na almofada; o negrito aguenta mais tinta.' },
      { key: 'margemMm', type: 'number', label: 'Respiro interno (mm)', default: 2, min: 0, max: 20 },
      {
        key: 'saida',
        type: 'select',
        label: 'Como sair',
        default: 'um',
        options: [
          { value: 'um', label: 'Um carimbo, no tamanho exato', hint: 'para gravar direto' },
          { value: 'folha', label: 'Repetido numa folha A4', hint: 'aproveita a chapa inteira' },
        ],
      },
      {
        key: 'espacoMm',
        type: 'number',
        label: 'Espaço entre eles (mm)',
        default: 4,
        min: 0,
        max: 30,
        showIf: { key: 'saida', equals: 'folha' },
      },
    ],
  },
];
