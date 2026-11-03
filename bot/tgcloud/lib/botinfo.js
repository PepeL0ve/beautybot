// lib/botinfo.js — кеш информации о боте (для сборки deep link).

import { api } from 'sdk';

let me = null;

export async function getMe() {
  if (!me) me = await api.getMe();
  return me;
}

export async function bookLink(masterCode) {
  const username = (await getMe()).username;
  return `https://t.me/${username}?start=book_${masterCode}`;
}
