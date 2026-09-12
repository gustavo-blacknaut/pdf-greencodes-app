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


def folha_de_contato(imagens: list[tuple[str, str]], destino: str) -> None:
    """Todas as miniaturas numa folha, com o nome embaixo de cada uma."""
    if not imagens:
        return
    colunas = min(6, max(3, math.ceil(math.sqrt(len(imagens)))))
    linhas = math.ceil(len(imagens) / colunas)
    celula_l, celula_a = LARGURA_DA_MINIATURA + 16, LARGURA_DA_MINIATURA + 80

    documento = pymupdf.open()
    pagina = documento.new_page(width=colunas * celula_l + 20, height=linhas * celula_a + 40)
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
        except Exception:  # noqa: BLE001
            continue
        pagina.insert_textbox(
            pymupdf.Rect(x, y + celula_a - 42, x + LARGURA_DA_MINIATURA, y + celula_a - 8),
            rotulo,
            fontsize=7.5,
            align=pymupdf.TEXT_ALIGN_CENTER,
        )

    pagina.insert_text((12, 20), "PDF.GreenCodes - prova das ferramentas (conteudo de exemplo)", fontsize=11)
    pagina.get_pixmap(dpi=96).save(destino)
    documento.close()


def main() -> int:
    raiz = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.getcwd(), "provas")
    motor = ler(os.path.join(raiz, "motor"))
    navegador = ler(os.path.join(raiz, "navegador"))
    if not motor and not navegador:
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

    for titulo, dados, pasta in (
        ("Motor (Python + PyMuPDF) — e o que o aplicativo usa nas ferramentas pesadas", motor, os.path.join(raiz, "motor")),
        ("Navegador (TypeScript) — e o que o site roda, sem servidor", navegador, os.path.join(raiz, "navegador")),
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
            arquivos = item.get("arquivos") or []
            primeiro = arquivos[0] if arquivos else ""
            tamanho = item.get("bytes") or 0
            tamanho_txt = f"{tamanho / 1024:.0f} KB" if tamanho < 1024 * 1024 else f"{tamanho / 1024 / 1024:.1f} MB"
            paginas = item.get("paginas") or "—"
            tempo = item.get("segundos")
            linhas_md.append(
                f"| `{nome}` | {mostra} | {primeiro}{f' (+{len(arquivos) - 1})' if len(arquivos) > 1 else ''} "
                f"| {tamanho_txt} | {paginas} | {f'{tempo}s' if tempo else '—'} |"
            )

            if primeiro:
                caminho = os.path.join(pasta, primeiro)
                saida = os.path.join(pasta_mini, f"{nome}-{os.path.basename(primeiro)}.png".replace(os.sep, "-"))
                if os.path.exists(caminho) and miniatura(caminho, saida):
                    contato.append((f"{nome}\n{mostra}"[:90], saida))

    folha_de_contato(contato, os.path.join(raiz, "contato.png"))
    linhas_md.append("\n## Como refazer\n")
    linhas_md.append("```\nmotor\\runtime\\python.exe scripts/provar-motor.py <pasta>\\motor\n")
    linhas_md.append('set PROVAS=<pasta>\\navegador && npx vitest run scripts/provar-ferramentas.test.ts\n')
    linhas_md.append("motor\\runtime\\python.exe scripts/provar-relatorio.py <pasta>\n```\n")

    with open(os.path.join(raiz, "LEIAME.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(linhas_md))

    print(f"{len(contato)} miniaturas, folha de contato e LEIAME.md em {raiz}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
