'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
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
  ModalDialog,
  ModalDialogContent,
  ModalDialogHeader,
  ModalDialogHeading,
  ModalDialogClose,
  ModalDialogBody,
} from '@/design-system';
import { useSessionId, getOrCreateSessionId } from '@/hooks/useSessionId';
import { useWakeLock } from '@/hooks/useWakeLock';
import {
  createEntry,
  getEntryStatus,
  getQueueStatus,
  getEntriesBySession,
} from '@/lib/api';
import { subscribeToMatchUpdates } from '@/lib/supabase';
import {
  getMyEntries,
  saveMyEntry,
  removeMyEntry,
  getActiveEntryId,
  setActiveEntryId,
  syncEntriesFromRemote,
  MyEntrySummary,
} from '@/lib/entryCookie';
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

  // 初期化中フラグ（初回ロード時のフォームチラつき防止）
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // 参加者ステータス & 全体状況
  const [myEntryInfo, setMyEntryInfo] = useState<EntryResponse | null>(null);
  const [myEntriesList, setMyEntriesList] = useState<MyEntrySummary[]>([]);
  const [queueState, setQueueState] = useState<QueueStatusResponse | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  // 表示モード制御: 待機画面がある場合でも、新規受付フォームを開けるフラグ
  const [showNewEntryForm, setShowNewEntryForm] = useState(false);

  // 重複エントリー確認モーダル用
  const [, setDuplicateModalOpen] = useState(false);
  const duplicateDialogRef = useRef<HTMLDialogElement>(null);

  // 4名以上選択時は自動的に Closed に切り替え（味方は身内・敵は他人ルール）
  useEffect(() => {
    if (headcount >= 4) {
      setPreference('closed');
    }
  }, [headcount]);

  // 呼出中（2. 次の試合 = slot_name === 'next'）なら画面スリープを防止
  const entryStatus = myEntryInfo?.entry.status;
  const slotName = myEntryInfo?.slot_name;
  const isCalled = entryStatus === 'called' && slotName === 'next';
  const isNextNext = entryStatus === 'called' && slotName === 'next_next';
  const isInMatch = entryStatus === 'in_match' || slotName === 'current';
  const isCompleted = entryStatus === 'completed';
  const isSkipped = entryStatus === 'skipped' || entryStatus === 'cancelled';
  useWakeLock(isCalled || isNextNext);

  // 呼出中になった瞬間に短く1回バイブレーション通知
  const prevIsCalledRef = useRef(false);
  useEffect(() => {
    if (isCalled && !prevIsCalledRef.current) {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate([200, 100, 200]);
        } catch {
          // ignore
        }
      }
    }
    prevIsCalledRef.current = isCalled;
  }, [isCalled]);

  // URLパラメータに entry_id を反映（ブラウザ再読み込み・離脱後の復帰を強固にする）
  const updateUrlEntryId = (id: string | null) => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (id) {
        if (url.searchParams.get('entry_id') !== id) {
          url.searchParams.set('entry_id', id);
          window.history.replaceState({}, '', url.toString());
        }
      } else {
        if (url.searchParams.has('entry_id')) {
          url.searchParams.delete('entry_id');
          window.history.replaceState({}, '', url.toString());
        }
      }
    } catch {
      // ignore
    }
  };

  // Cookie/Storage から自端末のエントリーリストを再同期
  const refreshCookieEntries = () => {
    const list = getMyEntries();
    setMyEntriesList(list);
    return list;
  };

  // 自エントリー情報の復元・最新化処理（Cookie + URL + SessionId 3段フォールバック & 無効ID自動クリーンアップ）
  const fetchMyEntryData = useCallback(async (targetSessionId?: string) => {
    const sid = targetSessionId || sessionId || getOrCreateSessionId();
    const activeId = getActiveEntryId();

    // 1. 指定 ID の取得試行
    let loadedFromActiveId: EntryResponse | null = null;
    if (activeId) {
      try {
        loadedFromActiveId = await getEntryStatus(activeId);
        // アクティブ中（waiting/called/in_match）であればそのまま確定
        if (['waiting', 'called', 'in_match'].includes(loadedFromActiveId.entry.status)) {
          setMyEntryInfo(loadedFromActiveId);
          updateUrlEntryId(loadedFromActiveId.entry.id);
          refreshCookieEntries();
          return loadedFromActiveId;
        }
      } catch {
        // 全リセット等でサーバー側に存在しないIDはローカルから除去
        updateUrlEntryId(null);
        removeMyEntry(activeId);
      }
    }

    // 2. サーバーから session_id による逆引き復元
    if (sid) {
      try {
        const sessionEntries = await getEntriesBySession(sid);
        if (sessionEntries && sessionEntries.length > 0) {
          syncEntriesFromRemote(
            sessionEntries.map((e) => ({
              id: e.entry.id,
              entry_number: e.entry.entry_number,
              team_name: e.entry.team_name,
            }))
          );
          refreshCookieEntries();

          // アクティブ（waiting/called/in_match）なエントリーを最優先し、なければ指定IDまたは最新履歴を表示
          const activeEntry =
            sessionEntries.find((e) =>
              ['waiting', 'called', 'in_match'].includes(e.entry.status)
            ) ||
            loadedFromActiveId ||
            sessionEntries[0];

          setMyEntryInfo(activeEntry);
          setActiveEntryId(activeEntry.entry.id);
          updateUrlEntryId(activeEntry.entry.id);
          return activeEntry;
        }
      } catch {
        // ignore
      }
    }

    if (loadedFromActiveId) {
      setMyEntryInfo(loadedFromActiveId);
      updateUrlEntryId(loadedFromActiveId.entry.id);
      refreshCookieEntries();
      return loadedFromActiveId;
    }

    // 3. ローカルリストの別エントリーを試行（存在しないIDは掃除）
    const currentList = refreshCookieEntries();
    if (currentList.length > 0) {
      for (const item of currentList) {
        if (item.id !== activeId) {
          try {
            const entryData = await getEntryStatus(item.id);
            setMyEntryInfo(entryData);
            setActiveEntryId(item.id);
            updateUrlEntryId(item.id);
            refreshCookieEntries();
            return entryData;
          } catch {
            removeMyEntry(item.id);
          }
        }
      }
    }

    // 有効なエントリーが1件も存在しない場合はクリア
    setMyEntryInfo(null);
    updateUrlEntryId(null);
    refreshCookieEntries();
    return null;
  }, [sessionId]);

  // リアルタイム反映 + 定期ポーリング (3秒毎)
  useEffect(() => {
    let isMounted = true;

    const poll = async () => {
      try {
        const qStatus = await getQueueStatus();
        if (!isMounted) return;
        setQueueState(qStatus);
        setIsOffline(false);

        await fetchMyEntryData();
      } catch {
        if (isMounted) setIsOffline(true);
      } finally {
        if (isMounted) setIsInitialLoading(false);
      }
    };

    refreshCookieEntries();
    poll();
    const timer = setInterval(poll, 15000);
    const unsubscribe = subscribeToMatchUpdates(() => {
      poll();
    });

    return () => {
      isMounted = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [fetchMyEntryData]);

  // 別の自エントリーに手動切り替え
  const handleSelectEntry = async (id: string) => {
    setActiveEntryId(id);
    updateUrlEntryId(id);
    setShowNewEntryForm(false);
    setErrorMessage(null);
    try {
      const entryData = await getEntryStatus(id);
      setMyEntryInfo(entryData);
      refreshCookieEntries();
    } catch {
      removeMyEntry(id);
      updateUrlEntryId(null);
      refreshCookieEntries();
      setMyEntryInfo(null);
    }
  };

  // エントリー送信前チェック（既に待機中エントリーがあれば警告モーダルを提示）
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaderName.trim() || !teamName.trim()) {
      setErrorMessage('代表者氏名とチーム名を入力してください。');
      return;
    }

    // 既にアクティブな自エントリーが存在するか確認
    const hasActiveEntry =
      myEntryInfo &&
      (myEntryInfo.entry.status === 'waiting' ||
        myEntryInfo.entry.status === 'called' ||
        myEntryInfo.entry.status === 'in_match');

    if (hasActiveEntry) {
      // 警告モーダルを開く
      setDuplicateModalOpen(true);
      duplicateDialogRef.current?.showModal();
    } else {
      executeCreateEntry();
    }
  };

  // 実際のエントリー登録処理
  const executeCreateEntry = async () => {
    setSubmitting(true);
    setErrorMessage(null);
    duplicateDialogRef.current?.close();
    setDuplicateModalOpen(false);

    const activeSessionId = sessionId || getOrCreateSessionId();

    try {
      const res = await createEntry({
        session_id: activeSessionId,
        leader_name: leaderName.trim(),
        team_name: teamName.trim(),
        headcount,
        preference: headcount >= 4 ? 'closed' : preference,
      });

      // Cookie & Storage に安全に保存
      saveMyEntry(res.entry.id, res.entry.entry_number, res.entry.team_name);
      refreshCookieEntries();
      setMyEntryInfo(res);
      updateUrlEntryId(res.entry.id);
      setShowNewEntryForm(false);

      // フォームをリセット
      setLeaderName('');
      setTeamName('');
    } catch (err: any) {
      setErrorMessage(err.message || 'エントリーの送信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  // 整理券の確認画面を表示中かどうか
  const hasMyEntry = Boolean(myEntryInfo);
  const isViewingTicket = hasMyEntry && !showNewEntryForm;

  return (
    <main className="min-h-screen bg-solid-gray-50 pb-16 text-solid-gray-900">
      {/* ネットワーク切断時の緊急バナー (デジタル庁 EmergencyBanner) */}
      {isOffline && (
        <div className="sticky top-0 z-50">
          <EmergencyBanner className="text-center font-bold">
            サーバーとの通信が切断されました。自動再接続中…
          </EmergencyBanner>
        </div>
      )}

      {/* ヘッダー (デジタル庁デザインシステム準拠) */}
      <header className="bg-white border-b border-solid-gray-300 py-4 px-6">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-1.5 h-6 bg-key-900 rounded-full inline-block shrink-0" aria-hidden="true" />
            <div>
              <div className="flex items-center gap-2">
                <Heading size="20" className="font-bold text-solid-gray-900 leading-tight">
                  OVERTER WATCH2026
                </Heading>
                {queueState?.is_local_mode && (
                  <span className="text-[10px] bg-amber-100 text-amber-900 border border-amber-300 font-bold px-1.5 py-0.5 rounded-4">
                    テスト環境
                  </span>
                )}
              </div>
              <p className="text-xs text-solid-gray-600">3v3 赤外線シューティング マッチング</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 整理券があるがフォームを開いている場合の「整理券へ」ヘッダーボタン */}
            {(myEntryInfo || myEntriesList.length > 0) && showNewEntryForm && (
              <Button
                size="sm"
                variant="solid-fill"
                onClick={() => setShowNewEntryForm(false)}
                className="font-bold text-xs"
              >
                整理券 #{myEntryInfo?.entry.entry_number || myEntriesList[0].entry_number} へ
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href="/monitor">
                会場モニタ表示
              </Link>
            </Button>
          </div>
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

        {/* 初期ロード中インジケーター */}
        {isInitialLoading && !myEntryInfo && myEntriesList.length === 0 ? (
          <Card className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-solid-gray-300 border-t-key-900 mb-3" />
            <p className="text-sm text-solid-gray-600 font-bold">整理券・エントリー情報を確認中…</p>
          </Card>
        ) : isViewingTicket && myEntryInfo ? (
          /* エントリー済: 待機または呼出中画面 */
          <div className="space-y-6">
            {/* 複数エントリーが存在する場合の自整理券切替バー */}
            {myEntriesList.length > 1 && (
              <div className="bg-white p-3 rounded-8 border border-solid-gray-300">
                <div className="text-xs font-bold text-solid-gray-600 mb-2">
                  この端末の整理券 ({myEntriesList.length}件):
                </div>
                <div className="flex gap-2 flex-wrap">
                  {myEntriesList.map((item) => {
                    const isSelected = item.id === myEntryInfo.entry.id;
                    return (
                      <Button
                        key={item.id}
                        size="sm"
                        variant={isSelected ? 'solid-fill' : 'outline'}
                        onClick={() => handleSelectEntry(item.id)}
                      >
                        #{item.entry_number} {item.team_name} {isSelected && '(表示中)'}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

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
                    state={
                      isCalled || isInMatch || isCompleted
                        ? 'completed'
                        : 'reached'
                    }
                    aria-current={
                      !isCalled && !isInMatch && !isCompleted ? 'step' : undefined
                    }
                  >
                    <StepNavigationStepHeader>
                      <StepNavigationNumber>2</StepNavigationNumber>
                      <StepNavigationTitle>待機中</StepNavigationTitle>
                    </StepNavigationStepHeader>
                  </StepNavigationStep>
                  <StepNavigationStep
                    state={
                      isInMatch || isCompleted
                        ? 'completed'
                        : isCalled
                        ? 'reached'
                        : undefined
                    }
                    aria-current={isCalled ? 'step' : undefined}
                  >
                    <StepNavigationStepHeader>
                      <StepNavigationNumber>3</StepNavigationNumber>
                      <StepNavigationTitle>受付呼出</StepNavigationTitle>
                    </StepNavigationStepHeader>
                  </StepNavigationStep>
                  <StepNavigationStep
                    state={
                      isCompleted
                        ? 'completed'
                        : isInMatch
                        ? 'reached'
                        : undefined
                    }
                    aria-current={isInMatch ? 'step' : undefined}
                    last
                  >
                    <StepNavigationStepHeader>
                      <StepNavigationNumber>4</StepNavigationNumber>
                      <StepNavigationTitle>対戦</StepNavigationTitle>
                    </StepNavigationStepHeader>
                  </StepNavigationStep>
                </StepNavigationList>
              </StepNavigation>
            </div>

            <Card
              variant={isCalled || isInMatch ? 'key' : 'default'}
              className={isCalled || isInMatch ? 'border-2 border-key-900' : ''}
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
                      呼出中 (受付へお越しください)
                    </StatusBadge>
                  ) : isNextNext ? (
                    <StatusBadge variant="key" size="md">
                      次々回 試合枠 (まもなく呼出)
                    </StatusBadge>
                  ) : isInMatch ? (
                    <StatusBadge variant="key" size="md">
                      対戦中
                    </StatusBadge>
                  ) : isCompleted ? (
                    <StatusBadge variant="success" size="md">
                      対戦完了
                    </StatusBadge>
                  ) : isSkipped ? (
                    <StatusBadge variant="error" size="md">
                      不在スキップ
                    </StatusBadge>
                  ) : (
                    <StatusBadge variant="gray" size="md">
                      待機中 (マッチング待ち)
                    </StatusBadge>
                  )}
                </div>

                {!isCalled && !isNextNext && !isInMatch && !isCompleted && !isSkipped && (
                  <p className="mt-3 text-xs text-solid-gray-600">
                    ※呼出時に不在の場合はスキップされます。お呼び出しまでそのままお待ちください。
                  </p>
                )}

                {isCalled && (
                  <div className="mt-5 text-left">
                    <NotificationBanner
                      bannerStyle="color-chip"
                      type="info1"
                      title="受付呼出中"
                    >
                      <span className="font-bold text-sm">
                        画面を受付スタッフにお見せください。呼出時に不在の場合はスキップされます。
                      </span>
                    </NotificationBanner>
                  </div>
                )}

                {isNextNext && (
                  <div className="mt-5 text-left">
                    <NotificationBanner
                      bannerStyle="color-chip"
                      type="info2"
                      title="まもなく呼出"
                    >
                      <span className="text-sm">
                        次々回の試合枠に入りました。受付付近でお待ちください。
                      </span>
                    </NotificationBanner>
                  </div>
                )}

                {isInMatch && (
                  <div className="mt-5 text-left">
                    <NotificationBanner
                      bannerStyle="color-chip"
                      type="info1"
                      title="対戦中"
                    >
                      <span className="text-sm font-medium">
                        フィールドへご案内中です。スタッフの指示に従ってご入場ください。
                      </span>
                    </NotificationBanner>
                  </div>
                )}

                {isCompleted && (
                  <div className="mt-5 text-left space-y-3">
                    <NotificationBanner
                      bannerStyle="color-chip"
                      type="success"
                      title="対戦終了"
                    >
                      <span className="text-sm">
                        この整理券での対戦は終了しました。
                      </span>
                    </NotificationBanner>
                    <Button
                      variant="solid-fill"
                      size="md"
                      className="w-full justify-center font-bold"
                      onClick={() => setShowNewEntryForm(true)}
                    >
                      + 新規エントリーする
                    </Button>
                  </div>
                )}

                {isSkipped && (
                  <div className="mt-5 text-left space-y-3">
                    <NotificationBanner
                      bannerStyle="color-chip"
                      type="error"
                      title="不在スキップ"
                    >
                      <span className="text-sm">
                        呼出時に不在のためスキップされました。遅れて来られた場合は受付スタッフにお声がけください。
                      </span>
                    </NotificationBanner>
                    <Button
                      variant="solid-fill"
                      size="md"
                      className="w-full justify-center font-bold"
                      onClick={() => setShowNewEntryForm(true)}
                    >
                      + 新規エントリーする
                    </Button>
                  </div>
                )}
              </div>

              {/* 定義リスト（dl/dt/dd）によるクリーンな情報表示 */}
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
                <li>呼出時に受付におられない場合はスキップされます。遅れて来られた場合は受付スタッフにお声がけください。</li>
                <li>欠員が生じた場合は、運営スタッフがサポートに入り試合を実施します。</li>
                <li>呼出画面の表示中は、画面のスリープを自動防止します。</li>
              </ul>
            </NotificationBanner>

            {/* 新規グループ追加エントリーへの切り替えボタン */}
            <div className="pt-2 text-center">
              <Button
                variant="outline"
                size="md"
                className="w-full justify-center font-bold"
                onClick={() => setShowNewEntryForm(true)}
              >
                + 別のグループを新規エントリーする
              </Button>
            </div>
          </div>
        ) : (
          /* 受付フォーム（未エントリー、または追加エントリー希望時） */
          <div className="space-y-6">
            {/* すでに発行済みの整理券がある場合の復帰カード */}
            {(myEntryInfo || myEntriesList.length > 0) && (
              <div className="bg-key-50 border-2 border-key-900 rounded-8 p-4 shadow-sm space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-key-900 animate-pulse shrink-0" />
                    <div>
                      <div className="font-bold text-sm text-key-900">
                        すでに受付済みの整理券があります
                      </div>
                      <div className="text-xs text-solid-gray-700">
                        {myEntryInfo ? (
                          <>
                            整理券 #{myEntryInfo.entry.entry_number} : {myEntryInfo.entry.team_name} (
                            <span className="font-bold text-key-900">
                              {isCalled
                                ? '呼出中！受付へ'
                                : isNextNext
                                ? '次々回枠（まもなく呼出）'
                                : isInMatch
                                ? '現在対戦中'
                                : isCompleted
                                ? '対戦完了'
                                : isSkipped
                                ? '不在スキップ'
                                : '待機中'}
                            </span>
                            )
                          </>
                        ) : (
                          <>この端末で {myEntriesList.length} 件の整理券が登録されています</>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="md"
                    variant="solid-fill"
                    onClick={() => {
                      setShowNewEntryForm(false);
                      if (myEntryInfo) {
                        updateUrlEntryId(myEntryInfo.entry.id);
                      } else if (myEntriesList.length > 0) {
                        handleSelectEntry(myEntriesList[0].id);
                      }
                    }}
                    className="font-bold shrink-0 shadow text-sm"
                  >
                    整理券 #{myEntryInfo?.entry.entry_number || myEntriesList[0]?.entry_number} の確認画面へ移動 →
                  </Button>
                </div>

                {/* 複数ある場合の整理券ボタン一覧 */}
                {myEntriesList.length > 1 && (
                  <div className="pt-2 border-t border-key-200 flex gap-2 flex-wrap items-center">
                    <span className="text-xs font-bold text-solid-gray-700">整理券切替:</span>
                    {myEntriesList.map((item) => (
                      <Button
                        key={item.id}
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowNewEntryForm(false);
                          handleSelectEntry(item.id);
                        }}
                      >
                        #{item.entry_number} {item.team_name}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Card>
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-solid-gray-200">
                <Heading size="20" hasChip={true} className="font-bold">
                  {showNewEntryForm ? '追加グループのエントリー' : 'マッチングエントリー登録'}
                </Heading>
                {(myEntryInfo || myEntriesList.length > 0) && (
                  <Button
                    size="sm"
                    variant="solid-fill"
                    onClick={() => {
                      setShowNewEntryForm(false);
                      if (myEntryInfo) {
                        updateUrlEntryId(myEntryInfo.entry.id);
                      } else if (myEntriesList.length > 0) {
                        handleSelectEntry(myEntriesList[0].id);
                      }
                    }}
                    className="font-bold text-xs"
                  >
                    ← 整理券確認画面に戻る
                  </Button>
                )}
              </div>

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

              <form onSubmit={handleFormSubmit} className="space-y-5">
                {/* 代表者氏名 */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Label htmlFor="leader-name" className="text-sm font-bold">代表者氏名</Label>
                    <RequirementBadge>必須</RequirementBadge>
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
                    <RequirementBadge>必須</RequirementBadge>
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
                    <RequirementBadge>必須</RequirementBadge>
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
                    4名以上のグループは友人が敵味方に分断されるのを防ぐため自動的に「貸切・身内戦」となります。
                  </SupportText>
                </fieldset>

                {/* マッチング希望形式 */}
                <fieldset>
                  <div className="flex items-center gap-2 mb-2">
                    <legend className="text-sm font-bold text-solid-gray-900">マッチング希望</legend>
                    <RequirementBadge>必須</RequirementBadge>
                  </div>
                  <div className="space-y-3">
                    <div className={`p-3 rounded-8 border border-solid-gray-300 bg-white ${headcount >= 4 ? 'opacity-50' : ''}`}>
                      <Radio
                        name="preference"
                        value="open"
                        checked={preference === 'open' && headcount <= 3}
                        onChange={() => {
                          if (headcount <= 3) setPreference('open');
                        }}
                        disabled={headcount >= 4}
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
          </div>
        )}
      </div>

      {/* 重複エントリー確認モーダルダイアログ (デジタル庁公式コンポーネント) */}
      <ModalDialog ref={duplicateDialogRef}>
        <ModalDialogContent className="max-w-md">
          <ModalDialogHeader>
            <ModalDialogHeading className="text-lg font-bold text-solid-gray-900">
              追加エントリーの確認
            </ModalDialogHeading>
            <ModalDialogClose onClick={() => duplicateDialogRef.current?.close()} />
          </ModalDialogHeader>
          <ModalDialogBody>
            <div className="space-y-4 text-sm text-solid-gray-800">
              <p>
                現在、この端末には有効な整理券があります。
              </p>
              {myEntryInfo && (
                <div className="p-3 bg-solid-gray-100 border border-solid-gray-300 rounded-8 font-bold text-xs text-solid-gray-900">
                  整理券番号 #{myEntryInfo.entry.entry_number} : {myEntryInfo.entry.team_name} (代表: {myEntryInfo.entry.leader_name} / {myEntryInfo.entry.headcount}名)
                </div>
              )}
              <p className="text-xs text-solid-gray-600">
                別グループとして新たに追加エントリーを発行しますか？ 既存の整理券も保持され、後から切り替えて確認できます。
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => duplicateDialogRef.current?.close()}
                  aria-disabled={submitting}
                >
                  キャンセル
                </Button>
                <Button
                  size="sm"
                  variant="solid-fill"
                  onClick={executeCreateEntry}
                  aria-disabled={submitting}
                >
                  {submitting ? '登録中…' : '追加エントリーを確定する'}
                </Button>
              </div>
            </div>
          </ModalDialogBody>
        </ModalDialogContent>
      </ModalDialog>
    </main>
  );
}
