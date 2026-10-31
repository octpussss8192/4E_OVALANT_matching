'use client';

import { useState, useEffect } from 'react';

const SESSION_KEY = 'ovalant_session_id';

export function generateSafeUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // fallback below
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let current = localStorage.getItem(SESSION_KEY);
    if (!current) {
      current = generateSafeUUID();
      localStorage.setItem(SESSION_KEY, current);
    }
    return current;
  } catch {
    return generateSafeUUID();
  }
}

export function useSessionId(): string {
  const [sessionId, setSessionId] = useState<string>('');

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  return sessionId;
}
