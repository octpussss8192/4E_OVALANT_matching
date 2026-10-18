'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Card,
  Heading,
  Button,
  StatusBadge,
  NotificationBanner,
  ModalDialog,
  ModalDialogContent,
  ModalDialogHeader,
  ModalDialogHeading,
  ModalDialogClose,
  ModalDialogBody,
  ModalDialogActions,
} from '@/design-system';
import { getQueueStatus, advanceMatch, skipEntry, resetSystem, addSampleGroups } from '@/lib/api';
import { subscribeToMatchUpdates } from '@/lib/supabase';
import type { QueueStatusResponse, Match, EntryGroup } from '@/types';

// デジタル庁デザインシステム規格のスピナーアイコン (SVG)
const Spinner = ({ className = 'size-4 text-current' }: { className?: string }) => (
  <svg
    className={`animate-spin ${className}`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

export default function AdminPage() {
  const [queueState, setQueueState] = useState<QueueStatusResponse | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionLoadingText, setActionLoadingText] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ title: string; message: string; type: 'info1' | 'success' | 'warning' } | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  // 競合状態（Race Condition）防止用リクエストID
  const fetchRequestIdRef = useRef(0);
  const actionLoadingRef = useRef(false);
  const isFetchingRef = useRef(false);

  // スキップ確認モーダル用状態
  const [skipTarget, setSkipTarget] = useState<EntryGroup | null>(null);
  const skipDialogRef = useRef<HTMLDialogElement>(null);

  const fetchStatus = async (showIndicator = false) => {
    // 操作中は古いポーリングによる競合上書きを防ぐためスキップ
    if (!showIndicator && actionLoadingRef.current) return;
    if (isFetchingRef.current && !showIndicator) return;

    const reqId = ++fetchRequestIdRef.current;
    isFetchingRef.current = true;
    setIsFetching(true);

    try {
      const data = await getQueueStatus();
      // 最新のリクエストレスポンスのみを反映（古いレスポンスによる上書き巻き戻しを完全防止）
      if (reqId === fetchRequestIdRef.current) {
        setQueueState((prevState) => {
          // Stale-While-Revalidate: もし前回のデータが存在していて、新しく届いたデータが空（かつリセット操作中でない）場合、
          // サーバーレスの一時的なコールドスタート空読みと判定して前回のデータを維持し、画面がまっさらに消えるのを防止
          if (
            prevState &&
            (prevState.all_active_entries?.length ?? 0) > 0 &&
            (data.all_active_entries?.length ?? 0) === 0 &&
            !actionLoadingRef.current
          ) {
            console.warn('[Admin] Temporary empty state received from serverless, preserving previous state');
            return prevState;
          }
          return data;
        });

        const now = new Date();
        setLastUpdated(now.toLocaleTimeString('ja-JP'));
      }
    } catch (err) {
      console.error('Failed to fetch admin status:', err);
    } finally {
      if (reqId === fetchRequestIdRef.current) {
        isFetchingRef.current = false;
        setIsFetching(false);
      }
    }
  };

  useEffect(() => {
    fetchStatus(true);

    // Supabase Realtime: データベースの更新 (entries / matches) を検知して即座に同期
    const unsubscribe = subscribeToMatchUpdates(() => {
      fetchStatus(true);
    });

    // バックグラウンド・セーフティネットポーリング (15秒)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchStatus(false);
      }
    }, 15000);

    // 他のタブから戻ってきた瞬間に即座にスピナー付きで最新同期
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchStatus(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    return () => {
      unsubscribe();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, []);

  // 自動消去タイマー (フィードバックバナー)
  useEffect(() => {
    if (actionFeedback) {
      const timer = setTimeout(() => setActionFeedback(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionFeedback]);

  // 試合進行操作 (Advance)
  const handleAdvance = async (matchId: string) => {
    actionLoadingRef.current = true;
    setActionLoading(true);
    setActionLoadingText('試合進行・繰り上げ処理中...');
    try {
      await advanceMatch(matchId);
      setActionFeedback({
        type: 'success',
        title: '試合スロット進行完了',
        message: '試合ステータスを進行し、空いたスロットへ後続待機組を繰り上げました。',
      });
      await fetchStatus(true);
    } catch (err: any) {
      alert(err.message || '試合進行に失敗しました');
    } finally {
      actionLoadingRef.current = false;
      setActionLoading(false);
      setActionLoadingText(null);
    }
  };

  // スキップ確認ダイアログを開く
  const openSkipModal = (group: EntryGroup) => {
    setSkipTarget(group);
    skipDialogRef.current?.showModal();
  };

  // スキップ確認ダイアログを閉じる
  const closeSkipModal = () => {
    skipDialogRef.current?.close();
    setSkipTarget(null);
  };

  // スキップ実行
  const handleConfirmSkip = async () => {
    if (!skipTarget) return;
    actionLoadingRef.current = true;
    setActionLoading(true);
    setActionLoadingText(`不在スキップ処理中 (#${skipTarget.entry_number} ${skipTarget.team_name})...`);
    try {
      await skipEntry(skipTarget.id, '受付呼出時不在のため運営がスキップ');
      closeSkipModal();
      setActionFeedback({
        type: 'info1',
        title: '不在スキップを実行しました',
        message: `#${skipTarget.entry_number}「${skipTarget.team_name}」をスキップしました。相方グループは待機キュー最優先に戻りました。`,
      });
      await fetchStatus(true);
    } catch (err: any) {
      alert(err.message || 'スキップに失敗しました');
    } finally {
      actionLoadingRef.current = false;
      setActionLoading(false);
      setActionLoadingText(null);
    }
  };

  // デバッグ用: サンプルグループの自動投入 (アトミックに4組一括投入)
  const handleAddSampleGroups = async () => {
    actionLoadingRef.current = true;
    setActionLoading(true);
    setActionLoadingText('テストデータ4組を一括投入中...');
    try {
      const updatedState = await addSampleGroups();
      setQueueState(updatedState);
      const now = new Date();
      setLastUpdated(now.toLocaleTimeString('ja-JP'));
      setActionFeedback({
        type: 'info1',
        title: 'テストデータ投入完了',
        message: '4組（Alpha 3名, Bravo 2名, Charlie 1名, Delta 4名）を一括投入し、スロットを再編成しました。',
      });
    } catch (err: any) {
      alert(err.message || 'テストデータの投入に失敗しました');
    } finally {
      actionLoadingRef.current = false;
      setActionLoading(false);
      setActionLoadingText(null);
    }
  };

  // 全リセット
  const handleReset = async () => {
    if (!confirm('本当にすべての試合と待機エントリーをリセットしますか？')) return;
    actionLoadingRef.current = true;
    setActionLoading(true);
    setActionLoadingText('全データをリセット中...');
    try {
      await resetSystem();
      setActionFeedback({
        type: 'warning',
        title: 'システム初期化',
        message: 'すべての試合スロットおよび待機キューを空にリセットしました。',
      });
      await fetchStatus(true);
    } finally {
      actionLoadingRef.current = false;
      setActionLoading(false);
      setActionLoadingText(null);
    }
  };

  const renderSlotManagement = (
    match: Match | null,
    slotTitle: string,
    actionButtonText: string,
  ) => {
    return (
      <Card className="relative flex flex-col justify-between bg-white shadow-sm border border-solid-gray-300 min-h-[220px]">
        {/* 操作中オーバーレイ */}
        {actionLoading && (
          <div className="absolute inset-0 bg-white/75 backdrop-blur-[0.5px] rounded-12 flex flex-col items-center justify-center z-10 gap-2 text-xs font-bold text-solid-gray-800">
            <Spinner className="size-6 text-key-900" />
            <span>{actionLoadingText || '更新中...'}</span>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between border-b border-solid-gray-200 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-solid-gray-800">{slotTitle}</span>
              {isFetching && <Spinner className="size-3.5 text-key-900" />}
            </div>
            {match && (
              <span className="text-xs bg-key-50 text-key-900 border border-key-300 px-2 py-0.5 rounded-4 font-bold">
                Match #{match.match_number} ({match.is_closed_match ? '貸切8分' : '通常10分'})
              </span>
            )}
          </div>

          {!queueState ? (
            <div className="py-10 flex flex-col items-center justify-center gap-2 text-xs text-solid-gray-500">
              <Spinner className="size-5 text-key-900" />
              <span>スロット状況を取得中...</span>
            </div>
          ) : match ? (
            <div className="space-y-3">
              <div className="space-y-2">
                {match.assigned_groups.map((group) => (
                  <div
                    key={group.id}
                    className="flex items-center justify-between p-2.5 bg-solid-gray-50 rounded-6 border border-solid-gray-200 text-xs"
                  >
                    <div>
                      <span className="font-bold text-sm text-key-900 mr-2">#{group.entry_number}</span>
                      <span className="font-bold text-solid-gray-900">{group.team_name}</span>
                      <span className="text-solid-gray-500 ml-1">({group.headcount}名)</span>
                      <div className="text-[10px] text-solid-gray-500">代表: {group.leader_name}</div>
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => openSkipModal(group)}
                      disabled={actionLoading}
                    >
                      不在スキップ
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-xs text-solid-gray-400">
              {actionLoading ? (
                <div className="flex items-center justify-center gap-2 text-solid-gray-600 font-semibold">
                  <Spinner className="size-4" /> スロット更新中...
                </div>
              ) : (
                '枠は現在空いています'
              )}
            </div>
          )}
        </div>

        {match && (
          <div className="pt-4 mt-3 border-t border-solid-gray-200">
            <Button
              size="md"
              variant="solid-fill"
              className="w-full justify-center text-sm font-bold"
              onClick={() => handleAdvance(match.id)}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner className="size-4" /> 処理中...
                </span>
              ) : (
                actionButtonText
              )}
            </Button>
          </div>
        )}
      </Card>
    );
  };

  return (
    <main className="min-h-screen bg-solid-gray-100 p-6 flex flex-col">
      {/* スタッフ管理ヘッダー (デジタル庁デザインシステム仕様) */}
      <header className="flex flex-col md:flex-row md:items-center justify-between bg-solid-gray-900 text-white px-6 py-4 rounded-12 shadow mb-4 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-wider">OVALANT 運営ダッシュボード (iPad)</h1>
            {/* デジタル庁公式 StatusBadge */}
            <StatusBadge className="text-xs py-1 px-2.5">
              {isFetching ? '同期中...' : 'リアルタイム連携 (Supabase)'}
              {lastUpdated && <span className="text-solid-gray-200 ml-1">({lastUpdated})</span>}
            </StatusBadge>
          </div>
          <p className="text-xs text-solid-gray-400 mt-0.5">受付呼出・試合進行・不在スキップ管理</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* デジタル庁公式 Button コンポーネント群 */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchStatus(true)}
            disabled={actionLoading || isFetching}
          >
            {isFetching ? <Spinner className="size-3.5 mr-1" /> : '🔄 '}
            手動更新
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddSampleGroups}
            disabled={actionLoading}
          >
            + テスト組投入
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleReset}
            disabled={actionLoading}
          >
            全リセット
          </Button>
          <Button
            asChild
            size="sm"
            variant="solid-fill"
          >
            <a href="/monitor" target="_blank" rel="noreferrer">
              会場モニタ別窓 ↗
            </a>
          </Button>
        </div>
      </header>

      {/* 操作完了フィードバック通知（デジタル庁公式 NotificationBanner） */}
      {actionFeedback && (
        <div className="mb-4">
          <NotificationBanner
            bannerStyle="standard"
            type={actionFeedback.type}
            title={actionFeedback.title}
          >
            <span className="text-sm font-medium">{actionFeedback.message}</span>
          </NotificationBanner>
        </div>
      )}

      {/* 上段: 3スロット進行パネル */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {renderSlotManagement(
          queueState?.current_match ?? null,
          '1. 現在対戦中',
          '試合終了 (スロットを空けて繰り上げ)',
        )}
        {renderSlotManagement(
          queueState?.next_match ?? null,
          '2. 次の試合',
          '案内完了 (対戦中へ昇格)',
        )}
        {renderSlotManagement(
          queueState?.next_next_match ?? null,
          '3. その次の試合',
          '呼出開始 (Nextへ昇格)',
        )}
      </div>

      {/* 下段: 受付グループ一覧テーブル（対戦中・呼出中・待機中を可視化） */}
      <Card className="flex-1 bg-white shadow-sm border border-solid-gray-300">
        {(() => {
          const displayGroups = (queueState?.all_active_entries && queueState.all_active_entries.length > 0)
            ? queueState.all_active_entries
            : (queueState?.waiting_groups ?? []);

          return (
            <>
              <div className="flex items-center justify-between border-b border-solid-gray-200 pb-3 mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <Heading size="20" hasChip={true} className="font-bold text-solid-gray-900">
                    受付エントリー一覧 ({displayGroups.length}組)
                  </Heading>
                  {isFetching && <Spinner className="size-4 text-key-900" />}
                  <span className="text-xs text-solid-gray-600">
                    (待機中: {queueState?.total_waiting_groups ?? 0}組 / {queueState?.total_waiting_players ?? 0}名)
                  </span>
                </div>
                <span className="text-xs text-solid-gray-500">
                  💡 サジェスト: {queueState?.suggestion_tip.message}
                </span>
              </div>

              {!queueState ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-solid-gray-500">
                  <Spinner className="size-5 text-key-900" />
                  <span>待機キューの状況を取得中...</span>
                </div>
              ) : displayGroups.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b bg-solid-gray-100 text-solid-gray-700">
                        <th className="py-2.5 px-3 font-semibold">整理券</th>
                        <th className="py-2.5 px-3 font-semibold">チーム名</th>
                        <th className="py-2.5 px-3 font-semibold">代表者名</th>
                        <th className="py-2.5 px-3 font-semibold">人数</th>
                        <th className="py-2.5 px-3 font-semibold">希望</th>
                        <th className="py-2.5 px-3 font-semibold">現在状況</th>
                        <th className="py-2.5 px-3 font-semibold">受付時刻</th>
                        <th className="py-2.5 px-3 font-semibold text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-solid-gray-200">
                      {displayGroups.map((group) => {
                        let statusLabel = '待機中';
                        let statusBadgeStyle = 'bg-solid-gray-536';

                        if (group.status === 'in_match') {
                          statusLabel = '対戦中';
                          statusBadgeStyle = 'bg-key-900';
                        } else if (group.status === 'called') {
                          if (group.assigned_match_id === queueState.next_match?.id) {
                            statusLabel = '呼出中 (Next)';
                            statusBadgeStyle = 'bg-key-800';
                          } else if (group.assigned_match_id === queueState.next_next_match?.id) {
                            statusLabel = '次回呼出 (その次)';
                            statusBadgeStyle = 'bg-solid-gray-700';
                          } else {
                            statusLabel = '枠割当済';
                            statusBadgeStyle = 'bg-solid-gray-600';
                          }
                        } else if (group.status === 'skipped') {
                          statusLabel = '不在スキップ';
                          statusBadgeStyle = 'bg-solid-gray-400';
                        }

                        return (
                          <tr key={group.id} className="hover:bg-solid-gray-50 transition-colors">
                            <td className="py-2.5 px-3 font-bold text-key-900">#{group.entry_number}</td>
                            <td className="py-2.5 px-3 font-bold text-solid-gray-900">{group.team_name}</td>
                            <td className="py-2.5 px-3 text-solid-gray-600">{group.leader_name}</td>
                            <td className="py-2.5 px-3 font-bold">{group.headcount}名</td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`px-2 py-0.5 rounded-4 text-[10px] font-bold ${
                                  group.preference === 'closed'
                                    ? 'bg-solid-gray-200 text-solid-gray-800 border border-solid-gray-400'
                                    : 'bg-key-50 text-key-900 border border-key-300'
                                }`}
                              >
                                {group.preference === 'closed' ? '貸切(8分)' : '合流(10分)'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <StatusBadge className={`${statusBadgeStyle} text-[10px] py-0.5 px-2`}>
                                {statusLabel}
                              </StatusBadge>
                            </td>
                            <td className="py-2.5 px-3 text-solid-gray-500">
                              {new Date(group.created_at).toLocaleTimeString('ja-JP')}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {group.status !== 'skipped' && (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() => openSkipModal(group)}
                                  disabled={actionLoading}
                                >
                                  不在スキップ
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-solid-gray-400">現在、エントリー中のグループはありません。</div>
              )}
            </>
          );
        })()}
      </Card>

      {/* 不在スキップ確認モーダルダイアログ (デジタル庁公式コンポーネント) */}
      <ModalDialog ref={skipDialogRef}>
        <ModalDialogContent className="max-w-md">
          <ModalDialogHeader>
            <ModalDialogHeading className="text-lg font-bold text-solid-gray-900">
              ⚠️ 不在スキップの確認
            </ModalDialogHeading>
            <ModalDialogClose onClick={closeSkipModal} />
          </ModalDialogHeader>
          <ModalDialogBody>
            <div className="space-y-2 text-sm text-solid-gray-800">
              <p>
                以下のグループを<strong>不在としてスキップ（無効化）</strong>しますか？
              </p>
              {skipTarget && (
                <div className="p-3 bg-solid-gray-50 border border-solid-gray-300 rounded-8 my-2 font-bold text-xs text-solid-gray-900">
                  #{skipTarget.entry_number} {skipTarget.team_name} (代表: {skipTarget.leader_name} / {skipTarget.headcount}名)
                </div>
              )}
              <p className="text-xs text-solid-gray-600">
                ※ スキップされたグループはキューから除外され、再エントリーが必要になります。
                合流対戦(Open)でマッチングしていた相方グループは自動的に待機キュー最優先に戻り、即座に再マッチングされます。
              </p>
            </div>
          </ModalDialogBody>
          <ModalDialogActions className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={closeSkipModal} disabled={actionLoading}>
              キャンセル
            </Button>
            <Button
              size="sm"
              variant="solid-fill"
              className="min-w-32"
              onClick={handleConfirmSkip}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <span className="flex items-center justify-center gap-1.5">
                  <Spinner className="size-3.5" /> スキップ処理中...
                </span>
              ) : (
                'スキップを実行する'
              )}
            </Button>
          </ModalDialogActions>
        </ModalDialogContent>
      </ModalDialog>
    </main>
  );
}
