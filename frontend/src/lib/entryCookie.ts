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
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[]\/+^])/g, '\\$1') + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getMyEntries(): MyEntrySummary[] {
  if (typeof window === 'undefined') return [];

  // 1. Try LocalStorage first (reliable across tabs)
  const rawStorage = localStorage.getItem(COOKIE_KEY);
  if (rawStorage) {
    try {
      const parsed = JSON.parse(rawStorage);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fallback
    }
  }

  // 2. Fallback to Cookie
  const rawCookie = getCookie(COOKIE_KEY);
  if (rawCookie) {
    try {
      const parsed = JSON.parse(rawCookie);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
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

  // 1. Check URL search param (?entry_id=xxx)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const paramId = urlParams.get('entry_id');
    if (paramId) {
      setActiveEntryId(paramId);
      return paramId;
    }
  } catch {
    // ignore
  }

  // 2. Check Storage / Cookie
  const activeId = localStorage.getItem(ACTIVE_ENTRY_KEY) || getCookie(ACTIVE_ENTRY_KEY);
  if (activeId && activeId.trim() !== '') return activeId;

  // 3. Fallback to latest entry from summary list
  const entries = getMyEntries();
  return entries.length > 0 ? entries[0].id : null;
}

export function setActiveEntryId(id: string): void {
  if (typeof window === 'undefined') return;
  setCookie(ACTIVE_ENTRY_KEY, id);
  localStorage.setItem(ACTIVE_ENTRY_KEY, id);
}

export function syncEntriesFromRemote(
  remoteList: { id: string; entry_number: number; team_name: string }[]
): void {
  if (typeof window === 'undefined' || !remoteList || remoteList.length === 0) return;
  const current = getMyEntries();
  const currentIds = new Set(current.map((c) => c.id));
  const toAdd = remoteList
    .filter((r) => !currentIds.has(r.id))
    .map((r) => ({
      id: r.id,
      entry_number: r.entry_number,
      team_name: r.team_name,
      createdAt: Date.now(),
    }));

  if (toAdd.length > 0) {
    const merged = [...current, ...toAdd];
    const jsonStr = JSON.stringify(merged);
    setCookie(COOKIE_KEY, jsonStr);
    localStorage.setItem(COOKIE_KEY, jsonStr);
  }

  const active = getActiveEntryId();
  if (!active && remoteList.length > 0) {
    setActiveEntryId(remoteList[0].id);
  }
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
