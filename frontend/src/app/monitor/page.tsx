'use client';

import { useState, useEffect } from 'react';
import { Card, NotificationBanner, Button } from '@/design-system';
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
    const timer = setInterval(poll, 15000);
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
      <Card className="flex flex-col h-full bg-white border border-solid-gray-300 rounded-8 p-6">
        <div className="border-b border-solid-gray-200 pb-3 mb-4">
          <div className="text-xl font-bold text-solid-gray-900">{title}</div>
        </div>

        {match ? (
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-2xl font-bold text-key-900">
                  Match #{match.match_number}
                </span>
                <span className="text-xs bg-solid-gray-100 text-solid-gray-800 px-2.5 py-1 rounded-4 border border-solid-gray-300 font-semibold">
                  {match.is_closed_match ? '【貸切内戦】' : '【通常合流】'} {match.duration_minutes}分枠
                </span>
              </div>

              {/* チーム対決表示 (デジタル庁公式セマンティックカラー仕様) */}
              {match.teams && (
                <div className="space-y-3">
                  {/* 赤チーム */}
                  <div className="bg-solid-gray-50 border-l-4 border-error-1 border border-solid-gray-200 rounded-6 p-3">
                    <div className="text-xs font-bold text-error-1 mb-1.5 flex justify-between items-center">
                      <span>RED TEAM</span>
                      <span className="text-solid-gray-700">{match.teams.red.total_count}名</span>
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
                  <div className="bg-solid-gray-50 border-l-4 border-key-900 border border-solid-gray-200 rounded-6 p-3">
                    <div className="text-xs font-bold text-key-900 mb-1.5 flex justify-between items-center">
                      <span>BLUE TEAM</span>
                      <span className="text-solid-gray-700">{match.teams.blue.total_count}名</span>
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

            <div className="mt-4 pt-3 border-t border-solid-gray-200 text-xs text-solid-gray-600 flex justify-between">
              <span>合計: {match.total_players}名 参加</span>
              <span>受付完了済</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-solid-gray-500 py-12">
            <span className="text-3xl mb-2 text-solid-gray-400">⏳</span>
            <p className="text-sm font-medium">現在マッチング待機中</p>
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-solid-gray-50 flex flex-col text-solid-gray-900">
      {/* 画面上部ヘッダー (デジタル庁デザインシステム準拠) */}
      <header className="bg-white border-b border-solid-gray-300 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-1.5 h-7 bg-key-900 rounded-full inline-block shrink-0" aria-hidden="true" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-solid-gray-900">
                OVALANT 3v3 会場進行モニタ
              </h1>
              <p className="text-xs text-solid-gray-600">リアルタイム試合進行・対戦組合せ表示</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-xs text-solid-gray-600">現在の待機組数</div>
              <div className="text-2xl font-bold text-key-900">
                {queueState?.total_waiting_groups ?? 0}
                <span className="text-xs font-normal text-solid-gray-700 ml-1">組 ({queueState?.total_waiting_players ?? 0}名)</span>
              </div>
            </div>
            <Button asChild size="sm" variant="outline">
              <a href="/">
                参加者エントリーへ
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 md:p-8 w-full flex-1 flex flex-col space-y-6">

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
  </div>
  );
}
