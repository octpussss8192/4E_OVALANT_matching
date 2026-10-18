'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Card,
  Heading,
  Button,
  StatusBadge,
  ModalDialog,
  ModalDialogContent,
  ModalDialogHeader,
  ModalDialogHeading,
  ModalDialogClose,
  ModalDialogBody,
  ModalDialogActions,
} from '@/design-system';
import { getQueueStatus, advanceMatch, skipEntry, resetSystem, createEntry } from '@/lib/api';
import type { QueueStatusResponse, Match, EntryGroup } from '@/types';

export default function AdminPage() {
  const [queueState, setQueueState] = useState<QueueStatusResponse | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionLoadingText, setActionLoadingText] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  // スキップ確認モーダル用状態
  const [skipTarget, setSkipTarget] = useState<EntryGroup | null>(null);
  const skipDialogRef = useRef<HTMLDialogElement>(null);

  const fetchStatus = async (showIndicator = false) => {
    if (showIndicator) setIsFetching(true);
    try {
      const data = await getQueueStatus();
      setQueueState(data);
      const now = new Date();
      setLastUpdated(now.toLocaleTimeString('ja-JP'));
    } catch (err) {
      console.error('Failed to fetch admin status:', err);
    } finally {
      if (showIndicator) setIsFetching(false);
    }
  };

  useEffect(() => {
    fetchStatus(true);
    const timer = setInterval(() => {
      fetchStatus(false);
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // 試合進行操作 (Advance)
  const handleAdvance = async (matchId: string) => {
    setActionLoading(true);
    setActionLoadingText('試合進行・繰り上げ処理中...');
    try {
      await advanceMatch(matchId);
      await fetchStatus(true);
    } catch (err: any) {
      alert(err.message || '試合進行に失敗しました');
    } finally {
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
    setActionLoading(true);
    setActionLoadingText(`不在スキップ処理中 (#${skipTarget.entry_number} ${skipTarget.team_name})...`);
    try {
      await skipEntry(skipTarget.id, '受付呼出時不在のため運営がスキップ');
      closeSkipModal();
      await fetchStatus(true);
    } catch (err: any) {
      alert(err.message || 'スキップに失敗しました');
    } finally {
      setActionLoading(false);
      setActionLoadingText(null);
    }
  };

  // デバッグ用: サンプルグループの自動投入
  const handleAddSampleGroups = async () => {
    setActionLoading(true);
    setActionLoadingText('テストデータ4組を一括投入中...');
    try {
      await createEntry({
        session_id: `test-${Date.now()}-1`,
        leader_name: '田中太郎',
        team_name: 'Alpha 3名組',
        headcount: 3,
        preference: 'open',
      });
      await createEntry({
        session_id: `test-${Date.now()}-2`,
        leader_name: '佐藤花子',
        team_name: 'Bravo 2名組',
        headcount: 2,
        preference: 'open',
      });
      await createEntry({
        session_id: `test-${Date.now()}-3`,
        leader_name: '鈴木一郎',
        team_name: 'ソロCharlie',
        headcount: 1,
        preference: 'open',
      });
      await createEntry({
        session_id: `test-${Date.now()}-4`,
        leader_name: '高橋健太',
        team_name: '貸切Delta',
        headcount: 4,
        preference: 'closed',
      });
      await fetchStatus(true);
    } catch (err: any) {
      alert(err.message || 'テストデータの投入に失敗しました');
    } finally {
      setActionLoading(false);
      setActionLoadingText(null);
    }
  };

  // 全リセット
  const handleReset = async () => {
    if (!confirm('本当にすべての試合と待機エントリーをリセットしますか？')) return;
    setActionLoading(true);
    setActionLoadingText('全データをリセット中...');
    try {
      await resetSystem();
      await fetchStatus(true);
    } finally {
      setActionLoading(false);
      setActionLoadingText(null);
    }
  };

  const [activeTab, setActiveTab] = useState<'waiting' | 'skipped' | 'all'>('waiting');

  const allEntries = queueState?.all_entries || [];
  const waitingEntries = allEntries.filter((e) => e.status === 'waiting');
  const skippedEntries = allEntries.filter((e) => e.status === 'skipped');
  const calledCount = allEntries.filter((e) => e.status === 'called').length;
  const inMatchCount = allEntries.filter((e) => e.status === 'in_match').length;
  const completedCount = allEntries.filter((e) => e.status === 'completed').length;

  const renderSlotManagement = (
    match: Match | null,
    slotTitle: string,
    actionButtonText: string,
    actionColorClass: string
  ) => {
    return (
      <Card className={`relative flex flex-col justify-between bg-white shadow-sm border border-solid-gray-300 transition-all duration-200 ${actionLoading ? 'opacity-80' : ''}`}>
        {actionLoading && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center z-10 rounded-12">
            <div className="flex items-center gap-2 bg-solid-gray-900 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
              <span className="animate-spin inline-block">🔄</span>
              <span>同期処理中...</span>
            </div>
          </div>
        )}
        <div>
          <div className="flex items-center justify-between border-b pb-2 mb-3">
            <span className="font-bold text-sm text-solid-gray-800">{slotTitle}</span>
            {match && (
              <span className="text-xs bg-key-50 text-key-900 border border-key-300 px-2 py-0.5 rounded-4 font-bold">
                Match #{match.match_number} ({match.is_closed_match ? '貸切8分' : '通常10分'})
              </span>
            )}
          </div>

          {match ? (
            <div className="space-y-3">
              <div className="space-y-2">
                {match.assigned_groups.map((group) => (
                  <div
                    key={group.id}
                    className="flex items-center justify-between p-2.5 bg-solid-gray-50 rounded-6 border text-xs"
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
                      className="border-red-600 text-red-600 hover:bg-red-50"
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
            <div className="py-8 text-center text-xs text-solid-gray-400">
              {actionLoading ? '更新中...' : '枠は現在空いています'}
            </div>
          )}
        </div>

        {match && (
          <div className="pt-4 mt-3 border-t">
            <Button
              size="md"
              variant="solid-fill"
              className={`w-full justify-center text-sm font-bold ${actionColorClass}`}
              onClick={() => handleAdvance(match.id)}
              disabled={actionLoading}
            >
              {actionLoading ? '処理中...' : actionButtonText}
            </Button>
          </div>
        )}
      </Card>
    );
  };

  return (
    <main className="min-h-screen bg-solid-gray-100 p-6 flex flex-col">
      {/* スタッフ管理ヘッダー */}
      <header className="flex flex-col md:flex-row md:items-center justify-between bg-solid-gray-900 text-white px-6 py-4 rounded-12 shadow mb-4 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-wider">OVALANT 運営ダッシュボード (iPad)</h1>
            {/* リアルタイム同期インジケーター */}
            <div className="flex items-center gap-1.5 bg-solid-gray-800 border border-solid-gray-700 px-2.5 py-1 rounded-full text-[11px]">
              <span className={`inline-block size-2 rounded-full ${isFetching ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
              <span className="text-solid-gray-300">
                {isFetching ? '同期中...' : 'リアルタイム同期 (2s)'}
              </span>
              {lastUpdated && (
                <span className="text-solid-gray-400 ml-1">({lastUpdated})</span>
              )}
            </div>
          </div>
          <p className="text-xs text-solid-gray-400 mt-0.5">受付呼出・試合進行・不在スキップ管理</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 手動リフレッシュボタン */}
          <Button
            size="sm"
            variant="outline"
            className="text-xs bg-solid-gray-800 text-white border-solid-gray-600 hover:bg-solid-gray-700"
            onClick={() => fetchStatus(true)}
            disabled={actionLoading || isFetching}
          >
            <span className={isFetching ? 'animate-spin inline-block mr-1' : 'inline-block mr-1'}>🔄</span>
            手動更新
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs bg-white text-solid-gray-900"
            onClick={handleAddSampleGroups}
            disabled={actionLoading}
          >
            + テスト組投入
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs border-red-500 text-red-400 hover:bg-red-950"
            onClick={handleReset}
            disabled={actionLoading}
          >
            全リセット
          </Button>
          <a
            href="/monitor"
            target="_blank"
            className="text-xs bg-key-700 hover:bg-key-800 text-white font-bold px-3 py-2 rounded-6 inline-flex items-center"
          >
            会場モニタ別窓 ↗
          </a>
        </div>
      </header>

      {/* デバッグ・状態可視化メトリクスバー */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 mb-4">
        <div className="bg-white border border-solid-gray-300 rounded-8 p-2.5 text-center shadow-xs">
          <div className="text-[10px] text-solid-gray-500 font-semibold">登録総数</div>
          <div className="text-base font-black text-solid-gray-900">{allEntries.length} <span className="text-xs font-normal">組</span></div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-8 p-2.5 text-center shadow-xs">
          <div className="text-[10px] text-blue-700 font-semibold">待機キュー (Waiting)</div>
          <div className="text-base font-black text-blue-900">{waitingEntries.length} <span className="text-xs font-normal">組</span></div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-8 p-2.5 text-center shadow-xs">
          <div className="text-[10px] text-amber-700 font-semibold">呼出・準備 (Called)</div>
          <div className="text-base font-black text-amber-900">{calledCount} <span className="text-xs font-normal">組</span></div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-8 p-2.5 text-center shadow-xs">
          <div className="text-[10px] text-emerald-700 font-semibold">対戦中 (In Match)</div>
          <div className="text-base font-black text-emerald-900">{inMatchCount} <span className="text-xs font-normal">組</span></div>
        </div>
        <div className="bg-solid-gray-100 border border-solid-gray-300 rounded-8 p-2.5 text-center shadow-xs">
          <div className="text-[10px] text-solid-gray-600 font-semibold">対戦終了 (Completed)</div>
          <div className="text-base font-black text-solid-gray-700">{completedCount} <span className="text-xs font-normal">組</span></div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-8 p-2.5 text-center shadow-xs">
          <div className="text-[10px] text-red-700 font-semibold">スキップ済 (Skipped)</div>
          <div className="text-base font-black text-red-900">{skippedEntries.length} <span className="text-xs font-normal">組</span></div>
        </div>
      </div>

      {/* アクション実行中の通知バー */}
      {actionLoading && (
        <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-900 px-4 py-2.5 rounded-8 flex items-center justify-between text-xs font-bold shadow-sm animate-pulse">
          <div className="flex items-center gap-2">
            <span className="animate-spin inline-block text-base">⏳</span>
            <span>{actionLoadingText || 'サーバーと同期中... しばらくお待ちください'}</span>
          </div>
          <span className="text-[11px] text-blue-700 font-normal">自動的に画面へ反映されます</span>
        </div>
      )}

      {/* 上段: 3スロット進行パネル */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {renderSlotManagement(
          queueState?.current_match ?? null,
          '1. 現在対戦中',
          '試合終了 (スロットを空けて繰り上げ)',
          'bg-emerald-700 hover:bg-emerald-800'
        )}
        {renderSlotManagement(
          queueState?.next_match ?? null,
          '2. 次の試合',
          '案内完了 (対戦中へ昇格)',
          'bg-key-900 hover:bg-key-1000'
        )}
        {renderSlotManagement(
          queueState?.next_next_match ?? null,
          '3. その次の試合',
          '呼出開始 (Nextへ昇格)',
          'bg-amber-700 hover:bg-amber-800'
        )}
      </div>

      {/* 下段: キュー・ログ一覧テーブル（タブ切替対応） */}
      <Card className="flex-1 bg-white shadow-sm border border-solid-gray-300">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b pb-3 mb-4 gap-2">
          {/* タブ切り替えボタン */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('waiting')}
              className={`px-3 py-1.5 rounded-6 text-xs font-bold transition-colors ${
                activeTab === 'waiting'
                  ? 'bg-blue-600 text-white'
                  : 'bg-solid-gray-100 text-solid-gray-700 hover:bg-solid-gray-200'
              }`}
            >
              ⏳ 待機キュー ({waitingEntries.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('skipped')}
              className={`px-3 py-1.5 rounded-6 text-xs font-bold transition-colors ${
                activeTab === 'skipped'
                  ? 'bg-red-600 text-white'
                  : 'bg-solid-gray-100 text-solid-gray-700 hover:bg-solid-gray-200'
              }`}
            >
              ⏭️ スキップ済 ({skippedEntries.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-6 text-xs font-bold transition-colors ${
                activeTab === 'all'
                  ? 'bg-solid-gray-800 text-white'
                  : 'bg-solid-gray-100 text-solid-gray-700 hover:bg-solid-gray-200'
              }`}
            >
              📋 全履歴 ({allEntries.length})
            </button>
          </div>

          <span className="text-xs text-solid-gray-500">
            💡 サジェスト: {queueState?.suggestion_tip.message}
          </span>
        </div>

        {/* タブ別テーブル表示 */}
        {activeTab === 'waiting' && (
          waitingEntries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b bg-solid-gray-100 text-solid-gray-700">
                    <th className="py-2.5 px-3 font-semibold">整理券</th>
                    <th className="py-2.5 px-3 font-semibold">チーム名</th>
                    <th className="py-2.5 px-3 font-semibold">代表者名</th>
                    <th className="py-2.5 px-3 font-semibold">人数</th>
                    <th className="py-2.5 px-3 font-semibold">希望</th>
                    <th className="py-2.5 px-3 font-semibold">受付時刻</th>
                    <th className="py-2.5 px-3 font-semibold text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-solid-gray-200">
                  {waitingEntries.map((group) => (
                    <tr key={group.id} className="hover:bg-solid-gray-50">
                      <td className="py-2.5 px-3 font-bold text-key-900">#{group.entry_number}</td>
                      <td className="py-2.5 px-3 font-bold text-solid-gray-900">{group.team_name}</td>
                      <td className="py-2.5 px-3 text-solid-gray-600">{group.leader_name}</td>
                      <td className="py-2.5 px-3 font-bold">{group.headcount}名</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-4 text-[10px] font-bold ${
                            group.preference === 'closed'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {group.preference === 'closed' ? '貸切(8分)' : '合流(10分)'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-solid-gray-500">
                        {new Date(group.created_at).toLocaleTimeString('ja-JP')}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Button
                          size="xs"
                          variant="outline"
                          className="border-red-600 text-red-600 hover:bg-red-50"
                          onClick={() => openSkipModal(group)}
                          disabled={actionLoading}
                        >
                          不在スキップ
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-solid-gray-400">現在、待機中のグループはありません。</div>
          )
        )}

        {activeTab === 'skipped' && (
          skippedEntries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b bg-red-50 text-red-900">
                    <th className="py-2.5 px-3 font-semibold">整理券</th>
                    <th className="py-2.5 px-3 font-semibold">チーム名</th>
                    <th className="py-2.5 px-3 font-semibold">代表者名</th>
                    <th className="py-2.5 px-3 font-semibold">人数</th>
                    <th className="py-2.5 px-3 font-semibold">スキップ理由</th>
                    <th className="py-2.5 px-3 font-semibold">スキップ時刻</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-solid-gray-200">
                  {skippedEntries.map((group) => (
                    <tr key={group.id} className="hover:bg-red-50/30">
                      <td className="py-2.5 px-3 font-bold text-red-900">#{group.entry_number}</td>
                      <td className="py-2.5 px-3 font-bold text-solid-gray-900 line-through">{group.team_name}</td>
                      <td className="py-2.5 px-3 text-solid-gray-600">{group.leader_name}</td>
                      <td className="py-2.5 px-3 font-bold">{group.headcount}名</td>
                      <td className="py-2.5 px-3 text-red-700">{group.skip_reason || '不在のためスキップ'}</td>
                      <td className="py-2.5 px-3 text-solid-gray-500">
                        {new Date(group.updated_at).toLocaleTimeString('ja-JP')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-solid-gray-400">スキップされたグループはありません。</div>
          )
        )}

        {activeTab === 'all' && (
          allEntries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b bg-solid-gray-100 text-solid-gray-700">
                    <th className="py-2.5 px-3 font-semibold">整理券</th>
                    <th className="py-2.5 px-3 font-semibold">チーム名</th>
                    <th className="py-2.5 px-3 font-semibold">代表者名</th>
                    <th className="py-2.5 px-3 font-semibold">人数</th>
                    <th className="py-2.5 px-3 font-semibold">ステータス</th>
                    <th className="py-2.5 px-3 font-semibold">受付時刻</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-solid-gray-200">
                  {allEntries.map((group) => (
                    <tr key={group.id} className="hover:bg-solid-gray-50">
                      <td className="py-2.5 px-3 font-bold text-key-900">#{group.entry_number}</td>
                      <td className="py-2.5 px-3 font-bold text-solid-gray-900">{group.team_name}</td>
                      <td className="py-2.5 px-3 text-solid-gray-600">{group.leader_name}</td>
                      <td className="py-2.5 px-3 font-bold">{group.headcount}名</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-4 text-[10px] font-bold ${
                            group.status === 'waiting'
                              ? 'bg-blue-100 text-blue-800'
                              : group.status === 'called'
                              ? 'bg-amber-100 text-amber-800'
                              : group.status === 'in_match'
                              ? 'bg-emerald-100 text-emerald-800'
                              : group.status === 'completed'
                              ? 'bg-solid-gray-200 text-solid-gray-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {group.status === 'waiting'
                            ? '待機中'
                            : group.status === 'called'
                            ? '呼出中'
                            : group.status === 'in_match'
                            ? '対戦中'
                            : group.status === 'completed'
                            ? '完了'
                            : 'スキップ'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-solid-gray-500">
                        {new Date(group.created_at).toLocaleTimeString('ja-JP')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-solid-gray-400">エントリー履歴はありません。</div>
          )
        )}
      </Card>

      {/* 不在スキップ確認モーダルダイアログ (デジタル庁公式コンポーネント) */}
      <ModalDialog ref={skipDialogRef}>
        <ModalDialogContent className="max-w-md">
          <ModalDialogHeader>
            <ModalDialogHeading className="text-lg font-bold text-red-600">
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
                <div className="p-3 bg-red-50 border border-red-200 rounded-8 my-2 font-bold text-xs text-red-900">
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
            <Button size="sm" variant="outline" onClick={closeSkipModal}>
              キャンセル
            </Button>
            <Button
              size="sm"
              variant="solid-fill"
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleConfirmSkip}
              disabled={actionLoading}
            >
              スキップを実行する
            </Button>
          </ModalDialogActions>
        </ModalDialogContent>
      </ModalDialog>
    </main>
  );
}
