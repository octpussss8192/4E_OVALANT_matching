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
    // 定期ポーリング（フォールバック: 3秒間隔で高速同期）
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
      <Card className="flex flex-col h-full bg-white border border-solid-gray-300 rounded-8 p-6">
        {/* スロット見出し (デジタル庁デザインシステム仕様: 白背景・クリーンなチップ付き見出し) */}
        <div className="flex items-center gap-2.5 pb-3 mb-4 border-b border-solid-gray-200">
          <span className="w-1.5 h-5 bg-key-900 rounded-full inline-block shrink-0" aria-hidden="true" />
          <h2 className="text-lg font-bold text-solid-gray-900 tracking-tight">{title}</h2>
        </div>

        {match ? (
          <div className="flex-1 flex flex-col justify-between">
            <div>
              {/* 試合番号 & 形式バッジ (原色の青太字を排除し、デジタル庁公式タイポグラフィに準拠) */}
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-solid-gray-200">
                <span className="text-xl font-bold text-solid-gray-900">
                  第 {match.match_number} 試合
                </span>
                <span className="text-xs bg-solid-gray-100 text-solid-gray-800 px-2.5 py-1 rounded-4 border border-solid-gray-300 font-semibold">
                  {match.is_closed_match ? '貸切内戦 (8分)' : '通常合流 (10分)'}
                </span>
              </div>

              {/* 試合の対戦・編成表示 */}
              {match.is_closed_match ? (
                /* Case A: 貸切・身内戦 (チーム分割せず、グループ単独枠として美しく表示) */
                <div className="py-2 space-y-3">
                  <div className="border border-solid-gray-200 rounded-6 p-4 bg-solid-gray-50">
                    <div className="text-xs font-bold text-solid-gray-700 pb-2 mb-2 border-b border-solid-gray-200 flex justify-between items-center">
                      <span>貸切内戦グループ</span>
                      <span className="font-normal text-solid-gray-600">身内対戦枠</span>
                    </div>
                    {match.assigned_groups.map((g) => (
                      <div key={g.id} className="flex justify-between items-center text-solid-gray-900">
                        <div>
                          <div className="text-base font-bold">#{g.entry_number} {g.team_name}</div>
                          <div className="text-xs text-solid-gray-600 mt-0.5">代表者: {g.leader_name}</div>
                        </div>
                        <div className="text-right">
                          <span className="text-lg font-bold text-solid-gray-900">{g.headcount}</span>
                          <span className="text-xs text-solid-gray-600 ml-0.5">名</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-solid-gray-600 leading-relaxed">
                    ※身内グループでの貸切内戦のため、赤青の事前チーム分けはありません。
                  </p>
                </div>
              ) : (
                /* Case B: 通常合流 (Open: 赤チーム vs 青チームの清潔なフラットリスト表示) */
                match.teams && (
                  <div className="space-y-4">
                    {/* 赤チーム */}
                    <div>
                      <div className="flex items-center justify-between pb-1.5 border-b-2 border-error-1 text-xs font-bold text-solid-gray-900">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-error-1 inline-block shrink-0" aria-hidden="true" />
                          <span>赤チーム (RED)</span>
                        </div>
                        <span className="text-solid-gray-700 font-semibold">{match.teams.red.total_count}名</span>
                      </div>
                      <ul className="divide-y divide-solid-gray-200 text-sm">
                        {match.teams.red.groups.map((g) => (
                          <li key={g.id} className="py-2.5 flex justify-between items-center text-solid-gray-900">
                            <div>
                              <span className="font-bold text-solid-gray-900 mr-2">#{g.entry_number}</span>
                              <span className="font-bold text-solid-gray-900">{g.team_name}</span>
                            </div>
                            <span className="text-xs text-solid-gray-600 font-medium">({g.headcount}名)</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* 青チーム */}
                    <div>
                      <div className="flex items-center justify-between pb-1.5 border-b-2 border-key-900 text-xs font-bold text-solid-gray-900">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-key-900 inline-block shrink-0" aria-hidden="true" />
                          <span>青チーム (BLUE)</span>
                        </div>
                        <span className="text-solid-gray-700 font-semibold">{match.teams.blue.total_count}名</span>
                      </div>
                      <ul className="divide-y divide-solid-gray-200 text-sm">
                        {match.teams.blue.groups.map((g) => (
                          <li key={g.id} className="py-2.5 flex justify-between items-center text-solid-gray-900">
                            <div>
                              <span className="font-bold text-solid-gray-900 mr-2">#{g.entry_number}</span>
                              <span className="font-bold text-solid-gray-900">{g.team_name}</span>
                            </div>
                            <span className="text-xs text-solid-gray-600 font-medium">({g.headcount}名)</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )
              )}
            </div>

            <div className="mt-6 pt-3 border-t border-solid-gray-200 text-xs text-solid-gray-600 flex justify-between items-center">
              <span>合計参加人数: <strong className="text-solid-gray-900 font-bold">{match.total_players}名</strong></span>
              <span className="text-solid-gray-500 font-medium">受付完了済</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-solid-gray-500 py-12">
            <span className="text-3xl mb-2 text-solid-gray-400" aria-hidden="true">⏳</span>
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
              <h1 className="text-2xl font-bold tracking-tight text-solid-gray-900 leading-tight">
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
                <span className="text-xs font-normal text-solid-gray-700 ml-1">
                  組 ({queueState?.total_waiting_players ?? 0}名)
                </span>
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
        {/* サジェストTipsバナー (デジタル庁 NotificationBanner) */}
        {queueState && (
          <NotificationBanner
            bannerStyle="standard"
            type="info1"
            title="空き状況アナウンス"
          >
            <span className="text-sm font-medium">{queueState.suggestion_tip.message}</span>
          </NotificationBanner>
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
