"""Junta as provas num relatorio: miniaturas, folha de contato e LEIAME.

Le o `resultado.json` que os dois provadores deixam (motor e navegador),
desenha a primeira pagina de cada arquivo que saiu e monta:

- `miniaturas/` — uma imagem por prova, para abrir uma a uma;
- `contato.png` — todas juntas numa folha, com o nome embaixo;
- `LEIAME.md` — a tabela do que cada ferramenta entregou, com tamanho,
  paginas e tempo, e o que ficou de fora e por que.

    motor\\runtime\\python.exe scripts/provar-relatorio.py <pasta-das-provas>
"""

from __future__ import annotations

import json
import math
import os
import sys

import pymupdf

LARGURA_DA_MINIATURA = 260


def miniatura(caminho: str, destino: str) -> tuple[int, int] | None:
    """A primeira pagina (ou a imagem) num PNG pequeno."""
    try:
        if caminho.lower().endswith((".png", ".jpg", ".jpeg")):
            imagem = pymupdf.open(caminho)
            pagina = imagem[0]
        else:
            imagem = pymupdf.open(caminho)
            if imagem.page_count == 0:
                return None
            pagina = imagem[0]
        escala = LARGURA_DA_MINIATURA / max(pagina.rect.width, 1)
        pixels = pagina.get_pixmap(matrix=pymupdf.Matrix(escala, escala))
        pixels.save(destino)
        imagem.close()
        return pixels.width, pixels.height
    except Exception:  # noqa: BLE001 - arquivo que nao da para desenhar so nao entra
        return None


def ler(pasta: str) -> list[dict]:
    caminho = os.path.join(pasta, "resultado.json")
    if not os.path.exists(caminho):
        return []
    with open(caminho, encoding="utf-8") as f:
        return json.load(f)


def _grade(pagina, imagens: list[tuple[str, str]], colunas: int, titulo: str) -> None:
    """Desenha as miniaturas em grade, com o nome embaixo de cada uma."""
    celula_l, celula_a = LARGURA_DA_MINIATURA + 16, LARGURA_DA_MINIATURA + 80
    pagina.draw_rect(pagina.rect, color=None, fill=(1, 1, 1))

    for indice, (rotulo, caminho) in enumerate(imagens):
        coluna, linha = indice % colunas, indice // colunas
        x = 10 + coluna * celula_l
        y = 30 + linha * celula_a
        try:
            pix = pymupdf.Pixmap(caminho)
            escala = min(LARGURA_DA_MINIATURA / pix.width, (celula_a - 46) / pix.height)
            caixa = pymupdf.Rect(x, y, x + pix.width * escala, y + pix.height * escala)
            pagina.draw_rect(caixa, color=(0.85, 0.85, 0.85), width=0.5)
            pagina.insert_image(caixa, pixmap=pix)
        except Exception:  # noqa: BLE001 - arquivo que nao da para desenhar so nao entra
            continue
        pagina.insert_textbox(
            pymupdf.Rect(x, y + celula_a - 42, x + LARGURA_DA_MINIATURA, y + celula_a - 8),
            rotulo,
            fontsize=7.5,
            align=pymupdf.TEXT_ALIGN_CENTER,
        )

    pagina.insert_text((12, 20), titulo, fontsize=11)


def folha_de_contato(imagens: list[tuple[str, str]], destino_png: str, destino_pdf: str) -> None:
    """Duas vistas do mesmo: uma folha longa em PNG, e um PDF paginado.

    O PNG mostra tudo de uma vez, para bater o olho. O PDF sai em folhas de
    vinte, que e o que se abre e se imprime sem rolar dez mil pixels.
    """
    if not imagens:
        return
    titulo = "PDF.GreenCodes - prova das ferramentas (conteudo de exemplo)"
    celula_l, celula_a = LARGURA_DA_MINIATURA + 16, LARGURA_DA_MINIATURA + 80

    colunas = 10
    documento = pymupdf.open()
    pagina = documento.new_page(
        width=colunas * celula_l + 20,
        height=math.ceil(len(imagens) / colunas) * celula_a + 40,
    )
    _grade(pagina, imagens, colunas, titulo)
    pagina.get_pixmap(dpi=96).save(destino_png)
    documento.close()

    por_pagina, colunas = 20, 5
    documento = pymupdf.open()
    for inicio in range(0, len(imagens), por_pagina):
        pedaco = imagens[inicio : inicio + por_pagina]
        pagina = documento.new_page(
            width=colunas * celula_l + 20,
            height=math.ceil(len(pedaco) / colunas) * celula_a + 40,
        )
        folha = inicio // por_pagina + 1
        _grade(pagina, pedaco, colunas, f"{titulo} - folha {folha}")
    documento.save(destino_pdf)
    documento.close()


# As ferramentas que o navegador nao roda porque o trabalho e do motor: no
# aplicativo elas vao por ele, e e por ele que estao provadas.
NO_MOTOR = {
    "folha-de-fotos": "folha-de-fotos",
    "separar-chapas": "separar-chapas",
    "cobertura-de-tinta": "cobertura-de-tinta",
    "rgb-para-cmyk": "rgb-para-cmyk",
}


def cobertura(
    no_navegador: list[dict],
    no_typescript: list[dict],
    no_motor: list[dict],
    na_impressao: list[dict],
) -> list[str]:
    """Uma linha por ferramenta, dizendo onde ela foi provada."""
    motor_ok = {d.get("acao") for d in no_motor if d.get("ok")}
    impressao_ok = bool(na_impressao) and all(d.get("ok") for d in na_impressao)
    typescript_ok = {d.get("slug") for d in no_typescript if d.get("ok")}

    base = no_navegador or no_typescript
    linhas = ["| ferramenta | provada onde | o que saiu |", "| --- | --- | --- |"]
    faltando: list[str] = []
    provadas = 0

    for item in base:
        slug = item.get("slug", "?")
        arquivos = item.get("arquivos") or []
        primeiro = arquivos[0] if arquivos else {}
        nome_do_arquivo = primeiro.get("nome") if isinstance(primeiro, dict) else primeiro

        if item.get("ok"):
            onde, saiu = "navegador", nome_do_arquivo or "arquivo"
        elif slug in typescript_ok:
            onde, saiu = "TypeScript (linha de comando)", "ver a pasta navegador/"
        elif slug in NO_MOTOR and NO_MOTOR[slug] in motor_ok:
            onde, saiu = "motor do aplicativo", f"ver `{NO_MOTOR[slug]}` na pasta motor/"
        elif slug == "imprimir" and impressao_ok:
            onde, saiu = "impressao medida", "cinco papeis, folha inteira (pasta impressao/)"
        else:
            onde, saiu = "**falta**", item.get("motivo", "?")
            faltando.append(f"`{slug}`: {item.get('motivo', '?')}")

        if onde != "**falta**":
            provadas += 1
        linhas.append(f"| `{slug}` — {item.get('nome', '')} | {onde} | {saiu} |")

    cabecalho = [f"\n## Cobertura: {provadas} de {len(base)} ferramentas provadas\n"]
    if faltando:
        cabecalho.append("Nao provadas aqui, e por que:\n")
        cabecalho.extend(f"- {f}" for f in faltando)
        cabecalho.append("")
    return cabecalho + linhas


def main() -> int:
    raiz = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.getcwd(), "provas")
    motor = ler(os.path.join(raiz, "motor"))
    navegador = ler(os.path.join(raiz, "navegador"))
    navegador_real = ler(os.path.join(raiz, "navegador-real"))
    impressao = ler(os.path.join(raiz, "impressao"))
    if not motor and not navegador and not navegador_real:
        print("nao achei resultado.json em", raiz)
        return 1

    pasta_mini = os.path.join(raiz, "miniaturas")
    os.makedirs(pasta_mini, exist_ok=True)
    contato: list[tuple[str, str]] = []

    linhas_md: list[str] = []
    linhas_md.append("# Prova das ferramentas do PDF.GreenCodes\n")
    linhas_md.append(
        "Tudo aqui foi gerado com **conteudo de exemplo** — paginas com texto inventado, "
        "uma foto desenhada por codigo e um CNPJ ficticio. Nenhum arquivo de cliente entrou.\n"
    )

    linhas_md.extend(cobertura(navegador_real, navegador, motor, impressao))

    for titulo, dados, pasta in (
        ("Motor (Python + PyMuPDF) — e o que o aplicativo usa nas ferramentas pesadas", motor, os.path.join(raiz, "motor")),
        ("Navegador de verdade — cada ferramenta na tela onde ela roda", navegador_real, os.path.join(raiz, "navegador-real")),
        ("Navegador (TypeScript) — o mesmo codigo fora da tela, na linha de comando", navegador, os.path.join(raiz, "navegador")),
        ("Impressao — pela fila do Windows, medindo a folha que sai", impressao, os.path.join(raiz, "impressao")),
    ):
        if not dados:
            continue
        certas = [d for d in dados if d.get("ok")]
        linhas_md.append(f"\n## {titulo}\n")
        linhas_md.append(f"{len(certas)} de {len(dados)} entregaram arquivo.\n")
        linhas_md.append("| ferramenta | o que mostra | arquivo | tamanho | paginas | tempo |")
        linhas_md.append("| --- | --- | --- | --- | --- | --- |")

        for item in dados:
            nome = item.get("acao") or item.get("slug", "?")
            mostra = item.get("mostra") or item.get("nome", "")
            if not item.get("ok"):
                linhas_md.append(f"| `{nome}` | {mostra} | — | — | — | {item.get('motivo', item.get('erro', '?'))} |")
                continue
            # O provador do navegador guarda {nome, bytes} por arquivo; os
            # outros guardam so o nome, e o tamanho somado na linha.
            arquivos = [a["nome"] if isinstance(a, dict) else a for a in (item.get("arquivos") or [])]
            primeiro = arquivos[0] if arquivos else ""
            tamanho = item.get("bytes") or sum(
                a.get("bytes", 0) for a in (item.get("arquivos") or []) if isinstance(a, dict)
            )
            tamanho_txt = f"{tamanho / 1024:.0f} KB" if tamanho < 1024 * 1024 else f"{tamanho / 1024 / 1024:.1f} MB"
            paginas = item.get("paginas") or "—"
            tempo = item.get("segundos") or (round(item["ms"] / 100) / 10 if item.get("ms") else None)
            linhas_md.append(
                f"| `{nome}` | {mostra} | {primeiro}{f' (+{len(arquivos) - 1})' if len(arquivos) > 1 else ''} "
                f"| {tamanho_txt} | {paginas} | {f'{tempo}s' if tempo else '—'} |"
            )

            if primeiro:
                caminho = os.path.join(pasta, primeiro)
                saida = os.path.join(pasta_mini, f"{nome}-{os.path.basename(primeiro)}.png".replace(os.sep, "-"))
                if os.path.exists(caminho) and miniatura(caminho, saida):
                    contato.append((f"{nome}\n{mostra}"[:90], saida))

    folha_de_contato(contato, os.path.join(raiz, "contato.png"), os.path.join(raiz, "contato.pdf"))
    linhas_md.append("\n## Como refazer\n")
    linhas_md.append("O motor, o TypeScript, a impressao e o relatorio saem de um comando so:\n")
    linhas_md.append("```\nnpm run provar-tudo\n```\n")
    linhas_md.append(
        "A parte do navegador e a unica que precisa de gente: abra `/app/provar` "
        "(no site, com `npm run dev`, ou no aplicativo), clique em **Rodar e baixar tudo** "
        "e descompacte o `provas-navegador.zip` em `<pasta>\\navegador-real`. Depois rode o "
        "relatorio de novo:\n"
    )
    linhas_md.append("```\nmotor\\runtime\\python.exe scripts/provar-relatorio.py <pasta>\n```\n")

    with open(os.path.join(raiz, "LEIAME.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(linhas_md))

    print(f"{len(contato)} miniaturas, folha de contato e LEIAME.md em {raiz}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
