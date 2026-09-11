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
        notas.append(
            "Este PDF ja estava no menor tamanho que da para alcancar sem redesenhar. "
            "O resultado nao ficou menor, entao o original foi mantido."
            if not redesenhar
            else "Nem redesenhando o arquivo ficou menor: as imagens ja estavam bem compactadas. "
            "O original foi mantido."
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


def _recomprimindo_imagens(pedido: Pedido, entrada: pymupdf.Document) -> None:
    """Encolhe as fotos que passam da resolucao pedida e recomprime em JPEG.

    O limiar fica acima do alvo de proposito: uma foto a 160 DPI com alvo de
    150 perderia qualidade para ganhar quase nada. So o que esta bem acima e
    reduzido; o resto so e recomprimido quando o JPEG ficar menor.
    """
    dpi = int(pedido.opcao("dpi", 150))
    qualidade = int(pedido.opcao("qualidade", 75))
    limiar = int(dpi * 1.2)
    pedido.andamento(0.2, "Reduzindo as imagens")

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
    pedido.andamento(0.7, "Enxugando as fontes")
    try:
        # Fonte embutida inteira pesa centenas de KB; subconjunto so leva os
        # caracteres usados. Fonte que nao se deixa recortar fica como estava.
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
