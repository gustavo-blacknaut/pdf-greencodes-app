"""Cobertura de tinta por amostragem dos quatro canais CMYK."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Tuple

import pymupdf

from ..documento import abrir, nome_com_sufixo
from ..protocolo import Pedido
from ..resolucao import aviso_de_reducao, couber, na_faixa

DPI_PADRAO = 150

# Os limites de cobertura que as graficas usam. Sao do papel, nao da maquina:
# papel poroso bebe mais tinta antes de repintar.
LIMITES_DE_TINTA = {
    "jornal": 240,
    "offset": 300,
    "couche": 330,
    "digital": 400,
}

def _pixmap_cmyk(pagina: pymupdf.Page, dpi: int) -> pymupdf.Pixmap:
    """A pagina rasterizada em quatro canais."""
    return pagina.get_pixmap(dpi=dpi, colorspace=pymupdf.csCMYK)


def _canais(pixels: pymupdf.Pixmap) -> List[bytes]:
    """Os quatro canais, cada um como uma sequencia de bytes.

    A fatia com passo 4 desentrelaca em C. Um `for` sobre `samples` faria a
    mesma coisa umas cem vezes mais devagar.
    """
    brutos = pixels.samples
    return [bytes(brutos[indice::4]) for indice in range(4)]


def _resumo_da_cobertura(canais: List[bytes], limite: int) -> Tuple[int, float, float]:
    """O maior, a media e a fracao de area acima do limite.

    A soma dos quatro canais em porcentagem e o que a grafica chama de TAC.
    Cada canal vai de 0 a 255, entao o teto e 400%.
    """
    largura = len(canais[0])
    if largura == 0:
        return 0, 0.0, 0.0

    # Amostragem: numa A4 a 150 DPI sao 2,2 milhoes de pixels, e somar os
    # quatro canais de todos em Python levaria segundos. Um a cada 16 da a
    # mesma resposta com erro muito abaixo do que o papel percebe.
    passo = max(1, largura // 200_000)
    maior = 0
    soma = 0
    acima = 0
    contados = 0

    for posicao in range(0, largura, passo):
        tinta = canais[0][posicao] + canais[1][posicao] + canais[2][posicao] + canais[3][posicao]
        if tinta > maior:
            maior = tinta
        soma += tinta
        if tinta * 100 / 255 > limite:
            acima += 1
        contados += 1

    em_porcento = lambda bruto: round(bruto * 100 / 255, 1)
    return (
        round(maior * 100 / 255),
        em_porcento(soma / contados),
        round(acima * 100 / contados, 2),
    )


def cobertura_de_tinta(pedido: Pedido) -> Dict[str, Any]:
    """Quanta tinta o papel vai receber, e onde passa do que ele aguenta."""
    documento = abrir(pedido.arquivos[0], pedido.senha())
    papel = str(pedido.opcao("papel", "offset")).lower()
    limite = LIMITES_DE_TINTA.get(papel)
    if limite is None:
        limite = int(pedido.opcao("limite", 300))
    limite = max(100, min(400, int(limite)))
    pedido_dpi = na_faixa(pedido.opcao("dpi"), DPI_PADRAO)

    paginas: List[Dict[str, Any]] = []
    total = documento.page_count
    reduzida = 0

    try:
        for numero in range(total):
            pedido.andamento(numero / total, f"Medindo a pagina {numero + 1} de {total}")
            pagina = documento[numero]
            caixa = pagina.rect
            dpi, cortou = couber(caixa.width, caixa.height, pedido_dpi, canais=4)
            if cortou:
                reduzida = max(reduzida, dpi)

            pixels = _pixmap_cmyk(pagina, dpi)
            maior, media, acima = _resumo_da_cobertura(_canais(pixels), limite)
            pixels = None

            paginas.append(
                {
                    "pagina": numero + 1,
                    "maior": maior,
                    "media": media,
                    "areaAcima": acima,
                    "passou": maior > limite,
                }
            )
    finally:
        documento.close()

    estouradas = [p for p in paginas if p["passou"]]
    pior = max(paginas, key=lambda p: p["maior"]) if paginas else None

    notas = [f"Limite considerado: {limite}% de cobertura total ({papel})."]
    if not paginas:
        notas.append("O documento nao tem paginas.")
    elif not estouradas:
        notas.append(f"Nenhuma pagina passou do limite. A pior chegou a {pior['maior']}%.")
    else:
        notas.append(
            f"{len(estouradas)} de {total} pagina(s) passaram do limite. "
            f"A pior e a {pior['pagina']}, com {pior['maior']}% em {pior['areaAcima']}% da area."
        )
        notas.append(
            "Passar do limite faz a tinta repintar na folha de cima, borrar e demorar a secar. "
            "Some com preto rico onde nao precisa, ou troque para um papel que aguente mais."
        )
    if reduzida:
        notas.append(aviso_de_reducao(pedido_dpi, reduzida))

    # O laudo vira arquivo para ficar junto do servico. Numa grafica a
    # conferencia so vale se sobreviver ao fechamento da janela.
    destino = pedido.saida or nome_com_sufixo(pedido.arquivos[0], "cobertura", ".txt")
    with open(destino, "w", encoding="utf-8") as laudo:
        laudo.write(f"Cobertura de tinta - {os.path.basename(pedido.arquivos[0])}\n")
        laudo.write(f"Papel: {papel} - limite de {limite}%\n")
        laudo.write("=" * 56 + "\n\n")
        laudo.write("pagina   maior   media   area acima do limite\n")
        for pagina in paginas:
            marca = "  <<<" if pagina["passou"] else ""
            laudo.write(
                f"{pagina['pagina']:>6}  {pagina['maior']:>5}%  {pagina['media']:>5}%"
                f"  {pagina['areaAcima']:>6}%{marca}\n"
            )
        laudo.write("\n")
        for nota in notas:
            laudo.write(f"- {nota}\n")
        laudo.write(
            "- Os numeros vem de amostragem, nao de todos os pixels: uma A4 a 150 DPI tem 2,2\n"
            "  milhoes deles. O erro fica bem abaixo do que o papel percebe, mas um pico muito\n"
            "  pequeno e isolado pode nao aparecer no 'maior'.\n"
        )

    pedido.andamento(1.0)
    return {
        "arquivo": destino,
        "bytes": os.path.getsize(destino),
        "limite": limite,
        "papel": papel,
        "paginas": paginas,
        "estouradas": len(estouradas),
        "notas": notas,
    }
