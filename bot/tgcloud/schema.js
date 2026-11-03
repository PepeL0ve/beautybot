// schema.js — все таблицы. Внешних ключей нет (платформа их отключает) —
// целостность и каскадные удаления обеспечивает код в lib/svc.
// Время: unix-секунды (epoch) для абсолютных моментов, "YYYY-MM-DD" и минуты
// от полуночи — для локального календаря мастера. Деньги — целые копейки.

import {
  table, integer, text, boolean, json, index, uniqueIndex, check, sql,
} from 'sdk/db';

const created = () =>
  integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`);

// Белый список: мастер может зарегистрироваться, только если его tg_user_id здесь.
export const accessList = table('access_list', {
  tgUserId: integer('tg_user_id').primaryKey(),
  note:     text('note'),
  addedAt:  created(),
});

export const masters = table('masters', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  tgUserId:         integer('tg_user_id').notNull().unique(),
  tgChatId:         integer('tg_chat_id').notNull(),
  name:             text('name').notNull(),           // отображаемое имя
  publicBlurb:      text('public_blurb'),             // описание на визитке
  publicPhotoFileId: text('public_photo_file_id'),    // фото визитки
  masterCode:       text('master_code').notNull().unique(), // слаг для deep link
  timezone:         text('timezone').notNull().default('Europe/Moscow'),
  settings:         json('settings').notNull(),       // см. spec §14
  created:          created(),
});

export const services = table('services', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  masterId:    integer('master_id').notNull(),
  name:        text('name').notNull(),
  durationMin: integer('duration_min').notNull(),
  priceCents:  integer('price_cents').notNull().default(0),
  priceFrom:   boolean('price_from').default(false), // «цена от»
  description: text('description'),
  isPopular:   boolean('is_popular').default(false),
  sort:        integer('sort').notNull().default(0),
  active:      boolean('active').default(true),
}, (t) => ({
  byMaster: index('idx_services_master').on(t.masterId, t.sort),
}));

// Рабочие часы по дням недели: 0=Пн … 6=Вс, один интервал на день.
export const workHours = table('work_hours', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  masterId: integer('master_id').notNull(),
  weekday:  integer('weekday').notNull(), // 0..6
  startMin: integer('start_min').notNull(),
  endMin:   integer('end_min').notNull(),
  enabled:  boolean('enabled').default(true),
}, (t) => ({
  perDay: uniqueIndex('uq_work_hours_master_day').on(t.masterId, t.weekday),
  range:  check('ck_work_hours_range', sql`${t.startMin} < ${t.endMin}`),
}));

// Перерывы/выходные/личные дела на конкретную дату. startMin null = весь день.
export const timeOff = table('time_off', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  masterId: integer('master_id').notNull(),
  date:     text('date').notNull(), // YYYY-MM-DD, локальная дата мастера
  startMin: integer('start_min'),   // null = весь день
  endMin:   integer('end_min'),
  kind:     text('kind').notNull(), // break | dayoff | personal
  note:     text('note'),
}, (t) => ({
  byDate: index('idx_time_off_master_date').on(t.masterId, t.date),
}));

export const scheduleTemplates = table('schedule_templates', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  masterId: integer('master_id').notNull(),
  name:     text('name').notNull(),
  payload:  json('payload').notNull(), // [{weekday,startMin,endMin,enabled}]
  created:  created(),
});

export const clients = table('clients', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  masterId:   integer('master_id').notNull(),
  tgUserId:   integer('tg_user_id'), // null — добавлен вручную (недостижим ботом)
  tgChatId:   integer('tg_chat_id'),
  displayName: text('display_name').notNull(),
  phone:      text('phone'),
  username:   text('username'),
  birthday:   text('birthday'), // 'MM-DD'
  notes:      text('notes'),
  blacklisted: boolean('blacklisted').default(false),
  archived:   boolean('archived').default(false),
  unreachable: boolean('unreachable').default(false), // бот заблокирован (403)
  created:    created(),
}, (t) => ({
  byMaster: index('idx_clients_master').on(t.masterId),
  perTg: uniqueIndex('uq_clients_master_tg').on(t.masterId, t.tgUserId),
}));

// status: pending | confirmed | completed | canceled | no_show
export const appointments = table('appointments', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  masterId:  integer('master_id').notNull(),
  clientId:  integer('client_id').notNull(),
  serviceId: integer('service_id'),
  startsAt:  integer('starts_at').notNull(), // epoch sec
  endsAt:    integer('ends_at').notNull(),
  status:    text('status').notNull().default('pending'),
  priceCents: integer('price_cents').notNull().default(0),
  prepaid:   boolean('prepaid').default(false),
  note:      text('note'),
  source:    text('source').notNull().default('master'), // master | self
  canceledAt: integer('canceled_at', { mode: 'timestamp' }),
}, (t) => ({
  byMasterTime: index('idx_ap_master_time').on(t.masterId, t.startsAt),
  byClient:     index('idx_ap_client').on(t.clientId),
  byStatus:     index('idx_ap_master_status').on(t.masterId, t.status),
}));

export const waitingList = table('waiting_list', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  masterId:  integer('master_id').notNull(),
  clientId:  integer('client_id').notNull(),
  serviceId: integer('service_id'),
  dateFrom:  text('date_from').notNull(),
  dateTo:    text('date_to').notNull(),
  status:    text('status').notNull().default('active'), // active|notified|booked|expired
  created:   created(),
}, (t) => ({
  byStatus: index('idx_wait_master_status').on(t.masterId, t.status),
  perClient: index('idx_wait_client').on(t.clientId),
}));

export const reviews = table('reviews', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  masterId:      integer('master_id').notNull(),
  appointmentId: integer('appointment_id').notNull(),
  clientId:      integer('client_id').notNull(),
  rating:        integer('rating').notNull(), // 1..5
  text:          text('text'),
  created:       created(),
}, (t) => ({
  perAp: uniqueIndex('uq_reviews_appointment').on(t.appointmentId),
  byMaster: index('idx_reviews_master').on(t.masterId),
}));

export const clientGroups = table('client_groups', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  masterId: integer('master_id').notNull(),
  name:     text('name').notNull(),
});

export const clientGroupMembers = table('client_group_members', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  groupId:  integer('group_id').notNull(),
  clientId: integer('client_id').notNull(),
}, (t) => ({
  uniquePair: uniqueIndex('uq_group_member').on(t.groupId, t.clientId),
}));

export const mailings = table('mailings', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  masterId:   integer('master_id').notNull(),
  text:       text('text').notNull(),
  targetKind: text('target_kind').notNull(), // all | group | category
  targetRef:  text('target_ref'),
  status:     text('status').notNull().default('draft'), // draft|sending|done
  sent:       integer('sent').notNull().default(0),
  failed:     integer('failed').notNull().default(0),
  cursor:     integer('cursor').notNull().default(0), // id клиента, на котором остановились
  created:    created(),
});

// kind: income | expense
export const financeEntries = table('finance_entries', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  masterId:     integer('master_id').notNull(),
  kind:         text('kind').notNull(),
  amountCents:  integer('amount_cents').notNull(),
  category:     text('category').notNull().default('Прочее'),
  entryDate:    text('entry_date').notNull(), // YYYY-MM-DD
  note:         text('note'),
  appointmentId: integer('appointment_id'),
}, (t) => ({
  byDate: index('idx_fin_master_date').on(t.masterId, t.entryDate),
  byAp:   index('idx_fin_appointment').on(t.appointmentId),
}));

// kind: ap_before | lost_client | birthday | waitlist_offer | pending_stale
export const reminders = table('reminders', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  masterId:      integer('master_id').notNull(),
  appointmentId: integer('appointment_id'),
  clientId:      integer('client_id'),
  kind:          text('kind').notNull(),
  sendAt:        integer('send_at').notNull(), // epoch sec
  sentAt:        integer('sent_at', { mode: 'timestamp' }),
  payload:       json('payload'),
}, (t) => ({
  due: index('idx_reminders_due').on(t.sentAt, t.sendAt),
  perAp: index('idx_reminders_ap').on(t.appointmentId, t.kind),
}));

// FSM-диалоги: одна строка на чат.
export const botStates = table('bot_states', {
  chatId:   integer('chat_id').primaryKey(),
  userId:   integer('user_id').notNull(),
  state:    text('state').notNull(),   // '' = нет диалога
  data:     json('data'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Журнал прогонов sweep (для отладки и защиты от повторов).
export const ticks = table('ticks', {
  id:     integer('id').primaryKey({ autoIncrement: true }),
  ranAt:  created(),
  note:   text('note'),
});
