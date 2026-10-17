'use client';

import { useState, useEffect } from 'react';
import { Card, NotificationBanner } from '@/design-system';
import { getQueueStatus } from '@/lib/api';
import { subscribeToMatchUpdates } from '@/lib/supabase';
import type { QueueStatusResponse, Match } from '@/types';

export default function MonitorPage() {
  const [queueState, setQueueState] = useState<QueueStatusResponse | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const data = await getQueueStatus();
        setQueueState(data);
      } catch (err) {
        console.error('Failed to fetch status:', err);
      }
    };

    poll();
    // 定期ポーリング（フォールバック）
    const timer = setInterval(poll, 3000);
    // Supabase Realtime イベントによる即時反映
    const unsubscribe = subscribeToMatchUpdates(() => {
      poll();
    });

    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  const renderSlotCard = (match: Match | null, title: string) => {
    return (
      <Card className="flex flex-col h-full bg-white shadow-md border-2 border-solid-gray-300">
        <div className="border-b border-solid-gray-200 pb-3 mb-4">
          <div className="text-xl font-bold text-solid-gray-900">{title}</div>
        </div>

        {match ? (
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-2xl font-black text-key-900">
                  Match #{match.match_number}
                </span>
                <span className="text-xs bg-solid-gray-100 text-solid-gray-700 px-2.5 py-1 rounded-4 border">
                  {match.is_closed_match ? '【貸切内戦】' : '【通常合流】'} {match.duration_minutes}分枠
                </span>
              </div>

              {/* チーム対決表示 */}
              {match.teams && (
                <div className="space-y-3">
                  {/* 赤チーム */}
                  <div className="bg-red-50 border border-red-200 rounded-8 p-3">
                    <div className="text-xs font-bold text-red-700 mb-1 flex justify-between">
                      <span>🔴 RED TEAM</span>
                      <span>{match.teams.red.total_count}名</span>
                    </div>
                    <div className="space-y-1">
                      {match.teams.red.groups.map((g) => (
                        <div key={g.id} className="text-sm font-bold text-solid-gray-900 flex justify-between">
                          <span>#{g.entry_number} {g.team_name}</span>
                          <span className="text-xs text-solid-gray-600 font-normal">({g.headcount}名)</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 青チーム */}
                  <div className="bg-blue-50 border border-blue-200 rounded-8 p-3">
                    <div className="text-xs font-bold text-blue-700 mb-1 flex justify-between">
                      <span>🔵 BLUE TEAM</span>
                      <span>{match.teams.blue.total_count}名</span>
                    </div>
                    <div className="space-y-1">
                      {match.teams.blue.groups.length > 0 ? (
                        match.teams.blue.groups.map((g) => (
                          <div key={g.id} className="text-sm font-bold text-solid-gray-900 flex justify-between">
                            <span>#{g.entry_number} {g.team_name}</span>
                            <span className="text-xs text-solid-gray-600 font-normal">({g.headcount}名)</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-solid-gray-500 italic">身内内戦のためチーム分けなし</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-solid-gray-200 text-xs text-solid-gray-500 flex justify-between">
              <span>合計: {match.total_players}名 参加</span>
              <span>受付完了済</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-solid-gray-400 py-12">
            <span className="text-4xl mb-2">⏳</span>
            <p className="text-sm font-medium">現在マッチング待機中</p>
          </div>
        )}
      </Card>
    );
  };

  return (
    <main className="min-h-screen bg-solid-gray-100 flex flex-col p-6">
      {/* 画面上部ヘッダー */}
      <header className="flex items-center justify-between bg-key-900 text-white px-6 py-4 rounded-12 shadow-md mb-6">
        <div>
          <h1 className="text-2xl font-black tracking-wider">OVALANT 3v3 LIVE MONITOR</h1>
          <p className="text-xs text-solid-gray-300">赤外線シューティング 会場進行モニタ</p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-xs text-solid-gray-300">現在の待機組数</div>
            <div className="text-2xl font-black">
              {queueState?.total_waiting_groups ?? 0}
              <span className="text-xs font-normal ml-1">組 ({queueState?.total_waiting_players ?? 0}名)</span>
            </div>
          </div>
          <a
            href="/"
            className="text-xs bg-white text-key-900 font-bold px-3 py-2 rounded-6 hover:bg-solid-gray-200"
          >
            参加者エントリーへ
          </a>
        </div>
      </header>

      {/* サジェストTipsバナー */}
      {queueState && (
        <div className="mb-6">
          <NotificationBanner
            bannerStyle="standard"
            type="info1"
            title="空き状況アナウンス"
          >
            <span className="text-sm">{queueState.suggestion_tip.message}</span>
          </NotificationBanner>
        </div>
      )}

      {/* 3スロット カラムグリッド */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1">
        {/* 1. 現在対戦中 */}
        {renderSlotCard(
          queueState?.current_match ?? null,
          '1. 現在対戦中'
        )}

        {/* 2. 次の試合 */}
        {renderSlotCard(
          queueState?.next_match ?? null,
          '2. 次の試合'
        )}

        {/* 3. その次の試合 */}
        {renderSlotCard(
          queueState?.next_next_match ?? null,
          '3. その次の試合'
        )}
      </div>
    </main>
  );
}
