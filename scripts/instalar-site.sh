#!/usr/bin/env bash
# Instala ou atualiza o site PDF.GreenCodes numa VPS Linux, com um comando so:
#
#   curl -fsSL https://raw.githubusercontent.com/gustavo-blacknaut/pdf-greencodes-app/main/scripts/instalar-site.sh | bash
#
# Baixa o codigo do GitHub (o mesmo do aplicativo), gera o site e deixa
# rodando no pm2. Rodar de novo atualiza para a ultima versao do main.
#
# A porta fica no arquivo .env da pasta do site. Na primeira vez ele e criado
# com a porta em branco: o site e gerado, mas so sobe no pm2 depois que voce
# preencher PORT= e rodar o comando de novo. O .env nao vai para o git e nao
# e apagado quando o site atualiza.
#
# Da para passar na linha de comando, e ai ganha do .env:
#   PASTA=/var/www/pdf   onde o codigo mora                (padrao: ~/pdf-greencodes)
#   PORT=5069            a porta do servidor
#   HOST=0.0.0.0         sem nginx na frente, expor direto (padrao: 127.0.0.1)

set -euo pipefail

REPO="https://github.com/gustavo-blacknaut/pdf-greencodes-app.git"
PASTA="${PASTA:-$HOME/pdf-greencodes}"
PORT_DA_LINHA="${PORT:-}"
HOST_DA_LINHA="${HOST:-}"

falhar() { echo "ERRO: $*" >&2; exit 1; }

# --- o que precisa estar instalado -------------------------------------------
command -v git >/dev/null || falhar "falta o git. No Ubuntu/Debian: sudo apt-get install -y git"
command -v node >/dev/null || falhar "falta o Node.js 20 ou mais novo. No Ubuntu/Debian:
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
MAIOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$MAIOR" -ge 20 ] || falhar "o Node.js e o $(node -v); o site precisa do 20 ou mais novo."

# --- o codigo ------------------------------------------------------------------
if [ -d "$PASTA/.git" ]; then
  echo "> Atualizando $PASTA"
  git -C "$PASTA" fetch --depth 1 origin main
  # A pasta e so do deploy: o que vale e o que esta no GitHub. O .env nao e
  # do git, entao o reset nao encosta nele.
  git -C "$PASTA" reset --hard origin/main
elif [ -e "$PASTA" ]; then
  falhar "$PASTA ja existe e nao e uma copia do git. Mova ou apague, ou escolha outra: PASTA=/outro/lugar"
else
  echo "> Baixando o codigo em $PASTA"
  git clone --depth 1 "$REPO" "$PASTA"
fi
cd "$PASTA"

# --- a configuracao ------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.exemple .env
  echo "> Criei $PASTA/.env, com a porta em branco para voce preencher"
fi
# O `tr` tira o \r de quem editou o .env no Windows.
set -a
# shellcheck disable=SC1090
. <(tr -d '\r' < .env)
set +a
export PORT="${PORT_DA_LINHA:-${PORT:-}}"
export HOST="${HOST_DA_LINHA:-${HOST:-127.0.0.1}}"

# --- o site --------------------------------------------------------------------
echo "> Instalando as dependencias"
npm ci --no-audit --no-fund
echo "> Gerando o site"
npm run build

if [ -z "$PORT" ]; then
  echo
  echo "O site foi gerado, mas ainda nao tem porta."
  echo "Preencha a porta em $PASTA/.env, por exemplo:"
  echo "  PORT=5069"
  echo "e rode este mesmo comando de novo para subir no pm2."
  exit 0
fi

# --- rodando -------------------------------------------------------------------
if ! command -v pm2 >/dev/null; then
  echo "> Instalando o pm2"
  npm install -g pm2 >/dev/null 2>&1 || sudo npm install -g pm2
fi
pm2 startOrReload ecosystem.config.js --update-env
pm2 save >/dev/null

VERSAO="$(node -p 'require("./package.json").version')"
echo
echo "Pronto: site $VERSAO rodando em http://$HOST:$PORT"
if [ "$HOST" = "127.0.0.1" ]; then
  echo "(Atras do nginx. Sem nginx, ponha HOST=0.0.0.0 no .env e rode de novo.)"
fi
echo "Para o site voltar sozinho quando a VPS reiniciar, rode uma vez: pm2 startup"
