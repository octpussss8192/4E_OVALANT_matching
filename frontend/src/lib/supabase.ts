import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wfvujsbcwelbkysrioxp.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_hz-XugfYZSwLEtXqjsTnAw_zY9xLlD_';


let supabaseInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (typeof window === 'undefined') {
    // サーバーサイドでの実行時は環境変数があれば生成
    if (supabaseUrl && supabaseAnonKey) {
      return createClient(supabaseUrl, supabaseAnonKey);
    }
    return null;
  }

  if (!supabaseInstance && supabaseUrl && supabaseAnonKey) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
  }

  return supabaseInstance;
}

/**
 * データベース変更（matches, entries）を検知してコールバックを発火するリアルタイムリスナー
 */
export function subscribeToMatchUpdates(onUpdate: () => void): () => void {
  const client = getSupabase();
  if (!client) {
    return () => {};
  }

  const channel = client
    .channel('ovalant-realtime-channel')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'matches' },
      () => {
        onUpdate();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'entries' },
      () => {
        onUpdate();
      }
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}
