import type { Impressora, OpcoesImpressao } from '../desktop';
import { PAPEIS, folhaEmMm } from './layout';

export function papeisDaImpressora(impressora?: Impressora) {
  const disponiveis = impressora?.papeis?.filter((p) => p.largura > 0 && p.altura > 0);
  if (!disponiveis?.length) return Object.entries(PAPEIS).map(([valor, medida]) => ({
    valor, nome: `${valor} · ${medida.largura} × ${medida.altura} mm`, padrao: valor === 'A4',
  }));
  return disponiveis.map((p) => {
    const largura = Math.min(p.largura, p.altura) * 0.254;
    const altura = Math.max(p.largura, p.altura) * 0.254;
    return { valor: `driver:${p.id}:${largura.toFixed(3)}:${altura.toFixed(3)}`,
      nome: `${p.nome} · ${largura.toFixed(1)} × ${altura.toFixed(1)} mm`, padrao: p.padrao };
  });
}

export function selecionarImpressora(opcoes: OpcoesImpressao, impressora?: Impressora): OpcoesImpressao {
  const papeis = papeisDaImpressora(impressora);
  const antiga = folhaEmMm(opcoes.papel ?? 'A4', false);
  const equivalente = papeis.find((p) => {
    const medida = folhaEmMm(p.valor, false);
    return Math.abs(medida.largura - antiga.largura) < 1 && Math.abs(medida.altura - antiga.altura) < 1;
  });
  return { ...opcoes, impressora: impressora?.nome,
    papel: (equivalente ?? papeis.find((p) => p.padrao) ?? papeis[0]).valor };
}
