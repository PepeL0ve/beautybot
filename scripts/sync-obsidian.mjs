// scripts/sync-obsidian.mjs — синхронизация Obsidian-вольта из проекта.
// Запуск из корня: node scripts/sync-obsidian.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const obs = path.join(root, 'obsidian');

// --- Копируем исходники ---
const copies = [
  ['spec.md', 'spec.md'],
  ['docs/manual-tests.md', 'manual-tests.md'],
  ['README.md', 'readme-src.md'],
];
for (const [from, to] of copies) {
  const src = path.join(root, from);
  const dst = path.join(obs, to);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    console.log(`✓ ${from} → ${to}`);
  }
}

// reports/
const reportsDir = path.join(root, 'reports');
if (fs.existsSync(reportsDir)) {
  fs.mkdirSync(path.join(obs, 'reports'), { recursive: true });
  for (const f of fs.readdirSync(reportsDir)) {
    if (f.endsWith('.md')) {
      fs.copyFileSync(path.join(reportsDir, f), path.join(obs, 'reports', f));
      console.log(`✓ reports/${f}`);
    }
  }
}

// --- Обновляем progress.md из git ---
const today = new Date().toISOString().slice(0, 10);
let gitLog = '';
try {
  gitLog = execSync('git log --oneline --all --date=short --pretty="%ad %s" -n 10', { cwd: root, encoding: 'utf8' });
} catch { /* нет git — пропускаем */ }

const progress = `# Текущий прогресс

Обновляется автоматически: \`node scripts/sync-obsidian.mjs\`

## Сейчас

- **Дата**: ${today}
- **Последние коммиты**:
${gitLog.split('\n').filter(Boolean).map((l) => `  - ${l}`).join('\n')}

## Фазы

- [x] Фаза 0 — каркас, доступ, онбординг, деплой
- [x] Фаза 1 — ядро календаря (услуги, часы, записи)
- [x] Фаза 2 — CRM клиентов
- [x] Фаза 3 — онлайн-запись клиентом
- [ ] Фаза 4 — напоминания и рассылки
- [ ] Фаза 5 — финансы и статистика
- [ ] Фаза 6 — итерация (сравнение с оригиналом)
`;
fs.writeFileSync(path.join(obs, 'progress.md'), progress, 'utf8');
console.log('✓ progress.md');

// --- Canvas с фазами ---
const phases = [
  { id: 'p0', label: 'Фаза 0', title: 'Каркас + доступ + онбординг', done: true },
  { id: 'p1', label: 'Фаза 1', title: 'Ядро календаря', done: true },
  { id: 'p2', label: 'Фаза 2', title: 'CRM клиентов', done: true },
  { id: 'p3', label: 'Фаза 3', title: 'Онлайн-запись', done: true },
  { id: 'p4', label: 'Фаза 4', title: 'Напоминания и рассылки', done: false },
  { id: 'p5', label: 'Фаза 5', title: 'Финансы и статистика', done: false },
  { id: 'p6', label: 'Фаза 6', title: 'Итерация', done: false },
];

const canvas = {
  nodes: [
    {
      id: 'title', type: 'text', text: '# beautyBOT\n\nКлон BeautyAgent — Telegram-бот для мастеров красоты',
      x: 200, y: -180, width: 500, height: 100,
    },
    ...phases.map((p, i) => ({
      id: p.id,
      type: 'text',
      text: `${p.done ? '✅' : '⬜️'} **${p.label}**\n${p.title}`,
      x: 100 + (i % 4) * 260,
      y: 60 + Math.floor(i / 4) * 200,
      width: 220,
      height: 120,
      color: p.done ? '1' : '4',
    })),
  ],
  edges: phases.slice(1).map((p, i) => ({
    id: `e${i}`,
    fromNode: phases[i].id,
    fromSide: 'right',
    toNode: p.id,
    toSide: 'left',
  })),
};
fs.writeFileSync(path.join(obs, 'roadmap.canvas'), JSON.stringify(canvas, null, 2), 'utf8');
console.log('✓ roadmap.canvas');

console.log('\nГотово. Откройте папку как vault в Obsidian.');