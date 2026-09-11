/**
 * pm2 para a VPS.
 *
 * `next start` não serve neste projeto: a saída é estática e ele recusa
 * `output: export`. Quem entrega a pasta `out/` é o servidor.js daqui.
 *
 * A porta vem do `.env` ao lado deste arquivo (ou da variável PORT, que
 * ganha dele). Sem porta nenhuma o pm2 não sobe o site: subir numa porta
 * chutada podia derrubar outro serviço da VPS que já estivesse nela.
 *
 *   pm2 start ecosystem.config.js
 *   pm2 save
 */
const fs = require('node:fs');
const path = require('node:path');

/** O `.env` como objeto. Linha em branco e comentário ficam de fora. */
function lerEnv() {
  try {
    const texto = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const valores = {};
    for (const linha of texto.split(/\r?\n/)) {
      const achado = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (achado) valores[achado[1]] = achado[2].replace(/^(["'])(.*)\1$/, '$2');
    }
    return valores;
  } catch {
    return {};
  }
}

const env = lerEnv();
const PORT = process.env.PORT || env.PORT;
if (!PORT) {
  throw new Error(`Falta a porta do site. Preencha PORT= em ${path.join(__dirname, '.env')} e rode de novo.`);
}

module.exports = {
  apps: [
    {
      name: 'pdf-greencodes',
      script: 'servidor.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT,
        // Atrás do nginx. Sem nginx, HOST=0.0.0.0 no .env expõe direto.
        HOST: process.env.HOST || env.HOST || '127.0.0.1',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      max_memory_restart: '200M',
      autorestart: true,
    },
  ],
};
