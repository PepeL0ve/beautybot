// lib/svc/settings.js — настройки мастера (spec §14) с дефолтами.

export const DEFAULT_SETTINGS = {
  auto_confirm: false,        // авто-подтверждение онлайн-записей
  only_existing: false,       // запись только для существующих клиентов
  sticky_min: 0,              // буфер вокруг записей
  min_lead_min: 60,           // минимальный горизонт записи
  book_days_ahead: 14,        // на сколько дней вперёд открыта запись
  remind_offsets_min: [1440, 120], // напоминания клиенту о записи
  pending_remind_min: 120,    // напомнить мастеру о висящей заявке
  regular_visits: 3,          // визитов для категории «постоянный»
  lost_days: 30,              // дней без визита → «потеряшка»
  auto_income: true,          // доход автоматически из завершённых записей
  birthday_greet: true,       // поздравлять клиентов с днём рождения
  admin_chat_id: null,        // чат для /tick и служебных уведомлений
};

export function withDefaults(s) {
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}
