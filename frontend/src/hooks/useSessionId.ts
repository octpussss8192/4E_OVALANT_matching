'use client';

import { useState, useEffect } from 'react';

const SESSION_KEY = 'ovalant_session_id';

export function useSessionId(): string {
  const [sessionId, setSessionId] = useState<string>('');

  useEffect(() => {
    let current = localStorage.getItem(SESSION_KEY);
    if (!current) {
      current = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, current);
    }
    setSessionId(current);
  }, []);

  return sessionId;
}
