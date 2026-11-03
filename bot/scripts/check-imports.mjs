// Проверка, что все относительные импорты внутри tgcloud/ указывают на
// существующие файлы (частая ошибка вложенных папок: '../lib/x.js' из lib/svc).
// Запуск из bot/: node scripts/check-imports.mjs

import fs from 'node:fs';
import path from 'node:path';

const root = 'tgcloud';
const files = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.js')) files.push(p);
  }
}
walk(root);

let bad = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (!fs.existsSync(target)) {
      console.log(`BROKEN  ${file}  ->  ${m[1]}`);
      bad++;
    }
  }
}

console.log(bad ? `\n${bad} broken import(s)` : `All relative imports resolve ✓ (${files.length} files)`);
process.exit(bad ? 1 : 0);