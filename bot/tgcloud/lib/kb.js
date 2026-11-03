// lib/kb.js — билдеры инлайн-клавиатур. callback_data: '<area>:<action>:<arg>'.

export const CB = {
  menu: (section) => `menu:go:${section}`,        // ap|sch|cli|mail|fin|set|link
  tzPick: (i) => `tz:pick:${i}`,
  tzSkip: () => `tz:skip:-`,
  cancel: (scope) => `fsm:cancel:${scope}`,       // прервать диалог
};

export function mainMenu() {
  return {
    inline_keyboard: [
      [
        { text: '📅 Записи', callback_data: CB.menu('ap') },
        { text: '🗓 Расписание', callback_data: CB.menu('sch') },
      ],
      [
        { text: '👥 Клиенты', callback_data: CB.menu('cli') },
        { text: '📣 Рассылка', callback_data: CB.menu('mail') },
      ],
      [{ text: '💰 Финансы', callback_data: CB.menu('fin') }],
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
