import { expect, it } from 'vitest';
import { selecionarImpressora, papeisDaImpressora } from './papeis';
import { folhaEmMm } from './layout';
import type { Impressora } from '../desktop';

const reveladora: Impressora = { nome: 'Foto', padrao: true, apelido: 'Foto', descricao: '', papeis: [
  { id: 257, nome: '4x6', largura: 400, altura: 600, padrao: true },
  { id: 258, nome: '6x8', largura: 600, altura: 800 },
] };
it('oferece só os papéis do driver e substitui A4 incompatível pelo padrão da reveladora', () => {
  const papeis = papeisDaImpressora(reveladora);
  expect(papeis).toHaveLength(2);
  const opcoes = selecionarImpressora({ papel: 'A4' }, reveladora);
  expect(opcoes.papel).toBe(papeis[0].valor);
  expect(folhaEmMm(opcoes.papel!, false)).toEqual({ largura: 101.6, altura: 152.4 });
  expect(folhaEmMm(opcoes.papel!, true)).toEqual({ largura: 152.4, altura: 101.6 });
});
it('mantém as medidas do papel ao trocar de impressora, mas usa o identificador da nova', () => {
  const antiga = selecionarImpressora({ papel: 'A4' }, reveladora);
  const nova = selecionarImpressora(antiga, { ...reveladora, papeis: [{ ...reveladora.papeis![0], id: 300 }] });
  expect(nova.papel).toBe('driver:300:101.600:152.400');
});
