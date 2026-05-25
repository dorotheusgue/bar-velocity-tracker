import type { SetSummary, StoredSession } from '../types';

const KEY = 'bvt.sessions.v1';

/**
 * localStorage-backed persistence. Sessions are grouped by calendar day
 * (the start of day for the set's `startedAt`). Keeping things flat and
 * synchronous here avoids the IndexedDB ceremony; we can swap in Dexie
 * later if size becomes an issue.
 */
export function loadSessions(): StoredSession[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as StoredSession[];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: StoredSession[]) {
  localStorage.setItem(KEY, JSON.stringify(sessions));
}

export function appendSet(summary: SetSummary): StoredSession[] {
  const sessions = loadSessions();
  const dayStart = startOfDay(summary.startedAt);
  let session = sessions.find((s) => s.date === dayStart);
  if (!session) {
    session = { id: crypto.randomUUID(), date: dayStart, sets: [] };
    sessions.push(session);
  }
  session.sets.push(summary);
  sessions.sort((a, b) => b.date - a.date);
  saveSessions(sessions);
  return sessions;
}

function startOfDay(timestamp: number): number {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
