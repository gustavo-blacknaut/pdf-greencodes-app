"""Folha de fotos: várias cópias da mesma foto numa folha só.

É o trabalho de balcão mais repetido de uma gráfica: nove 3x4 num 10x15 para
documento. O molde do Corel resolve o desenho, mas não resolve o enquadramento
— cada rosto entra num lugar diferente do retângulo, e é isso que dá trabalho.
Aqui o recorte vem escolhido da tela e a folha sai montada.

Tudo em milímetros, que é como papel e foto são vendidos. A conversão para
ponto (1/72 de polegada) acontece só na hora de desenhar.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Tuple

import pymupdf

from ..documento import abrir, nome_com_sufixo
from ..protocolo import ErroDoUsuario, Pedido

PONTOS_POR_MM = 72 / 25.4

# Os formatos de foto, em milímetros.
#
# A polaroid é o único com moldura: a foto quadrada não fica centrada, sobra
# uma tarja larga embaixo, que é onde se escreve. As medidas são as da
# Polaroid 600 de verdade.
MODELOS: Dict[str, Dict[str, Any]] = {
    # As três de baixo não são grade: são a revelação avulsa, uma foto só do
    # tamanho do papel. `papel_sugerido` aponta pro papel do mesmo tamanho, e
    # a tela seleciona ele sozinha — sem margem nos dois, sai sem borda
    # branca, do jeito que uma foto revelada em laboratório sai.
    "10x15": {"nome": "10x15", "largura": 100, "altura": 150, "papel_sugerido": "10x15"},
    "13x18": {"nome": "13x18", "largura": 130, "altura": 180, "papel_sugerido": "13x18"},
    "15x20": {"nome": "15x20", "largura": 150, "altura": 200, "papel_sugerido": "15x20"},
    "3x4": {"nome": "3x4 — documento", "largura": 30, "altura": 40},
    "3x4-grande": {"nome": "3,5x4,5 — passaporte europeu", "largura": 35, "altura": 45},
    "5x7": {"nome": "5x7", "largura": 50, "altura": 70},
    "2x2pol": {"nome": "2x2 polegadas — visto americano", "largura": 51, "altura": 51},
    "6x9": {"nome": "6x9", "largura": 60, "altura": 90},
    "9x12": {"nome": "9x12", "largura": 90, "altura": 120},
    # A polaroid do balcao e 7,5 x 10: duas cabem num 10x15, que e o papel que
    # a loja usa. A Polaroid 600 de verdade (8,89 x 10,79) so cabe uma, e
    # sobra papel — por isso ela ficou como opcao separada, e nao como padrao.
    #
    # `deitado` e a mesma polaroid de lado, com a tarja continuando embaixo:
    # quem fotografa paisagem quer o cartao deitado, e nao a foto girada
    # dentro de um cartao em pe.
    "polaroid": {
        "nome": "Polaroid 7,5 x 10",
        "largura": 75,
        "altura": 100,
        "moldura": {"esquerda": 5, "topo": 5, "largura": 65, "altura": 65},
        "deitado": {
            "largura": 100,
            "altura": 75,
            "moldura": {"esquerda": 5, "topo": 5, "largura": 90, "altura": 50},
        },
    },
    "polaroid-600": {
        "nome": "Polaroid 600 — a original",
        "largura": 88.9,
        "altura": 107.9,
        "moldura": {"esquerda": 4.95, "topo": 4.95, "largura": 79, "altura": 79},
        "deitado": {
            "largura": 107.9,
            "altura": 88.9,
            "moldura": {"esquerda": 4.95, "topo": 4.95, "largura": 98, "altura": 62},
        },
    },
    "adesivo-redondo": {"nome": "Adesivo redondo 5 cm", "largura": 50, "altura": 50, "redondo": True},
    "adesivo-quadrado": {"nome": "Adesivo quadrado 5 cm", "largura": 50, "altura": 50},
}

# Os papéis, em milímetros.
PAPEIS: Dict[str, Tuple[float, float]] = {
    "10x15": (100, 150),
    "13x18": (130, 180),
    "15x20": (150, 200),
    "15x21": (150, 210),
    "20x25": (200, 250),
    "A4": (210, 297),
    "A3": (297, 420),
}

# Foto costuma sair sem margem, porque impressora de foto imprime até a borda e
# o corte vem depois. Quem precisar de margem põe na tela.
MARGEM_PADRAO = 0.0
ESPACO_PADRAO = 0.0

DPI_PADRAO = 300
DPI_DA_PREVIA = 100


def cabem_quantas(
    foto: Tuple[float, float],
    papel: Tuple[float, float],
    margem: float,
    espaco: float,
) -> Tuple[int, int]:
    """Colunas e linhas de uma foto desse tamanho nesse papel."""
    uteis_x = papel[0] - 2 * margem + espaco
    uteis_y = papel[1] - 2 * margem + espaco

    return (
        int(uteis_x // (foto[0] + espaco)),
        int(uteis_y // (foto[1] + espaco)),
    )


def encaixar(
    foto: Tuple[float, float],
    papel: Tuple[float, float],
    margem: float,
    espaco: float,
    deitar: bool = False,
) -> Tuple[int, int, bool]:
    """Quantas fotos cabem na folha, em pé por padrão.

    Deitar a foto às vezes rende uma a mais — um 3x4 num 10x15 dá 10 deitado
    contra 9 em pé — mas a folha de documento é 3 por 3 em pé, e é assim que
    ela sai do molde e é assim que a guilhotina corta. Render mais não vale
    entregar uma folha diferente da que a pessoa esperava, então deitar só
    acontece quando alguém pede.
    """
    colunas, linhas = cabem_quantas(foto, papel, margem, espaco)

    if deitar:
        c_deitada, l_deitada = cabem_quantas((foto[1], foto[0]), papel, margem, espaco)
        if c_deitada * l_deitada > colunas * linhas:
            return c_deitada, l_deitada, True

    if colunas * linhas == 0:
        virada = cabem_quantas((foto[1], foto[0]), papel, margem, espaco)
        if virada[0] * virada[1] > 0:
            raise ErroDoUsuario(
                "essa foto não cabe nesse papel em pé, mas cabe deitada — marque a opção de deitar"
            )
        raise ErroDoUsuario("essa foto não cabe nesse papel; escolha um papel maior")

    return colunas, linhas, False


def area_do_recorte(pagina: pymupdf.Page, recorte: Dict[str, float] | None) -> pymupdf.Rect:
    """A parte da foto que vai para o papel.

    Vem da tela como fração de 0 a 1, para não depender do tamanho em pixels
    da imagem: a mesma escolha vale se a pessoa trocar a foto por uma maior.
    """
    inteira = pagina.rect
    if not recorte:
        return inteira

    x = float(recorte.get("x", 0))
    y = float(recorte.get("y", 0))
    largura = float(recorte.get("largura", 1))
    altura = float(recorte.get("altura", 1))

    # Um recorte fora da imagem vira imagem inteira em vez de erro: a tela
    # arredonda, e meio pixel a mais não é motivo para recusar o trabalho.
    x = max(0.0, min(1.0, x))
    y = max(0.0, min(1.0, y))
    largura = max(0.01, min(1.0 - x, largura))
    altura = max(0.01, min(1.0 - y, altura))

    return pymupdf.Rect(
        inteira.x0 + x * inteira.width,
        inteira.y0 + y * inteira.height,
        inteira.x0 + (x + largura) * inteira.width,
        inteira.y0 + (y + altura) * inteira.height,
    )


def na_proporcao(area: pymupdf.Rect, proporcao: float) -> pymupdf.Rect:
    """Apara o recorte até ele ter exatamente a proporção da casa.

    Sem isso o MuPDF encaixa a foto inteira dentro da casa e sobra tarja
    branca em dois lados, porque ele preserva a proporção da imagem. Numa
    folha de 3x4 essa tarja aparece depois do corte, e a foto sai errada.

    Apara pelo centro: o rosto costuma estar no meio do recorte que a pessoa
    escolheu, então tirar das bordas é o que menos incomoda.
    """
    atual = area.width / area.height
    if abs(atual - proporcao) < 0.001:
        return area

    meio_x = (area.x0 + area.x1) / 2
    meio_y = (area.y0 + area.y1) / 2

    if atual > proporcao:
        largura = area.height * proporcao
        return pymupdf.Rect(meio_x - largura / 2, area.y0, meio_x + largura / 2, area.y1)

    altura = area.width / proporcao
    return pymupdf.Rect(area.x0, meio_y - altura / 2, area.x1, meio_y + altura / 2)


def _desenhar_a_foto(
    pagina: pymupdf.Page,
    area: pymupdf.Rect,
    alvo_mm: float,
    dpi: int,
) -> pymupdf.Pixmap:
    """Desenha o recorte no tamanho que a casa precisa, e nada alem disso.

    A conta e pelo tamanho impresso: uma foto de 100 mm a 300 DPI pede 1181
    pixels de largura. Antes o desenho saia na resolucao da pagina da foto, e
    a pagina de uma imagem vale um ponto por pixel — entao pedir 300 DPI
    multiplicava a foto por 4,17. Uma foto de 1843 px virava 7681 px, sem um
    detalhe novo: uma folha 10x15 saia com 9,6 MB de pixel inventado.

    Nunca amplia. Mais pixel que o original nao e mais detalhe; e so arquivo
    maior e impressao mais lenta.
    """
    alvo_px = max(alvo_mm, 1) / 25.4 * max(dpi, 1)
    escala = min(alvo_px / max(area.width, 1), 1.0)
    return pagina.get_pixmap(clip=area, matrix=pymupdf.Matrix(escala, escala))


def _escrever_na_tarja(
    pagina: pymupdf.Page,
    cartao: pymupdf.Rect,
    janela: pymupdf.Rect,
    texto: str,
) -> None:
    """Escreve na tarja branca da polaroid, centralizado.

    A tarja e o que sobra do cartao abaixo da foto — e para isso que ela
    existe. O tamanho da letra sai da altura da tarja e encolhe ate a frase
    caber na largura: nome comprido nao pode vazar para fora do cartao.
    """
    tarja = pymupdf.Rect(cartao.x0, janela.y1, cartao.x1, cartao.y1)
    if tarja.height < 6 or not texto.strip():
        return

    largura_util = tarja.width * 0.88
    tamanho = min(tarja.height * 0.42, 22)
    fonte = pymupdf.Font("helv")
    while tamanho > 5 and fonte.text_length(texto, tamanho) > largura_util:
        tamanho -= 0.5

    linha = fonte.text_length(texto, tamanho)
    pagina.insert_text(
        pymupdf.Point(tarja.x0 + (tarja.width - linha) / 2, tarja.y0 + tarja.height / 2 + tamanho * 0.35),
        texto,
        fontsize=tamanho,
        fontname="helv",
        color=(0.15, 0.15, 0.15),
    )


def _celula(x_mm: float, y_mm: float, largura_mm: float, altura_mm: float) -> pymupdf.Rect:
    """Um retângulo em milímetros, devolvido em pontos."""
    return pymupdf.Rect(
        x_mm * PONTOS_POR_MM,
        y_mm * PONTOS_POR_MM,
        (x_mm + largura_mm) * PONTOS_POR_MM,
        (y_mm + altura_mm) * PONTOS_POR_MM,
    )


def _marcas_de_corte(pagina: pymupdf.Page, caixa: pymupdf.Rect, comprimento_mm: float = 3) -> None:
    """Risquinhos nos cantos, fora da foto, para guiar a guilhotina.

    Ficam do lado de fora do retângulo de propósito: risco por cima da foto
    apareceria no documento depois de cortado.
    """
    traco = comprimento_mm * PONTOS_POR_MM
    cinza = (0.6, 0.6, 0.6)

    for x in (caixa.x0, caixa.x1):
        pagina.draw_line(pymupdf.Point(x, caixa.y0 - traco), pymupdf.Point(x, caixa.y0), color=cinza, width=0.25)
        pagina.draw_line(pymupdf.Point(x, caixa.y1), pymupdf.Point(x, caixa.y1 + traco), color=cinza, width=0.25)

    for y in (caixa.y0, caixa.y1):
        pagina.draw_line(pymupdf.Point(caixa.x0 - traco, y), pymupdf.Point(caixa.x0, y), color=cinza, width=0.25)
        pagina.draw_line(pymupdf.Point(caixa.x1, y), pymupdf.Point(caixa.x1 + traco, y), color=cinza, width=0.25)


def montar_folha(
    origem: str,
    modelo: Dict[str, Any],
    papel: Tuple[float, float],
    recorte: Dict[str, float] | None,
    margem: float,
    espaco: float,
    marcas: bool,
    quantidade: int | None,
    dpi: int,
    deitar: bool = False,
    esticar: bool = False,
    texto: str = "",
    sangria: float = 0.0,
    senha: str = "",
) -> Tuple[pymupdf.Document, Dict[str, Any]]:
    """Desenha a folha e devolve o documento junto com o que foi feito."""
    if not os.path.exists(origem):
        raise ErroDoUsuario(f"não encontrei a imagem: {os.path.basename(origem)}")

    # Pelo `abrir` do documento, e nao pelo `pymupdf.open` cru: e ali que mora
    # a conversao que faz uma foto virar PDF de uma pagina. Sem ela, um
    # arquivo que o MuPDF abre mas nao trata como PDF derruba a operacao la na
    # frente com "is no PDF", que nao diz nada a quem esta no balcao.
    try:
        imagem = abrir(origem, senha)
    except ErroDoUsuario:
        raise
    except Exception as erro:  # noqa: BLE001
        raise ErroDoUsuario(
            f"não consegui abrir {os.path.basename(origem)}: {erro}. "
            "Se for foto de celular em HEIC, ou um formato menos comum, salve como JPG ou PNG antes."
        ) from erro

    with imagem:
        if imagem.page_count == 0:
            raise ErroDoUsuario("esse arquivo não tem imagem dentro")

        pagina_da_foto = imagem[0]
        area = area_do_recorte(pagina_da_foto, recorte)

        medida_final = (float(modelo["largura"]), float(modelo["altura"]))
        moldura = modelo.get("moldura")

        # Sobra para o corte: a foto sai um pouco maior que a medida final e a
        # guilhotina entra por dentro da imagem. É o 3,2 x 4,2 do balcão para
        # um 3x4 — sem isso, o corte um fio fora do lugar deixa tarja branca.
        #
        # Só vale se não custar foto nenhuma: numa revelação 10x15 em papel
        # 10x15 a sobra não caberia, e aí ela some sozinha.
        sangria = max(0.0, min(10.0, float(sangria)))
        if sangria and not moldura:
            com = cabem_quantas((medida_final[0] + sangria, medida_final[1] + sangria), papel, margem, espaco)
            sem = cabem_quantas(medida_final, papel, margem, espaco)
            if com[0] * com[1] < sem[0] * sem[1]:
                sangria = 0.0
        else:
            sangria = 0.0

        largura_foto = medida_final[0] + sangria
        altura_foto = medida_final[1] + sangria

        colunas, linhas, girado = encaixar((largura_foto, altura_foto), papel, margem, espaco, deitar)

        # Moldura nunca deita: a tarja larga da polaroid é onde se escreve, e
        # ela tem que ficar embaixo.
        if moldura:
            girado = False
        elif girado:
            largura_foto, altura_foto = altura_foto, largura_foto

        cabem = colunas * linhas
        quantas = cabem if quantidade is None else max(1, min(cabem, quantidade))

        # A foto recortada é desenhada uma vez e reaproveitada em todas as
        # casas. Desenhar por casa multiplicaria o tempo e o tamanho do
        # arquivo por nove sem nenhum ganho. Deitar é trabalho do insert_image,
        # que resolve na hora de posicionar e dispensa um segundo desenho.
        # A casa manda na proporcao. Numa moldura quem manda e a janela de
        # dentro, nao o cartao inteiro.
        if moldura:
            alvo = moldura["largura"] / moldura["altura"]
        elif girado:
            alvo = altura_foto / largura_foto
        else:
            alvo = largura_foto / altura_foto

        # Esticar pula o recorte pela proporção: pega a área exatamente como
        # foi selecionada, de qualquer formato, e deixa o insert_image
        # esticar para preencher a casa. É a "mágica" de caber sem cortar —
        # o preço é que, se a proporção não bater, a imagem distorce.
        area_final = area if esticar else na_proporcao(area, alvo)
        # Quanto a foto vai medir no papel, de verdade: e dessa medida que sai
        # a resolucao do desenho. Deitada, a largura da imagem cai na altura
        # da casa; com moldura, o que conta e a janela de dentro.
        if moldura:
            alvo_mm = moldura["largura"]
        elif girado:
            alvo_mm = altura_foto
        else:
            alvo_mm = largura_foto
        pixels = _desenhar_a_foto(pagina_da_foto, area_final, alvo_mm, dpi)
        # A casa e preenchida inteira (keep_proportion=False): o recorte ja
        # saiu na proporcao dela, e o arredondamento de pixel do desenho
        # deixava um fio de papel branco em dois lados.
        # JPEG, e nao o mapa de pixels cru: foto em PNG dentro do PDF e o que
        # fazia uma folha 10x15 sair com 9,6 MB. A 92 a diferenca nao sai no
        # papel, e o arquivo cai para menos de um decimo.
        foto = pixels.tobytes("jpeg", jpg_quality=92)
        giro = 90 if girado else 0

        folha = pymupdf.open()
        pagina = folha.new_page(width=papel[0] * PONTOS_POR_MM, height=papel[1] * PONTOS_POR_MM)

        # Centraliza a grade no papel: o que sobra vira margem igual dos dois
        # lados, que é como um laboratório de fotos monta a folha.
        usado_x = colunas * largura_foto + (colunas - 1) * espaco
        usado_y = linhas * altura_foto + (linhas - 1) * espaco
        canto_x = (papel[0] - usado_x) / 2
        canto_y = (papel[1] - usado_y) / 2

        postas = 0

        for linha in range(linhas):
            for coluna in range(colunas):
                if postas >= quantas:
                    break

                x = canto_x + coluna * (largura_foto + espaco)
                y = canto_y + linha * (altura_foto + espaco)
                caixa = _celula(x, y, largura_foto, altura_foto)

                if moldura:
                    # A moldura branca da polaroid: o papel já é branco, então
                    # o que importa é a foto entrar menor e fora do centro.
                    pagina.draw_rect(caixa, color=(0.85, 0.85, 0.85), fill=(1, 1, 1), width=0.3)
                    dentro = _celula(
                        x + moldura["esquerda"],
                        y + moldura["topo"],
                        moldura["largura"],
                        moldura["altura"],
                    )
                    pagina.insert_image(dentro, stream=foto, rotate=giro, keep_proportion=False)
                    if texto:
                        _escrever_na_tarja(pagina, caixa, dentro, texto)
                else:
                    pagina.insert_image(caixa, stream=foto, rotate=giro, keep_proportion=False)

                if modelo.get("redondo"):
                    # Guia de corte redondo: um círculo fino por cima marca
                    # onde a máquina de recorte vai passar.
                    meio = pymupdf.Point((caixa.x0 + caixa.x1) / 2, (caixa.y0 + caixa.y1) / 2)
                    pagina.draw_circle(meio, caixa.width / 2, color=(0.6, 0.6, 0.6), width=0.25)
                elif marcas:
                    # A marca fica na medida final, e não na borda do que foi
                    # impresso: é por ali que a guilhotina passa, deixando a
                    # sobra de cada lado como folga.
                    meio_da_sobra = sangria / 2
                    _marcas_de_corte(
                        pagina,
                        caixa + (meio_da_sobra * PONTOS_POR_MM, meio_da_sobra * PONTOS_POR_MM,
                                 -meio_da_sobra * PONTOS_POR_MM, -meio_da_sobra * PONTOS_POR_MM),
                    )

                postas += 1

        outra = cabem_quantas((altura_foto, largura_foto), papel, margem, espaco)
        # E o mesmo papel virado na bandeja: uma polaroid de 7,5x10 cabe uma
        # vez no 10x15 em pe e duas vezes deitado.
        virada = cabem_quantas((largura_foto, altura_foto), (papel[1], papel[0]), margem, espaco)

        resumo = {
            "modelo": modelo["nome"],
            "fotoMm": [round(largura_foto, 1), round(altura_foto, 1)],
            "papelMm": [papel[0], papel[1]],
            "colunas": colunas,
            "linhas": linhas,
            "cabem": cabem,
            "postas": postas,
            "girada": girado,
            "cabemDeitando": outra[0] * outra[1],
            "cabemComAFolhaDeitada": virada[0] * virada[1],
            "sangriaMm": round(sangria, 1),
            "medidaFinalMm": [round(medida_final[0], 1), round(medida_final[1], 1)],
            "esticada": esticar and abs(area.width / area.height - alvo) > 0.02,
        }
        return folha, resumo


def folha_de_fotos(pedido: Pedido) -> Dict[str, Any]:
    """Monta a folha, como PDF para imprimir ou como imagem para conferir antes."""
    if not pedido.arquivos:
        raise ErroDoUsuario("escolha a foto primeiro")

    nome_modelo = str(pedido.opcao("modelo", "3x4"))
    if nome_modelo == "personalizado":
        # Medida livre: adesivo de 4 cm, foto de 7x9, tag de 25x60 — o balcao
        # pede tamanho que nenhuma lista cobre.
        modelo = {
            "nome": "Personalizado",
            "largura": max(10.0, min(400.0, float(pedido.opcao("larguraMm", 50)))),
            "altura": max(10.0, min(400.0, float(pedido.opcao("alturaMm", 50)))),
        }
        if bool(pedido.opcao("redondo", False)):
            modelo["redondo"] = True
    else:
        modelo = MODELOS.get(nome_modelo)
    if modelo is None:
        raise ErroDoUsuario(f"não conheço o formato {nome_modelo}")

    # A polaroid (e qualquer modelo com moldura) pode ir deitada: o cartao e
    # que vira, com a tarja continuando embaixo.
    if bool(pedido.opcao("deitar", False)) and modelo.get("deitado"):
        modelo = {**modelo, **modelo["deitado"]}

    nome_papel = str(pedido.opcao("papel", "10x15"))
    papel = PAPEIS.get(nome_papel)
    if papel is None:
        raise ErroDoUsuario(f"não conheço o papel {nome_papel}")

    # A folha em pé ou deitada. Os papéis estão guardados em pé, e virar é só
    # trocar as medidas — mas muda quantas fotos cabem, e às vezes muda muito:
    # num 10x15 deitado cabem doze 3x4 em vez de nove.
    if bool(pedido.opcao("paisagem", False)):
        papel = (papel[1], papel[0])

    previa = bool(pedido.opcao("previa", False))
    quantidade = pedido.opcao("quantidade")

    pedido.andamento(0.2, "Recortando a foto")
    folha, resumo = montar_folha(
        origem=pedido.arquivos[0],
        senha=pedido.senha(0),
        modelo=modelo,
        papel=papel,
        recorte=pedido.opcao("recorte"),
        margem=float(pedido.opcao("margem", MARGEM_PADRAO)),
        espaco=float(pedido.opcao("espaco", ESPACO_PADRAO)),
        marcas=bool(pedido.opcao("marcas", True)),
        deitar=bool(pedido.opcao("deitar", False)),
        esticar=bool(pedido.opcao("esticar", False)),
        texto=str(pedido.opcao("texto", "") or ""),
        sangria=float(pedido.opcao("sangriaMm", 0)),
        quantidade=None if quantidade in (None, "", 0) else int(quantidade),
        dpi=DPI_DA_PREVIA if previa else max(150, min(600, int(pedido.opcao("dpi", DPI_PADRAO)))),
    )

    pedido.andamento(0.7, "Montando a folha")
    try:
        if previa:
            pasta = pedido.saida or os.path.dirname(pedido.arquivos[0])
            os.makedirs(pasta, exist_ok=True)
            destino = os.path.join(pasta, "previa-folha.png")
            folha[0].get_pixmap(dpi=DPI_DA_PREVIA).save(destino)
        else:
            destino = pedido.saida or nome_com_sufixo(pedido.arquivos[0], f"folha-{nome_modelo}", ".pdf")
            folha.save(destino, garbage=4, deflate=True)
    finally:
        folha.close()

    pedido.andamento(1.0)
    return {
        "arquivo": destino,
        "previa": previa,
        "bytes": os.path.getsize(destino),
        **resumo,
        "notas": [] if previa else _recados(resumo),
    }


def _recados(resumo: Dict[str, Any]) -> List[str]:
    """O que sai na folha, e o que sairia se o papel virasse.

    A segunda parte existe porque o papel de foto nao tem lado: 10x15 e 15x10
    sao a mesma folha na bandeja. Uma polaroid de 7,5x10 cabe uma vez no 10x15
    em pe e duas vezes deitado — e quem esta no balcao precisa saber disso
    antes de imprimir, nao depois.
    """
    recados = [_recado(resumo)]
    sangria = float(resumo.get("sangriaMm", 0))
    if sangria:
        final = resumo.get("medidaFinalMm", [0, 0])
        recados.append(
            f"Cada foto sai impressa com {resumo['fotoMm'][0]}x{resumo['fotoMm'][1]} mm e as marcas estao "
            f"na medida final, {final[0]}x{final[1]} mm: a sobra de {sangria} mm e para a guilhotina entrar "
            "por dentro da imagem, sem deixar tarja branca."
        )
    virando = int(resumo.get("cabemComAFolhaDeitada", 0))
    if virando > int(resumo.get("cabem", 0)):
        recados.append(
            f"Virando a folha cabem {virando} em vez de {resumo['cabem']}: e o mesmo papel, "
            "so de lado na bandeja. Marque 'folha deitada' e monte de novo."
        )
    return recados


def _recado(resumo: Dict[str, Any]) -> str:
    esticada = " A imagem foi esticada para preencher sem cortar — a proporção do recorte não era a mesma do quadro, então algo saiu levemente deformado." if resumo.get("esticada") else ""

    if resumo["colunas"] == 1 and resumo["linhas"] == 1:
        largura, altura = resumo["fotoMm"]
        largura_papel, altura_papel = resumo["papelMm"]
        sem_borda = abs(largura - largura_papel) < 1 and abs(altura - altura_papel) < 1
        fecho = "sem borda branca, preenchendo o papel." if sem_borda else "com borda, porque o papel é maior que a foto."
        return f"Uma foto de {largura}x{altura} mm, {fecho} Imprima em tamanho real, sem ajustar à página.{esticada}"

    parte = f"{resumo['postas']} fotos de {resumo['fotoMm'][0]}x{resumo['fotoMm'][1]} mm"
    grade = f"{resumo['colunas']} por {resumo['linhas']}"
    deitada = ", com a foto deitada para caber mais" if resumo["girada"] else ""
    return f"{parte} em grade de {grade}{deitada}. Imprima em tamanho real, sem ajustar à página.{esticada}"


def formatos(pedido: Pedido) -> Dict[str, Any]:
    """O catálogo, para a tela montar as opções sem repetir as medidas."""
    del pedido
    return {
        "modelos": [
            {
                "id": chave,
                "nome": dados["nome"],
                "largura": dados["largura"],
                "altura": dados["altura"],
                "proporcao": round(dados["largura"] / dados["altura"], 4),
                "moldura": dados.get("moldura"),
                "redondo": bool(dados.get("redondo")),
                "papelSugerido": dados.get("papel_sugerido"),
            }
            for chave, dados in MODELOS.items()
        ],
        "papeis": [{"id": chave, "nome": chave, "largura": w, "altura": h} for chave, (w, h) in PAPEIS.items()],
    }
