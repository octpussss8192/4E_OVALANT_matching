import type {
  EntryGroup,
  MatchingPreference,
  Match,
  MatchStatus,
  SystemConfig,
  QueueDisplayState,
  GroupQueueStatus,
  MatchTeamAssignment,
  SuggestionTip,
} from './types.ts';

export class MatchingEngine {
  private entries: EntryGroup[] = [];
  private matches: Match[] = [];
  private nextEntryNumber = 101;
  private nextMatchNumber = 1;

  public config: SystemConfig = {
    maxPlayersPerMatch: 6,
    minPlayersFlexibleThreshold: 5,
    flexibleWaitTimeSeconds: 600, // デフォルト10分（テスト時は上書き可能）
    standardMatchDurationMinutes: 10,
    closedMatchDurationMinutes: 8,
    turnaroundDurationMinutes: 2,
  };

  constructor(configOverrides?: Partial<SystemConfig>) {
    if (configOverrides) {
      this.config = { ...this.config, ...configOverrides };
    }
  }

  // --- 1. エントリー受付 ---
  public registerEntry(
    leaderName: string,
    teamName: string,
    memberCount: number,
    preference: MatchingPreference,
    createdAt: Date = new Date()
  ): EntryGroup {
    if (memberCount < 1 || memberCount > 6) {
      throw new Error('メンバー数は1〜6名である必要があります。');
    }

    const group: EntryGroup = {
      id: `entry-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      entryNumber: this.nextEntryNumber++,
      leaderName,
      teamName,
      memberCount,
      preference,
      status: 'waiting',
      createdAt,
    };

    this.entries.push(group);
    this.recalculateSlots(createdAt);
    return group;
  }

  // --- 2. 運営側操作: スキップ（無効化） ---
  public skipEntry(entryId: string, reason: string = '呼び出し時不在', currentTime: Date = new Date()): boolean {
    const group = this.entries.find((e) => e.id === entryId);
    if (!group) return false;

    if (group.status === 'completed' || group.status === 'skipped' || group.status === 'cancelled') {
      return false; // 既に無効または完了
    }

    group.status = 'skipped';
    group.skippedAt = currentTime;
    group.skipReason = reason;

    // もし試合に割り当てられていたら Match を再編
    if (group.assignedMatchId) {
      const matchIndex = this.matches.findIndex((m) => m.id === group.assignedMatchId);
      if (matchIndex !== -1) {
        const match = this.matches[matchIndex];
        // 試合がまだ終了していない場合
        if (match.status !== 'finished') {
          // Closed の場合はその試合枠ごと破棄
          if (match.isClosedMatch) {
            match.status = 'cancelled';
          } else {
            // Open の場合は該当グループを除外
            match.assignedGroups = match.assignedGroups.filter((g) => g.id !== group.id);
            match.totalPlayers = match.assignedGroups.reduce((acc, g) => acc + g.memberCount, 0);

            // 残ったグループを待機状態に戻して即座に再マッチングさせる（公平性のため）
            for (const remaining of match.assignedGroups) {
              remaining.status = 'waiting';
              remaining.assignedMatchId = undefined;
            }
            match.status = 'cancelled';
          }
        }
      }
      group.assignedMatchId = undefined;
    }

    // スキップに伴い、空いたスロットを即座に再計算・繰り上げ
    this.recalculateSlots(currentTime);
    return true;
  }

  // --- 3. 試合進行操作 ---
  public advanceMatchLifecycle(currentTime: Date = new Date()): void {
    // Current が終わったら finished にし、Next を Current に昇格
    const current = this.matches.find((m) => m.status === 'in_progress');
    const next = this.matches.find((m) => m.status === 'calling');
    const nextNext = this.matches.find((m) => m.status === 'scheduled');

    if (current) {
      current.status = 'finished';
      current.endedAt = currentTime;
      for (const g of current.assignedGroups) {
        g.status = 'completed';
      }
    }

    if (next) {
      next.status = 'in_progress';
      next.startedAt = currentTime;
      for (const g of next.assignedGroups) {
        g.status = 'in_match';
      }
    }

    if (nextNext) {
      nextNext.status = 'calling';
      for (const g of nextNext.assignedGroups) {
        g.status = 'called';
        g.calledAt = currentTime;
      }
    }

    // 空いたスロットを補充
    this.recalculateSlots(currentTime);
  }

  // --- 4. スロット（Next, Next Next）の再計算とマッチング実行 ---
  public recalculateSlots(currentTime: Date = new Date()): void {
    // 待機中のグループ（作成順 FIFO）
    const waitingGroups = this.entries
      .filter((e) => e.status === 'waiting')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // 現在アクティブなマッチ
    let callingMatch = this.matches.find((m) => m.status === 'calling');
    let scheduledMatch = this.matches.find((m) => m.status === 'scheduled');

    // Next（calling）枠が空いていて、Next Next（scheduled）がある場合は即座に繰り上げ昇格
    if (!callingMatch && scheduledMatch) {
      scheduledMatch.status = 'calling';
      for (const g of scheduledMatch.assignedGroups) {
        g.status = 'called';
        if (!g.calledAt) g.calledAt = currentTime;
      }
      callingMatch = scheduledMatch;
      scheduledMatch = undefined;
    }

    // Next（calling）枠が依然として空いていて、待機グループがある場合
    if (!callingMatch && waitingGroups.length > 0) {
      const match = this.findNextMatchCombination(waitingGroups, currentTime);
      if (match) {
        match.status = 'calling';
        for (const g of match.assignedGroups) {
          g.status = 'called';
          g.calledAt = currentTime;
          g.matchedAt = currentTime;
          g.assignedMatchId = match.id;
        }
        this.matches.push(match);
        callingMatch = match;
      }
    }

    // 再度待機グループを取得（Nextに割り当てられたものを除外）
    const remainingWaiting = this.entries
      .filter((e) => e.status === 'waiting')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Next Next（scheduled）枠が空いていて、待機グループがある場合
    if (!scheduledMatch && remainingWaiting.length > 0) {
      const match = this.findNextMatchCombination(remainingWaiting, currentTime);
      if (match) {
        match.status = 'scheduled';
        for (const g of match.assignedGroups) {
          g.status = 'called'; // 案内済み
          g.matchedAt = currentTime;
          g.assignedMatchId = match.id;
        }
        this.matches.push(match);
      }
    }
  }

  // --- 5. マッチング探索アルゴリズム ---
  private findNextMatchCombination(
    waitingPool: EntryGroup[],
    currentTime: Date
  ): Match | null {
    if (waitingPool.length === 0) return null;

    const firstGroup = waitingPool[0];

    // パターンA: 先頭が Closed（貸切）の場合
    if (firstGroup.preference === 'closed') {
      return this.createMatch([firstGroup], true, currentTime);
    }

    // パターンB: 先頭が Open の場合
    // Openグループのみを対象に組み合わせを探索
    const openGroups = waitingPool.filter((g) => g.preference === 'open');
    if (openGroups.length === 0) return null;

    // Step 1: 先頭 openGroups[0] を必須とし、合計6名（完全一致）の組み合わせを探索
    const targetGroup = openGroups[0];
    const candidatePool = openGroups.slice(1);
    const needed = this.config.maxPlayersPerMatch - targetGroup.memberCount;

    if (needed === 0) {
      // 6名単独グループの場合
      return this.createMatch([targetGroup], false, currentTime);
    }

    const exactCombo = this.findSubsetSum(candidatePool, needed);
    if (exactCombo) {
      return this.createMatch([targetGroup, ...exactCombo], false, currentTime);
    }

    // Step 2: 6名が作れない場合、先頭の待機時間が閾値を超えているか判定
    const waitSeconds = (currentTime.getTime() - targetGroup.createdAt.getTime()) / 1000;
    const isWaitExpired = waitSeconds >= this.config.flexibleWaitTimeSeconds;

    if (isWaitExpired) {
      // 柔軟マッチング: 合計5名（閾値）での組み合わせを探索
      const flexibleNeeded = this.config.minPlayersFlexibleThreshold - targetGroup.memberCount;
      if (flexibleNeeded === 0) {
        return this.createMatch([targetGroup], false, currentTime);
      }
      if (flexibleNeeded > 0) {
        const flexCombo = this.findSubsetSum(candidatePool, flexibleNeeded);
        if (flexCombo) {
          return this.createMatch([targetGroup, ...flexCombo], false, currentTime);
        }
      }
    }

    // 成立しない場合は null（次回の追加や時間経過を待つ）
    return null;
  }

  /**
   * FIFOを優先した部分和探索（Bin Packing）
   * 到着順（配列の先頭）の要素をなるべく優先して合計 targetSum を作成
   */
  private findSubsetSum(candidates: EntryGroup[], targetSum: number): EntryGroup[] | null {
    const result: EntryGroup[] = [];

    const search = (index: number, currentSum: number): boolean => {
      if (currentSum === targetSum) return true;
      if (currentSum > targetSum || index >= candidates.length) return false;

      // candidates[index] を採用する場合 (FIFO優先)
      result.push(candidates[index]);
      if (search(index + 1, currentSum + candidates[index].memberCount)) {
        return true;
      }
      result.pop(); // バックトラック

      // candidates[index] を採用しない場合
      if (search(index + 1, currentSum)) {
        return true;
      }

      return false;
    };

    if (search(0, 0)) {
      return result;
    }
    return null;
  }

  // --- 6. チーム分け（3 vs 3 または 3 vs 2） ---
  private createMatch(groups: EntryGroup[], isClosed: boolean, createdAt: Date): Match {
    const totalPlayers = groups.reduce((acc, g) => acc + g.memberCount, 0);
    const duration = isClosed
      ? this.config.closedMatchDurationMinutes
      : this.config.standardMatchDurationMinutes;

    const teams = this.assignTeams(groups);

    return {
      id: `match-${this.nextMatchNumber}`,
      matchNumber: this.nextMatchNumber++,
      status: 'scheduled',
      isClosedMatch: isClosed,
      allocatedDurationMinutes: duration,
      assignedGroups: groups,
      totalPlayers,
      teams,
      createdAt,
    };
  }

  /**
   * 人数をできるだけ均等に赤チーム・青チームへ分割
   */
  private assignTeams(groups: EntryGroup[]): MatchTeamAssignment {
    const teamRed: EntryGroup[] = [];
    const teamBlue: EntryGroup[] = [];
    let redCount = 0;
    let blueCount = 0;

    // 人数の大きいグループから順に人数の少ない方のチームへ配分（貪欲法）
    const sorted = [...groups].sort((a, b) => b.memberCount - a.memberCount);

    for (const g of sorted) {
      if (redCount <= blueCount) {
        teamRed.push(g);
        redCount += g.memberCount;
      } else {
        teamBlue.push(g);
        blueCount += g.memberCount;
      }
    }

    return {
      teamRed,
      teamBlue,
      teamRedCount: redCount,
      teamBlueCount: blueCount,
    };
  }

  // --- 7. サジェストTipsと待機画面表示データの生成 ---
  public getQueueDisplayState(currentTime: Date = new Date()): QueueDisplayState {
    const currentMatch = this.matches.find((m) => m.status === 'in_progress') || null;
    const nextMatch = this.matches.find((m) => m.status === 'calling') || null;
    const nextNextMatch = this.matches.find((m) => m.status === 'scheduled') || null;

    const waitingGroups = this.entries.filter((e) => e.status === 'waiting');
    const totalWaitingPlayers = waitingGroups.reduce((acc, g) => acc + g.memberCount, 0);

    const suggestionTip = this.calculateSuggestionTip(waitingGroups);

    return {
      currentMatch,
      nextMatch,
      nextNextMatch,
      suggestionTip,
      totalWaitingGroups: waitingGroups.length,
      totalWaitingPlayers,
    };
  }

  /**
   * サジェストTipsの算出:
   * 待機中のOpenグループのうち、あと何名いれば即座に6名（あるいは5名）マッチが成立するか
   */
  private calculateSuggestionTip(waitingGroups: EntryGroup[]): SuggestionTip {
    const openWaiting = waitingGroups.filter((g) => g.preference === 'open');

    if (openWaiting.length === 0) {
      return {
        recommendedPartySize: 3,
        message: '現在待機列なし！何名様でもすぐにご案内可能です。',
      };
    }

    // 待機先頭から greedy に足していき、6名に対する不足人数を検知
    let sum = 0;
    for (const g of openWaiting) {
      if (sum + g.memberCount <= 6) {
        sum += g.memberCount;
      }
    }

    const deficit = 6 - sum;
    if (deficit > 0 && deficit <= 6) {
      return {
        recommendedPartySize: deficit,
        message: `現在【${deficit}名】組なら、すぐにご案内可能です！（Open枠）`,
      };
    }

    return {
      recommendedPartySize: 2,
      message: '現在2名組ならマッチングが早くなる可能性が高いです！',
    };
  }

  // --- 8. ユーザーごとのステータス取得 ---
  public getGroupStatus(entryId: string): GroupQueueStatus | null {
    const group = this.entries.find((e) => e.id === entryId);
    if (!group) return null;

    if (group.status === 'completed' || group.status === 'skipped' || group.status === 'cancelled') {
      return {
        group,
        aheadGroupCount: 0,
        estimatedWaitMinutes: 0,
        slotName: 'inactive',
      };
    }

    // スロットの特定
    let slotName: GroupQueueStatus['slotName'] = 'waiting';
    if (group.assignedMatchId) {
      const match = this.matches.find((m) => m.id === group.assignedMatchId);
      if (match) {
        if (match.status === 'in_progress') slotName = 'current';
        else if (match.status === 'calling') slotName = 'next';
        else if (match.status === 'scheduled') slotName = 'next_next';
      }
    }

    // 前にいる待機組数の計算
    let aheadGroupCount = 0;
    if (slotName === 'waiting') {
      aheadGroupCount = this.entries.filter(
        (e) => e.status === 'waiting' && e.createdAt.getTime() < group.createdAt.getTime()
      ).length;
    }

    // 待ち時間予測（スロット番号ベース）
    const avgCycle = this.config.standardMatchDurationMinutes + this.config.turnaroundDurationMinutes;
    let multiplier = 0;
    if (slotName === 'current') multiplier = 0;
    else if (slotName === 'next') multiplier = 1;
    else if (slotName === 'next_next') multiplier = 2;
    else {
      // waiting の場合、現在のアクティブマッチ数＋待機順
      multiplier = 2 + Math.ceil((aheadGroupCount + 1) / 2);
    }

    return {
      group,
      aheadGroupCount,
      estimatedWaitMinutes: multiplier * avgCycle,
      slotName,
    };
  }

  // デバッグ用: 全体状態のダンプ
  public getAllEntries(): EntryGroup[] {
    return this.entries;
  }

  public getAllMatches(): Match[] {
    return this.matches;
  }
}
