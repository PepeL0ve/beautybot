# Скрипт синхронизации Obsidian-вольта

Обновляет `obsidian/` из исходников проекта. Запускать после любого изменения
spec/reports/README.

## Как запускать

```bash
cd C:\Users\FLYXSE\beautyBOT
node scripts/sync-obsidian.mjs
```

Или из корня проекта:
```bash
npm run sync:obsidian   # если добавлено в package.json
```

## Что делает

1. Копирует `spec.md` → `obsidian/spec.md`
2. Копирует `reports/*.md` → `obsidian/reports/`
3. Копирует `docs/manual-tests.md` → `obsidian/manual-tests.md`
4. Обновляет `obsidian/progress.md` из `git log` и списка фаз
5. Обновляет `obsidian/roadmap.canvas` — карточки фаз с текущим статусом