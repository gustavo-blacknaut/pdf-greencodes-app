import type { OutputFile } from './tipos';

/** Nomes repetidos não podem apontar para o primeiro blob ao baixar ou imprimir. */
export function nomesUnicos(files: OutputFile[]): OutputFile[] {
  const reservados = new Set(files.map((file) => file.name.toLowerCase()));
  const usados = new Set<string>();
  return files.map((file) => {
    if (!usados.has(file.name.toLowerCase())) {
      usados.add(file.name.toLowerCase());
      return file;
    }
    const ponto = file.name.lastIndexOf('.');
    const base = ponto > 0 ? file.name.slice(0, ponto) : file.name;
    const ext = ponto > 0 ? file.name.slice(ponto) : '';
    let numero = 2;
    let name: string;
    do { name = `${base} (${numero++})${ext}`; }
    while (reservados.has(name.toLowerCase()) || usados.has(name.toLowerCase()));
    usados.add(name.toLowerCase());
    return { ...file, name };
  });
}
