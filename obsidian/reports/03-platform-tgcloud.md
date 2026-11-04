# REA Report 03 — Платформа запуска: Telegram Cloud serverless (@tgcloud)

Дата: 2026-11-03
Источник: https://core.telegram.org/bots/serverless (официальная документация)

## Модель исполнения (CONFIRMED)

- Код работает на инфраструктуре Telegram в V8-изолятах, рядом с системами
  Telegram. Никаких серверов, контейнеров, SSH.
- Webhook управляется платформой автоматически (вручную не указывается).
- Каждый тип update → отдельный файл: `handlers/message.js`,
  `handlers/callback_query.js`, `handlers/inline_query.js`, прочие типы Bot API
  по имени файла (например `my_chat_member.js`). Пустой/отсутствующий файл —
  update молча игнорируется. Хендлеры плоские, без подкаталогов.
- Общий код — `lib/` (вложенности допустимы только внутри lib),
  эндпоинты для Mini App — `endpoints/`.
- **Нет npm-пакетов в рантайме**: импортируется только `sdk` и свои модули.
  SDK-поверхность: `db`, `api` (Bot API), `fetch`, `InputFile`,
  `EndpointError`. Нет filesystem; сеть только через SDK fetch.
- ESM, `.js` расширения в относительных импортах.
- Единственная переменная окружения: `TGCLOUD_TOKEN` (CI-аутентификация).

## База данных (CONFIRMED)

- На каждый бот — SQLite через `sdk.db`: DSL как в Drizzle ORM
  (`table()`, `integer()`, `text()`, `json()`, `blob()`), fluent async query
  builder, raw SQL `db.run/all/get/values`.
- **Внешние ключи отключены** (`.references()` бросает) — целостность
  обеспечиваем в коде приложения.
- Миграции отделены от деплоя: `push` затем `migrate` (2 шага); удаление
  колонок/таблиц — через `.deprecated()`, смена типов — вручную.

## Mini App (CONFIRMED, для Фазы 6)

- Фронтенд React/Vue/Svelte собирается Vite; статика хостится на
  `https://app<app_id>.tgcloud.ai/`.
- `endpoints/*.js` вызываются ТОЛЬКО из Mini App пользователя Telegram
  (`ctx.initData.user` — платформа верифицирует); клиентский вызов через
  `Telegram.WebApp.Serverless.call('endpoint', {...})`.
- Внешний HTTP-вызов эндпоинта невозможен → внешняя система не может
  дёрнуть модули напрямую.

## Планировщик (CONFIRMED: ОТСУТСТВУЕТ)

Нет cron-триггеров, таймеров, очередей, отложенных сообщений. Код выполняется
только при входящем update. Следствие для паритета с оригиналом:
напоминания по времени реализуем гибридом:
1. **/tick** — внешний бесплатный cron (cron-job.org / GitHub Actions, каждые
   5–10 мин) через Bot API `sendMessage` шлёт боту скрытую команду в чат
   админа; `handlers/message.js` перехватывает её и выполняет sweep всех
   просроченных напоминаний (INFERRED workaround — стандартный вызов Bot API
   sendMessage не зависит от webhook-режима).
2. **Ленивая проверка** при каждом update — страховка.

## Файлы / лимиты (CONFIRMED)

- Upload InputFile ≤ 50 MB; download через `getFileContent/getFileStream`
  ≤ 20 MB; multipart через `fetch` (FormData); лимит ответа 30 MB.
- Ошибки Bot API: `BotApiError` с `.code`, `.description` (403 при блокировке).

## Инструменты (CONFIRMED)

1. @BotFather → бот → Serverless → включить → получить CLI-токен
   (отдельный от Bot API токена).
2. `npm create @tgcloud/bot example_bot` (или `npm i -g @tgcloud/cli` + `tgcloud init`).
3. `npx tgcloud login` (токен в git-игнорируемом `.tgcloud/credentials`).
4. Локальная проверка без деплоя: `npx tgcloud run <module> '<json5 payload>'`.
5. Деплой: `npx tgcloud push` (атомарный, зеркалит папку, удалённые файлы
   удаляются; оптимистичная конкурентность — устаревший push отклоняется).
6. БД: `npx tgcloud migrate` (категории safe/warning/manual).
7. Служебные: `status`, `diff`, `fetch`, `pull`, `reset`, `webhook sync`.

## Риски / UNKNOWN (проверено в Фазе 0 — 2026-11-04)

- ✅ Intl/ICU доступен в изоляте: `Intl.DateTimeFormat` с `Asia/Yekaterinburg`
  дал `10:00` для 05:00Z (UTC+5), `ru-RU` форматирует («чт, 5 ноября»).
- ✅ Лимит инвокации достаточен: простой обработчик — 4 мс, смоук с 17 таблицами
  и Bot API getMe — 136 мс. Чанк рассылки 20 сообщений укладывается с запасом.
- ✅ Типы update: webhook принимает `message, callback_query` (см. `tgcloud webhook`).
- ✅ `tgcloud run` передаёт **сам payload** (Message/CallbackQuery), не обёртку `{message:…}`.
  Только `handlers/` и `endpoints/` запускаемы; `lib/*` — лишь через импорт.
- ✅ Динамический `import()` в модулях **не поддерживается** — только статические.
- ✅ Относительные импорты из вложенных папок: из `lib/svc/x.js` путь к соседу
  пишется `../kb.js`, а не `../lib/kb.js` (иначе «Compilation failed» без деталей —
  ловится `bot/scripts/check-imports.mjs`).
- ✅ Стек БД: миграция 17 таблиц применилась; json-колонки и timestamp
  читаются с конверсией; `onConflictDoUpdate` работает.

## Фактическая конфигурация (Фаза 0)

- Бот: **@BeautyGrodnoBot** (id 9138662588), webhook
  `https://cloud.telegram.org/app9138662588/webhook`, in sync.
- Локальный репозиторий: `C:\Users\FLYXSE\beautyBOT`, проект — `bot/`.
- Доступ владельца: `access_list` = 969434663 (онбординг пройден, мастер
  `H7833SFU`, Europe/Moscow).

## Fallback

Если Serverless недоступен аккаунту в BotFather: Cloudflare Workers + D1
(grammY или сырой webhook), архитектура хендлеров и схема БД переносятся 1:1.
