// lib/kb.js — билдеры инлайн-клавиатур. callback_data: '<area>:<action>:<arg>'.
// Лимит Telegram — 64 байта на callback_data, поэтому id короткие.

export const CB = {
  menu: (section) => `menu:go:${section}`,        // ap|sch|cli|mail|fin|set|link
  tzPick: (i) => `tz:pick:${i}`,
  cancel: (scope) => `fsm:cancel:${scope}`,
  back: (section) => `menu:go:${section}`,
};

export function mainMenu() {
  return {
    inline_keyboard: [
      [
        { text: '📅 Записи', callback_data: CB.menu('ap') },
        { text: '🗓 Расписание', callback_data: CB.menu('sch') },
      ],
      [
        { text: '💼 Услуги', callback_data: CB.menu('svc') },
        { text: '👥 Клиенты', callback_data: CB.menu('cli') },
      ],
      [
        { text: '📣 Рассылка', callback_data: CB.menu('mail') },
        { text: '💰 Финансы', callback_data: CB.menu('fin') },
      ],
      [
        { text: '⚙️ Настройки', callback_data: CB.menu('set') },
        { text: '🔗 Моя ссылка', callback_data: CB.menu('link') },
      ],
    ],
  };
}

// Ряд «назад/отмена» для FSM-диалогов.
export function fsmRow(scope) {
  return {
    inline_keyboard: [[{ text: '❌ Отмена', callback_data: CB.cancel(scope) }]],
  };
}

export const TZ_OPTIONS = [
  'Europe/Moscow',       // +3
  'Europe/Kaliningrad',  // +2
  'Europe/Samara',       // +4
  'Asia/Yekaterinburg',  // +5
  'Asia/Novosibirsk',    // +7
  'Asia/Vladivostok',    // +10
];

export function tzMenu() {
  return {
    inline_keyboard: [
      TZ_OPTIONS.map((tz, i) => ({
        text: tz.replace(/^(Europe|Asia)\//, ''),
        callback_data: CB.tzPick(i),
      })),
      [{ text: '❌ Отмена', callback_data: CB.cancel('onb') }],
    ],
  };
}

// ---- Фаза 1: услуги ----

export const svc = {
  add: () => 'svc:add:-',
  open: (id) => `svc:open:${id}`,
  editName: (id) => `svc:nm:${id}`,
  editDur: (id) => `svc:du:${id}`,
  editPrice: (id) => `svc:pr:${id}`,
  editDesc: (id) => `svc:ds:${id}`,
  toggleFrom: (id) => `svc:fr:${id}`,
  toggleActive: (id) => `svc:ac:${id}`,
  togglePopular: (id) => `svc:pp:${id}`,
  del: (id) => `svc:dl:${id}`,
  delConfirm: (id) => `svc:dy:${id}`,
  up: (id) => `svc:up:${id}`,
  down: (id) => `svc:dn:${id}`,
  durPick: (min) => `svc:dm:${min}`,
  fromYes: () => 'svc:fy:-',
  fromNo: () => 'svc:fn:-',
  popYes: () => 'svc:py:-',
  popNo: () => 'svc:pn:-',
};

export function servicesMenu(rows) {
  const kb = rows.map((s) => [
    { text: `${s.active ? '🟢' : '⚪️'} ${s.name} · ${s.durationMin} мин`, callback_data: svc.open(s.id) },
  ]);
  kb.push([{ text: '➕ Добавить услугу', callback_data: svc.add() }]);
  kb.push([{ text: '🏠 Меню', callback_data: CB.menu('menu') }]);
  return { inline_keyboard: kb };
}

export function serviceCardMenu(s) {
  return {
    inline_keyboard: [
      [
        { text: '✏️ Название', callback_data: svc.editName(s.id) },
        { text: '🕑 Время', callback_data: svc.editDur(s.id) },
      ],
      [
        { text: '💰 Цена', callback_data: svc.editPrice(s.id) },
        { text: '📝 Описание', callback_data: svc.editDesc(s.id) },
      ],
      [
        { text: s.priceFrom ? '💰 Цена «от» ✔' : '💰 Сделать «от»', callback_data: svc.toggleFrom(s.id) },
        { text: s.isPopular ? '⭐ Популярная ✔' : '⭐ В популярные', callback_data: svc.togglePopular(s.id) },
      ],
      [
        { text: s.active ? '⚪️ Скрыть' : '🟢 Показать', callback_data: svc.toggleActive(s.id) },
        { text: '🗑 Удалить', callback_data: svc.del(s.id) },
      ],
      [
        { text: '⬆️ Выше', callback_data: svc.up(s.id) },
        { text: '⬇️ Ниже', callback_data: svc.down(s.id) },
      ],
      [{ text: '⬅️ К услугам', callback_data: 'menu:go:svclic' }],
    ],
  };
}

export function durationMenu() {
  const opts = [30, 45, 60, 90, 120];
  return {
    inline_keyboard: [
      opts.slice(0, 3).map((m) => ({ text: `${m} мин`, callback_data: svc.durPick(m) })),
      opts.slice(3).map((m) => ({ text: `${m} мин`, callback_data: svc.durPick(m) })),
      [{ text: '✍️ Свой вариант', callback_data: CB.cancel('svc-dur') }],
    ],
  };
}

export function confirmMenu(area, id) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Да', callback_data: `${area}:dy:${id}` },
        { text: '❌ Нет', callback_data: `svc:open:${id}` },
      ],
    ],
  };
}

// ---- Фаза 1: расписание ----

export const WD_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export const sch = {
  day: (wd) => `sch:day:${wd}`,
  toggled: (wd) => `sch:tg:${wd}`,
  editStart: (wd) => `sch:st:${wd}`,
  editEnd: (wd) => `sch:en:${wd}`,
  toffList: () => 'sch:off:-',
  toffAdd: () => 'sch:oa:-',
  toffKind: (kind) => `sch:ok:${kind}`,
  toffDel: (id) => `sch:od:${id}`,
  tplList: () => 'sch:tp:-',
  tplSave: () => 'sch:ts:-',
  tplApply: (id) => `sch:ta:${id}`,
  slots: () => 'sch:sl:-',
};

export function scheduleMenu(hours) {
  const kb = [];
  for (let wd = 0; wd < 7; wd += 2) {
    const row = [];
    for (const d of [wd, wd + 1]) {
      if (d > 6) break;
      const h = hours.find((r) => r.weekday === d);
      const on = h && h.enabled;
      const time = on ? `${fmtShort(h.startMin)}-${fmtShort(h.endMin)}` : 'вых.';
      row.push({ text: `${on ? '🟢' : '⚪️'} ${WD_LABELS[d]} ${time}`, callback_data: sch.day(d) });
    }
    kb.push(row);
  }
  kb.push([
    { text: '📌 Перерывы/выходные', callback_data: sch.toffList() },
    { text: '📐 Шаблоны', callback_data: sch.tplList() },
  ]);
  kb.push([{ text: '🏠 Меню', callback_data: CB.menu('menu') }]);
  return { inline_keyboard: kb };
}

export function dayMenu(wd, enabled) {
  return {
    inline_keyboard: [
      [
        { text: '⏰ Начало', callback_data: sch.editStart(wd) },
        { text: '⏰ Конец', callback_data: sch.editEnd(wd) },
      ],
      [
        {
          text: enabled ? '⚪️ Сделать выходным' : '🟢 Сделать рабочим',
          callback_data: sch.toggled(wd),
        },
      ],
      [{ text: '⬅️ К расписанию', callback_data: CB.menu('sch') }],
    ],
  };
}

export function timeOffKindMenu() {
  return {
    inline_keyboard: [
      [{ text: '☕ Перерыв', callback_data: sch.toffKind('break') }],
      [{ text: '🏖 Выходной', callback_data: sch.toffKind('dayoff') }],
      [{ text: '👤 Личное дело', callback_data: sch.toffKind('personal') }],
      [{ text: '❌ Отмена', callback_data: CB.cancel('toff') }],
    ],
  };
}

export function timeOffMenu(rows) {
  const kb = rows.map((r) => [
    { text: `🗑 ${shortDate(r.date)} ${timeOffText(r)}`, callback_data: sch.toffDel(r.id) },
  ]);
  kb.push([{ text: '➕ Добавить', callback_data: sch.toffAdd() }]);
  kb.push([{ text: '⬅️ К расписанию', callback_data: CB.menu('sch') }]);
  return { inline_keyboard: kb };
}

export function templatesMenu(templates) {
  const kb = templates.map((t) => [
    { text: `📐 ${t.name}`, callback_data: sch.tplApply(t.id) },
  ]);
  kb.push([{ text: '💾 Сохранить текущие часы', callback_data: sch.tplSave() }]);
  kb.push([{ text: '⬅️ К расписанию', callback_data: CB.menu('sch') }]);
  return { inline_keyboard: kb };
}

function fmtShort(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function shortDate(date) {
  const [, m, d] = date.split('-');
  return `${Number(d)}.${m}`;
}

function timeOffText(r) {
  const kind = { break: '☕', dayoff: '🏖', personal: '👤' }[r.kind] || '';
  return r.startMin == null ? `${kind} весь день` : `${kind} ${fmtShort(r.startMin)}-${fmtShort(r.endMin)}`;
}

// ---- Фаза 1: записи ----

export const ap = {
  today: () => 'ap:day:0',
  day: (date) => `ap:day:${date}`,
  week: () => 'ap:wk:-',
  open: (id) => `ap:op:${id}`,
  add: () => 'ap:add:-',
  clientPick: (id) => `ap:cp:${id}`,
  clientNew: () => 'ap:cn:-',
  svcPick: (id) => `ap:sp:${id}`,
  datePick: (d) => `ap:dp:${d}`,
  slotPick: (min) => `ap:tp:${min}`,
  status: (id, st) => `ap:st:${id}:${st}`,
  prepaid: (id) => `ap:pp:${id}`,
  price: (id) => `ap:pc:${id}`,
  note: (id) => `ap:nt:${id}`,
  move: (id) => `ap:mv:${id}`,
  moveDate: (id, d) => `ap:md:${id}:${d}`,
  moveSlot: (id, min) => `ap:ms:${id}:${min}`,
  del: (id) => `ap:dl:${id}`,
  delConfirm: (id) => `ap:dy:${id}`,
};

export function appointmentsMenu(dateStr, rows) {
  const kb = rows.map((a) => [
    {
      text: `${statusIcon(a.status)} ${a.time} ${a.clientName}${a.serviceName ? ' · ' + a.serviceName : ''}`,
      callback_data: ap.open(a.id),
    },
  ]);
  kb.push([
    { text: '➕ Новая запись', callback_data: ap.add() },
    { text: '🗓 Неделя', callback_data: ap.week() },
  ]);
  kb.push([{ text: '🏠 Меню', callback_data: CB.menu('menu') }]);
  return { inline_keyboard: kb };
}

function statusIcon(s) {
  return { pending: '⏳', confirmed: '✅', completed: '✔️', canceled: '❌', no_show: '🚫' }[s] || '•';
}

export function appointmentCardMenu(a) {
  const kb = [
    [
      { text: '✅ Подтвердить', callback_data: ap.status(a.id, 'confirmed') },
      { text: '✔️ Завершить', callback_data: ap.status(a.id, 'completed') },
    ],
    [
      { text: '🚫 Неявка', callback_data: ap.status(a.id, 'no_show') },
      { text: '❌ Отменить', callback_data: ap.status(a.id, 'canceled') },
    ],
    [
      { text: a.prepaid ? '💳 Предоплата ✔' : '💳 Отметить предоплату', callback_data: ap.prepaid(a.id) },
    ],
    [
      { text: '➡️ Перенести', callback_data: ap.move(a.id) },
      { text: '💰 Цена', callback_data: ap.price(a.id) },
    ],
    [
      { text: '📝 Заметка', callback_data: ap.note(a.id) },
      { text: '🗑 Удалить', callback_data: ap.del(a.id) },
    ],
    [{ text: '⬅️ К записям', callback_data: ap.day(a.dateStr) }],
  ];
  return { inline_keyboard: kb };
}

export function clientsPickMenu(clients) {
  const kb = clients.map((c) => [
    { text: `👤 ${c.displayName}${c.phone ? ' · ' + c.phone : ''}`, callback_data: ap.clientPick(c.id) },
  ]);
  kb.push([{ text: '➕ Новый клиент', callback_data: ap.clientNew() }]);
  kb.push([{ text: '❌ Отмена', callback_data: CB.cancel('ap-new') }]);
  return { inline_keyboard: kb };
}

export function servicesPickMenu(services) {
  const kb = services.map((s) => [
    { text: `${s.name} · ${s.durationMin} мин`, callback_data: ap.svcPick(s.id) },
  ]);
  kb.push([{ text: '❌ Отмена', callback_data: CB.cancel('ap-new') }]);
  return { inline_keyboard: kb };
}

export function datesMenu(dates, fmt) {
  const kb = dates.map((d) => [{ text: fmt(d), callback_data: ap.datePick(d) }]);
  kb.push([{ text: '❌ Отмена', callback_data: CB.cancel('ap-new') }]);
  return { inline_keyboard: kb };
}

export function slotsMenu(slots, minToStr) {
  const kb = [];
  let row = [];
  for (const s of slots) {
    row.push({ text: minToStr(s.min), callback_data: ap.slotPick(s.min) });
    if (row.length === 4) {
      kb.push(row);
      row = [];
    }
  }
  if (row.length) kb.push(row);
  kb.push([{ text: '❌ Отмена', callback_data: CB.cancel('ap-new') }]);
  return { inline_keyboard: kb };
}

export function moveDatesMenu(apId, dates, fmt) {
  const kb = dates.map((d) => [{ text: fmt(d), callback_data: ap.moveDate(apId, d) }]);
  kb.push([{ text: '❌ Отмена', callback_data: ap.open(apId) }]);
  return { inline_keyboard: kb };
}

export function moveSlotsMenu(apId, slots, minToStr) {
  const kb = [];
  let row = [];
  for (const s of slots) {
    row.push({ text: minToStr(s.min), callback_data: ap.moveSlot(apId, s.min) });
    if (row.length === 4) {
      kb.push(row);
      row = [];
    }
  }
  if (row.length) kb.push(row);
  kb.push([{ text: '❌ Отмена', callback_data: ap.open(apId) }]);
  return { inline_keyboard: kb };
}

export function weekMenu(days) {
  const kb = [];
  for (let i = 0; i < days.length; i += 2) {
    const row = days.slice(i, i + 2).map((d) => ({
      text: d.label,
      callback_data: ap.day(d.date),
    }));
    kb.push(row);
  }
  kb.push([
    { text: '📅 Сегодня', callback_data: ap.today() },
    { text: '🏠 Меню', callback_data: CB.menu('menu') },
  ]);
  return { inline_keyboard: kb };
}