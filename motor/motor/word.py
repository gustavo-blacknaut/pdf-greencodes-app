"""Converte Word com o renderizador do próprio Microsoft Word."""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

from .protocolo import ErroDoUsuario


def converter_word(caminho: str) -> str:
    if os.name != "nt":
        raise ErroDoUsuario("A conversão de Word no Juntar requer o aplicativo Windows com Microsoft Word instalado.")

    descritor, destino = tempfile.mkstemp(suffix=".pdf", dir=os.path.dirname(caminho))
    os.close(descritor)
    os.unlink(destino)
    script = Path(__file__).with_name("word_para_pdf.ps1")
    concluido = False
    try:
        processo = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script), caminho, destino],
            capture_output=True,
            text=True,
            timeout=120,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            check=False,
        )
        if processo.returncode != 0 or not os.path.isfile(destino):
            detalhe = (processo.stderr or processo.stdout).strip()
            raise ErroDoUsuario(
                f"Não consegui converter {os.path.basename(caminho)} pelo Microsoft Word. "
                + (detalhe[-500:] if detalhe else "Confirme que o Word está instalado e o arquivo abre normalmente nele.")
            )
        concluido = True
        return destino
    except subprocess.TimeoutExpired as erro:
        raise ErroDoUsuario(
            f"O Microsoft Word demorou demais para converter {os.path.basename(caminho)}. "
            "Feche diálogos abertos no Word e tente novamente."
        ) from erro
    except OSError as erro:
        raise ErroDoUsuario("Não consegui iniciar o Microsoft Word para converter o documento.") from erro
    finally:
        if not concluido:
            try:
                os.unlink(destino)
            except FileNotFoundError:
                pass
