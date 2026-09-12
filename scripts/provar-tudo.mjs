/**
 * Prova todas as ferramentas de uma vez e monta o relatório.
 *
 * Chama os três provadores na ordem em que eles dependem um do outro: o do
 * motor desenha as entradas de exemplo, o do navegador as reaproveita, e o
 * relatório junta os dois em miniaturas e numa folha de contato.
 *
 *   npm run provar-tudo
 *   npm run provar-tudo -- "C:/Users/geren/Desktop/provas"
 *
 * Nada do que entra é de alguém: as páginas, a foto e o CNPJ são inventados
 * dentro dos scripts. A pasta de saída não vai para o git.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON = path.join(RAIZ, 'motor', 'runtime', 'python.exe');
const destino = path.resolve(process.argv[2] ?? path.join(RAIZ, 'provas'));

if (!existsSync(PYTHON)) {
  console.error('O motor ainda não foi preparado. Rode: node scripts/preparar-motor.mjs');
  process.exit(1);
}

mkdirSync(destino, { recursive: true });
const correr = (comando, argumentos, extras = {}) => {
  console.log(`\n> ${comando} ${argumentos.join(' ')}`);
  execFileSync(comando, argumentos, { cwd: RAIZ, stdio: 'inherit', ...extras });
};

correr(PYTHON, [path.join('scripts', 'provar-motor.py'), path.join(destino, 'motor')]);
// O vitest pelo arquivo .mjs dele, e não pelo `npx`: o Node 24 no Windows
// recusa executar .cmd direto (EINVAL), e chamar por shell abriria espaço
// para o caminho com espaço virar outro comando.
// A pasta vai pela variável PROVAS: sem ela o provador do navegador passa sem
// escrever nada, para não sujar a pasta durante o `npm test`.
correr(process.execPath, [path.join('node_modules', 'vitest', 'vitest.mjs'), 'run', 'scripts/provar-ferramentas.test.ts'], {
  env: { ...process.env, PROVAS: path.join(destino, 'navegador') },
});
// A impressão passa pelo spooler de verdade, pela "Microsoft Print to PDF":
// é o único jeito de medir a folha que sai sem gastar papel.
correr(process.execPath, [path.join('scripts', 'provar-impressao.mjs'), path.join(destino, 'impressao')]);
correr(PYTHON, [path.join('scripts', 'provar-relatorio.py'), destino]);

console.log(`\nPronto. Abra ${path.join(destino, 'contato.png')} para ver tudo de uma vez,`);
console.log(`e ${path.join(destino, 'LEIAME.md')} para a tabela ferramenta por ferramenta.`);
