// Tarefa 5.10: HTML + CSS + JS do build, comprimidos com gzip, precisam somar menos de 50 KB.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = new URL('../dist/', import.meta.url).pathname;
const LIMIT = 50 * 1024;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(DIST).filter((f) => /\.(html|css|js)$/.test(f));
let raw = 0;
let gz = 0;
for (const f of files) {
  const data = readFileSync(f);
  const size = gzipSync(data, { level: 9 }).length;
  raw += data.length;
  gz += size;
  console.log(`${relative(DIST, f).padEnd(32)} ${String(data.length).padStart(7)} B  gzip ${String(size).padStart(6)} B`);
}
// Nada de mock ou código de teste no build de produção.
const leaked = files.filter((f) => /mock|__mock|vitest/.test(readFileSync(f, 'utf8')));
console.log(`total: ${raw} B, gzip ${gz} B (${(gz / 1024).toFixed(1)} KB) de ${LIMIT / 1024} KB`);
if (leaked.length) {
  console.error('mock no build: ' + leaked.join(', '));
  process.exit(1);
}
if (gz >= LIMIT) process.exit(1);
