/**
 * Cookie and LocalStorage utility to securely store and restore
 * the participant's own entry history without exposing access to other groups.
 */

export interface MyEntrySummary {
  id: string;
  entry_number: number;
  team_name: string;
  createdAt: number;
}

const COOKIE_KEY = 'ow2026_my_entries';
const ACTIVE_ENTRY_KEY = 'ow2026_active_entry_id';

function setCookie(name: string, value: string, days = 365): void {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';');
  for (const c of cookies) {
    const [k, v] = c.trim().split('=');
    if (k === name && v) {
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return null;
}

export function getMyEntries(): MyEntrySummary[] {
  if (typeof window === 'undefined') return [];

  // 1. Try Cookie
  const rawCookie = getCookie(COOKIE_KEY);
  if (rawCookie) {
    try {
      const parsed = JSON.parse(rawCookie);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fallback
    }
  }

  // 2. Fallback to LocalStorage
  const rawStorage = localStorage.getItem(COOKIE_KEY);
  if (rawStorage) {
    try {
      const parsed = JSON.parse(rawStorage);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fallback
    }
  }

  // 3. Migration: if legacy single entry key exists
  const legacyId =
    localStorage.getItem('overter_watch_my_entry_id') ||
    localStorage.getItem('ovalant_my_entry_id');
  if (legacyId) {
    return [{ id: legacyId, entry_number: 0, team_name: '', createdAt: Date.now() }];
  }

  return [];
}

export function saveMyEntry(id: string, entry_number: number, team_name: string): void {
  if (typeof window === 'undefined') return;
  const list = getMyEntries().filter((e) => e.id !== id);
  const updated: MyEntrySummary[] = [
    { id, entry_number, team_name, createdAt: Date.now() },
    ...list,
  ];

  const jsonStr = JSON.stringify(updated);
  setCookie(COOKIE_KEY, jsonStr);
  localStorage.setItem(COOKIE_KEY, jsonStr);
  setActiveEntryId(id);
}

export function getActiveEntryId(): string | null {
  if (typeof window === 'undefined') return null;
  const activeId = getCookie(ACTIVE_ENTRY_KEY) || localStorage.getItem(ACTIVE_ENTRY_KEY);
  if (activeId) return activeId;

  const entries = getMyEntries();
  return entries.length > 0 ? entries[0].id : null;
}

export function setActiveEntryId(id: string): void {
  if (typeof window === 'undefined') return;
  setCookie(ACTIVE_ENTRY_KEY, id);
  localStorage.setItem(ACTIVE_ENTRY_KEY, id);
}

export function removeMyEntry(id: string): void {
  if (typeof window === 'undefined') return;
  const list = getMyEntries().filter((e) => e.id !== id);
  const jsonStr = JSON.stringify(list);
  setCookie(COOKIE_KEY, jsonStr);
  localStorage.setItem(COOKIE_KEY, jsonStr);

  const currentActive = getActiveEntryId();
  if (currentActive === id) {
    const nextActive = list.length > 0 ? list[0].id : '';
    setCookie(ACTIVE_ENTRY_KEY, nextActive);
    localStorage.setItem(ACTIVE_ENTRY_KEY, nextActive);
  }
}

