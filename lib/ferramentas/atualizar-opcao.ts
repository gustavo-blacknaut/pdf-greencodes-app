type Valor = string | number | boolean;
type Opcoes = Record<string, Valor>;

export function atualizarOpcao(operacao: string | null, atuais: Opcoes, chave: string, valor: Valor): Opcoes {
  const novas = { ...atuais, [chave]: valor };
  if (operacao === 'photo-sheet' && chave === 'modelo' && ['10x15', '13x18', '15x20'].includes(String(valor))
    && (!atuais.papelFoto || atuais.papelFoto === '10x15' || atuais.papelFoto === atuais.modelo)) {
    novas.papelFoto = valor;
  }
  return novas;
}
