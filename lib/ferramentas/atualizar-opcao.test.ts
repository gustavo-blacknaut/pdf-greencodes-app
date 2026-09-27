import { describe, expect, it } from 'vitest';
import { atualizarOpcao } from './atualizar-opcao';

describe('papel da folha de fotos', () => {
  it.each(['10x15', '13x18', '15x20'])('acompanha o formato %s ao partir do papel padrão', (modelo) => {
    expect(atualizarOpcao('photo-sheet', { modelo: '3x4', papelFoto: '10x15' }, 'modelo', modelo))
      .toEqual({ modelo, papelFoto: modelo });
  });
  it('acompanha a troca entre tamanhos de revelação', () => {
    expect(atualizarOpcao('photo-sheet', { modelo: '13x18', papelFoto: '13x18' }, 'modelo', '15x20').papelFoto).toBe('15x20');
  });
  it.each(['A4', '15x21'])('mantém o papel personalizado %s', (papelFoto) => {
    expect(atualizarOpcao('photo-sheet', { modelo: '13x18', papelFoto }, 'modelo', '15x20').papelFoto).toBe(papelFoto);
  });
  it('mantém o papel ao voltar para fotos de documento', () => {
    expect(atualizarOpcao('photo-sheet', { modelo: '13x18', papelFoto: '13x18' }, 'modelo', '3x4').papelFoto).toBe('13x18');
  });
});
