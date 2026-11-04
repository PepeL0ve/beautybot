// lib/i18n/ru.js — ВСЕ тексты интерфейса (spec §17). Разметка HTML.

import { esc } from '../fmt.js';
import { fmtDate, localDate, localMin, minToHHMM, fmtOffset } from '../time.js';

// Короткий формат суммы для визитки (без копеек, если их нет).
function rub(cents) {
  const v = Math.round((cents || 0) / 100);
  return `${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;
}

// Подписи статусов записи (используются в карточке и кнопках).
export const STATUS_TEXT = {
  pending: '⏳ Ждёт подтверждения',
  confirmed: '✅ Подтверждена',
  completed: '✔️ Завершена',
  canceled: '❌ Отменена',
  no_show: '🚫 Неявка',
};

// Подписи категорий клиента (spec §9).
export const CATEGORY_LABEL = {
  new: '🆕 Новый',
  regular: '⭐ Постоянный',
  lost: '😴 Потеряшка',
  blacklist: '⛔ Чёрный список',
  archived: '📦 В архиве',
};

// Средняя оценка отзывов клиента (для карточки).
export function reviewsSummaryInline(reviewRows) {
  if (!reviewRows || !reviewRows.length) return null;
  const avg = reviewRows.reduce((s, r) => s + r.rating, 0) / reviewRows.length;
  return { avg: avg.toFixed(1), count: reviewRows.length };
}

export const T = {
  ERR: '⚠️ Что-то пошло не так. Попробуйте ещё раз.',
  WIP: '🚧 Раздел в разработке — появится в следующем обновлении.',

  DENIED: (id) =>
    `⛔ Бот доступен по приглашению.\n\nВаш Telegram ID: <code>${id}</code>\nПередайте его администратору — после внесения в список доступа напишите /start.`,

  CLIENT_NO_PAYLOAD:
    '👋 Это бот записи к мастерам. Записаться можно по ссылке, которую даёт мастер — обычно вида t.me/…?start=book_XXXX.',

  // Онбординг мастера
  ONB_ASK_NAME: (defName) =>
    `👋 Привет! Настроим ваш кабинет — займёт минуту.\n\n1/2 · Как вас будут видеть клиенты при записи?\n\nСейчас: <b>${esc(defName)}</b> — можно оставить, отправив «-», или введите своё имя.`,
  ONB_ASK_TZ:
    `2/2 · Часовой пояс для расписания:\nвыберите кнопкой или отправьте название зоны IANA (например, Europe/Kaliningrad).`,
  ONB_BAD_TZ: '🤔 Не знаю такую зону. Выберите кнопкой или отправьте зону IANA, например Asia/Novosibirsk.',
  ONB_DONE: (name, tz, link) =>
    `✅ Кабинет готов!\n\n👤 <b>${esc(name)}</b>\n🕑 ${esc(tz)}\n\n🔗 Ваша ссылка записи:\n${link}\n\nДальше: добавьте услуги и настройте рабочие часы в меню. Напоминания и запись клиентов включатся по мере настройки.`,

  MENU_TITLE: (name) =>
    `🏠 <b>Главное меню</b>\nМастер: <b>${esc(name)}</b>`,
  MENU_TITLE_CLIENT: (name) =>
    `📖 Кабинет мастера <b>${esc(name)}</b>`,
  LINK: (name, code, link) =>
    `🔗 <b>Ваша ссылка записи</b>\n\n<code>${link}</code>\n\nКод мастера: <code>${esc(code)}</code>\nОтправьте ссылку клиентам — они запишутся прямо в этом боте.\n\nСгенерировать новый код: ⚙️ Настройки (старая ссылка перестанет работать).`,

  // Клиентская визитка (Фаза 0 — без записи)
  CLIENT_CARD: (m) =>
    `💅 <b>${esc(m.name)}</b>\n${m.publicBlurb ? esc(m.publicBlurb) + '\n' : ''}\n🕐 Часовой пояс мастера: ${esc(m.timezone)}\n\n Онлайн-запись откроется после настройки мастером каталога услуг.`,
  MASTER_NOT_FOUND: '🤷 Мастер не найден — проверьте ссылку.',

  // ---------- Фаза 1: услуги ----------
  SVC_LIST_EMPTY:
    '💼 <b>Услуги</b>\n\nПока пусто. Добавьте услугу — без неё записать клиента нельзя.',
  SVC_LIST: (rows) =>
    `💼 <b>Услуги</b>\n\n${rows.join('\n')}\n\nВыберите услугу, чтобы изменить.`,
  SVC_ASK_NAME: '1/4 · Название услуги?\n\nНапример: «Стрижка женская».',
  SVC_ASK_DURATION:
    '2/4 · Сколько длится? Выберите кнопкой или отправьте число минут (от 5 до 600).',
  SVC_ASK_PRICE: '3/4 · Цена в рублях?\n\nМожно с копейками: 1500 или 1500,50.',
  SVC_ASK_PRICE_BAD: '🤔 Не похоже на цену. Отправьте число, например 1500 или 1500,50.',
  SVC_ASK_FROM: (name, money, dur) =>
    `Услуга «${esc(name)}» · ${dur} мин · ${esc(money)}\n\nЦена указывается как «от» (окончательная зависит от работы)?`,
  SVC_ASK_DESC: 'Добавьте короткое описание (не обязательно). Отправьте «-», чтобы пропустить.',
  SVC_ASK_POPULAR: 'Показывать эту услугу в «популярных» на странице записи?',
  SVC_ASK_DURATION_BAD: '🤔 Нужно целое число минут от 5 до 600.',
  SVC_SAVED: (name) => `✅ Услуга «${esc(name)}» сохранена.`,
  SVC_DELETED: '🗑 Услуга удалена.',
  SVC_DELETE_BLOCKED:
    '⛔ Нельзя удалить: на эту услугу есть будущие записи. Сначала перенесите или отмените их.',
  SVC_CARD: (s, money) =>
    `💼 <b>${esc(s.name)}</b>\n\n🕑 ${s.durationMin} мин\n💰 ${s.priceFrom ? 'от ' : ''}${esc(money)}` +
    `${s.description ? '\n\n' + esc(s.description) : ''}\n\n${s.active ? '🟢 Активна' : '⚪️ Скрыта'}` +
    `${s.isPopular ? '\n⭐️ Популярная' : ''}`,
  SVC_EDIT_NAME: 'Отправьте новое название.',
  SVC_EDIT_DURATION: 'Отправьте новую длительность в минутах (5–600).',
  SVC_EDIT_PRICE: 'Отправьте новую цену в рублях (1500 или 1500,50).',
  SVC_EDIT_DESC: 'Отправьте новое описание. «-» — удалить описание.',

  // ---------- Фаза 1: расписание ----------
  SCH_TITLE: (summary) =>
    `🗓 <b>Рабочие часы</b>\n\n${esc(summary)}\n\nНажмите день, чтобы включить/выключить или изменить время.`,
  SCH_ASK_START: (day) => `⏰ Начало рабочего дня в ${esc(day)}?\n\nФормат: 10:00`,
  SCH_ASK_END: (day, start) => `⏰ Конец рабочего дня в ${esc(day)} (начало в ${start})?\n\nФормат: 19:00`,
  SCH_BAD_TIME: '🤔 Не понял время. Отправьте в формате 10:00 (часы 0–23, минуты 0–59).',
  SCH_BAD_RANGE: '⛔ Конец должен быть позже начала. Попробуйте ещё раз.',
  SCH_SAVED_DAY: (day, start, end) => `✅ ${esc(day)}: ${start}–${end}`,
  SCH_DAY_OFF: (day) => `✅ ${esc(day)} — выходной.`,
  SCH_TIMEOFF_EMPTY: '📌 На ближайшие 14 дней перерывов и выходных нет.',
  SCH_TIMEOFF_TITLE: (lines) =>
    `📌 <b>Перерывы и выходные</b> (14 дней)\n\n${lines.join('\n')}\n\nНажмите, чтобы удалить.`,
  SCH_TOFF_KIND:
    'Что добавить на эту дату?\n\n☕ перерыв — часть дня\n🏖 выходной — весь день\n👤 личное дело — часть дня с заметкой',
  SCH_TOFF_ASK_START: '⏰ Во сколько начинается? Формат: 13:00',
  SCH_TOFF_ASK_END: (start) => `⏰ Во сколько заканчивается? Начало в ${start}, формат: 14:00`,
  SCH_TOFF_ASK_NOTE: 'Короткая заметка (например, «обед»). «-» — без заметки.',
  SCH_TOFF_ADDED: (label) => `✅ Добавлено: ${esc(label)}`,
  SCH_TOFF_DELETED: '🗑 Удалено.',
  SCH_TPL_TITLE: (lines) =>
    `📐 <b>Шаблоны расписания</b>\n\n${lines.join('\n')}\n\nПрименение шаблона перезапишет рабочие часы всех дней недели.`,
  SCH_TPL_EMPTY: '📐 Шаблонов пока нет. Создайте из текущих часов.',
  SCH_TPL_ASK_NAME: 'Название шаблона? Например: «Лето, вторник–суббота».',
  SCH_TPL_SAVED: (name) => `✅ Шаблон «${esc(name)}» сохранён.`,
  SCH_TPL_APPLIED: (name) => `✅ Шаблон «${esc(name)}» применён ко всем дням недели.`,
  SCH_SLOTS_TITLE: (date, priceHint) =>
    `🕳 <b>Свободные окна</b> на ${esc(date)}\n\n${priceHint}`,

  // ---------- Фаза 1: записи ----------
  AP_TODAY_EMPTY: (date) => `📅 <b>${esc(date)}</b>\n\nЗаписей нет.`,
  AP_DAY_TITLE: (date, lines, freeCount) =>
    `📅 <b>${esc(date)}</b>\n\n${lines.join('\n')}\n\n🕳 Свободных окон: ${freeCount}`,
  AP_WEEK_TITLE: (lines) =>
    `🗓 <b>Неделя</b>\n\n${lines.join('\n')}\n\nНажмите день, чтобы открыть его.`,
  AP_CARD: (ap, tz, money) =>
    `${ap.status === 'pending' ? '⏳' : ap.status === 'canceled' ? '❌' : '✅'} ` +
    `<b>${esc(fmtDate(localDate(tz, ap.startsAt)))}, ${minToHHMM(localMin(tz, ap.startsAt))}</b>\n` +
    `👤 ${esc(ap.client?.displayName || 'Клиент')}\n` +
    `💼 ${esc(ap.service?.name || 'Без услуги')} (${Math.round((ap.endsAt - ap.startsAt) / 60)} мин)\n` +
    `💰 ${esc(money)}\n` +
    `${STATUS_TEXT[ap.status] || ''}${ap.prepaid ? '\n💳 Предоплата получена' : ''}` +
    `${ap.note ? '\n📝 ' + esc(ap.note) : ''}`,
  AP_STATUS_SET: (label) => `✅ Статус: ${esc(label)}`,
  AP_PREPAID_ON: '💳 Предоплата отмечена.',
  AP_PREPAID_OFF: '💳 Отметка предоплаты снята.',
  AP_DELETED: '🗑 Запись удалена.',
  AP_CONFLICT: '⛔ Это время пересекается с другой записью. Выберите другое.',
  AP_ASK_CLIENT:
    '👤 Кому запись?\n\nОтправьте имя для поиска или выберите клиента из списка.',
  AP_NEW_CLIENT_NAME: 'Новый клиент. Как его зовут?',
  AP_ASK_CLIENT_PHONE:
    'Телефон клиента? Отправьте номер или «-», чтобы пропустить.\n\nБез Telegram клиенту нельзя написать через бота — только скопировать текст.',
  AP_ASK_SERVICE: '💼 Какую услугу выполняем?',
  AP_ASK_DATE: '📆 На какую дату?',
  AP_ASK_TIME: '🕐 Выберите свободное время или отправьте своё в формате 14:30.',
  AP_BAD_TIME: '🤔 Не понял время. Отправьте в формате 14:30.',
  AP_NOWORK: '⛔ В этот день нет рабочих часов. Настройте расписание или выберите другой день.',
  AP_NO_SLOTS: '⛔ На эту дату нет свободных окон. Выберите другой день.',
  AP_ASK_PRICE: (service, defMoney) =>
    `💰 Цена для этой записи?\n\nУслуга «${esc(service)}»: ${esc(defMoney)}. Отправьте свою сумму или «-», чтобы оставить.`,
  AP_CREATED: (ap, tz, money) =>
    `✅ Запись создана\n\n📅 ${esc(fmtDate(localDate(tz, ap.startsAt)))}, ${minToHHMM(localMin(tz, ap.startsAt))}\n` +
    `👤 ${esc(ap.clientName || 'Клиент')}\n💼 ${esc(ap.serviceName || 'Без услуги')}\n💰 ${esc(money)}`,
  AP_ASK_MOVE_DATE: '📆 На какую дату перенести?',
  AP_ASK_MOVE_TIME: '🕐 Новое время (свободные окна выше) или своё в формате 14:30.',
  AP_MOVED: '✅ Запись перенесена.',
  AP_ASK_NOTE: '📝 Заметка к записи. «-» — удалить заметку.',

  // ---------- общее ----------
  BACK_TO_MENU: '🏠 Меню',
  BACK: '⬅️ Назад',
  BTN_ADD: '➕ Добавить',

  // ---------- Фаза 2: CRM ----------
  CLI_EMPTY: '👥 <b>Клиенты</b>\n\nПока никого. Клиенты появятся автоматически при первой записи, либо добавьте вручную.',
  CLI_LIST: (filterLabel, total, page, pages, lines) =>
    `👥 <b>Клиенты</b> · ${esc(filterLabel)}\n${total} чел. · стр. ${page + 1}/${pages}\n\n${lines.join('\n')}`,
  CLI_SEARCH_PROMPT: '🔍 Введите имя, телефон или username для поиска. «-» — сбросить поиск.',
  CLI_SEARCH_EMPTY: '🔍 Ничего не найдено. Попробуйте другое имя или телефон.',
  CLI_SEARCH_DONE: (q) => `🔍 Поиск: «${esc(q)}»`,
  CLI_CARD: (d, money) => {
    const lines = [
      `👤 <b>${esc(d.client.displayName)}</b>`,
      `🏷 ${CATEGORY_LABEL[d.category] || d.category}`,
    ];
    if (d.client.phone) lines.push(`📞 ${esc(d.client.phone)}`);
    if (d.client.username) lines.push(`💬 @${esc(d.client.username)}`);
    if (d.client.birthday) lines.push(`🎂 ${esc(d.client.birthday)}`);
    lines.push('');
    lines.push(`📊 Визитов: <b>${d.stats.visits}</b> · всего на ${esc(money(d.stats.totalSpent))}`);
    if (d.stats.lastVisitDate) lines.push(`🕐 Последний визит: ${esc(fmtDate(d.stats.lastVisitDate))}`);
    else lines.push('🕐 Визитов ещё не было');
    if (d.stats.upcoming) lines.push(`📅 Предстоящих записей: ${d.stats.upcoming}`);
    if (d.stats.noShows) lines.push(`🚫 Неявок: ${d.stats.noShows}`);
    if (d.groups.length) lines.push(`📁 Группы: ${d.groups.map((g) => esc(g.name)).join(', ')}`);
    const rs = reviewsSummaryInline(d.reviews);
    if (rs) lines.push(`⭐ Отзывы: ${rs.avg} (${rs.count})`);
    if (d.client.notes) lines.push(`\n📝 ${esc(d.client.notes)}`);
    if (d.history.length) {
      lines.push('\n<b>История</b>');
      for (const h of d.history) {
        const mark = h.status === 'completed' ? '✔️' : h.status === 'canceled' ? '❌' : h.status === 'no_show' ? '🚫' : '⏳';
        lines.push(`${mark} ${esc(fmtDate(h.dateStr))} · ${esc(h.serviceName || 'услуга')} · ${esc(money(h.priceCents))}`);
      }
    }
    return lines.join('\n');
  },
  CLI_CARD_NO_TG:
    '\n\n💡 Клиент не запускал бота — напоминания ему придётся отправлять вручную (текст можно скопировать).',
  CLI_EDIT_NAME: 'Отправьте новое имя клиента.',
  CLI_EDIT_PHONE: 'Отправьте телефон или «-», чтобы удалить.',
  CLI_EDIT_BIRTHDAY: 'День рождения в формате ДД.ММ или ММ-ДД. «-» — удалить.',
  CLI_EDIT_BIRTHDAY_BAD: '🤔 Нужен формат ДД.ММ, например 14.03.',
  CLI_EDIT_NOTES: 'Заметка о клиенте. «-» — удалить.',
  CLI_SAVED: '✅ Сохранено.',
  CLI_BL_ON: '⛔ Клиент в чёрном списке: он не сможет записаться, слоты ему не показываются.',
  CLI_BL_OFF: '✅ Клиент убран из чёрного списка.',
  CLI_ARCH_ON: '📦 Клиент в архиве — скрыт из основного списка и рассылок.',
  CLI_ARCH_OFF: '📤 Клиент возвращён из архива.',
  CLI_DEL_CONFIRM: (name) =>
    `🗑 Удалить клиента «${esc(name)}» и всю его историю? Действие необратимо.`,
  CLI_DELETED: '🗑 Клиент удалён.',
  CLI_DEL_BLOCKED: '⛔ Нельзя удалить: у клиента есть предстоящие записи. Сначала отмените их.',
  CLI_ASK_NAME: 'Как зовут клиента?',
  CLI_ASK_PHONE: 'Телефон? «-» — пропустить.',
  CLI_ASK_BIRTHDAY: 'День рождения (ДД.ММ)? «-» — пропустить.',
  CLI_CREATED: (name) => `✅ Клиент «${esc(name)}» добавлен.`,

  // Группы
  GRP_TITLE: (lines) => `📁 <b>Группы клиентов</b>\n\n${lines.join('\n')}`,
  GRP_EMPTY: '📁 Групп пока нет. Создайте первую — например «VIP» или «Только по будням».',
  GRP_ASK_NAME: 'Название новой группы?',
  GRP_CREATED: (name) => `✅ Группа «${esc(name)}» создана.`,
  GRP_DELETED: '🗑 Группа удалена (клиенты остались).',
  GRP_MEMBERS: (name, lines) =>
    `📁 <b>${esc(name)}</b>\n\n${lines.length ? lines.join('\n') : 'Пока никого.'}\n\nНажмите клиента, чтобы добавить/убрать.`,
  GRP_DEL_CONFIRM: (name) => `🗑 Удалить группу «${esc(name)}»? Клиенты останутся, но пропадут из группы.`,

  // Фильтры
  CLI_FILTERS: 'Выберите фильтр:',

  // ---------- Фаза 3: онлайн-запись (клиент) ----------
  BK_CARD: (m, popular) => {
    const lines = [`💅 <b>${esc(m.name)}</b>`];
    if (m.publicBlurb) lines.push(esc(m.publicBlurb));
    lines.push(`🕐 Время мастера: ${esc(m.timezone)}`);
    if (popular.length) {
      lines.push('\n<b>Популярное</b>');
      for (const s of popular) {
        lines.push(`• ${esc(s.name)} — ${s.durationMin} мин${s.priceCents ? ' · ' + (s.priceFrom ? 'от ' : '') + esc(rub(s.priceCents)) : ''}`);
      }
    }
    return lines.join('\n');
  },
  BK_CARD_NO_SERVICES: (name) =>
    `💅 <b>${esc(name)}</b>\n\nМастер пока не открыл онлайн-запись. Загляните позже.`,
  BK_ASK_SERVICE: '💼 Выберите услугу:',
  BK_NO_SERVICES_FOR_BOOK: '😔 Сейчас нет доступных услуг для записи.',
  BK_ASK_DATE: '📆 Выберите день (показаны только дни со свободными окнами):',
  BK_NO_DATES: '😔 На ближайшие дни свободных окон нет. Попробуйте позже или свяжитесь с мастером.',
  BK_ASK_TIME: (svc, date) =>
    `🕐 Свободное время\n\n💼 ${esc(svc.name)} · ${svc.durationMin} мин\n📅 ${esc(fmtDate(date))}\n\nВыберите время:`,
  BK_NO_SLOTS: '⛔ Это время уже занято. Выберите другое.',
  BK_CONFIRM: (svc, date, time, money) =>
    `Проверьте заявку:\n\n💼 ${esc(svc.name)} · ${svc.durationMin} мин\n📅 ${esc(fmtDate(date))} в ${time}\n💰 ${esc(money)}\n\nОтправить заявку мастеру?`,
  BK_SENT_PENDING: (svc, date, time) =>
    `✅ Заявка отправлена!\n\n💼 ${esc(svc.name)}\n📅 ${esc(fmtDate(date))} в ${time}\n\nМастер подтвердит запись — пришлю уведомление.`,
  BK_SENT_CONFIRMED: (svc, date, time) =>
    `✅ <b>Вы записаны!</b>\n\n💼 ${esc(svc.name)}\n📅 ${esc(fmtDate(date))} в ${time}\n\nЕсли планы изменятся, отмените запись в «Мои записи».`,
  BK_BLOCKED_BLACKLIST: '😔 Запись к этому мастеру сейчас недоступна. Свяжитесь с мастером напрямую.',
  BK_BLOCKED_EXISTING:
    '🔒 Запись открыта только для постоянных клиентов мастера.\nСвяжитесь с мастером, чтобы он добавил вас.',

  // Мои записи
  MY_TITLE: '📅 <b>Мои записи</b>',
  MY_EMPTY: '📅 <b>Мои записи</b>\n\nПока нет записей. Нажмите «Записаться», чтобы выбрать время.',
  MY_UPCOMING: (lines) => `📅 <b>Мои записи</b>\n\n${lines.join('\n')}`,
  MY_PAST_HEAD: '\n\n<b>Прошедшие</b>',
  MY_AP: (a, svcName, time) =>
    `${a.status === 'pending' ? '⏳ ждёт подтверждения' : '✅ подтверждена'}\n` +
    `${esc(fmtDate(a.dateStr))} в ${time}\n` +
    `${esc(svcName || 'услуга')}`,
  MY_CANCEL_CONFIRM: (svc, date, time) =>
    `Отменить запись?\n\n💼 ${esc(svc)}\n📅 ${esc(fmtDate(date))} в ${time}`,
  MY_CANCELED: '❌ Запись отменена. Мастер получил уведомление.',
  MY_CANCEL_TOO_LATE: '⛔ Эту запись уже нельзя отменить — свяжитесь с мастером.',
  MY_OFFER_WAITLIST: 'Хотите, сообщу, если это время снова освободится?',
  MY_WAITLIST_ADDED: '🔔 Хорошо, сообщу, если окно освободится.',
  MY_WAITLIST_ALREADY: '🔔 Вы уже в листе ожидания у этого мастера.',

  // Отзывы
  RV_TITLE: '⭐ <b>Оцените визит</b>',
  RV_ASK_AP: 'Выберите визит, который хотите оценить:',
  RV_ASK_STARS: (svc, date) =>
    `⭐ Как прошёл визит?\n\n💼 ${esc(svc)}\n📅 ${esc(fmtDate(date))}\n\nПоставьте оценку:`,
  RV_ASK_TEXT: (stars) => `Спасибо за ${stars}⭐! Хотите добавить пару слов? Отправьте текст или «-», чтобы пропустить.`,
  RV_THANKS: '🙏 Спасибо за отзыв!',
  RV_ALREADY: 'Вы уже оценили этот визит.',
  RV_NONE: 'Пока нет завершённых визитов, которые можно оценить.',

  // Уведомления мастеру
  NOTIF_NEW_REQUEST: (name, svc, date, time, price, hasTg) =>
    `🔔 <b>Новая заявка на запись</b>\n\n👤 ${esc(name)}${hasTg ? '' : ' (без Telegram)'}\n` +
    `💼 ${esc(svc)}\n📅 ${esc(fmtDate(date))} в ${time}\n💰 ${esc(price)}`,
  NOTIF_NEW_BOOKED: (name, svc, date, time) =>
    `📥 <b>Клиент записался</b> (авто-подтверждение)\n\n👤 ${esc(name)}\n💼 ${esc(svc)}\n📅 ${esc(fmtDate(date))} в ${time}`,
  NOTIF_ACCEPTED: '✅ Заявка принята.',
  NOTIF_REJECTED: '❌ Заявка отклонена.',
  NOTIF_CLIENT_CANCELED: (name, svc, date, time) =>
    `❌ <b>Клиент отменил запись</b>\n\n👤 ${esc(name)}\n💼 ${esc(svc)}\n📅 ${esc(fmtDate(date))} в ${time}\n\nОкно снова свободно.`,
  NOTIF_CLIENT_GONE: '⚠️ Не удалось уведомить клиента — он не запускал бота.',
  CLIENT_AP_CONFIRMED: (svc, date, time) =>
    `✅ <b>Запись подтверждена</b>\n\n💼 ${esc(svc)}\n📅 ${esc(fmtDate(date))} в ${time}\n\nДо встречи!`,
  CLIENT_AP_REJECTED: (svc, date, time) =>
    `😔 Мастер не сможет принять вас ${esc(fmtDate(date))} в ${time} (${esc(svc)}).\n\nВыберите другое время — я на связи.`,
  CLIENT_RATE_PROMPT: '⭐ Как прошёл визит? Поставьте оценку мастеру.',
  WAITLIST_OFFER: (date) =>
    `🔔 Освободилось время на ${esc(fmtDate(date))} у мастера, к которому вы хотели попасть.\n\nУспейте записаться!`,

  // ---------- Фаза 4: настройки ----------
  SET_TITLE: (s) =>
    `⚙️ <b>Настройки</b>\n\n` +
    `${s.auto_confirm ? '✅' : '⬜️'} Авто-подтверждение заявок\n` +
    `${s.only_existing ? '✅' : '⬜️'} Запись только для своих клиентов\n` +
    `${s.birthday_greet ? '✅' : '⬜️'} Поздравления с днём рождения\n` +
    `${s.auto_income ? '✅' : '⬜️'} Авто-доход из завершённых записей\n` +
    `🕐 Напоминания: ${s.remind_offsets_min.map(fmtOffset).join(', ')}\n` +
    `📅 Запись на ${s.book_days_ahead} дней вперёд`,
  SET_TOGGLE: (key) => `set:tg:${key}`,
  SET_PAGE: 'set:page:-',
  SET_REGENERATE: 'set:regen:-',
  SET_REGENERATED: (code, link) =>
    `🔗 Новая ссылка создана:\n\n<code>${esc(link)}</code>\n\nСтарая перестанет работать. Код мастера: <code>${esc(code)}</code>`,
  SET_PAGE_TITLE: 'Страница записи',
  SET_ASK_BLURB: 'Короткое описание для страницы записи (1–2 предложения). «-» — удалить.',
  SET_ASK_NAME: 'Отображаемое имя на странице записи?',
  SET_SAVED: '✅ Сохранено.',

  // ---------- Фаза 4: рассылки ----------
  MAIL_TITLE: '📣 <b>Рассылка</b>',
  MAIL_EMPTY: '📣 Пока нет рассылок. Создайте первую.',
  MAIL_ASK_AUDIENCE: 'Кому отправить?',
  MAIL_ASK_TEXT: (audience) =>
    `Текст рассылки для ${esc(audience)}:\n\nПоддерживается подстановка {имя} — будет заменено на имя клиента.`,
  MAIL_PREVIEW: (text, audience, count) =>
    `📣 <b>Предпросмотр</b>\n\n${esc(text)}\n\nАудитория: ${esc(audience)} · ${count} чел.\n\nОтправить?`,
  MAIL_STARTED: '🚀 Рассылка запущена. Отправка идёт пачками — отчёт придёт по завершении.',
  MAIL_DONE: (sent, failed, noTg) =>
    `📣 Рассылка завершена\n\n✅ Отправлено: ${sent}\n❌ Недоставлено: ${failed}` +
    (noTg ? `\n\n💡 ${noTg} клиент(ов) не запускали бота — напоминание им нужно отправить вручную (текст есть в карточке клиента).` : ''),
  MAIL_SENDING: (sent, total) => `📣 Отправка… ${sent} из ${total}`,

  // ---------- Фаза 4: лист ожидания мастера ----------
  WL_TITLE: (lines) =>
    `🔔 <b>Лист ожидания</b>\n\n${lines.join('\n')}`,
  WL_EMPTY: '🔔 Лист ожидания пуст.',
  WL_DELETED: '🗑 Заявка удалена из листа ожидания.',
};
