from __future__ import annotations

import csv
import hashlib
import io
from pathlib import Path

import pymupdf

from motor.operacoes import ACOES


def ler_resultados(resultado):
    return {Path(item["arquivo"]).name: Path(item["arquivo"]).read_text(encoding="utf-8-sig")
            for item in resultado["arquivos"]}


def test_gera_tres_relatorios_e_preserva_os_originais(rodar, criar_pdf):
    arquivos = [criar_pdf(2, "primeiro.pdf"), criar_pdf(1, "segundo.pdf")]
    hashes = [hashlib.sha256(Path(p).read_bytes()).digest() for p in arquivos]
    resultado = rodar("informacoes-pdf", arquivos, {"dpi": 72})
    saidas = ler_resultados(resultado)
    assert set(saidas) == {"informacoes-pdf.txt", "relatorio-paginas.csv", "cobertura-de-tinta.txt"}
    assert len(list(csv.reader(io.StringIO(saidas["relatorio-paginas.csv"]), delimiter=";"))) == 4
    for nome in ["primeiro.pdf", "segundo.pdf"]:
        assert nome in saidas["informacoes-pdf.txt"]
        assert nome in saidas["cobertura-de-tinta.txt"]
    assert "NÃO EMBUTIDA" in saidas["informacoes-pdf.txt"]
    assert hashes == [hashlib.sha256(Path(p).read_bytes()).digest() for p in arquivos]
    progresso = [p["fracao"] for p in resultado["_andamento"]]
    assert progresso == sorted(progresso)
    assert progresso[-1] == 1


def test_csv_considera_crop_rotacao_e_protege_nome_formula(rodar, tmp_path):
    caminho = tmp_path / "=formula.pdf"
    doc = pymupdf.open()
    pagina = doc.new_page(width=400, height=500)
    pagina.set_cropbox(pymupdf.Rect(20, 30, 220, 330))
    pagina.set_rotation(90)
    doc.save(caminho)
    doc.close()
    resultado = rodar("informacoes-pdf", [str(caminho)], {"dpi": 72})
    linhas = list(csv.reader(io.StringIO(ler_resultados(resultado)["relatorio-paginas.csv"]), delimiter=";"))
    assert linhas[1] == ["'=formula.pdf", "1", "105.83", "70.56", "Paisagem", "90"]


def test_detecta_dpi_no_tamanho_desenhado(rodar, tmp_path):
    caminho = tmp_path / "fotos.pdf"
    foto = pymupdf.Pixmap(pymupdf.csRGB, 100, 200, bytes([255, 0, 0]) * 20_000, False).tobytes("png")
    doc = pymupdf.open()
    pagina = doc.new_page(width=400, height=500)
    pagina.insert_image(pymupdf.Rect(0, 0, 72, 144), stream=foto)
    pagina.set_rotation(90)
    doc.save(caminho)
    doc.close()
    saidas = ler_resultados(rodar("informacoes-pdf", [str(caminho)], {"dpi": 72}))
    assert "100 DPI no tamanho de impressão" in saidas["informacoes-pdf.txt"]
    assert "CRÍTICA: página 1" in saidas["informacoes-pdf.txt"]


def test_pdf_protegido_usa_senha_e_respeita_papel(rodar, criar_pdf):
    caminho = criar_pdf(1, senha="teste")
    saidas = ler_resultados(rodar("informacoes-pdf", [caminho], {"dpi": 72, "papel": "jornal"}, senhas=["teste"]))
    assert "limite de 240%" in saidas["cobertura-de-tinta.txt"]
    assert "teste" not in saidas["informacoes-pdf.txt"].replace("teste.pdf", "")


def test_ferramentas_excluidas_nao_existem_no_motor():
    assert "separar-chapas" not in ACOES
    assert "separar-pares-impares" not in ACOES
