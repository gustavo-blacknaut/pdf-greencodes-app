"""Preto de gráfica: CMYK de verdade dentro do PDF.

Numa impressora de escritório preto é preto e acabou. Numa gráfica não: existe
o **K100**, que usa só a chapa preta, e o **preto rico**, que soma um pouco de
ciano e magenta para o preto ficar mais fundo em área chapada.

A diferença é prática. K100 não tem erro de registro — se as chapas saírem um
fio desalinhadas, texto fino em preto rico aparece com franja colorida na
borda, e em K100 não, porque só uma chapa imprime. Por isso texto vai em K100
e fundo chapado vai em preto rico.

Duas coisas precisam estar certas para o RIP obedecer:

1. A imagem tem que estar em **DeviceCMYK**, não em ICC. O MuPDF grava
   `ICCBased(CMYK, SWOP)` por conta própria, e um perfil ICC autoriza o RIP a
   reconverter — o K100 vira quadricromia e some a vantagem toda. Por isso o
   ColorSpace é trocado à mão depois de inserir a imagem.
2. Os quatro canais precisam ser montados sem laço em Python. Uma A4 a 150 DPI
   tem 2,2 milhões de pixels; a fatia com passo 4 no bytearray resolve em
   ~15 ms porque roda em C.
"""

from __future__ import annotations

from functools import lru_cache

import pymupdf

# As tintas que o aplicativo oferece, em porcentagem de C, M, Y e K.
TINTAS = {
    "k100": {
        "nome": "K100 — só a chapa preta",
        "cmyk": (0, 0, 0, 100),
        "nota": "Só a chapa preta imprime, então não há erro de registro. É o preto certo para texto.",
    },
    "rico": {
        "nome": "Preto rico — 20C 20M 100K",
        "cmyk": (20, 20, 0, 100),
        "nota": "Mais fundo em área chapada. Texto fino pode sair com franja colorida se as chapas desalinharem.",
    },
}


def porcentagem(valor: int) -> int:
    """De 0-100 para 0-255, que é como o canal é gravado."""
    return round(max(0, min(100, valor)) * 255 / 100)


@lru_cache(maxsize=16)
def tabela_do_canal(corte: int, tinta: int) -> bytes:
    """Quanto deste canal cada tom de cinza recebe, sem meio-tom.

    São 256 bytes, um por tom possível. Acima do corte é papel e não recebe
    tinta nenhuma; abaixo recebe a quantidade cheia daquele canal.
    """
    return bytes(0 if tom > corte else tinta for tom in range(256))


@lru_cache(maxsize=16)
def tabela_do_canal_com_meio_tom(corte: int, tinta: int) -> bytes:
    """A mesma coisa, mas com o meio-tom no meio.

    O escuro leva a tinta cheia e o claro não leva nenhuma, como no limiar; a
    diferença é que entre os dois a tinta acompanha o tom, e é isso que faz
    foto continuar foto quando a chapa é gerada — o RIP resolve a retícula.
    """
    branco = max(corte + 1, min(255, int(corte * 1.15)))
    preto = max(0, min(branco - 1, int(corte * 0.6)))
    faixa = branco - preto
    return bytes(
        tinta if tom <= preto else 0 if tom >= branco else round(tinta * (branco - tom) / faixa)
        for tom in range(256)
    )


def cmyk_do_cinza(
    cinza: pymupdf.Pixmap,
    corte: int,
    cmyk: tuple[int, int, int, int],
    duro: bool = True,
) -> pymupdf.Pixmap:
    """Transforma a página em cinza numa página de duas cores em CMYK.

    Onde o cinza é escuro entra a tinta escolhida; onde é claro não entra
    tinta nenhuma, e o papel aparece. No modo duro não há meio-tom — é o mesmo
    limiar do tons de preto, só que dizendo em qual chapa a tinta vai; na
    curva, a tinta acompanha o tom.
    """
    total = cinza.width * cinza.height
    vazio = bytes(total)

    planos = []
    for percentual in cmyk:
        tinta = porcentagem(percentual)
        tabela = tabela_do_canal(corte, tinta) if duro else tabela_do_canal_com_meio_tom(corte, tinta)
        planos.append(vazio if tinta == 0 else cinza.samples.translate(tabela))

    # Intercalar com fatia de passo 4: o bytearray faz isso em C, e o laço
    # equivalente em Python levaria segundos por página.
    saida = bytearray(total * 4)
    saida[0::4] = planos[0]
    saida[1::4] = planos[1]
    saida[2::4] = planos[2]
    saida[3::4] = planos[3]

    return pymupdf.Pixmap(pymupdf.csCMYK, cinza.width, cinza.height, bytes(saida), False)


def fixar_devicecmyk(doc: pymupdf.Document) -> int:
    """Troca o ColorSpace das imagens CMYK por DeviceCMYK direto.

    Sem isso o MuPDF grava um perfil ICC, e perfil ICC é permissão para o RIP
    reconverter a cor. Numa gráfica isso significa o K100 chegar na chapa como
    quadricromia, que é exatamente o que se estava tentando evitar.

    Devolve quantas imagens foram trocadas.
    """
    trocadas = 0
    for pagina in doc:
        for imagem in pagina.get_images(full=True):
            xref = imagem[0]
            try:
                info = doc.extract_image(xref)
            except Exception:  # noqa: BLE001 - imagem ilegivel nao impede as outras
                continue

            # colorspace 4 e o numero de canais: so as CMYK interessam aqui.
            if info.get("colorspace") == 4:
                doc.xref_set_key(xref, "ColorSpace", "/DeviceCMYK")
                trocadas += 1
    return trocadas
