/**
 * A folha da prévia, em pixels de tela.
 *
 * A conta de onde a arte cai é a mesma da impressão (`montarFolha`), e só é
 * convertida de milímetro para pixel aqui. Prévia com conta própria já mostrou
 * uma coisa enquanto o papel saía outra.
 */

import { marcasDeCorte, marcasDeRegistro } from '@/lib/impressao/layout';
import { montarFolha, type Arte, type Montagem } from '@/lib/impressao/folha';
import type { FolhaNaTela } from './PreviaDaPagina';

export function folhaNaTela(
  arte: Arte,
  montagem: Montagem,
  espaco: { largura: number; altura: number },
  zoom: number,
): FolhaNaTela {
  const { folha, caixa, borda } = montarFolha(arte, montagem);

  // "Ajustado" mostra a folha inteira, em pé ou deitada, como a prévia do
  // navegador: quem confere margem precisa ver as quatro bordas de uma vez.
  // O zoom multiplica dali.
  const cabe = Math.min(
    espaco.largura / folha.largura,
    espaco.altura > 0 ? espaco.altura / folha.altura : Number.POSITIVE_INFINITY,
  );
  const porMm = cabe * (zoom > 0 ? zoom : 1);
  const emPx = (valor: number) => valor * porMm;

  const marcas: FolhaNaTela['marcas'] = [];
  if (montagem.marcasCorte) {
    const espessura = Math.max(1, emPx(0.25));
    for (const traco of marcasDeCorte(caixa)) {
      marcas.push({
        x: emPx(Math.min(traco.x1, traco.x2)),
        y: emPx(Math.min(traco.y1, traco.y2)),
        largura: Math.max(espessura, emPx(Math.abs(traco.x2 - traco.x1))),
        altura: Math.max(espessura, emPx(Math.abs(traco.y2 - traco.y1))),
      });
    }
  }
  if (montagem.marcasRegistro) {
    const lado = Math.max(3, emPx(3));
    for (const alvo of marcasDeRegistro(caixa)) {
      marcas.push({ x: emPx(alvo.x) - lado / 2, y: emPx(alvo.y) - lado / 2, largura: lado, altura: lado });
    }
  }

  return {
    largura: emPx(folha.largura),
    altura: emPx(folha.altura),
    arte: { x: emPx(caixa.x), y: emPx(caixa.y), largura: emPx(caixa.largura), altura: emPx(caixa.altura) },
    marcas,
    // O tracejado de "até aqui a impressora alcança", como na prévia do navegador.
    imprimivel:
      borda.lados > 0 || borda.cima > 0
        ? {
            x: emPx(borda.lados),
            y: emPx(borda.cima),
            largura: emPx(folha.largura - borda.lados * 2),
            altura: emPx(folha.altura - borda.cima * 2),
          }
        : null,
    espelho:
      montagem.espelho === 'horizontal' ? 'scaleX(-1)' : montagem.espelho === 'vertical' ? 'scaleY(-1)' : undefined,
    negativo: Boolean(montagem.negativo),
    cinza: montagem.colorido === false,
  };
}
