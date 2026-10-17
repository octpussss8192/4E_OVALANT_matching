'use client';

import { useEffect, useRef } from 'react';

export function useWakeLock(enabled: boolean): void {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(console.error);
        wakeLockRef.current = null;
      }
      return;
    }

    if (!('wakeLock' in navigator)) {
      return;
    }

    let isCancelled = false;

    const requestLock = async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (!isCancelled) {
          wakeLockRef.current = sentinel;
          sentinel.addEventListener('release', () => {
            wakeLockRef.current = null;
          });
        } else {
          await sentinel.release();
        }
      } catch (err) {
        console.warn('Wake Lock request failed:', err);
      }
    };

    requestLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && enabled && !wakeLockRef.current) {
        requestLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isCancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(console.error);
        wakeLockRef.current = null;
      }
    };
  }, [enabled]);
}
