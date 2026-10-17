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

  // スキップ確認モーダル用状態
  const [skipTarget, setSkipTarget] = useState<EntryGroup | null>(null);
  const skipDialogRef = useRef<HTMLDialogElement>(null);

  const fetchStatus = async () => {
    try {
      const data = await getQueueStatus();
      setQueueState(data);
    } catch (err) {
      console.error('Failed to fetch admin status:', err);
    }
  };

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 2000);
    return () => clearInterval(timer);
  }, []);

  // 試合進行操作 (Advance)
  const handleAdvance = async (matchId: string) => {
    setActionLoading(true);
    try {
      await advanceMatch(matchId);
      await fetchStatus();
    } catch (err: any) {
      alert(err.message || '試合進行に失敗しました');
    } finally {
      setActionLoading(false);
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
    try {
      await skipEntry(skipTarget.id, '受付呼出時不在のため運営がスキップ');
      closeSkipModal();
      await fetchStatus();
    } catch (err: any) {
      alert(err.message || 'スキップに失敗しました');
    } finally {
      setActionLoading(false);
    }
  };

  // デバッグ用: サンプルグループの自動投入
  const handleAddSampleGroups = async () => {
    setActionLoading(true);
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
      await fetchStatus();
    } catch (err: any) {
      alert(err.message || 'テストデータの投入に失敗しました');
    } finally {
      setActionLoading(false);
    }
  };

  // 全リセット
  const handleReset = async () => {
    if (!confirm('本当にすべての試合と待機エントリーをリセットしますか？')) return;
    setActionLoading(true);
    try {
      await resetSystem();
      await fetchStatus();
    } finally {
      setActionLoading(false);
    }
  };

  const renderSlotManagement = (
    match: Match | null,
    slotTitle: string,
    actionButtonText: string,
    actionColorClass: string
  ) => {
    return (
      <Card className="flex flex-col justify-between bg-white shadow-sm border border-solid-gray-300">
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
            <div className="py-8 text-center text-xs text-solid-gray-400">枠は現在空いています</div>
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
              {actionButtonText}
            </Button>
          </div>
        )}
      </Card>
    );
  };

  return (
    <main className="min-h-screen bg-solid-gray-100 p-6 flex flex-col">
      {/* スタッフ管理ヘッダー */}
      <header className="flex items-center justify-between bg-solid-gray-900 text-white px-6 py-4 rounded-12 shadow mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-wider">OVALANT 運営ダッシュボード (iPad)</h1>
          <p className="text-xs text-solid-gray-400">受付呼出・試合進行・不在スキップ管理</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="text-xs bg-white"
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
            className="text-xs bg-key-700 hover:bg-key-800 text-white font-bold px-3 py-2 rounded-6"
          >
            会場モニタ別窓
          </a>
        </div>
      </header>

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

      {/* 下段: 待機キュー一覧テーブル */}
      <Card className="flex-1 bg-white shadow-sm border border-solid-gray-300">
        <div className="flex items-center justify-between border-b pb-3 mb-4">
          <Heading size="20" hasChip={true} className="font-bold text-solid-gray-900">
            待機キュー一覧 ({queueState?.total_waiting_groups ?? 0}組 / {queueState?.total_waiting_players ?? 0}名)
          </Heading>
          <span className="text-xs text-solid-gray-500">
            💡 サジェスト: {queueState?.suggestion_tip.message}
          </span>
        </div>

        {queueState && queueState.waiting_groups.length > 0 ? (
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
                {queueState.waiting_groups.map((group, idx) => (
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
