"""Deixar o arquivo menor.

Dois caminhos, porque servem a documentos diferentes. O caminho leve so
arruma a estrutura do PDF e nao toca em nenhuma imagem: o resultado e
identico ao original, so que menor. O caminho pesado redesenha as paginas, e
ai a reducao e grande mas a qualidade cai e o texto deixa de ser selecionavel.
"""

from __future__ import annotations

import os
import shutil
from typing import Any, Dict

import pymupdf
from pymupdf import mupdf

from ..documento import abrir, nome_com_sufixo, salvar
from ..protocolo import ErroDoUsuario, Pedido

# DPI de cada nivel do caminho pesado. 150 e leitura de tela, 110 e rascunho e
# 200 ainda imprime bem em laser.
DPI_POR_NIVEL = {"pouco": 200, "medio": 150, "muito": 110}
QUALIDADE_POR_NIVEL = {"pouco": 88, "medio": 78, "muito": 62}


def comprimir(pedido: Pedido) -> Dict[str, Any]:
    """Reduz o arquivo, avisando quanto reduziu de verdade.

    Se o PDF ja estava enxuto, o resultado pode sair do mesmo tamanho ou maior.
    Nesse caso o original e mantido e a nota explica: entregar um arquivo maior
    chamando de comprimido seria mentir para quem pediu.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    nivel = str(pedido.opcao("nivel", "medio"))
    redesenhar = bool(pedido.opcao("redesenhar", False))
    # "imagens" e o caminho do meio, e o padrao: so as fotos encolhem, o texto
    # continua texto. E onde mora quase todo o peso de um PDF real.
    so_imagens = str(pedido.opcao("modo", "")) == "imagens"
    # Para a nota de "nao havia o que reduzir", que cita a resolucao pedida.
    dpi = int(pedido.opcao("dpi", 150))

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    bytes_entrada = os.path.getsize(origem)

    entrada = abrir(origem, senha)
    try:
        if redesenhar:
            resultado, paginas = _redesenhando(pedido, entrada, nivel)
        elif so_imagens:
            _recomprimindo_imagens(pedido, entrada)
            resultado, paginas = entrada, entrada.page_count
        else:
            resultado, paginas = entrada, entrada.page_count
            pedido.andamento(0.5, "Reorganizando o arquivo")

        destino = pedido.saida or nome_com_sufixo(origem, "comprimido")
        bytes_saida = salvar(resultado, destino, senha)

        if resultado is not entrada:
            resultado.close()
    finally:
        entrada.close()

    notas = []
    if senha:
        notas.append("A senha do arquivo original foi mantida no resultado.")

    if bytes_saida >= bytes_entrada:
        # Nao entrega arquivo maior chamando de comprimido: o original volta
        # por cima do resultado, e a nota diz por que.
        shutil.copyfile(origem, destino)
        bytes_saida = bytes_entrada
        if redesenhar:
            notas.append(
                "Nem redesenhando o arquivo ficou menor: as imagens ja estavam bem compactadas. "
                "O original foi mantido."
            )
        elif so_imagens:
            notas.append(
                f"As fotos deste PDF ja estao em {dpi} DPI ou menos, entao nao havia o que reduzir sem "
                "estragar. O original foi mantido. Para um arquivo de tela ou e-mail, escolha uma "
                "resolucao menor."
            )
        else:
            # Sem perda nao toca em foto nenhuma: e quase sempre por isso que
            # um PDF de foto volta do mesmo tamanho. Mandar o caminho certo
            # vale mais do que dizer que ja estava no menor possivel.
            notas.append(
                "Sem perda so reorganiza a estrutura, e neste arquivo nao havia folga: o original foi "
                "mantido. Se o peso esta nas fotos, escolha a resolucao de impressao (300 DPI) — ela "
                "costuma cortar muito e nao tira nada que o papel mostre."
            )
    elif so_imagens:
        notas.append(
            "As fotos foram reduzidas e recomprimidas. Texto, linhas e vetores continuam como estavam: "
            "da para selecionar, pesquisar e imprimir nitido."
        )
    if redesenhar:
        notas.append("As paginas viraram imagem, entao o texto deixa de ser selecionavel e pesquisavel.")

    pedido.andamento(1.0)
    return {
        "arquivo": destino,
        "paginas": paginas,
        "bytesEntrada": bytes_entrada,
        "bytesSaida": bytes_saida,
        "reducao": round(1 - bytes_saida / bytes_entrada, 4) if bytes_entrada else 0,
        "notas": notas,
    }


# A tabela de quantizacao de luminancia do padrao JPEG (anexo K), em ordem natural.
# Todo programa que grava JPEG "com qualidade Q" parte dela e a multiplica por um fator.
_QUANTIZACAO_PADRAO = (
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99,
)  # fmt: skip

# O JPEG grava a tabela em zigue-zague: a posicao k do arquivo e esta da tabela natural.
_ZIGZAG = (
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
)  # fmt: skip


def _qualidade_do_jpeg(dados: bytes) -> int | None:
    """Estima o "quality" de um JPEG pela sua tabela de quantizacao, ou nada se nao der.

    So o cabecalho basta: a tabela vem antes dos pixels. A estimativa usa as
    posicoes em que o padrao tem valor alto (>= 40), porque nas de valor baixo a
    tabela satura em 1 quando a qualidade passa de uns 92 e o resultado
    subestimaria — e subestimar a qualidade aqui faria pular um trabalho que
    tinha ganho. Fica dentro de uns 3 pontos, o que basta para a decisao.
    """
    limite = min(len(dados), 65536)
    i = 2
    while i + 4 < limite:
        if dados[i] != 0xFF:
            i += 1
            continue
        marca = dados[i + 1]
        if marca == 0xFF:
            i += 1
            continue
        if marca == 0xD8 or marca == 0x01 or 0xD0 <= marca <= 0xD7:
            i += 2  # marcas sem comprimento
            continue
        if marca == 0xDA:
            return None  # comecaram os pixels e nenhuma tabela de luminancia apareceu
        tamanho = (dados[i + 2] << 8) | dados[i + 3]
        if marca == 0xDB:  # DQT
            j, fim = i + 4, min(i + 2 + tamanho, len(dados))
            while j < fim:
                info = dados[j]
                precisao, ident = info >> 4, info & 0x0F
                j += 1
                bytes_da_tabela = 128 if precisao else 64
                if ident == 0 and not precisao and j + 64 <= len(dados):
                    natural = [0] * 64
                    for k in range(64):
                        natural[_ZIGZAG[k]] = dados[j + k]
                    razoes = [natural[n] / _QUANTIZACAO_PADRAO[n] for n in range(64) if _QUANTIZACAO_PADRAO[n] >= 40]
                    fator = 100 * sum(razoes) / len(razoes)
                    qualidade = (200 - fator) / 2 if fator <= 100 else 5000 / fator
                    return max(1, min(100, round(qualidade)))
                j += bytes_da_tabela
        i += 2 + tamanho
    return None


def _recomprimir_pode_ganhar(entrada: pymupdf.Document, xref: int, filtro: str, bpc: int, qualidade: int) -> bool:
    """Regravar esta imagem poderia dar um arquivo menor?

    So o JPEG de qualidade claramente abaixo da pedida diz nao com certeza:
    regravar um JPEG a uma qualidade maior so o engorda, e o MuPDF, em modo
    "so se ficar menor", deixaria o original — o mesmo que nao ter tentado.
    O resto (sem perda, preto e branco, qualidade parecida ou desconhecida)
    pode ganhar, e segue para a regravacao de sempre.
    """
    if filtro != "DCTDecode" or bpc == 1:
        return True
    try:
        estimada = _qualidade_do_jpeg(entrada.xref_stream_raw(xref) or b"")
    except Exception:  # noqa: BLE001 - imagem estranha: na duvida, deixa regravar
        return True
    return estimada is None or estimada >= qualidade - 5


def _pagina_passa_da_resolucao(pagina: pymupdf.Page, limiar: float) -> bool:
    """Alguma imagem desta pagina esta impressa com mais resolucao que o limiar?

    Pela lista de imagens da pagina (`get_image_info`), que so le tamanhos: nao
    decodifica nada. O que decodifica, e caro, e `get_image_rects` — ele
    calcula um MD5 dos pixels para achar onde a imagem foi desenhada.
    """
    for info in pagina.get_image_info():
        largura_pol = pymupdf.Rect(info["bbox"]).width / 72
        if largura_pol > 0 and info.get("width", 0) / largura_pol > limiar:
            return True
    return False


def _analisar_imagens(entrada: pymupdf.Document, dpi: int, qualidade: int) -> tuple[bool, bool]:
    """Diz se ha o que fazer com as imagens: (alguma passa da resolucao, alguma pode ganhar).

    Sem nenhuma das duas, reduzir as imagens de um arquivo de mil paginas era
    minutos gastos para devolver o arquivo do jeito que estava. Custa uma
    olhada por pagina, sem decodificar imagem nenhuma.
    """
    limiar = dpi * 1.2
    passa = False
    pode_ganhar = False
    decididas: dict[int, bool] = {}

    for pagina in entrada:
        for imagem in pagina.get_images(full=True):
            xref = imagem[0]
            if xref not in decididas:
                filtro = imagem[8] if len(imagem) > 8 else ""
                decididas[xref] = _recomprimir_pode_ganhar(entrada, xref, filtro, imagem[4], qualidade)
            pode_ganhar = pode_ganhar or decididas[xref]

        if not passa:
            passa = _pagina_passa_da_resolucao(pagina, limiar)

        if passa and pode_ganhar:
            break

    return passa, pode_ganhar


def _encolher_fotos_grandes(entrada: pymupdf.Document, dpi: int, qualidade: int) -> int:
    """Redesenha à mão a foto que o MuPDF nao encolheu, e devolve quantas trocou.

    O `rewrite_images` resolve quase tudo, mas passa batido em imagem sem
    perda com perfil ICC — que e exatamente o que muito programa grava. Um
    caso real: uma folha 10x15 com uma imagem de 7681 x 10753 sem perda, quase
    2000 DPI no papel, 9,6 MB, e a compressao devolvia o arquivo igualzinho
    dizendo que ja estava no menor tamanho. Nao estava.

    Aqui a conta e simples: quanto a imagem mede impressa e quantos pixels
    isso pede no DPI pedido. O que passa disso e reduzido e regravado em JPEG,
    e so fica se tiver ficado menor de verdade.
    """
    trocadas = 0
    limiar = dpi * 1.2

    for pagina in entrada:
        # Pagina sem imagem acima do limiar nao tem o que trocar, e olhar por
        # imagem custa decodifica-la: `get_image_rects` calcula um MD5 dos
        # pixels. Eram 51 s em 700 paginas de digitalizacao para nao trocar nada.
        if not _pagina_passa_da_resolucao(pagina, limiar):
            continue
        for imagem in pagina.get_images(full=True):
            xref = imagem[0]
            # Imagem com mascara de transparencia fica quieta: o JPEG nao
            # guarda alfa, e trocar deixaria fundo preto no lugar do vazado.
            if imagem[1]:
                continue

            caixas = pagina.get_image_rects(xref)
            if not caixas:
                continue
            largura_pol = max(caixa.width for caixa in caixas) / 72
            if largura_pol <= 0:
                continue
            try:
                pix = pymupdf.Pixmap(entrada, xref)
            except Exception:  # noqa: BLE001
                continue
            if pix.alpha or pix.n not in (1, 3):
                continue

            atual = pix.width / largura_pol
            if atual <= limiar:
                continue

            alvo_l = max(1, round(largura_pol * dpi))
            alvo_a = max(1, round(pix.height * alvo_l / pix.width))
            antigo = len(entrada.xref_stream_raw(xref) or b"")
            menor = pymupdf.Pixmap(pix, alvo_l, alvo_a, None)
            jpeg = menor.tobytes("jpeg", jpg_quality=qualidade)
            del pix, menor

            if antigo and len(jpeg) >= antigo:
                continue
            pagina.replace_image(xref, stream=jpeg)
            trocadas += 1

    return trocadas


def _recomprimindo_imagens(pedido: Pedido, entrada: pymupdf.Document) -> None:
    """Encolhe as fotos que passam da resolucao pedida e recomprime em JPEG.

    O limiar fica acima do alvo de proposito: uma foto a 160 DPI com alvo de
    150 perderia qualidade para ganhar quase nada. So o que esta bem acima e
    reduzido; o resto so e recomprimido quando o JPEG ficar menor.
    """
    dpi = int(pedido.opcao("dpi", 150))
    qualidade = int(pedido.opcao("qualidade", 75))
    limiar = int(dpi * 1.2)
    passa, pode_ganhar = _analisar_imagens(entrada, dpi, qualidade)
    if not passa and not pode_ganhar:
        # Nada acima da resolucao pedida e nenhuma imagem que regravar deixasse
        # menor: o resultado da regravacao seria o proprio arquivo, depois de
        # minutos. Segue direto para as fontes e a gravacao.
        pedido.andamento(0.7, "As imagens ja estao na resolucao pedida")
        _enxugar_fontes(pedido, entrada)
        return
    pedido.andamento(0.2, f"Reduzindo as imagens de {entrada.page_count} paginas")

    # As opcoes a mao, e nao os parametros simples do `rewrite_images`: eles
    # reduzem pela media, que so divide por numero inteiro - uma foto a
    # 480 DPI parava em 240 em vez de chegar nos 150 pedidos. O bicubico vai
    # direto ao alvo.
    #
    # Foto (JPEG) volta como JPEG. Imagem sem perda - diagrama, print de tela,
    # logo - encolhe mas continua sem perda no nivel recomendado: JPEG em
    # traco fino deixa borrao em volta de cada linha. No forte vira JPEG.
    opcoes = mupdf.PdfImageRewriterOptions()
    opcoes.recompress_when = mupdf.FZ_RECOMPRESS_WHEN_SMALLER
    sem_perda_vira_jpeg = qualidade < 70
    for tipo in ("color", "gray"):
        for perda in ("lossy", "lossless"):
            prefixo = f"{tipo}_{perda}_image_"
            setattr(opcoes, prefixo + "subsample_method", mupdf.FZ_SUBSAMPLE_BICUBIC)
            setattr(opcoes, prefixo + "subsample_threshold", limiar)
            setattr(opcoes, prefixo + "subsample_to", dpi)
            jpeg = perda == "lossy" or sem_perda_vira_jpeg
            setattr(
                opcoes,
                prefixo + "recompress_method",
                mupdf.FZ_RECOMPRESS_JPEG if jpeg else mupdf.FZ_RECOMPRESS_LOSSLESS,
            )
            setattr(opcoes, prefixo + "recompress_quality", str(qualidade))
    # Preto e branco puro (digitalizacao de texto) vira FAX, que e o menor
    # formato para isso e nao borra nada.
    opcoes.bitonal_image_recompress_method = mupdf.FZ_RECOMPRESS_FAX
    opcoes.bitonal_image_subsample_method = mupdf.FZ_SUBSAMPLE_AVERAGE
    opcoes.bitonal_image_subsample_threshold = max(limiar, 360)
    opcoes.bitonal_image_subsample_to = max(dpi, 300)
    entrada.rewrite_images(options=opcoes)
    # E o que o MuPDF deixou passar: imagem sem perda com perfil ICC, que e o
    # caso da folha de fotos e de meio programa de foto por ai. So se alguma
    # imagem passa da resolucao: e a mesma conta que a regravacao acabou de
    # fazer, e sem nada acima dela esta etapa nao tem o que trocar.
    if passa:
        pedido.andamento(0.5, "Reduzindo as fotos grandes")
        _encolher_fotos_grandes(entrada, dpi, qualidade)
    _enxugar_fontes(pedido, entrada)


def _enxugar_fontes(pedido: Pedido, entrada: pymupdf.Document) -> None:
    """Fonte embutida inteira pesa centenas de KB; subconjunto so leva os caracteres usados."""
    pedido.andamento(0.7, "Enxugando as fontes")
    try:
        # Fonte que nao se deixa recortar fica como estava.
        entrada.subset_fonts()
    except Exception:  # noqa: BLE001
        pass
    pedido.andamento(0.85, "Gravando")


def _redesenhando(pedido: Pedido, entrada: pymupdf.Document, nivel: str) -> tuple[pymupdf.Document, int]:
    """Cada pagina vira um JPEG, o que corta muito mas descarta o texto."""
    dpi = DPI_POR_NIVEL.get(nivel, DPI_POR_NIVEL["medio"])
    qualidade = QUALIDADE_POR_NIVEL.get(nivel, QUALIDADE_POR_NIVEL["medio"])

    saida = pymupdf.open()
    total = entrada.page_count

    for indice in range(total):
        pedido.andamento(indice / total, f"Pagina {indice + 1} de {total}")

        pagina = entrada[indice]
        pixels = pagina.get_pixmap(dpi=dpi)
        nova = saida.new_page(width=pagina.rect.width, height=pagina.rect.height)
        nova.insert_image(nova.rect, stream=pixels.tobytes("jpeg", jpg_quality=qualidade))
        del pixels

    return saida, total


def reparar(pedido: Pedido) -> Dict[str, Any]:
    """Reescreve o PDF do zero, o que resolve boa parte dos arquivos quebrados.

    O MuPDF reconstroi a tabela de referencias percorrendo o arquivo inteiro,
    entao PDF com indice corrompido costuma voltar a abrir. Nao recupera
    conteudo que simplesmente nao esta no arquivo.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)

    doc = abrir(origem, senha)
    try:
        pedido.andamento(0.5, "Reconstruindo o arquivo")
        destino = pedido.saida or nome_com_sufixo(origem, "reparado")
        bytes_saida = salvar(doc, destino, senha)
        paginas = doc.page_count
    finally:
        doc.close()

    pedido.andamento(1.0)
    return {
        "arquivo": destino,
        "paginas": paginas,
        "bytes": bytes_saida,
        "notas": ["O arquivo foi reescrito do zero. O que nao estava dentro dele nao da para recuperar."],
    }
