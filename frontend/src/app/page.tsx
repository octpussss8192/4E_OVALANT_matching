'use client';

import { useState, useEffect } from 'react';
import {
  Heading,
  Input,
  Radio,
  Button,
  Card,
  StatusBadge,
  EmergencyBanner,
  NotificationBanner,
  RequirementBadge,
  SupportText,
  Label,
} from '@/design-system';
import { useSessionId } from '@/hooks/useSessionId';
import { useWakeLock } from '@/hooks/useWakeLock';
import { createEntry, getEntryStatus, getQueueStatus } from '@/lib/api';
import type { EntryResponse, QueueStatusResponse, PreferenceType } from '@/types';

export default function ParticipantPage() {
  const sessionId = useSessionId();

  // フォーム状態
  const [leaderName, setLeaderName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [headcount, setHeadcount] = useState<number>(3);
  const [preference, setPreference] = useState<PreferenceType>('open');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 参加者ステータス & 全体状況
  const [myEntryInfo, setMyEntryInfo] = useState<EntryResponse | null>(null);
  const [queueState, setQueueState] = useState<QueueStatusResponse | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  // 4名以上選択時は自動的に Closed に切り替え（味方は身内・敵は他人ルール）
  useEffect(() => {
    if (headcount >= 4) {
      setPreference('closed');
    }
  }, [headcount]);

  // 呼出中なら画面スリープを防止
  const isCalled = myEntryInfo?.entry.status === 'called';
  useWakeLock(isCalled);

  // 定期ポーリングによる状態更新 (3秒毎)
  useEffect(() => {
    let timer: NodeJS.Timeout;

    const poll = async () => {
      try {
        const qStatus = await getQueueStatus();
        setQueueState(qStatus);
        setIsOffline(false);

        // 自エントリーが保存されていれば最新状態を追従
        const savedEntryId = localStorage.getItem('ovalant_my_entry_id');
        if (savedEntryId) {
          try {
            const entryData = await getEntryStatus(savedEntryId);
            setMyEntryInfo(entryData);
          } catch {
            localStorage.removeItem('ovalant_my_entry_id');
            setMyEntryInfo(null);
          }
        }
      } catch (err) {
        setIsOffline(true);
      }
    };

    poll();
    timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, []);

  // エントリー送信
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId) return;
    if (!leaderName.trim() || !teamName.trim()) {
      setErrorMessage('代表者名とチーム名を入力してください。');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await createEntry({
        session_id: sessionId,
        leader_name: leaderName,
        team_name: teamName,
        headcount,
        preference: headcount >= 4 ? 'closed' : preference,
      });
      setMyEntryInfo(res);
      localStorage.setItem('ovalant_my_entry_id', res.entry.id);
    } catch (err: any) {
      setErrorMessage(err.message || 'エントリーの送信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-solid-gray-50 pb-16">
      {/* ネットワーク切断時の緊急バナー */}
      {isOffline && (
        <div className="sticky top-0 z-50">
          <EmergencyBanner className="text-center font-bold">
            ⚠️ サーバーとの通信が切断されました。自動再接続中…
          </EmergencyBanner>
        </div>
      )}

      {/* ヘッダー */}
      <header className="bg-key-900 text-white py-4 px-6 shadow-md">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-wider">OVALANT</h1>
            <p className="text-xs text-solid-gray-300">3v3 赤外線シューティング マッチング</p>
          </div>
          <a
            href="/monitor"
            className="text-xs bg-key-1000 hover:bg-key-1100 text-white px-3 py-1.5 rounded-6 border border-key-700"
          >
            会場モニタ表示
          </a>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 mt-6">
        {/* サジェストTipsバナー */}
        {queueState && (
          <div className="mb-6">
            <NotificationBanner
              bannerStyle="standard"
              type="info1"
              title="リアルタイム案内"
            >
              <span className="text-sm">{queueState.suggestion_tip.message}</span>
            </NotificationBanner>
          </div>
        )}

        {/* 状態に応じた画面表示 */}
        {myEntryInfo ? (
          /* エントリー済: 待機または呼出中画面 */
          <div className="space-y-6">
            <Card
              variant={isCalled ? 'success' : 'default'}
              className={isCalled ? 'animate-pulse border-4' : ''}
            >
              <div className="text-center py-4">
                <div className="mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-solid-gray-600">
                    整理券番号
                  </span>
                  <div className="text-5xl font-black text-key-900 mt-1">
                    #{myEntryInfo.entry.entry_number}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-center">
                  {isCalled ? (
                    <span className="inline-block bg-emerald-600 text-white font-bold px-4 py-1.5 rounded-full text-lg shadow-sm">
                      📢 呼出中 (受付へお越しください)
                    </span>
                  ) : (
                    <StatusBadge className="bg-key-900 text-sm px-3 py-1">
                      {myEntryInfo.slot_name === 'next_next'
                        ? '次々回 試合枠 (準備待機)'
                        : myEntryInfo.slot_name === 'next'
                        ? '次回 試合枠 (まもなく呼出)'
                        : '待機中 (マッチング待ち)'}
                    </StatusBadge>
                  )}
                </div>

                {isCalled && (
                  <div className="mt-4 p-4 bg-emerald-100 rounded-8 border border-emerald-300 text-emerald-950 font-bold text-base leading-relaxed">
                    🔔 お待たせしました！受付スタッフへこの画面をお見せください。
                  </div>
                )}
              </div>

              <div className="border-t border-solid-gray-200 mt-4 pt-4 grid grid-cols-2 gap-4 text-center">
                <div className="bg-solid-gray-100 p-3 rounded-8">
                  <div className="text-xs text-solid-gray-600">前の待機組数</div>
                  <div className="text-2xl font-bold text-solid-gray-900 mt-0.5">
                    {myEntryInfo.ahead_groups_count}
                    <span className="text-xs font-normal ml-1">組</span>
                  </div>
                </div>
                <div className="bg-solid-gray-100 p-3 rounded-8">
                  <div className="text-xs text-solid-gray-600">予想待ち時間</div>
                  <div className="text-2xl font-bold text-solid-gray-900 mt-0.5">
                    約 {myEntryInfo.estimated_wait_minutes}
                    <span className="text-xs font-normal ml-1">分</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 text-xs text-solid-gray-600 border-t border-solid-gray-200 pt-3 flex justify-between">
                <span>チーム名: <strong>{myEntryInfo.entry.team_name}</strong></span>
                <span>人数: <strong>{myEntryInfo.entry.headcount}名</strong></span>
                <span>モード: <strong>{myEntryInfo.entry.preference === 'closed' ? '貸切(8分)' : '合流(10分)'}</strong></span>
              </div>
            </Card>

            <div className="bg-white p-4 rounded-8 border border-solid-gray-200 text-xs text-solid-gray-600 space-y-1">
              <p className="font-semibold text-solid-gray-800">⚠️ ご案内と注意事項</p>
              <p>・呼出時に受付におられない場合、不在スキップとなり再エントリーが必要になります。</p>
              <p>・「呼出中」の画面は消灯しないよう画面ロック防止機能が働きます。</p>
            </div>
          </div>
        ) : (
          /* 未エントリー: 受付フォーム */
          <Card className="bg-white shadow-sm">
            <Heading size="20" hasChip={true} className="mb-4 pb-2 border-b border-solid-gray-200 font-bold">
              マッチングエントリー登録
            </Heading>

            {errorMessage && (
              <div className="mb-4 p-3 bg-red-50 border border-red-300 text-red-800 text-xs rounded-6">
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* 代表者名 */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Label htmlFor="leader-name" className="text-sm font-bold">代表者氏名</Label>
                  <RequirementBadge>※必須</RequirementBadge>
                </div>
                <Input
                  id="leader-name"
                  value={leaderName}
                  onChange={(e) => setLeaderName(e.target.value)}
                  required
                  className="w-full"
                />
                <SupportText className="text-xs text-solid-gray-500 mt-1">受付呼出時にお呼びする氏名です</SupportText>
              </div>

              {/* チーム名 */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Label htmlFor="team-name" className="text-sm font-bold">チーム名</Label>
                  <RequirementBadge>※必須</RequirementBadge>
                </div>
                <Input
                  id="team-name"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  required
                  className="w-full"
                />
                <SupportText className="text-xs text-solid-gray-500 mt-1">モニタに表示されるチーム名です</SupportText>
              </div>

              {/* 人数選択 */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Label className="text-sm font-bold">参加人数 (1〜6名)</Label>
                  <RequirementBadge>※必須</RequirementBadge>
                </div>
                <div className="grid grid-cols-6 gap-2">
                  {[1, 2, 3, 4, 5, 6].map((num) => (
                    <label
                      key={num}
                      className={`flex flex-col items-center justify-center p-2 rounded-8 border cursor-pointer min-h-touch text-center transition-all ${
                        headcount === num
                          ? 'bg-key-50 border-key-900 font-bold text-key-900 ring-2 ring-key-900'
                          : 'border-solid-gray-300 hover:border-solid-gray-500'
                      }`}
                    >
                      <input
                        type="radio"
                        name="headcount"
                        value={num}
                        checked={headcount === num}
                        onChange={() => setHeadcount(num)}
                        className="sr-only"
                      />
                      <span className="text-base">{num}</span>
                      <span className="text-[10px] text-solid-gray-500">名</span>
                    </label>
                  ))}
                </div>
                <SupportText className="text-xs text-solid-gray-600 mt-1">
                  ※ 4名以上のグループは友人が敵味方に分断されるのを防ぐため自動的に「貸切・身内戦」となります。
                </SupportText>
              </div>

              {/* マッチング希望形式 */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Label className="text-sm font-bold">マッチング希望</Label>
                  <RequirementBadge>※必須</RequirementBadge>
                </div>
                <div className="space-y-2">
                  <label
                    className={`block p-3 rounded-8 border cursor-pointer min-h-touch ${
                      preference === 'open' && headcount <= 3
                        ? 'bg-key-50 border-key-900 ring-2 ring-key-900'
                        : headcount >= 4
                        ? 'opacity-40 cursor-not-allowed bg-solid-gray-100 border-solid-gray-200'
                        : 'border-solid-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Radio
                        name="preference"
                        value="open"
                        checked={preference === 'open' && headcount <= 3}
                        onChange={() => setPreference('open')}
                        disabled={headcount >= 4}
                      />
                      <span className="font-bold text-sm text-solid-gray-900">他グループと合流対戦 (Open)</span>
                    </div>
                    <p className="text-xs text-solid-gray-600 mt-1 pl-7">
                      他の来場者と3vs3でマッチング。試合時間 10分。マッチングが早くなる可能性があります。
                    </p>
                  </label>

                  <label
                    className={`block p-3 rounded-8 border cursor-pointer min-h-touch ${
                      preference === 'closed'
                        ? 'bg-key-50 border-key-900 ring-2 ring-key-900'
                        : 'border-solid-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Radio
                        name="preference"
                        value="closed"
                        checked={preference === 'closed'}
                        onChange={() => setPreference('closed')}
                      />
                      <span className="font-bold text-sm text-solid-gray-900">自分たちだけで貸切・身内戦 (Closed)</span>
                    </div>
                    <p className="text-xs text-solid-gray-600 mt-1 pl-7">
                      他のグループと混ざらず対戦。試合時間 8分（少し短縮枠となります）。
                    </p>
                  </label>
                </div>
              </div>

              {/* 送信ボタン */}
              <div className="pt-2">
                <Button
                  type="submit"
                  size="lg"
                  variant="solid-fill"
                  className="w-full justify-center min-h-touch text-base"
                  disabled={submitting}
                >
                  {submitting ? 'エントリー送信中…' : 'エントリーを確定する'}
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </main>
  );
}
