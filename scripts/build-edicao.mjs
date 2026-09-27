import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const edicao = process.argv[2];
if (!['opus', 'completa'].includes(edicao)) throw new Error('Escolha opus ou completa.');
const raiz = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env, NEXT_PUBLIC_APP_EDITION: edicao };
const executar = (...args) => execFileSync(process.execPath, args, { cwd: raiz, env, stdio: 'inherit' });
executar('scripts/compilar-impressora.js');
executar('scripts/motor-do-instalador.mjs');
const configuracoes = ['--config', 'src-tauri/tauri.instalador.json'];
if (edicao === 'opus') configuracoes.push('--config', 'src-tauri/tauri.opus.json', '--features', 'opus');
executar('node_modules/@tauri-apps/cli/tauri.js', 'build', ...configuracoes);
