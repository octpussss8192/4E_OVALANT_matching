/**
 * API client to interact with FastAPI backend
 * Compatible with Vercel Multi-Services (internal bindings & client rewrites)
 */

import {
  CreateEntryRequest,
  EntryResponse,
  QueueStatusResponse,
} from '@/types';

function getApiBase(): string {
  // ブラウザ（クライアントサイド）: Vercelのrewrite (/api/(.*) -> backend) 経由で相対パスを利用
  if (typeof window !== 'undefined') {
    return '/api';
  }
  // サーバーサイド (SSR / Route Handlers): Vercel Binding で注入される BACKEND_URL を利用
  if (process.env.BACKEND_URL) {
    return `${process.env.BACKEND_URL}/api`;
  }
  // ローカル開発環境のフォールバック
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
}

export async function createEntry(req: CreateEntryRequest): Promise<EntryResponse> {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/entries`, {
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
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/status`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error('ステータスの取得に失敗しました');
  }
  return res.json();
}

export async function getEntriesBySession(sessionId: string): Promise<EntryResponse[]> {
  const apiBase = getApiBase();
  try {
    const res = await fetch(`${apiBase}/entries/by-session/${encodeURIComponent(sessionId)}`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      return [];
    }
    return res.json();
  } catch {
    return [];
  }
}

export async function getEntryStatus(entryId: string): Promise<EntryResponse> {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/entries/${entryId}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error('エントリーステータスの取得に失敗しました');
  }
  return res.json();
}

export async function advanceMatch(matchId: string): Promise<void> {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/admin/matches/${matchId}/advance`, {
    method: 'POST',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: '試合進行に失敗しました' }));
    throw new Error(errorData.detail || '試合進行に失敗しました');
  }
}

export async function skipEntry(entryId: string, reason: string): Promise<void> {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/admin/entries/${entryId}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: 'スキップに失敗しました' }));
    throw new Error(errorData.detail || 'スキップに失敗しました');
  }
}

export async function restoreEntry(entryId: string): Promise<void> {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/admin/entries/${entryId}/restore`, {
    method: 'POST',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: '復帰に失敗しました' }));
    throw new Error(errorData.detail || '復帰に失敗しました');
  }
}

export async function resetSystem(): Promise<void> {
  const apiBase = getApiBase();
  await fetch(`${apiBase}/admin/reset`, { method: 'POST' });
}

export async function addSampleGroups(): Promise<QueueStatusResponse> {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/admin/sample-data`, {
    method: 'POST',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: 'テストデータ投入に失敗しました' }));
    throw new Error(errorData.detail || 'テストデータ投入に失敗しました');
  }
  return res.json();
}

