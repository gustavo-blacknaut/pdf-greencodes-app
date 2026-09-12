"""Tons de cinza, inverter cor e tons de preto.

As tres redesenham a pagina e transformam os pixels. Redesenhar descarta o
texto vetorial, entao o resultado deixa de ser pesquisavel; e o preco de
garantir que a cor no papel seja a que aparece na tela, porque mexer na cor sem
redesenhar exigiria reinterpretar cada objeto do PDF e ainda assim nao pegaria
o que esta dentro de imagem.

Nenhuma delas percorre pixel a pixel em Python. Uma pagina A4 a 150 DPI tem
2,2 milhoes de pixels, e um laco desses em Python levaria alguns segundos por
pagina: jogaria fora exatamente o ganho que trouxe o PyMuPDF para o projeto. O
cinza sai do proprio MuPDF, a inversao sai de `invert_irect` em C, e o limiar
sai de uma tabela de traducao de 256 bytes aplicada por `bytes.translate`, que
tambem e C.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Callable, Dict, List

import pymupdf

from ..documento import abrir, nome_com_sufixo, salvar
from ..resolucao import aviso_de_reducao, couber, na_faixa
from ..tinta import TINTAS, cmyk_do_cinza, fixar_devicecmyk
from ..protocolo import ErroDoUsuario, Pedido

DPI_PADRAO = 150
DPI_MINIMO = 72
DPI_MAXIMO = 300

LIMITE_PADRAO = 180
LIMITE_MINIMO = 60
LIMITE_MAXIMO = 240


def em_cinza(pixels: pymupdf.Pixmap) -> pymupdf.Pixmap:
    """Deixa a pagina em um canal so, com o peso perceptual do MuPDF.

    A conversao do MuPDF ja usa luminancia, entao verde pesa mais que vermelho,
    que pesa mais que azul. Uma media simples dos tres deixaria texto azul
    quase invisivel no papel.
    """
    if pixels.colorspace is not None and pixels.colorspace.n == 1:
        return pixels
    return pymupdf.Pixmap(pymupdf.csGRAY, pixels)


def _percentis(amostras: bytes, baixo: float, alto: float) -> tuple[int, int]:
    """Os tons onde ficam as pontas da imagem, ignorando o extremo isolado.

    Um pixel preto perdido no canto nao pode decidir o preto da pagina
    inteira, entao as pontas sao percentis e nao o minimo e o maximo. A
    contagem sai de `bytes.count`, que roda em C: 256 varreduras de uma
    amostra pequena custam menos que um laco Python sobre a pagina.
    """
    # De sete em sete: a amostra continua representando a pagina e a conta
    # fica sete vezes mais barata.
    amostra = amostras[::7] or amostras
    total = len(amostra)
    contagem = [amostra.count(tom) for tom in range(256)]

    def tom_em(fracao: float) -> int:
        alvo = total * fracao
        soma = 0
        for tom in range(256):
            soma += contagem[tom]
            if soma >= alvo:
                return tom
        return 255

    return tom_em(baixo), tom_em(alto)


def tabela_de_niveis(preto: int, branco: int) -> bytes:
    """Estica a faixa usada da imagem ate as pontas, com um S de leve.

    Esticar sozinho devolve o preto e o branco, mas o meio continua mole: e o
    "todo cinza" de uma foto convertida. O S levanta o claro e baixa o escuro
    perto do meio, que e o que da corpo a foto em preto e branco sem fechar
    sombra nem estourar luz.
    """
    if branco - preto < 8:
        return bytes(range(256))
    faixa = branco - preto

    def ajustar(tom: int) -> int:
        if tom <= preto:
            return 0
        if tom >= branco:
            return 255
        esticado = (tom - preto) / faixa
        # S suave: no meio empurra 12% para longe do cinza medio; nas pontas
        # nao mexe.
        do_meio = esticado - 0.5
        s = esticado + 0.24 * do_meio * (1 - 4 * do_meio * do_meio)
        return max(0, min(255, round(s * 255)))

    return bytes(ajustar(tom) for tom in range(256))


def em_cinza_com_contraste(pixels: pymupdf.Pixmap) -> pymupdf.Pixmap:
    """Cinza com preto de verdade e branco de verdade.

    Foto colorida convertida direto vira um cinza chapado: a cor carregava o
    contraste, e sem ela sobra meio-tom no meio da faixa. Aqui as pontas da
    imagem sao esticadas ate o preto e o branco, o que devolve o contraste
    sem inventar detalhe nenhum — e o mesmo que o "niveis automaticos" de um
    editor de foto. O meio-tom continua todo la.
    """
    cinza = em_cinza(pixels)
    preto, branco = _percentis(cinza.samples, 0.005, 0.995)
    if preto <= 2 and branco >= 252:
        return cinza  # a imagem ja usa a faixa inteira
    esticados = cinza.samples.translate(tabela_de_niveis(preto, branco))
    return pymupdf.Pixmap(pymupdf.csGRAY, cinza.width, cinza.height, esticados, False)


def inverter(pixels: pymupdf.Pixmap) -> pymupdf.Pixmap:
    """Negativo em preto e branco.

    Passa por cinza primeiro de proposito. Inverter os tres canais de um
    documento colorido devolveria as cores complementares (vermelho vira
    ciano), que e outra coisa e quase nunca e o que se quer: o uso real e ler
    documento de fundo escuro e economizar toner num que veio todo preto.
    """
    cinza = em_cinza(pixels)
    cinza.invert_irect(cinza.irect)
    return cinza


@lru_cache(maxsize=8)
def tabela_de_corte(corte: int) -> bytes:
    """De que tom cada tom vira: tudo acima do corte vai a branco, o resto a preto.

    Sao 256 bytes, um por tom possivel, e o mesmo corte costuma se repetir em
    todas as paginas do documento — por isso a tabela fica guardada.
    """
    return bytes(255 if tom > corte else 0 for tom in range(256))


@lru_cache(maxsize=8)
def tabela_de_curva(corte: int) -> bytes:
    """Escurece o cinza sem jogar fora o meio-tom.

    O limiar duro resolve digitalizacao de texto e estraga todo o resto: a
    borda suavizada de cada letra vira preto e o texto sai borrado, e foto
    vira mancha. Aqui o que e escuro vai a preto cheio, o que e claro vai a
    branco de papel, e o que esta no meio continua existindo — so que mais
    fundo. E o que a maioria dos documentos precisa: preto de verdade na
    impressao, sem perder a foto que estava na pagina.
    """
    preto = max(0, min(254, int(corte * 0.6)))
    branco = max(preto + 1, min(255, int(corte * 1.15)))
    faixa = branco - preto
    return bytes(
        0 if tom <= preto else 255 if tom >= branco else round((tom - preto) * 255 / faixa)
        for tom in range(256)
    )


def escurecer(pixels: pymupdf.Pixmap, corte: int, duro: bool) -> pymupdf.Pixmap:
    """Aplica a tabela escolhida: o limiar duro ou a curva com meio-tom."""
    cinza = em_cinza(pixels)
    tabela = tabela_de_corte(corte) if duro else tabela_de_curva(corte)
    trocados = cinza.samples.translate(tabela)
    return pymupdf.Pixmap(pymupdf.csGRAY, cinza.width, cinza.height, trocados, False)


def limiar(pixels: pymupdf.Pixmap, corte: int) -> pymupdf.Pixmap:
    """Sem meio-termo: abaixo do corte vira preto puro, acima vira branco.

    Cinza claro de digitalizacao imprime falhado, e texto digitalizado costuma
    sair acinzentado. Foto neste modo vira mancha, porque nao sobra meio-tom.

    A troca acontece em `bytes.translate`, que percorre os 2,2 milhoes de
    pixels em C. Chegar aqui com um canal so e o que permite isso: em RGB
    seriam tres bytes por pixel e a tabela nao daria conta.
    """
    cinza = em_cinza(pixels)
    duros = cinza.samples.translate(tabela_de_corte(corte))
    return pymupdf.Pixmap(pymupdf.csGRAY, cinza.width, cinza.height, duros, False)


def _redesenhar(
    pedido: Pedido,
    transformar: Callable[[pymupdf.Pixmap], pymupdf.Pixmap],
    sufixo: str,
    notas: List[str],
    cmyk: bool = False,
) -> Dict[str, Any]:
    """A maquina que as tres operacoes compartilham."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    dpi = na_faixa(pedido.opcao("dpi", DPI_PADRAO), DPI_PADRAO)
    origem = pedido.arquivos[0]
    senha = pedido.senha(0)

    entrada = abrir(origem, senha)
    saida = pymupdf.open()
    reduziu: tuple[int, int] | None = None
    try:
        total = entrada.page_count
        for indice in range(total):
            pedido.andamento(indice / total, f"Pagina {indice + 1} de {total}")

            pagina = entrada[indice]

            # A trava e por pagina: um documento pode misturar A4 e A0, e o
            # que cabe numa nao cabe na outra.
            usado, baixou = couber(pagina.rect.width, pagina.rect.height, dpi, 4 if cmyk else 3)
            if baixou and not reduziu:
                reduziu = (dpi, usado)

            pixels = transformar(pagina.get_pixmap(dpi=usado))

            nova = saida.new_page(width=pagina.rect.width, height=pagina.rect.height)
            nova.insert_image(nova.rect, pixmap=pixels)

            # Solta o mapa de pixels antes da proxima pagina: uma A3 a 300 DPI
            # ocupa uns 50 MB, e segurar duas ja aperta numa maquina de 4 GB.
            del pixels

        # O ColorSpace so pode ser trocado depois que as imagens existem, e
        # tem que ser antes de salvar.
        if cmyk:
            fixar_devicecmyk(saida)

        destino = pedido.saida or nome_com_sufixo(origem, sufixo)
        bytes_saida = salvar(saida, destino, senha)

        pedido.andamento(1.0)
        recados = list(notas)
        if reduziu:
            recados.insert(0, aviso_de_reducao(*reduziu))
        return {"arquivo": destino, "paginas": total, "bytes": bytes_saida, "notas": recados}
    finally:
        saida.close()
        entrada.close()


def tons_de_cinza(pedido: Pedido) -> Dict[str, Any]:
    """Preto e branco com meio-tom, com ou sem o contraste automatico.

    O automatico e o padrao porque foto convertida direto sai chapada: quem
    pede tons de cinza quer a foto em preto e branco, e nao um borrao cinza.
    """
    automatico = str(pedido.opcao("contraste", "auto")) != "nenhum"
    notas = [
        "O documento virou preto e branco com meio-tom, que e o modo certo para foto.",
        "As paginas viraram imagem, entao o texto deixa de ser selecionavel.",
    ]
    if automatico:
        notas.insert(
            0,
            "O contraste foi ajustado por pagina: o mais escuro virou preto e o mais claro virou branco, "
            "sem perder o meio-tom.",
        )
    return _redesenhar(
        pedido,
        em_cinza_com_contraste if automatico else em_cinza,
        "cinza",
        notas,
    )


def inverter_cor(pedido: Pedido) -> Dict[str, Any]:
    return _redesenhar(
        pedido,
        inverter,
        # "negativo", e nao "invertido": esse e o nome que o inverter paginas
        # usa, e os dois caiam no mesmo arquivo na mesma pasta.
        "negativo",
        [
            "O que era escuro ficou claro e o que era claro ficou escuro.",
            "As paginas viraram imagem, entao o texto deixa de ser selecionavel.",
        ],
    )


def tons_de_preto(pedido: Pedido) -> Dict[str, Any]:
    """Tudo abaixo do corte vira preto; acima, papel.

    A tinta decide em qual chapa esse preto sai. `rgb` serve para laser e para
    ler na tela. `k100` e `rico` gravam DeviceCMYK de verdade, e existem porque
    numa grafica preto nao e uma cor so: ver o modulo `tinta`.
    """
    corte = max(LIMITE_MINIMO, min(LIMITE_MAXIMO, int(pedido.opcao("limite", LIMITE_PADRAO))))
    tinta = str(pedido.opcao("tinta", "rgb"))
    # Duro so quando pedido: e o modo que estraga foto e engrossa texto.
    duro = str(pedido.opcao("modo", "curva")) == "limiar"

    comum = (
        [
            "Cinza virou preto puro e o fundo virou branco, sem meio-tom.",
            "Neste modo foto vira mancha e a borda da letra engrossa. Para documento com foto, use a curva.",
        ]
        if duro
        else [
            "O escuro virou preto cheio e o fundo virou branco, com o meio-tom preservado.",
            "Foto continua foto: para jogar fora o meio-tom de proposito, escolha o limiar.",
        ]
    )

    if tinta not in TINTAS:
        return _redesenhar(pedido, lambda pixels: escurecer(pixels, corte, duro), "preto", comum)

    escolhida = TINTAS[tinta]
    c, m, y, k = escolhida["cmyk"]

    return _redesenhar(
        pedido,
        lambda pixels: cmyk_do_cinza(em_cinza(pixels), corte, (c, m, y, k), duro),
        f"preto-{tinta}",
        [
            f"O preto saiu em {escolhida['nome']}, gravado como DeviceCMYK.",
            escolhida["nota"],
            "Sem perfil ICC no meio, entao o RIP recebe exatamente estes valores de tinta.",
            *comum,
        ],
        cmyk=True,
    )
