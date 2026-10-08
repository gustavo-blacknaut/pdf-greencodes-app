from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pymupdf
import pytest

from motor.word import converter_word


@pytest.mark.skipif(os.name != "nt", reason="A exportação usa o Word no Windows")
def test_conversao_chama_o_word_sem_ler_o_doc_na_memoria(tmp_path, monkeypatch):
    origem = tmp_path / "principal.doc"
    origem.write_bytes(bytes.fromhex("D0CF11E0A1B11AE1"))
    chamadas = []

    def exportar(argumentos, **_):
        chamadas.append(argumentos)
        doc = pymupdf.open()
        doc.new_page(width=420, height=595)
        doc.save(argumentos[-1])
        doc.close()
        return subprocess.CompletedProcess(argumentos, 0, "", "")

    monkeypatch.setattr(subprocess, "run", exportar)
    destino = converter_word(str(origem))

    assert Path(destino).exists()
    assert chamadas[0][-2:] == [str(origem), destino]
    assert any(parte.endswith("word_para_pdf.ps1") for parte in chamadas[0])
