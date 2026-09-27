"""Conferência de imagens e fontes, medidas das páginas e cobertura de tinta."""

from __future__ import annotations

import csv
import math
import os
from pathlib import Path

from ..documento import abrir
from ..protocolo import ErroDoUsuario, Pedido
from .chapas import cobertura_de_tinta


def _celula(valor: str) -> str:
    return "'" + valor if valor.lstrip().startswith(("=", "+", "-", "@")) else valor


def _conferir(documento, nome: str, pedido: Pedido, indice: int, total: int):
    linhas = [f"Informações do PDF — {nome}", f"{len(documento)} página(s)", ""]
    medidas = []
    fontes = {}
    baixas = []
    imagens = 0
    erros = []
    for numero, pagina in enumerate(documento):
        pedido.andamento((indice + 0.4 * numero / max(1, len(documento))) / total,
                         f"Conferindo {nome}: página {numero + 1}/{len(documento)}")
        caixa = pagina.rect
        largura, altura = caixa.width * 25.4 / 72, caixa.height * 25.4 / 72
        orientacao = "Quadrada" if abs(largura - altura) < 0.01 else "Paisagem" if largura > altura else "Retrato"
        medidas.append([_celula(nome), numero + 1, f"{largura:.2f}", f"{altura:.2f}", orientacao, pagina.rotation])
        try:
            for imagem in pagina.get_image_info():
                a, b, c, d, _, _ = imagem["transform"]
                horizontal, vertical = math.hypot(a, b), math.hypot(c, d)
                if horizontal <= 0 or vertical <= 0:
                    continue
                dpi = min(imagem["width"] * 72 / horizontal, imagem["height"] * 72 / vertical)
                imagens += 1
                if dpi < 300:
                    baixas.append((numero + 1, round(dpi), imagem["width"], imagem["height"]))
        except Exception as erro:
            erros.append(f"Página {numero + 1}: imagens não verificadas ({erro}).")
        try:
            for fonte in pagina.get_fonts(full=True):
                xref, _, tipo, nome_fonte, *_ = fonte
                if (xref, nome_fonte) in fontes:
                    continue
                embutida = bool(xref) and (tipo == "Type3" or bool(documento.extract_font(xref)[3]))
                fontes[(xref, nome_fonte)] = embutida
        except Exception as erro:
            erros.append(f"Página {numero + 1}: fontes não verificadas ({erro}).")

    distintas = sorted({(m[2], m[3]) for m in medidas})
    linhas.extend(["MEDIDAS VISÍVEIS", *[f"  {l} × {a} mm" for l, a in distintas]])
    if len(distintas) > 1:
        linhas.append("  Atenção: o documento mistura tamanhos de página.")
    linhas.extend(["", "RESOLUÇÃO DAS IMAGENS", f"  {imagens} ocorrência(s) de imagem conferida(s)."])
    for pagina, dpi, largura, altura in baixas:
        nivel = "CRÍTICA" if dpi < 150 else "BAIXA"
        linhas.append(f"  {nivel}: página {pagina}, {largura} × {altura} px, {dpi} DPI no tamanho de impressão.")
    if imagens and not baixas:
        linhas.append("  Todas as imagens verificadas têm ao menos 300 DPI no tamanho de impressão.")
    linhas.extend(["", "FONTES"])
    if not fontes:
        linhas.append("  Nenhuma fonte declarada.")
    for (_, nome_fonte), embutida in sorted(fontes.items()):
        linhas.append(f"  {nome_fonte}: {'embutida' if embutida else 'NÃO EMBUTIDA'}.")
    if erros:
        linhas.extend(["", "VERIFICAÇÕES INCOMPLETAS", *erros])
    linhas.extend(["", "LIMITES DA CONFERÊNCIA",
                   "  Não certifica sangria, superimposição, fidelidade de cor ou o perfil da impressora.",
                   "  A cobertura de tinta está no relatório separado; usa conversão CMYK e amostragem.",
                   "  A resolução é calculada a partir dos pixels e do tamanho desenhado, sem alterar o PDF."])
    return "\n".join(linhas), medidas, len(baixas), sum(not v for v in fontes.values())


def informacoes_pdf(pedido: Pedido):
    if not pedido.arquivos:
        raise ErroDoUsuario("Escolha ao menos um PDF para conferir.")
    pasta = Path(pedido.saida) if pedido.saida else Path(pedido.arquivos[0]).parent
    pasta.mkdir(parents=True, exist_ok=True)
    laudos, medidas, coberturas = [], [], []
    baixas = soltas = 0
    total = len(pedido.arquivos)
    for indice, caminho in enumerate(pedido.arquivos):
        nome = os.path.basename(caminho)
        with abrir(caminho, pedido.senha(indice)) as documento:
            laudo, linhas, imagens_baixas, fontes_soltas = _conferir(documento, nome, pedido, indice, total)
        laudos.append(laudo)
        medidas.extend(linhas)
        baixas += imagens_baixas
        soltas += fontes_soltas
        parcial = pasta / f"cobertura-parcial-{indice + 1}.txt"
        filho = Pedido({"arquivos": [caminho], "opcoes": pedido.opcoes,
                        "senhas": [pedido.senha(indice)], "saida": str(parcial)},
                       lambda passo: pedido.andamento((indice + 0.4 + 0.6 * passo["fracao"]) / total,
                                                       passo.get("mensagem", "Medindo a tinta")))
        cobertura_de_tinta(filho)
        coberturas.append(parcial.read_text(encoding="utf-8"))
        parcial.unlink()

    conferencia = pasta / "informacoes-pdf.txt"
    paginas = pasta / "relatorio-paginas.csv"
    tinta = pasta / "cobertura-de-tinta.txt"
    conferencia.write_text("\n\n".join(laudos), encoding="utf-8")
    with paginas.open("w", encoding="utf-8-sig", newline="") as arquivo:
        writer = csv.writer(arquivo, delimiter=";")
        writer.writerow(["Arquivo", "Pagina", "Largura_mm", "Altura_mm", "Orientacao", "Rotacao_graus"])
        writer.writerows(medidas)
    tinta.write_text("\n\n".join(coberturas), encoding="utf-8")
    pedido.andamento(1)
    return {"arquivos": [{"arquivo": str(p)} for p in (conferencia, paginas, tinta)],
            "notas": [f"Três relatórios gerados para {len(medidas)} página(s) de {total} arquivo(s).",
                      f"{baixas} imagem(ns) abaixo de 300 DPI; {soltas} fonte(s) não embutida(s).",
                      "Os relatórios não têm senha e contêm os nomes dos arquivos. Os PDFs originais foram preservados."]}
