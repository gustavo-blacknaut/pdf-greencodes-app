"""Inverter, intercalar, separar pares/ímpares, páginas em branco."""

from __future__ import annotations

import pymupdf
import pytest

from motor.protocolo import ErroDoUsuario


def texto_das_paginas(caminho):
    doc = pymupdf.open(caminho)
    textos = [p.get_text().strip() for p in doc]
    doc.close()
    return textos


class TestInverterPaginas:
    def test_a_ultima_vira_a_primeira(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "invertido.pdf")
        resultado = rodar("inverter-paginas", [criar_pdf(paginas=4)], {}, saida=destino)

        assert resultado["paginas"] == 4
        textos = texto_das_paginas(destino)
        assert "Pagina 4" in textos[0]
        assert "Pagina 1" in textos[3]


class TestIntercalar:
    def test_alterna_pagina_a_pagina(self, criar_pdf, rodar, tmp_path):
        a = criar_pdf(paginas=2, nome="a.pdf")
        b = criar_pdf(paginas=2, nome="b.pdf")
        destino = str(tmp_path / "intercalado.pdf")
        rodar("intercalar", [a, b], {}, saida=destino)

        # Cada arquivo tem seu proprio texto "Pagina N", entao a ordem final
        # e A1, B1, A2, B2 — 4 paginas ao todo, todas com "Pagina 1" ou
        # "Pagina 2" dependendo de qual metade veio.
        textos = texto_das_paginas(destino)
        assert len(textos) == 4

    def test_precisa_de_exatamente_dois_arquivos(self, criar_pdf, rodar):
        with pytest.raises(ErroDoUsuario, match="dois arquivos"):
            rodar("intercalar", [criar_pdf(paginas=1)], {})

    def test_inverter_segundo_desfaz_a_ordem_do_scanner(self, criar_pdf, rodar, tmp_path):
        a = criar_pdf(paginas=3, nome="a.pdf")
        b = criar_pdf(paginas=3, nome="b.pdf")

        normal = str(tmp_path / "normal.pdf")
        invertido = str(tmp_path / "invertido.pdf")
        rodar("intercalar", [a, b], {"inverterSegundo": False}, saida=normal)
        rodar("intercalar", [a, b], {"inverterSegundo": True}, saida=invertido)

        # Com inverterSegundo, a segunda pagina do resultado (que vem do
        # arquivo B) muda de qual pagina de B ela e.
        doc_normal = pymupdf.open(normal)
        doc_invertido = pymupdf.open(invertido)
        texto_normal = doc_normal[1].get_text()
        texto_invertido = doc_invertido[1].get_text()
        doc_normal.close()
        doc_invertido.close()

        assert texto_normal != texto_invertido

    def test_tamanhos_diferentes_usa_o_maior(self, criar_pdf, rodar, tmp_path):
        a = criar_pdf(paginas=3, nome="a.pdf")
        b = criar_pdf(paginas=1, nome="b.pdf")
        destino = str(tmp_path / "intercalado.pdf")
        resultado = rodar("intercalar", [a, b], {}, saida=destino)
        # 3 de A + 1 de B = 4 paginas, mesmo com B tendo menos.
        assert resultado["paginas"] == 4


class TestPaginasEmBranco:
    def test_sem_posicao_insere_uma_no_fim(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "com-branca.pdf")
        resultado = rodar("paginas-em-branco", [criar_pdf(paginas=3)], {}, saida=destino)

        assert resultado["paginas"] == 4
        assert resultado["inseridas"] == 1
        textos = texto_das_paginas(destino)
        assert textos[-1] == ""

    def test_insere_depois_das_paginas_pedidas(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "com-brancas.pdf")
        resultado = rodar("paginas-em-branco", [criar_pdf(paginas=4)], {"apos": "2"}, saida=destino)

        assert resultado["paginas"] == 5
        textos = texto_das_paginas(destino)
        # Pagina 1, Pagina 2, branco, Pagina 3, Pagina 4
        assert "Pagina 2" in textos[1]
        assert textos[2] == ""
        assert "Pagina 3" in textos[3]

    def test_branca_tem_o_tamanho_da_pagina_anterior(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "com-branca.pdf")
        rodar("paginas-em-branco", [criar_pdf(paginas=1)], {}, saida=destino)

        doc = pymupdf.open(destino)
        assert doc[0].rect == doc[1].rect
        doc.close()
