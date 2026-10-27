'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, NotificationBanner, Button, Heading, StatusBadge } from '@/design-system';
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
        {/* スロット見出し (デジタル庁デザインシステム仕様: 白背景・クリーンなチップ付き見出し) */}
        <Heading size="20" hasChip={true} className="font-bold text-solid-gray-900 tracking-tight pb-3 mb-4 border-b border-solid-gray-200">
          {title}
        </Heading>

        {match ? (
          <div className="flex-1 flex flex-col justify-between">
            <div>
              {/* 試合番号 & 形式バッジ */}
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
                      <div className="flex items-center justify-between pb-2 mb-1 border-b border-solid-gray-300">
                        <StatusBadge variant="error" size="sm">
                          赤チーム (RED)
                        </StatusBadge>
                        <span className="text-xs text-solid-gray-700 font-semibold">
                          {(match.teams.red.staff_count ?? 0) > 0 ? (
                            <>
                              {match.teams.red.total_count + (match.teams.red.staff_count ?? 0)}名
                              <span className="text-[11px] text-solid-gray-500 font-normal ml-1">
                                (参加{match.teams.red.total_count} + 助っ人{match.teams.red.staff_count})
                              </span>
                            </>
                          ) : (
                            `${match.teams.red.total_count}名`
                          )}
                        </span>
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
                        {/* 運営スタッフ助っ人表示 */}
                        {(match.teams.red.staff_count ?? 0) > 0 && (
                          <li className="py-2 px-2.5 my-1.5 rounded-6 bg-solid-gray-100 border border-solid-gray-300 flex justify-between items-center text-solid-gray-900">
                            <div className="flex items-center gap-1.5 font-bold text-xs text-solid-gray-800">
                              <span>運営スタッフ (助っ人参加)</span>
                            </div>
                            <span className="text-xs bg-solid-gray-800 text-white font-bold px-2 py-0.5 rounded-4">
                              +{match.teams.red.staff_count}名
                            </span>
                          </li>
                        )}
                      </ul>
                    </div>

                    {/* 青チーム */}
                    <div>
                      <div className="flex items-center justify-between pb-2 mb-1 border-b border-solid-gray-300">
                        <StatusBadge variant="key" size="sm">
                          青チーム (BLUE)
                        </StatusBadge>
                        <span className="text-xs text-solid-gray-700 font-semibold">
                          {(match.teams.blue.staff_count ?? 0) > 0 ? (
                            <>
                              {match.teams.blue.total_count + (match.teams.blue.staff_count ?? 0)}名
                              <span className="text-[11px] text-solid-gray-500 font-normal ml-1">
                                (参加{match.teams.blue.total_count} + 助っ人{match.teams.blue.staff_count})
                              </span>
                            </>
                          ) : (
                            `${match.teams.blue.total_count}名`
                          )}
                        </span>
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
                        {/* 運営スタッフ助っ人表示 */}
                        {(match.teams.blue.staff_count ?? 0) > 0 && (
                          <li className="py-2 px-2.5 my-1.5 rounded-6 bg-solid-gray-100 border border-solid-gray-300 flex justify-between items-center text-solid-gray-900">
                            <div className="flex items-center gap-1.5 font-bold text-xs text-solid-gray-800">
                              <span>運営スタッフ (助っ人参加)</span>
                            </div>
                            <span className="text-xs bg-solid-gray-800 text-white font-bold px-2 py-0.5 rounded-4">
                              +{match.teams.blue.staff_count}名
                            </span>
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                )
              )}
            </div>

            <div className="mt-6 pt-3 border-t border-solid-gray-200 text-xs text-solid-gray-600 flex justify-between items-center flex-wrap gap-2">
              <span>合計対戦人数: <strong className="text-solid-gray-900 font-bold">{match.total_players}名</strong></span>
              {(match.total_staff ?? 0) > 0 ? (
                <span className="text-xs bg-solid-gray-200 text-solid-gray-800 font-bold px-2 py-0.5 rounded-4 border border-solid-gray-300">
                  スタッフ助っ人 {match.total_staff}名参加
                </span>
              ) : (
                <span className="text-solid-gray-500 font-medium">受付完了済</span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-solid-gray-500 py-12">
            <svg
              className="size-8 mb-2.5 text-solid-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
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
          <div>
            <Heading size="24" hasChip={true} className="font-bold text-solid-gray-900 leading-tight">
              OVERTER WATCH2026 3v3 会場進行モニタ
            </Heading>
            <p className="text-xs text-solid-gray-600 mt-1 pl-4.5">リアルタイム試合進行・対戦組合せ表示</p>
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
              <Link href="/">
                参加者エントリーへ
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 md:p-8 w-full space-y-6 flex-1">
        {/* サジェストTipsバナー */}
        {queueState && (
          <NotificationBanner
            bannerStyle="standard"
            type="info1"
            title="リアルタイム案内"
          >
            <span className="text-sm font-medium">{queueState.suggestion_tip.message}</span>
          </NotificationBanner>
        )}

        {/* 3スロット (対戦中 / 次の試合 / 次々回待機) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {renderSlotCard(queueState?.current_match ?? null, '1. 現在対戦中 (フィールド案内済)')}
          {renderSlotCard(queueState?.next_match ?? null, '2. 次の試合 (受付前集合・呼出中)')}
          {renderSlotCard(queueState?.next_next_match ?? null, '3. その次の試合 (準備待機中)')}
        </div>
      </main>
    </div>
  );
}
