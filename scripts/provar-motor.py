"""Prova as 37 acoes do motor, uma por uma, e grava o que sai.

Nao e um teste: e uma demonstracao. Os testes dizem "passou"; isto entrega os
arquivos para alguem abrir e olhar, com o tempo que cada operacao levou e o
tamanho do que saiu. E o que se mostra para quem vai usar o programa no
balcao, ou para conferir depois de uma mudanca grande.

Tudo que entra e inventado aqui dentro — paginas com texto de exemplo, uma
"foto" de formas coloridas, um CNPJ 00.000.000/0001-00. Nenhum arquivo da
pessoa entra, e nada do que sai tem dado de ninguem.

    motor\\runtime\\python.exe scripts/provar-motor.py [pasta-de-saida]
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "motor"))

import pymupdf  # noqa: E402

PYTHON = os.path.join(RAIZ, "motor", "runtime", "python.exe")
PRINCIPAL = os.path.join(RAIZ, "motor", "principal.py")


class Motor:
    """O motor de verdade, pelo mesmo canal que o aplicativo usa.

    Pelo processo, e nao chamando a funcao: e assim que o defeito de
    codificacao de acento aparece, e e assim que o aplicativo conversa.
    """

    def __init__(self) -> None:
        self.processo = subprocess.Popen(
            [PYTHON, PRINCIPAL],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=RAIZ,
        )

    def pedir(self, acao: str, pedido: dict) -> dict:
        """Manda o pedido e devolve a resposta final.

        O canal responde em linhas: as de `tipo: andamento` vao passando, e a
        conversa termina em `fim` ou `erro`.
        """
        linha = json.dumps({"id": acao, "acao": acao, **pedido}, ensure_ascii=True) + "\n"
        assert self.processo.stdin and self.processo.stdout
        self.processo.stdin.write(linha.encode("utf-8"))
        self.processo.stdin.flush()
        while True:
            resposta = self.processo.stdout.readline()
            if not resposta:
                raise RuntimeError("o motor fechou o canal")
            dados = json.loads(resposta.decode("utf-8"))
            if dados.get("tipo") == "fim":
                return {"ok": True, "dados": dados.get("dados", {})}
            if dados.get("tipo") == "erro":
                return {"ok": False, "erro": dados.get("erro", "?")}

    def fechar(self) -> None:
        if self.processo.stdin:
            self.processo.stdin.close()
        self.processo.wait(timeout=30)


def pdf_de_exemplo(caminho: str, paginas: int = 4, senha: str = "") -> str:
    """Um documento com texto, linha e cor — nada de real."""
    doc = pymupdf.open()
    for n in range(1, paginas + 1):
        pagina = doc.new_page()
        pagina.insert_text((72, 90), f"Pagina {n} de {paginas}", fontsize=22)
        pagina.insert_text((72, 130), "Documento de exemplo do PDF.GreenCodes", fontsize=12)
        pagina.insert_text((72, 150), "CNPJ 00.000.000/0001-00 - dados ficticios", fontsize=10)
        pagina.draw_rect(pymupdf.Rect(72, 180, 520, 400), color=(0.1, 0.4, 0.9), fill=(0.85, 0.92, 1))
        pagina.draw_line(pymupdf.Point(72, 430), pymupdf.Point(520, 430), color=(0, 0, 0), width=1.5)
    if senha:
        doc.save(caminho, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw=senha, user_pw=senha)
    else:
        doc.save(caminho)
    doc.close()
    return caminho


def foto_de_exemplo(caminho: str, largura: int = 1200, altura: int = 1600) -> str:
    """Uma "foto": degrade com formas, para ter detalhe como uma de verdade."""
    doc = pymupdf.open()
    pagina = doc.new_page(width=largura / 4, height=altura / 4)
    r = pagina.rect
    for i in range(40):
        t = i / 40
        pagina.draw_rect(
            pymupdf.Rect(0, r.height * t, r.width, r.height * (t + 1 / 40) + 1),
            color=None,
            fill=(0.2 + t * 0.6, 0.45, 0.9 - t * 0.5),
        )
    for k in range(24):
        pagina.draw_circle(
            ((k * 37) % r.width, (k * 53) % r.height),
            8 + (k % 5) * 6,
            color=(1, 1, 1),
            fill=((k % 3) / 2, (k % 4) / 3, (k % 5) / 4),
        )
    pagina.get_pixmap(dpi=288).save(caminho, jpg_quality=92)
    doc.close()
    return caminho


def main() -> int:
    saida = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "provas", "motor")
    os.makedirs(saida, exist_ok=True)
    entradas = os.path.join(saida, "_entradas")
    os.makedirs(entradas, exist_ok=True)

    doc4 = pdf_de_exemplo(os.path.join(entradas, "documento-4-paginas.pdf"), 4)
    doc1 = pdf_de_exemplo(os.path.join(entradas, "documento-1-pagina.pdf"), 1)
    doc_senha = pdf_de_exemplo(os.path.join(entradas, "com-senha-1234.pdf"), 2, senha="1234")
    foto = foto_de_exemplo(os.path.join(entradas, "foto-exemplo.jpg"))

    def alvo(nome: str, extensao: str = ".pdf") -> str:
        return os.path.join(saida, nome + extensao)

    # (acao, pedido, o que isto mostra)
    provas: list[tuple[str, dict, str]] = [
        ("informar", {"arquivos": [doc4]}, "le paginas, formato e se pede senha"),
        ("juntar", {"arquivos": [doc4, doc1], "saida": alvo("juntar")}, "dois documentos num so"),
        ("extrair", {"arquivos": [doc4], "opcoes": {"paginas": "2,4"}, "saida": alvo("extrair")}, "so as paginas 2 e 4"),
        ("remover", {"arquivos": [doc4], "opcoes": {"paginas": "1"}, "saida": alvo("remover")}, "sem a primeira pagina"),
        ("girar", {"arquivos": [doc4], "opcoes": {"graus": 90}, "saida": alvo("girar")}, "tudo girado 90 graus"),
        ("inverter-paginas", {"arquivos": [doc4], "saida": alvo("inverter-paginas")}, "de tras para frente"),
        ("intercalar", {"arquivos": [doc4, doc1], "saida": alvo("intercalar")}, "uma de cada, alternando"),
        ("separar-pares-impares", {"arquivos": [doc4], "opcoes": {"quais": "impares"}, "saida": alvo("separar-pares-impares")}, "so as impares"),
        ("livreto", {"arquivos": [doc4], "saida": alvo("livreto")}, "na ordem da dobra, para grampear no meio"),
        ("varias-por-folha", {"arquivos": [doc4], "opcoes": {"porFolha": 4}, "saida": alvo("varias-por-folha")}, "quatro paginas por folha"),
        ("dividir-paginas", {"arquivos": [doc4], "opcoes": {"onde": "vertical"}, "saida": alvo("dividir-paginas")}, "cada pagina cortada ao meio"),
        ("paginas-em-branco", {"arquivos": [doc4], "opcoes": {"onde": "depois"}, "saida": alvo("paginas-em-branco")}, "uma folha em branco depois de cada"),
        ("comprimir", {"arquivos": [doc4], "opcoes": {"modo": "imagens", "dpi": 300, "qualidade": 82}, "saida": alvo("comprimir")}, "fotos a 300 DPI, texto intacto"),
        ("reparar", {"arquivos": [doc4], "saida": alvo("reparar")}, "estrutura reescrita do zero"),
        ("cortar", {"arquivos": [doc4], "opcoes": {"margemMm": 10}, "saida": alvo("cortar")}, "10 mm aparados de cada lado"),
        ("redimensionar", {"arquivos": [doc4], "opcoes": {"formato": "a5"}, "saida": alvo("redimensionar")}, "reduzido para A5"),
        ("numerar", {"arquivos": [doc4], "opcoes": {"posicao": "rodape-direita"}, "saida": alvo("numerar")}, "numero no canto de cada folha"),
        ("cabecalho-rodape", {"arquivos": [doc4], "opcoes": {"cabecalho": "EXEMPLO", "rodape": "PDF.GreenCodes"}, "saida": alvo("cabecalho-rodape")}, "cabecalho e rodape em todas"),
        ("marca-dagua", {"arquivos": [doc4], "opcoes": {"texto": "COPIA", "opacidade": 0.25}, "saida": alvo("marca-dagua")}, "COPIA por cima, transparente"),
        ("tons-de-cinza", {"arquivos": [doc4], "opcoes": {"dpi": 150}, "saida": alvo("tons-de-cinza")}, "sem cor, com meio-tom"),
        ("tons-de-preto", {"arquivos": [doc4], "opcoes": {"dpi": 150}, "saida": alvo("tons-de-preto")}, "preto e branco de digitalizacao"),
        ("inverter-cor", {"arquivos": [doc4], "opcoes": {"dpi": 150}, "saida": alvo("inverter-cor")}, "negativo, para fotolito"),
        ("rgb-para-cmyk", {"arquivos": [doc1], "saida": alvo("rgb-para-cmyk")}, "cor separada nas quatro tintas"),
        ("separar-chapas", {"arquivos": [doc1], "opcoes": {"chapas": "cmyk", "dpi": 150}, "saida": alvo("separar-chapas")}, "uma pagina por chapa"),
        ("cobertura-de-tinta", {"arquivos": [doc1], "opcoes": {"dpi": 100}}, "quanto de tinta cada pagina pede"),
        ("proteger", {"arquivos": [doc4], "opcoes": {"senha": "1234"}, "saida": alvo("proteger")}, "com senha de abertura"),
        ("desbloquear", {"arquivos": [doc_senha], "senhas": ["1234"], "saida": alvo("desbloquear")}, "senha retirada, com a senha certa"),
        ("ler-metadados", {"arquivos": [doc4]}, "autor, titulo e datas"),
        ("definir-metadados", {"arquivos": [doc4], "opcoes": {"titulo": "Exemplo", "autor": "PDF.GreenCodes"}, "saida": alvo("definir-metadados")}, "titulo e autor gravados"),
        ("limpar-metadados", {"arquivos": [doc4], "saida": alvo("limpar-metadados")}, "sem autor, sem historico"),
        ("imagem-para-pdf", {"arquivos": [foto], "saida": alvo("imagem-para-pdf")}, "foto virou pagina"),
        ("folha-de-fotos", {"arquivos": [foto], "opcoes": {"modelo": "3x4", "papel": "10x15", "sangriaMm": 2}, "saida": alvo("folha-de-fotos-3x4")}, "nove 3x4 num 10x15, com sobra de corte"),
        ("folha-de-fotos", {"arquivos": [foto], "opcoes": {"modelo": "polaroid", "papel": "10x15", "paisagem": True, "texto": "Exemplo 2026", "fonteDoTexto": "script"}, "saida": alvo("folha-de-fotos-polaroid")}, "duas polaroids com a tarja escrita"),
        ("formatos", {"arquivos": []}, "a lista de formatos e papeis"),
    ]

    # Estas devolvem uma pasta com varios arquivos.
    em_pasta: list[tuple[str, dict, str]] = [
        ("dividir", {"arquivos": [doc4], "opcoes": {"porArquivo": 2}}, "um arquivo a cada duas paginas"),
        ("pdf-para-imagem", {"arquivos": [doc1], "opcoes": {"dpi": 150, "formato": "jpeg"}}, "cada pagina como imagem"),
        ("extrair-imagens", {"arquivos": [alvo("imagem-para-pdf")]}, "as fotos de dentro do PDF"),
        ("desenhar", {"arquivos": [doc1], "opcoes": {"dpi": 150}}, "pagina desenhada em imagem"),
    ]

    motor = Motor()
    linhas: list[dict] = []
    try:
        for acao, pedido, oQueMostra in provas + em_pasta:
            if (acao, pedido, oQueMostra) in em_pasta:
                pasta = os.path.join(saida, acao)
                os.makedirs(pasta, exist_ok=True)
                pedido = {**pedido, "saida": pasta}
            inicio = time.time()
            try:
                resposta = motor.pedir(acao, pedido)
            except Exception as erro:  # noqa: BLE001
                linhas.append({"acao": acao, "ok": False, "erro": str(erro), "mostra": oQueMostra})
                continue
            gasto = time.time() - inicio

            if not resposta.get("ok"):
                linhas.append({"acao": acao, "ok": False, "erro": resposta.get("erro", "?"), "mostra": oQueMostra})
                continue

            dados = resposta.get("dados", {})
            arquivos = dados.get("arquivos") if isinstance(dados.get("arquivos"), list) else None
            nomes: list[str] = []
            bytes_totais = 0
            if isinstance(dados.get("arquivo"), str):
                nomes = [os.path.relpath(dados["arquivo"], saida)]
                bytes_totais = os.path.getsize(dados["arquivo"]) if os.path.exists(dados["arquivo"]) else 0
            elif arquivos and all(isinstance(a, dict) and "arquivo" in a for a in arquivos):
                nomes = [os.path.relpath(a["arquivo"], saida) for a in arquivos]
                bytes_totais = sum(os.path.getsize(a["arquivo"]) for a in arquivos if os.path.exists(a["arquivo"]))

            linhas.append(
                {
                    "acao": acao,
                    "ok": True,
                    "segundos": round(gasto, 2),
                    "arquivos": nomes,
                    "bytes": bytes_totais,
                    "paginas": dados.get("paginas") if isinstance(dados.get("paginas"), int) else None,
                    "notas": [n for n in dados.get("notas", []) if isinstance(n, str)],
                    "mostra": oQueMostra,
                }
            )
            print(f"{'ok ' if linhas[-1]['ok'] else 'ERRO'} {acao:<26} {oQueMostra}")
    finally:
        motor.fechar()

    with open(os.path.join(saida, "resultado.json"), "w", encoding="utf-8") as f:
        json.dump(linhas, f, ensure_ascii=False, indent=2)

    certas = sum(1 for l in linhas if l["ok"])
    print(f"\n{certas} de {len(linhas)} acoes do motor entregaram arquivo, em {saida}")
    return 0 if certas == len(linhas) else 1


if __name__ == "__main__":
    raise SystemExit(main())
