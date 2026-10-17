/**
 * API client to interact with FastAPI backend
 */

import {
  CreateEntryRequest,
  EntryResponse,
  QueueStatusResponse,
} from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

export async function createEntry(req: CreateEntryRequest): Promise<EntryResponse> {
  const res = await fetch(`${API_BASE}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: 'エントリーに失敗しました' }));
    throw new Error(errorData.detail || 'エントリーに失敗しました');
  }
  return res.json();
}

export async function getQueueStatus(): Promise<QueueStatusResponse> {
  const res = await fetch(`${API_BASE}/status`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error('ステータスの取得に失敗しました');
  }
  return res.json();
}

export async function getEntryStatus(entryId: string): Promise<EntryResponse> {
  const res = await fetch(`${API_BASE}/entries/${entryId}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error('エントリーステータスの取得に失敗しました');
  }
  return res.json();
}

export async function advanceMatch(matchId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/matches/${matchId}/advance`, {
    method: 'POST',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: '試合進行に失敗しました' }));
    throw new Error(errorData.detail || '試合進行に失敗しました');
  }
}

export async function skipEntry(entryId: string, reason: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/entries/${entryId}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: 'スキップに失敗しました' }));
    throw new Error(errorData.detail || 'スキップに失敗しました');
  }
}

export async function resetSystem(): Promise<void> {
  await fetch(`${API_BASE}/admin/reset`, { method: 'POST' });
}
