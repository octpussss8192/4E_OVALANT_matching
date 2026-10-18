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
  StepNavigation,
  StepNavigationList,
  StepNavigationStep,
  StepNavigationStepHeader,
  StepNavigationNumber,
  StepNavigationTitle,
} from '@/design-system';
import { useSessionId } from '@/hooks/useSessionId';
import { useWakeLock } from '@/hooks/useWakeLock';
import { createEntry, getEntryStatus, getQueueStatus } from '@/lib/api';
import { subscribeToMatchUpdates } from '@/lib/supabase';
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

  // リアルタイム反映 + 定期ポーリング (3秒毎)
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
    const unsubscribe = subscribeToMatchUpdates(() => {
      poll();
    });

    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  // エントリー送信
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId) return;
    if (!leaderName.trim() || !teamName.trim()) {
      setErrorMessage('代表者氏名とチーム名を入力してください。');
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
    <main className="min-h-screen bg-solid-gray-50 pb-16 text-solid-gray-900">
      {/* ネットワーク切断時の緊急バナー (デジタル庁 EmergencyBanner) */}
      {isOffline && (
        <div className="sticky top-0 z-50">
          <EmergencyBanner className="text-center font-bold">
            ⚠️ サーバーとの通信が切断されました。自動再接続中…
          </EmergencyBanner>
        </div>
      )}

      {/* ヘッダー (デジタル庁デザインシステム準拠) */}
      <header className="bg-white border-b border-solid-gray-300 py-4 px-6">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-1.5 h-6 bg-key-900 rounded-full inline-block shrink-0" aria-hidden="true" />
            <div>
              <Heading size="20" className="font-bold text-solid-gray-900 leading-tight">
                OVALANT
              </Heading>
              <p className="text-xs text-solid-gray-600">3v3 赤外線シューティング マッチング</p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <a href="/monitor">
              会場モニタ表示
            </a>
          </Button>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 mt-6 space-y-6">
        {/* サジェストTipsバナー (デジタル庁 NotificationBanner) */}
        {queueState && (
          <NotificationBanner
            bannerStyle="standard"
            type="info1"
            title="リアルタイム案内"
          >
            <span className="text-sm">{queueState.suggestion_tip.message}</span>
          </NotificationBanner>
        )}

        {/* 状態に応じた画面表示 */}
        {myEntryInfo ? (
          /* エントリー済: 待機または呼出中画面 */
          <div className="space-y-6">
            {/* StepNavigation による進行状況ステップ表示 (デジタル庁公式コンポーネント) */}
            <div className="bg-white p-4 rounded-8 border border-solid-gray-300">
              <StepNavigation orientation="horizontal" size="small">
                <StepNavigationList>
                  <StepNavigationStep state="completed" first>
                    <StepNavigationStepHeader>
                      <StepNavigationNumber>1</StepNavigationNumber>
                      <StepNavigationTitle>受付完了</StepNavigationTitle>
                    </StepNavigationStepHeader>
                  </StepNavigationStep>
                  <StepNavigationStep
                    state={isCalled ? 'completed' : 'reached'}
                    aria-current={!isCalled ? 'step' : undefined}
                  >
                    <StepNavigationStepHeader>
                      <StepNavigationNumber>2</StepNavigationNumber>
                      <StepNavigationTitle>待機中</StepNavigationTitle>
                    </StepNavigationStepHeader>
                  </StepNavigationStep>
                  <StepNavigationStep
                    state={isCalled ? 'reached' : undefined}
                    aria-current={isCalled ? 'step' : undefined}
                  >
                    <StepNavigationStepHeader>
                      <StepNavigationNumber>3</StepNavigationNumber>
                      <StepNavigationTitle>受付呼出</StepNavigationTitle>
                    </StepNavigationStepHeader>
                  </StepNavigationStep>
                  <StepNavigationStep last>
                    <StepNavigationStepHeader>
                      <StepNavigationNumber>4</StepNavigationNumber>
                      <StepNavigationTitle>対戦</StepNavigationTitle>
                    </StepNavigationStepHeader>
                  </StepNavigationStep>
                </StepNavigationList>
              </StepNavigation>
            </div>

            <Card
              variant={isCalled ? 'key' : 'default'}
              className={isCalled ? 'border-2 border-key-900' : ''}
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
                    <StatusBadge variant="key" size="md">
                      📢 呼出中 (受付へお越しください)
                    </StatusBadge>
                  ) : (
                    <StatusBadge variant="gray" size="md">
                      {myEntryInfo.slot_name === 'next_next'
                        ? '次々回 試合枠 (準備待機)'
                        : myEntryInfo.slot_name === 'next'
                        ? '次回 試合枠 (まもなく呼出)'
                        : '待機中 (マッチング待ち)'}
                    </StatusBadge>
                  )}
                </div>

                {isCalled && (
                  <div className="mt-5 text-left">
                    <NotificationBanner
                      bannerStyle="color-chip"
                      type="info1"
                      title="受付呼出中"
                    >
                      <span className="font-bold text-sm">
                        お待たせしました！受付スタッフへこの画面をお見せください。
                      </span>
                    </NotificationBanner>
                  </div>
                )}
              </div>

              {/* 定義リスト（dl/dt/dd）によるクリーンな情報表示（余計なグレータイルネストを解消） */}
              <dl className="border-t border-solid-gray-200 mt-4 pt-4 grid grid-cols-2 gap-4 text-center">
                <div className="py-2">
                  <dt className="text-xs text-solid-gray-600">前の待機組数</dt>
                  <dd className="text-3xl font-bold text-solid-gray-900 mt-1">
                    {myEntryInfo.ahead_groups_count}
                    <span className="text-sm font-normal ml-1">組</span>
                  </dd>
                </div>
                <div className="py-2 border-l border-solid-gray-200">
                  <dt className="text-xs text-solid-gray-600">予想待ち時間</dt>
                  <dd className="text-3xl font-bold text-solid-gray-900 mt-1">
                    約 {myEntryInfo.estimated_wait_minutes}
                    <span className="text-sm font-normal ml-1">分</span>
                  </dd>
                </div>
              </dl>

              <dl className="mt-4 text-xs text-solid-gray-600 border-t border-solid-gray-200 pt-3 flex justify-between">
                <div>
                  <dt className="inline text-solid-gray-600">チーム名: </dt>
                  <dd className="inline font-bold text-solid-gray-900">{myEntryInfo.entry.team_name}</dd>
                </div>
                <div>
                  <dt className="inline text-solid-gray-600">人数: </dt>
                  <dd className="inline font-bold text-solid-gray-900">{myEntryInfo.entry.headcount}名</dd>
                </div>
                <div>
                  <dt className="inline text-solid-gray-600">モード: </dt>
                  <dd className="inline font-bold text-solid-gray-900">
                    {myEntryInfo.entry.preference === 'closed' ? '貸切(8分)' : '合流(10分)'}
                  </dd>
                </div>
              </dl>
            </Card>

            <NotificationBanner
              bannerStyle="color-chip"
              type="info2"
              title="ご案内と注意事項"
            >
              <ul className="list-disc pl-4 space-y-1 text-xs text-solid-gray-700">
                <li>呼出時に受付におられない場合、不在スキップとなり再エントリーが必要になります。</li>
                <li>「呼出中」の画面は消灯しないよう画面ロック防止機能が働きます。</li>
              </ul>
            </NotificationBanner>
          </div>
        ) : (
          /* 未エントリー: 受付フォーム */
          <Card>
            <Heading size="20" hasChip={true} className="mb-4 pb-2 border-b border-solid-gray-200 font-bold">
              マッチングエントリー登録
            </Heading>

            {errorMessage && (
              <div className="mb-4">
                <NotificationBanner
                  bannerStyle="standard"
                  type="error"
                  title="入力エラー"
                >
                  <span className="text-sm">{errorMessage}</span>
                </NotificationBanner>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* 代表者氏名 */}
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
                <SupportText className="text-xs text-solid-gray-600 mt-1">
                  受付呼出時にお呼びする氏名です
                </SupportText>
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
                <SupportText className="text-xs text-solid-gray-600 mt-1">
                  会場モニタに表示されるチーム名です
                </SupportText>
              </div>

              {/* 人数選択 */}
              <fieldset>
                <div className="flex items-center gap-2 mb-2">
                  <legend className="text-sm font-bold text-solid-gray-900">参加人数 (1〜6名)</legend>
                  <RequirementBadge>※必須</RequirementBadge>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[1, 2, 3, 4, 5, 6].map((num) => (
                    <div
                      key={num}
                      className="border border-solid-gray-300 rounded-8 p-2 flex items-center justify-center min-h-touch bg-white"
                    >
                      <Radio
                        name="headcount"
                        value={num}
                        checked={headcount === num}
                        onChange={() => setHeadcount(num)}
                        size="sm"
                      >
                        <span className="font-bold text-sm text-solid-gray-900">{num}名</span>
                      </Radio>
                    </div>
                  ))}
                </div>
                <SupportText className="text-xs text-solid-gray-600 mt-1">
                  ※ 4名以上のグループは友人が敵味方に分断されるのを防ぐため自動的に「貸切・身内戦」となります。
                </SupportText>
              </fieldset>

              {/* マッチング希望形式 */}
              <fieldset>
                <div className="flex items-center gap-2 mb-2">
                  <legend className="text-sm font-bold text-solid-gray-900">マッチング希望</legend>
                  <RequirementBadge>※必須</RequirementBadge>
                </div>
                <div className="space-y-3">
                  <div className={`p-3 rounded-8 border border-solid-gray-300 bg-white ${headcount >= 4 ? 'opacity-50' : ''}`}>
                    <Radio
                      name="preference"
                      value="open"
                      checked={preference === 'open' && headcount <= 3}
                      onChange={() => setPreference('open')}
                      aria-disabled={headcount >= 4}
                      size="md"
                    >
                      <span className="font-bold text-sm text-solid-gray-900">他グループと合流対戦 (Open)</span>
                    </Radio>
                    <p className="text-xs text-solid-gray-600 mt-1 pl-10">
                      他の来場者と3vs3でマッチング。試合時間 10分。マッチングが早くなる可能性があります。
                    </p>
                  </div>

                  <div className="p-3 rounded-8 border border-solid-gray-300 bg-white">
                    <Radio
                      name="preference"
                      value="closed"
                      checked={preference === 'closed'}
                      onChange={() => setPreference('closed')}
                      size="md"
                    >
                      <span className="font-bold text-sm text-solid-gray-900">自分たちだけで貸切・身内戦 (Closed)</span>
                    </Radio>
                    <p className="text-xs text-solid-gray-600 mt-1 pl-10">
                      他のグループと混ざらず対戦。試合時間 8分（少し短縮枠となります）。
                    </p>
                  </div>
                </div>
              </fieldset>

              {/* 送信ボタン */}
              <div className="pt-2">
                <Button
                  type="submit"
                  size="lg"
                  variant="solid-fill"
                  className="w-full justify-center min-h-touch text-base font-bold"
                  aria-disabled={submitting}
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
