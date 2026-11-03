// lib/svc/sweep.js — единый прогон отложенных задач (spec §13).
// Вызывается /tick (cron каждые 5 мин) и лениво при обращении мастера.
// Фаза 0: каркас. Фаза 4 наполнит: ap_before, pending_stale, lost_client,
// birthday, waitlist_offer, продолжение рассылок.

export async function runSweep(nowSec) {
  const res = { reminders: 0, digests: 0, waitlist: 0, mailings: 0 };
  // TODO(Фаза 4): обработка due-напоминаний, дайджестов, листа ожидания,
  // продолжение недоотправленных рассылок (чанки по MAILING_CHUNK).
  return res;
}
