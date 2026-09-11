/**
 * Monta o motor que vai no instalador: o mesmo de `motor/`, sem o que só
 * serve para desenvolver.
 *
 * O runtime de desenvolvimento traz o pip e o pytest, com pygments, pluggy e
 * companhia: uns 1.850 arquivos pequenos que o motor nunca importa. Em
 * megabytes pesavam pouco, e em tempo pesavam muito — extrair milhares de
 * arquivos pequenos era o que deixava a instalação lenta, com o instalador
 * em só 35 MB.
 *
 * A cópia vai para `src-tauri/target/`, que o git ignora, e só o instalador
 * usa (`tauri.instalador.json`). O `cargo test` e o `tauri dev` continuam com
 * o motor inteiro, que é o que tem o pytest.
 *
 * Depois de copiar, confere as DLLs e liga o motor copiado de verdade, pedindo
 * a lista de ações: se algo que ele importa ficou de fora, é aqui que quebra,
 * e não na máquina de quem instalou.
 *
 *   node scripts/motor-do-instalador.mjs
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conferir } from './conferir-motor.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEM = path.join(RAIZ, 'motor');
const DESTINO = path.join(RAIZ, 'src-tauri', 'target', 'motor-do-instalador');

/** Pacotes de desenvolvimento, e os `.dist-info` deles. */
const SO_PARA_DESENVOLVER =
  /^(pip|pygments|_?pytest|pluggy|iniconfig|packaging|colorama)(-[^\\/]*\.dist-info)?$|^py\.py$/i;

function entra(origem) {
  const relativo = path.relative(ORIGEM, origem);
  const partes = relativo.split(path.sep);
  // Os testes são do repositório, não do programa.
  if (partes[0] === 'testes') return false;
  // pip.exe, pytest.exe e os outros atalhos de linha de comando.
  if (partes[0] === 'runtime' && partes[1] === 'Scripts') return false;

  const dentroDoSitePackages = partes[0] === 'runtime' && partes[1] === 'Lib' && partes[2] === 'site-packages';
  if (dentroDoSitePackages && partes.length >= 4) {
    // O cache solto na raiz é o do `py.py` do pytest.
    if (partes.length === 4 && partes[3] === '__pycache__') return false;
    if (SO_PARA_DESENVOLVER.test(partes[3])) return false;
  }
  return true;
}

function contar(pasta) {
  let arquivos = 0;
  let bytes = 0;
  const visitar = (atual) => {
    for (const nome of readdirSync(atual)) {
      const caminho = path.join(atual, nome);
      const info = statSync(caminho);
      if (info.isDirectory()) visitar(caminho);
      else {
        arquivos += 1;
        bytes += info.size;
      }
    }
  };
  visitar(pasta);
  return { arquivos, megabytes: (bytes / 1024 / 1024).toFixed(1) };
}

if (!existsSync(path.join(ORIGEM, 'runtime', 'python.exe'))) {
  console.error('O motor ainda não foi preparado. Rode: node scripts/preparar-motor.mjs');
  process.exit(1);
}

rmSync(DESTINO, { recursive: true, force: true });
cpSync(ORIGEM, DESTINO, { recursive: true, filter: entra });

const antes = contar(ORIGEM);
const depois = contar(DESTINO);
console.log(`Motor do instalador em ${path.relative(RAIZ, DESTINO)}`);
console.log(`   ${depois.arquivos} arquivos, ${depois.megabytes} MB (o de desenvolvimento tem ${antes.arquivos}, ${antes.megabytes} MB)`);

const { faltas } = conferir(path.join(DESTINO, 'runtime'));
if (faltas.size) {
  console.error(`\nFaltam DLLs no motor do instalador: ${[...faltas.keys()].join(', ')}`);
  process.exit(1);
}

try {
  const acoes = execFileSync(path.join(DESTINO, 'runtime', 'python.exe'), [path.join(DESTINO, 'principal.py'), '--acoes'], {
    encoding: 'utf8',
    timeout: 60_000,
  }).trim();
  console.log(`   o motor copiado liga e responde com ${acoes.split(/\s+/).length} ações`);
} catch (erro) {
  console.error('\nO motor copiado não liga. Algo que ele importa ficou de fora:\n');
  console.error(erro.stderr || erro.message);
  process.exit(1);
}
