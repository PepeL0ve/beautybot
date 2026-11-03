// lib/state.js — FSM-диалоги (таблица bot_states). Одна строка на чат.

import { db } from 'sdk';
import { eq } from 'sdk/db';
import { botStates } from '../schema.js';

export async function getState(chatId) {
  const row = await db.select().from(botStates).where(eq(botStates.chatId, chatId)).get();
  return row && row.state ? row : null;
}

export async function setState(chatId, userId, state, data = {}) {
  await db
    .insert(botStates)
    .values({ chatId, userId, state, data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: botStates.chatId,
      set: { userId, state, data, updatedAt: new Date() },
    })
    .run();
}

export async function clearState(chatId) {
  await db.delete(botStates).where(eq(botStates.chatId, chatId)).run();
}
