"""A recompressao das imagens: o que ela decide fazer, e o que decide poupar.

Reduzir as imagens de mil paginas de digitalizacao levava minutos — 136 s
regravando e 51 s decodificando fotos so para descobrir que nao passavam da
resolucao — para devolver o arquivo do jeito que estava. A pressa so vale se a
decisao de poupar o trabalho for a mesma que o trabalho tomaria: o MuPDF, em
modo "so se ficar menor", deixa cada imagem como esta quando o resultado nao
encolhe, entao pular so e seguro onde regravar certamente nao encolheria.
Estes testes prendem os dois lados: a decisao, e o que sai no fim.
"""

from __future__ import annotations

import hashlib

import pymupdf
import pytest

from motor.operacoes import otimizar


def _folha(largura: int = 1240, altura: int = 1754) -> bytes:
    """Uma 'folha digitalizada': texto em linhas sobre fundo claro. Tem detalhe de verdade."""
    doc = pymupdf.open()
    pagina = doc.new_page(width=largura, height=altura)
    for linha in range(50):
        pagina.insert_text((80, 100 + linha * 30), f"Documento ficticio linha {linha} lorem ipsum dolor sit amet", fontsize=16)
    pixels = pagina.get_pixmap(dpi=72)
    doc.close()
    return pixels


def _jpeg(qualidade: int, largura: int = 1240, altura: int = 1754) -> bytes:
    return _folha(largura, altura).tobytes("jpeg", jpg_quality=qualidade)


def _pdf_com_imagem(caminho, imagem: bytes, paginas: int = 3, retangulo=(0, 0, 595, 842)) -> str:
    doc = pymupdf.open()
    for _ in range(paginas):
        pagina = doc.new_page(width=595, height=842)
        pagina.insert_image(pymupdf.Rect(*retangulo), stream=imagem)
    doc.save(str(caminho))
    doc.close()
    return str(caminho)


def _impressao_digital_das_imagens(caminho: str) -> list[str]:
    """O hash do fluxo de cada imagem: se o arquivo mudou uma imagem, isto muda."""
    doc = pymupdf.open(caminho)
    try:
        return sorted({hashlib.sha1(doc.xref_stream_raw(i[0])).hexdigest() for pagina in doc for i in pagina.get_images(full=True)})
    finally:
        doc.close()


class TestQualidadeDoJpeg:
    @pytest.mark.parametrize("qualidade", [30, 50, 60, 75, 85, 90, 95])
    def test_estima_a_qualidade_com_que_o_jpeg_foi_gravado(self, qualidade):
        estimada = otimizar._qualidade_do_jpeg(_jpeg(qualidade, 600, 800))
        assert estimada is not None
        assert abs(estimada - qualidade) <= 4, f"gravado a {qualidade}, estimado {estimada}"

    def test_nao_subestima_a_qualidade_alta(self):
        """Subestimar aqui faria pular um trabalho que tinha ganho."""
        for qualidade in (92, 95, 98):
            assert otimizar._qualidade_do_jpeg(_jpeg(qualidade, 600, 800)) >= qualidade - 4

    def test_dado_que_nao_e_jpeg_devolve_nada(self):
        assert otimizar._qualidade_do_jpeg(b"") is None
        assert otimizar._qualidade_do_jpeg(b"isto nao e uma imagem" * 20) is None
        assert otimizar._qualidade_do_jpeg(b"\xff\xd8\xff\xda\x00\x04\x00\x00") is None


class TestAnaliseDasImagens:
    def test_jpeg_de_qualidade_baixa_em_resolucao_normal_nao_tem_o_que_fazer(self, tmp_path):
        pdf = _pdf_com_imagem(tmp_path / "scan.pdf", _jpeg(55))
        doc = pymupdf.open(pdf)
        assert otimizar._analisar_imagens(doc, dpi=600, qualidade=88) == (False, False)

    def test_jpeg_de_qualidade_alta_pode_encolher_ao_regravar(self, tmp_path):
        pdf = _pdf_com_imagem(tmp_path / "foto.pdf", _jpeg(97))
        doc = pymupdf.open(pdf)
        passa, pode = otimizar._analisar_imagens(doc, dpi=600, qualidade=80)
        assert (passa, pode) == (False, True)

    def test_imagem_com_mais_resolucao_que_o_pedido_e_detectada(self, tmp_path):
        # 1240 px em 2 polegadas de largura: 620 DPI. Pedindo 300, passa do limiar de 360.
        pdf = _pdf_com_imagem(tmp_path / "grande.pdf", _jpeg(55), retangulo=(0, 0, 144, 200))
        doc = pymupdf.open(pdf)
        passa, _ = otimizar._analisar_imagens(doc, dpi=300, qualidade=82)
        assert passa

    def test_imagem_sem_perda_sempre_entra_na_regravacao(self, tmp_path):
        png = _folha(600, 800).tobytes("png")
        pdf = _pdf_com_imagem(tmp_path / "sem-perda.pdf", png)
        doc = pymupdf.open(pdf)
        _, pode = otimizar._analisar_imagens(doc, dpi=600, qualidade=88)
        assert pode, "imagem sem perda pode virar JPEG menor: nao da para pular"

    def test_a_mesma_imagem_em_varias_paginas_e_avaliada_uma_vez(self, tmp_path, monkeypatch):
        pdf = _pdf_com_imagem(tmp_path / "repetida.pdf", _jpeg(55), paginas=12)
        doc = pymupdf.open(pdf)
        chamadas = []
        original = otimizar._recomprimir_pode_ganhar
        monkeypatch.setattr(otimizar, "_recomprimir_pode_ganhar", lambda *a: chamadas.append(a[1]) or original(*a))
        otimizar._analisar_imagens(doc, dpi=600, qualidade=88)
        assert len(chamadas) == len(set(chamadas)) == 1


class TestRecompressaoPoupaOTrabalho:
    def test_sem_o_que_fazer_a_regravacao_nem_comeca_e_as_imagens_saem_iguais(self, rodar, tmp_path, monkeypatch):
        origem = _pdf_com_imagem(tmp_path / "scan.pdf", _jpeg(55), paginas=4)
        chamadas = []
        original = pymupdf.Document.rewrite_images
        monkeypatch.setattr(pymupdf.Document, "rewrite_images", lambda self, **kw: chamadas.append(1) or original(self, **kw))

        destino = str(tmp_path / "saida.pdf")
        resultado = rodar("comprimir", [origem], {"modo": "imagens", "dpi": 600, "qualidade": 88}, saida=destino)

        assert chamadas == [], "regravar 4 imagens que nao passam de 600 DPI e gastar tempo a toa"
        assert _impressao_digital_das_imagens(destino) == _impressao_digital_das_imagens(origem)
        assert resultado["paginas"] == 4
        assert any("ja estao na resolucao pedida" in (p.get("mensagem") or "") for p in resultado["_andamento"])

    def test_o_que_sai_e_o_mesmo_que_a_regravacao_completa_daria(self, rodar, tmp_path, monkeypatch):
        """A prova de que pular nao muda o resultado: as duas rotas entregam as mesmas imagens."""
        origem = _pdf_com_imagem(tmp_path / "scan.pdf", _jpeg(55), paginas=3)

        poupada = str(tmp_path / "poupada.pdf")
        rodar("comprimir", [origem], {"modo": "imagens", "dpi": 600, "qualidade": 88}, saida=poupada)

        # Forca a rota completa: a analise diz que ha o que fazer.
        monkeypatch.setattr(otimizar, "_analisar_imagens", lambda *a: (True, True))
        completa = str(tmp_path / "completa.pdf")
        rodar("comprimir", [origem], {"modo": "imagens", "dpi": 600, "qualidade": 88}, saida=completa)

        assert _impressao_digital_das_imagens(poupada) == _impressao_digital_das_imagens(completa)

    def test_com_imagem_acima_da_resolucao_a_regravacao_acontece_e_encolhe(self, rodar, tmp_path):
        origem = _pdf_com_imagem(tmp_path / "grande.pdf", _jpeg(90), paginas=2, retangulo=(0, 0, 144, 200))
        destino = str(tmp_path / "menor.pdf")
        resultado = rodar("comprimir", [origem], {"modo": "imagens", "dpi": 300, "qualidade": 82}, saida=destino)

        assert resultado["bytesSaida"] < resultado["bytesEntrada"]
        doc = pymupdf.open(destino)
        assert doc.extract_image(doc[0].get_images()[0][0])["width"] < 1240
        doc.close()

    def test_a_reducao_das_fotos_grandes_so_roda_quando_alguma_passa(self, rodar, tmp_path, monkeypatch):
        chamadas = []
        original = otimizar._encolher_fotos_grandes
        monkeypatch.setattr(otimizar, "_encolher_fotos_grandes", lambda *a: chamadas.append(1) or original(*a))

        normal = _pdf_com_imagem(tmp_path / "normal.pdf", _jpeg(97), paginas=2)
        rodar("comprimir", [normal], {"modo": "imagens", "dpi": 600, "qualidade": 80}, saida=str(tmp_path / "a.pdf"))
        assert chamadas == [], "nenhuma imagem passa de 600 DPI: nao ha o que reduzir por esta via"

        grande = _pdf_com_imagem(tmp_path / "grande.pdf", _jpeg(90), paginas=2, retangulo=(0, 0, 144, 200))
        rodar("comprimir", [grande], {"modo": "imagens", "dpi": 300, "qualidade": 82}, saida=str(tmp_path / "b.pdf"))
        assert chamadas == [1]


class TestQuandoNaoHaOQueReduzir:
    def test_devolve_o_original_e_explica_em_vez_de_quebrar(self, rodar, tmp_path):
        """A nota citava `dpi`, que nao existia na funcao: quebrava justo no caso mais comum de escaneado."""
        origem = _pdf_com_imagem(tmp_path / "scan.pdf", _jpeg(55), paginas=3)
        destino = str(tmp_path / "saida.pdf")

        resultado = rodar("comprimir", [origem], {"modo": "imagens", "dpi": 600, "qualidade": 88}, saida=destino)

        assert resultado["bytesSaida"] <= resultado["bytesEntrada"]
        assert any("600 DPI" in nota for nota in resultado["notas"]) or resultado["bytesSaida"] < resultado["bytesEntrada"]
        assert pymupdf.open(destino).page_count == 3


class TestFotosGrandesNaoDecodificaAToa:
    def test_pagina_sem_imagem_acima_da_resolucao_nao_decodifica_nada(self, tmp_path, monkeypatch):
        """`get_image_rects` decodifica a imagem (calcula um MD5 dos pixels): custava 51 s em 700 paginas."""
        pdf = _pdf_com_imagem(tmp_path / "scan.pdf", _jpeg(55), paginas=6)
        doc = pymupdf.open(pdf)
        decodificacoes = []
        original = pymupdf.Page.get_image_rects
        monkeypatch.setattr(pymupdf.Page, "get_image_rects", lambda self, *a, **k: decodificacoes.append(1) or original(self, *a, **k))

        trocadas = otimizar._encolher_fotos_grandes(doc, dpi=600, qualidade=88)

        assert trocadas == 0
        assert decodificacoes == []

    def test_a_imagem_que_passa_continua_sendo_reduzida(self, tmp_path):
        # Sem perda e enorme numa folha pequena: o caso que o MuPDF deixa passar.
        pixels = _folha(1240, 1754)
        pdf = _pdf_com_imagem(tmp_path / "pesada.pdf", pixels.tobytes("png"), paginas=1, retangulo=(0, 0, 200, 283))
        doc = pymupdf.open(pdf)
        assert otimizar._encolher_fotos_grandes(doc, dpi=150, qualidade=75) == 1
        doc.close()
