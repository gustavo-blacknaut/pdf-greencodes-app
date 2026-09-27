import { describe, expect, it } from 'vitest';
import { tipoDePrevia } from './previa-resultado';

describe('prévia dos resultados', () => {
  it.each(['pdf', 'PDF'])('reconhece PDF com extensão %s e blob vazio em disco', (extensao) => {
    expect(tipoDePrevia({ name: `resultado.${extensao}`, blob: new Blob() })).toBe('pdf');
  });
  it.each(['png', 'JPG', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'svg'])('visualiza imagem %s', (extensao) => {
    expect(tipoDePrevia({ name: `foto.${extensao}`, blob: new Blob() })).toBe('imagem');
  });
  it.each(['txt', 'csv', 'json'])('visualiza relatório %s como texto sem executar conteúdo', (extensao) => {
    expect(tipoDePrevia({ name: `relatorio.${extensao}`, blob: new Blob() })).toBe('texto');
  });
  it('encaminha DOCX para prévia convertida', () => {
    expect(tipoDePrevia({ name: 'resultado.docx', blob: new Blob() })).toBe('word');
  });
  it.each(['xlsx', 'html', 'exe'])('não tenta interpretar formato não suportado %s', (extensao) => {
    expect(tipoDePrevia({ name: `resultado.${extensao}`, blob: new Blob() })).toBeNull();
  });
});
