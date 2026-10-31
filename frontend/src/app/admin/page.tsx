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
  type StatusBadgeVariant,
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
  const [actionFeedback, setActionFeedback] = useState<{
    title: string;
    message: string;
    type: 'info1' | 'success' | 'warning' | 'error';
  } | null>(null);
  // 表示モード ('active': 進行中のみ, 'history': 完了・スキップ含む全履歴)
  const [viewMode, setViewMode] = useState<'active' | 'history'>('active');
  const [isFetching, setIsFetching] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [fetchError, setFetchError] = useState(false);

  // 競合状態（Race Condition）防止用リクエストID
  const fetchRequestIdRef = useRef(0);
  const actionLoadingRef = useRef(false);
  const isFetchingRef = useRef(false);
  const isIntentionalResetRef = useRef(false);

  // 不在スキップ確認モーダル用状態
  const [skipTarget, setSkipTarget] = useState<EntryGroup | null>(null);
  const skipDialogRef = useRef<HTMLDialogElement>(null);

  // 全リセット確認モーダル用状態
  const resetDialogRef = useRef<HTMLDialogElement>(null);

  // CSVエクスポート処理 (バックエンド直接ダウンロード + クライアント側フォールバック、Excel対応 UTF-8 BOM付き)
  const handleExportCsv = async () => {
    const totalEntries =
      (queueState?.all_history_entries?.length ?? 0) ||
      (queueState?.all_active_entries?.length ?? 0);

    if (!queueState || totalEntries === 0) {
      setActionFeedback({
        type: 'warning',
        title: 'エクスポート不可',
        message: '出力対象のエントリー履歴がありません。',
      });
      return;
    }

    try {
      const apiBase =
        typeof window !== 'undefined'
          ? '/api'
          : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api');
      const res = await fetch(`${apiBase}/admin/export-csv`, { cache: 'no-store' });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const now = new Date();
        const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
        a.download = `overter_watch_2026_entries_${timestamp}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        setActionFeedback({
          type: 'success',
          title: 'CSVエクスポート完了',
          message: `全 ${totalEntries} 件のエントリー履歴をCSV出力しました。`,
        });
        return;
      }
    } catch (e) {
      console.warn('Backend export failed, falling back to client-side export:', e);
    }

    // クライアント側Blobフォールバック
    const list =
      queueState.all_history_entries && queueState.all_history_entries.length > 0
        ? queueState.all_history_entries
        : (queueState.all_active_entries ?? []);

    const headers = [
      '整理券番号',
      'チーム名',
      '代表者名',
      '人数',
      '希望形式',
      '最終ステータス',
      '受付時刻',
      '割当試合ID',
      'スキップ理由',
    ];
    const rows = list.map((g) => {
      let statusStr = '待機中';
      if (g.status === 'in_match') statusStr = '対戦中';
      else if (g.status === 'called') statusStr = '呼出中';
      else if (g.status === 'completed') statusStr = '対戦完了';
      else if (g.status === 'skipped') statusStr = '不在スキップ';

      return [
        g.entry_number,
        `"${g.team_name.replace(/"/g, '""')}"`,
        `"${g.leader_name.replace(/"/g, '""')}"`,
        g.headcount,
        g.preference === 'closed' ? '貸切(8分)' : '合流(10分)',
        statusStr,
        `"${new Date(g.created_at).toLocaleString('ja-JP')}"`,
        g.assigned_match_id || '',
        `"${(g.skip_reason || '').replace(/"/g, '""')}"`,
      ];
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    a.download = `overter_watch_2026_entries_history_${timestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    setActionFeedback({
      type: 'success',
      title: 'CSVエクスポート完了',
      message: `全 ${list.length} 件のエントリー履歴をCSV出力しました。`,
    });
  };

  const fetchStatus = async (isManual = false) => {
    // 操作中は古いポーリングによる競合上書きを防ぐためスキップ
    if (!isManual && actionLoadingRef.current) return;
    if (isFetchingRef.current && !isManual) return;

    const reqId = ++fetchRequestIdRef.current;
    isFetchingRef.current = true;
    if (isManual) {
      setIsFetching(true);
    }

    try {
      const data = await getQueueStatus();
      setFetchError(false);
      if (reqId === fetchRequestIdRef.current) {
        setQueueState(data);
        const now = new Date();
        setLastUpdated(now.toLocaleTimeString('ja-JP'));
      }
    } catch (err) {
      console.error('Failed to fetch admin status:', err);
      setFetchError(true);
    } finally {
      if (reqId === fetchRequestIdRef.current) {
        isFetchingRef.current = false;
        if (isManual) {
          setIsFetching(false);
        }
      }
    }
  };

  useEffect(() => {
    fetchStatus(false);

    // Supabase Realtime: データベースの更新 (entries / matches) を検知して即座に同期
    const unsubscribe = subscribeToMatchUpdates(() => {
      fetchStatus(false);
    });

    // 15秒ごとの静かなフォールバック定期同期
    const pollInterval = setInterval(() => {
      fetchStatus(false);
    }, 15000);

    return () => {
      clearInterval(pollInterval);
      unsubscribe();
    };
  }, []);

  // 自動消去タイマー (フィードバックバナー: 6秒)
  useEffect(() => {
    if (actionFeedback) {
      const timer = setTimeout(() => setActionFeedback(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [actionFeedback]);

  // 試合進行操作 (Advance)
  const handleAdvance = async (matchId: string) => {
    const isCurrentFinish = queueState?.current_match?.id === matchId;
    actionLoadingRef.current = true;
    setActionLoading(true);
    setActionLoadingText(isCurrentFinish ? '試合終了処理中...' : '案内完了・繰り上げ処理中...');
    try {
      await advanceMatch(matchId);
      setActionFeedback({
        type: 'success',
        title: isCurrentFinish ? '試合終了完了' : '案内完了・スロット繰り上げ完了',
        message: isCurrentFinish
          ? '現在対戦中の試合を完了として記録し、フィールド枠を空けました。'
          : '次の試合を「1. 現在対戦中」へ昇格し、後続の待機枠を繰り上げました。',
      });
      await fetchStatus(true);
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        title: '進行エラー',
        message: err.message || '試合進行に失敗しました',
      });
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
      const targetId = skipTarget.id;
      setQueueState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          all_active_entries: (prev.all_active_entries || []).filter((g) => g.id !== targetId),
          waiting_groups: (prev.waiting_groups || []).filter((g) => g.id !== targetId),
          all_history_entries: (prev.all_history_entries || []).map((g) =>
            g.id === targetId ? { ...g, status: 'skipped' as const } : g
          ),
        };
      });
      closeSkipModal();
      setActionFeedback({
        type: 'info1',
        title: '不在スキップを実行しました',
        message: `#${skipTarget.entry_number}「${skipTarget.team_name}」を進行中キューから除外しました。相方グループは待機キュー最優先に戻りました。`,
      });
      await fetchStatus(true);
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        title: 'スキップエラー',
        message: err.message || 'スキップに失敗しました',
      });
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
      setActionFeedback({
        type: 'error',
        title: '投入エラー',
        message: err.message || 'テストデータの投入に失敗しました',
      });
    } finally {
      actionLoadingRef.current = false;
      setActionLoading(false);
      setActionLoadingText(null);
    }
  };

  // 全リセット確認モーダルを開く
  const openResetModal = () => {
    resetDialogRef.current?.showModal();
  };

  const closeResetModal = () => {
    resetDialogRef.current?.close();
  };

  // 全リセット実行
  const handleConfirmReset = async () => {
    closeResetModal();
    actionLoadingRef.current = true;
    isIntentionalResetRef.current = true;
    setActionLoading(true);
    setActionLoadingText('全データをリセット中...');
    try {
      await resetSystem();
      setQueueState({
        current_match: null,
        next_match: null,
        next_next_match: null,
        waiting_groups: [],
        all_active_entries: [],
        all_history_entries: [],
        total_waiting_groups: 0,
        total_waiting_players: 0,
        suggestion_tip: {
          recommended_party_size: null,
          message: '現在待機列なし。何名様でもすぐにご案内可能です。',
        },
      });
      setActionFeedback({
        type: 'warning',
        title: 'システム初期化',
        message: 'すべての試合スロットおよび待機キューを空にリセットしました。',
      });
      await fetchStatus(true);
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        title: '初期化エラー',
        message: err.message || '全リセットに失敗しました',
      });
    } finally {
      actionLoadingRef.current = false;
      setActionLoading(false);
      setActionLoadingText(null);
      setTimeout(() => {
        isIntentionalResetRef.current = false;
      }, 5000);
    }
  };

  const renderSlotManagement = (
    match: Match | null,
    slotTitle: string,
    actionButtonText: string,
  ) => {
    return (
      <Card className="relative flex flex-col justify-between min-h-[220px]">
        {/* 操作中オーバーレイ */}
        {actionLoading && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-[0.5px] rounded-8 flex flex-col items-center justify-center z-10 gap-2 text-xs font-bold text-solid-gray-900">
            <Spinner className="size-6 text-key-900" />
            <span>{actionLoadingText || '更新中...'}</span>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-solid-gray-200">
            <div className="flex items-center gap-2.5">
              <span className="w-1.5 h-5 bg-key-900 rounded-full inline-block shrink-0" aria-hidden="true" />
              <h2 className="text-base font-bold text-solid-gray-900 tracking-tight">{slotTitle}</h2>
            </div>
            {match && (
              <span className="text-xs bg-solid-gray-100 text-solid-gray-800 px-2 py-0.5 rounded-4 border border-solid-gray-300 font-semibold">
                第 {match.match_number} 試合 ({match.is_closed_match ? '貸切 8分' : '合流 10分'})
              </span>
            )}
          </div>

          {!queueState ? (
            <div className="py-10 flex flex-col items-center justify-center gap-2 text-xs text-solid-gray-600">
              <Spinner className="size-5 text-key-900" />
              <span>スロット状況を取得中...</span>
            </div>
          ) : match ? (
            <div>
              <ul className="divide-y divide-solid-gray-200">
                {match.assigned_groups.map((group) => (
                  <li
                    key={group.id}
                    className="flex items-center justify-between py-2.5 text-xs"
                  >
                    <div>
                      <div>
                        <span className="font-bold text-sm text-solid-gray-900 mr-2">#{group.entry_number}</span>
                        <span className="font-bold text-solid-gray-900">{group.team_name}</span>
                        <span className="text-solid-gray-600 ml-1">({group.headcount}名)</span>
                      </div>
                      <div className="text-[11px] text-solid-gray-500 mt-0.5">代表: {group.leader_name}</div>
                    </div>
                    {match.status === 'in_progress' ? (
                      <StatusBadge variant="key" size="sm">
                        対戦中
                      </StatusBadge>
                    ) : (
                      <Button
                        size="xs"
                        variant="outline"
                        className="text-error-1 border-error-1 hover:bg-error-50 hover:text-error-1"
                        onClick={() => openSkipModal(group)}
                        aria-disabled={actionLoading}
                      >
                        不在スキップ
                      </Button>
                    )}
                  </li>
                ))}
                {/* 運営スタッフ助っ人補充バッジ */}
                {(match.total_staff ?? 0) > 0 && (
                  <li className="py-2.5 px-3 my-1.5 rounded-6 bg-solid-gray-100 border border-solid-gray-300 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-solid-gray-900">
                      <span>運営スタッフ助っ人補充</span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] font-bold">
                      {(match.teams?.red.staff_count ?? 0) > 0 && (
                        <span className="bg-error-1 text-white px-2 py-0.5 rounded-4">
                          赤 +{match.teams?.red.staff_count}名
                        </span>
                      )}
                      {(match.teams?.blue.staff_count ?? 0) > 0 && (
                        <span className="bg-key-900 text-white px-2 py-0.5 rounded-4">
                          青 +{match.teams?.blue.staff_count}名
                        </span>
                      )}
                    </div>
                  </li>
                )}
              </ul>
            </div>
          ) : (
            <div className="py-10 text-center text-xs text-solid-gray-500">
              {actionLoading ? (
                <div className="flex items-center justify-center gap-2 text-solid-gray-700 font-semibold">
                  <Spinner className="size-4 text-key-900" /> スロット更新中...
                </div>
              ) : (
                '枠は現在空いています'
              )}
            </div>
          )}
        </div>

        {match && (
          <div className="pt-4 mt-3 border-t border-solid-gray-200">
            {match.status === 'scheduled' && queueState?.next_match ? (
              <div className="w-full py-2.5 px-3 rounded-8 bg-solid-gray-100 border border-solid-gray-300 text-center text-xs font-bold text-solid-gray-600">
                「2. 次の試合」の案内完了時に自動で繰り上がります
              </div>
            ) : (
              <Button
                size="md"
                variant="solid-fill"
                className="w-full justify-center text-sm font-bold min-h-touch"
                onClick={() => handleAdvance(match.id)}
                aria-disabled={actionLoading}
              >
                {actionLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner className="size-4" /> 処理中...
                  </span>
                ) : (
                  actionButtonText
                )}
              </Button>
            )}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-solid-gray-50 flex flex-col text-solid-gray-900">
      {/* スタッフ管理ヘッダー (デジタル庁デザインシステム準拠) */}
      <header className="bg-white border-b border-solid-gray-300 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="w-1.5 h-6 bg-key-900 rounded-full inline-block shrink-0" aria-hidden="true" />
              <Heading size="20" className="font-bold text-solid-gray-900 leading-tight">
                OVERTER WATCH2026 運営ダッシュボード
              </Heading>
              {queueState?.is_local_mode ? (
                <StatusBadge variant="gray" size="sm" className="bg-amber-100 text-amber-900 border-amber-300 font-bold">
                  🧪 ローカル検証モード (本番DB保護中)
                </StatusBadge>
              ) : (
                <StatusBadge variant={fetchError ? 'error' : 'key'} size="sm">
                  {fetchError ? '通信再接続待機中' : '本番DB連携中'}
                  {lastUpdated && <span className="opacity-90 ml-1">({lastUpdated})</span>}
                </StatusBadge>
              )}
            </div>
            <p className="text-xs text-solid-gray-600 mt-1 pl-4.5">
              受付呼出・試合進行・不在スキップ管理
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchStatus(true)}
              aria-disabled={isFetching}
            >
              {isFetching ? (
                <span className="flex items-center gap-1.5">
                  <Spinner className="size-3.5" /> 読込み中...
                </span>
              ) : (
                '手動更新'
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddSampleGroups}
              aria-disabled={actionLoading}
            >
              テスト組投入
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-error-1 border-error-1 hover:bg-error-50 hover:text-error-1"
              onClick={openResetModal}
              aria-disabled={actionLoading}
            >
              全リセット
            </Button>
            <Button
              asChild
              size="sm"
              variant="solid-fill"
            >
              <a href="/monitor" target="_blank" rel="noreferrer">
                会場モニタ別窓
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 md:p-8 w-full space-y-6 flex-1">

        {/* 操作フィードバック通知（デジタル庁公式 NotificationBanner） */}
        {actionFeedback && (
          <NotificationBanner
            bannerStyle="standard"
            type={actionFeedback.type}
            title={actionFeedback.title}
          >
            <span className="text-sm font-medium">{actionFeedback.message}</span>
          </NotificationBanner>
        )}

        {/* 上段: 3スロット進行パネル */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

        {/* 下段: 受付グループ一覧テーブル */}
        <Card className="p-6">
          {(() => {
            const rawActive = (queueState?.all_active_entries && queueState.all_active_entries.length > 0)
              ? queueState.all_active_entries
              : (queueState?.waiting_groups ?? []);

            // 進行中エントリーからは不在スキップ・対戦完了のグループを除外
            const activeList = rawActive.filter(
              (g) => g.status !== 'skipped' && g.status !== 'completed'
            );

            const historyList = (queueState?.all_history_entries && queueState.all_history_entries.length > 0)
              ? queueState.all_history_entries
              : (queueState?.all_active_entries ?? []);

            const displayGroups = viewMode === 'active' ? activeList : historyList;

            return (
              <>
                <div className="flex items-center justify-between border-b border-solid-gray-200 pb-3 mb-4 flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <Heading size="20" hasChip={true} className="font-bold text-solid-gray-900">
                      {viewMode === 'active' ? '進行中エントリー' : '全エントリー履歴'} ({displayGroups.length}組)
                    </Heading>
                    <span className="text-xs text-solid-gray-600">
                      (待機中: {queueState?.total_waiting_groups ?? 0}組 / {queueState?.total_waiting_players ?? 0}名)
                    </span>
                  </div>

                  {/* タブ切り替え ＆ CSVエクスポートボタン */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant={viewMode === 'active' ? 'solid-fill' : 'outline'}
                        onClick={() => setViewMode('active')}
                      >
                        進行中のみ ({activeList.length})
                      </Button>
                      <Button
                        size="sm"
                        variant={viewMode === 'history' ? 'solid-fill' : 'outline'}
                        onClick={() => {
                          setViewMode('history');
                          fetchStatus(true);
                        }}
                      >
                        全履歴 ({historyList.length})
                      </Button>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleExportCsv}
                      aria-disabled={!queueState || (historyList.length === 0 && activeList.length === 0)}
                    >
                      CSV出力
                    </Button>
                  </div>
                </div>

                {!queueState && isFetching ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-solid-gray-500">
                    <Spinner className="size-6 text-key-900" />
                    <span>エントリー状況を読込み中...</span>
                  </div>
                ) : displayGroups.length > 0 ? (
                  <div className="overflow-x-auto -mx-6 px-6 relative">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-black bg-solid-gray-100 text-solid-gray-900">
                          <th scope="col" className="py-3 px-4 font-bold text-start align-top">整理券</th>
                          <th scope="col" className="py-3 px-4 font-bold text-start align-top">チーム名</th>
                          <th scope="col" className="py-3 px-4 font-bold text-start align-top">代表者名</th>
                          <th scope="col" className="py-3 px-4 font-bold text-start align-top">人数</th>
                          <th scope="col" className="py-3 px-4 font-bold text-start align-top">希望形式</th>
                          <th scope="col" className="py-3 px-4 font-bold text-start align-top">現在状況</th>
                          <th scope="col" className="py-3 px-4 font-bold text-start align-top">受付時刻</th>
                          <th scope="col" className="py-3 px-4 font-bold text-right align-top">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayGroups.map((group) => {
                          let statusLabel = '待機中';
                          let badgeVariant: StatusBadgeVariant = 'gray';

                          if (group.status === 'in_match') {
                            statusLabel = '対戦中';
                            badgeVariant = 'key';
                          } else if (group.status === 'called') {
                            if (group.assigned_match_id === queueState?.next_match?.id) {
                              statusLabel = '呼出中 (Next)';
                              badgeVariant = 'key';
                            } else if (group.assigned_match_id === queueState?.next_next_match?.id) {
                              statusLabel = '次回呼出 (その次)';
                              badgeVariant = 'gray';
                            } else {
                              statusLabel = '枠割当済';
                              badgeVariant = 'gray';
                            }
                          } else if (group.status === 'completed') {
                            statusLabel = '対戦完了';
                            badgeVariant = 'success';
                          } else if (group.status === 'skipped') {
                            statusLabel = '不在スキップ';
                            badgeVariant = 'error';
                          }

                          return (
                            <tr key={group.id} className="border-b border-solid-gray-300 hover:bg-solid-gray-50 transition-colors">
                              <td className="py-3.5 px-4 font-bold text-key-900 align-middle">#{group.entry_number}</td>
                              <td className="py-3.5 px-4 font-bold text-solid-gray-900 align-middle">{group.team_name}</td>
                              <td className="py-3.5 px-4 text-solid-gray-700 align-middle">{group.leader_name}</td>
                              <td className="py-3.5 px-4 font-bold align-middle">{group.headcount}名</td>
                              <td className="py-3.5 px-4 align-middle">
                                <StatusBadge
                                  variant={group.preference === 'closed' ? 'gray' : 'key'}
                                  size="sm"
                                >
                                  {group.preference === 'closed' ? '貸切(8分)' : '合流(10分)'}
                                </StatusBadge>
                              </td>
                              <td className="py-3.5 px-4 align-middle">
                                <StatusBadge variant={badgeVariant} size="sm">
                                  {statusLabel}
                                </StatusBadge>
                              </td>
                              <td className="py-3.5 px-4 text-solid-gray-600 align-middle">
                                {new Date(group.created_at).toLocaleTimeString('ja-JP')}
                              </td>
                              <td className="py-3.5 px-4 text-right align-middle">
                                {(group.status === 'waiting' || group.status === 'called') && (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    className="text-error-1 border-error-1 hover:bg-error-50 hover:text-error-1"
                                    onClick={() => openSkipModal(group)}
                                    aria-disabled={actionLoading}
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
                  <div className="py-12 text-center text-xs text-solid-gray-500">
                    {isFetching ? (
                      <div className="flex items-center justify-center gap-2">
                        <Spinner className="size-4 text-key-900" />
                        <span>最新エントリー状況を確認中...</span>
                      </div>
                    ) : viewMode === 'active' ? (
                      '現在、進行中・待機中のグループはありません。'
                    ) : (
                      '過去のエントリー履歴はありません。'
                    )}
                  </div>
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
                不在スキップの確認
              </ModalDialogHeading>
              <ModalDialogClose onClick={closeSkipModal} />
            </ModalDialogHeader>
            <ModalDialogBody>
              <div className="space-y-3 text-sm text-solid-gray-800">
                <p>
                  以下のグループを<strong>不在としてスキップ（無効化）</strong>しますか？
                </p>
                {skipTarget && (
                  <div className="p-3 bg-solid-gray-50 border border-solid-gray-300 rounded-8 font-bold text-xs text-solid-gray-900">
                    #{skipTarget.entry_number} {skipTarget.team_name} (代表: {skipTarget.leader_name} / {skipTarget.headcount}名)
                  </div>
                )}
                <p className="text-xs text-solid-gray-600 leading-relaxed">
                  スキップされたグループは進行中キューから除外されます。
                  「2. 次の試合（呼出中）」で両チームに2名以上残っている場合は<strong>不足人数を運営スタッフが助っ人補充して試合枠を維持</strong>し、それ以外の場合は<strong>相方グループを待機キュー最優先に戻して後続グループと即座に再編成</strong>します。
                </p>
              </div>
            </ModalDialogBody>
            <ModalDialogActions className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeSkipModal} aria-disabled={actionLoading}>
                キャンセル
              </Button>
              <Button
                size="sm"
                variant="solid-fill"
                className="min-w-32 font-bold"
                onClick={handleConfirmSkip}
                aria-disabled={actionLoading}
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

        {/* 全リセット確認モーダルダイアログ (デジタル庁公式コンポーネント) */}
        <ModalDialog ref={resetDialogRef}>
          <ModalDialogContent className="max-w-md">
            <ModalDialogHeader>
              <ModalDialogHeading className="text-lg font-bold text-solid-gray-900">
                全データ初期化の確認
              </ModalDialogHeading>
              <ModalDialogClose onClick={closeResetModal} />
            </ModalDialogHeader>
            <ModalDialogBody>
              <div className="space-y-3 text-sm text-solid-gray-800">
                <p className="font-bold text-error-1">
                  本当にすべての試合スロットおよび待機エントリーを初期化（空にリセット）しますか？
                </p>
                <p className="text-xs text-solid-gray-600 leading-relaxed">
                  進行中の試合、呼出中・準備中の枠、待機キュー内のすべてのエントリー情報が削除されます。この操作は元に戻せません。
                </p>
              </div>
            </ModalDialogBody>
            <ModalDialogActions className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeResetModal} aria-disabled={actionLoading}>
                キャンセル
              </Button>
              <Button
                size="sm"
                variant="solid-fill"
                className="min-w-32 font-bold !bg-error-1 hover:!bg-red-800"
                onClick={handleConfirmReset}
                aria-disabled={actionLoading}
              >
                {actionLoading ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <Spinner className="size-3.5" /> 初期化中...
                  </span>
                ) : (
                  '初期化を実行する'
                )}
              </Button>
            </ModalDialogActions>
          </ModalDialogContent>
        </ModalDialog>
      </main>
    </div>
  );
}
