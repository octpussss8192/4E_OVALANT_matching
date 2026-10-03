import { MatchingEngine } from './matchingEngine.ts';
import type { QueueDisplayState, Match } from './types.ts';

function formatMatch(match: Match | null, label: string): string {
  if (!match) return `  [${label}]: (空きスロット)`;
  const groupStrs = match.assignedGroups.map(
    (g) => `${g.teamName}(${g.memberCount}名/${g.preference})`
  );
  const typeStr = match.isClosedMatch ? '【貸切/Closed】' : '【通常/Open】';
  const durationStr = `${match.allocatedDurationMinutes}分`;
  let teamStr = '';
  if (match.teams) {
    const red = match.teams.teamRed.map((g) => `${g.teamName}(${g.memberCount})`).join('+');
    const blue = match.teams.teamBlue.map((g) => `${g.teamName}(${g.memberCount})`).join('+');
    teamStr = ` -> [Red: ${red} (${match.teams.teamRedCount}名) vs Blue: ${blue} (${match.teams.teamBlueCount}名)]`;
  }
  return `  [${label}]: Match #${match.matchNumber} ${typeStr} 計${match.totalPlayers}名 (${durationStr}) : ${groupStrs.join(' + ')}${teamStr}`;
}

function printState(engine: MatchingEngine, title: string) {
  const state: QueueDisplayState = engine.getQueueDisplayState();
  console.log(`\n======================================================`);
  console.log(`🔷 ${title}`);
  console.log(`======================================================`);
  console.log(`【待機状況】 待機グループ数: ${state.totalWaitingGroups}組 / 待機人数: ${state.totalWaitingPlayers}名`);
  console.log(`【サジェストTips】💡 ${state.suggestionTip.message}`);
  console.log(`【試合スロット状況】`);
  console.log(formatMatch(state.currentMatch, 'Current (進行中)'));
  console.log(formatMatch(state.nextMatch, 'Next (呼出中)'));
  console.log(formatMatch(state.nextNextMatch, 'Next Next (待機)'));
  console.log(`------------------------------------------------------`);
}

async function runScenario1_ExactMatch() {
  console.log('\n\n######################################################');
  console.log('🧪 シナリオ1: 【ぴったり6名マッチング [3名, 2名, 1名] のOpen組】');
  console.log('######################################################');

  const engine = new MatchingEngine();
  const baseTime = new Date('2026-10-03T10:00:00Z');

  printState(engine, '初期状態（待機なし）');

  console.log('>> Group A (3名, Open) がエントリー');
  engine.registerEntry('山田太郎', 'チームAlpha', 3, 'open', new Date(baseTime.getTime() + 1000));
  printState(engine, 'Group A 登録後');

  console.log('>> Group B (2名, Open) がエントリー');
  engine.registerEntry('佐藤花子', 'チームBravo', 2, 'open', new Date(baseTime.getTime() + 2000));
  printState(engine, 'Group B 登録後（合計5名: まだ6名に満たないためマッチ保留）');

  console.log('>> Group C (1名, Open) がエントリー（合計6名到達！）');
  engine.registerEntry('鈴木一郎', 'ソロプレイヤーCharlie', 1, 'open', new Date(baseTime.getTime() + 3000));
  printState(engine, 'Group C 登録後 -> [3名+2名+1名] で即座にNext枠にマッチ成立！');

  const statusAlpha = engine.getGroupStatus(engine.getAllEntries()[0].id);
  console.log(`📊 チームAlphaのステータス: スロット=${statusAlpha?.slotName}, 予想待ち時間=${statusAlpha?.estimatedWaitMinutes}分`);
}

async function runScenario2_ClosedAndOpen() {
  console.log('\n\n######################################################');
  console.log('🧪 シナリオ2: 【Closed（貸切）とOpenの共存 & 試合時間短縮】');
  console.log('######################################################');

  const engine = new MatchingEngine();
  const baseTime = new Date('2026-10-03T11:00:00Z');

  console.log('>> Group 1: 貸切希望 (Closed 4名) がエントリー');
  engine.registerEntry('本田圭佑', 'チーム貸切X', 4, 'closed', new Date(baseTime.getTime() + 1000));
  printState(engine, 'ClosedグループがNext枠に単独配分（試合時間は8分に短縮）');

  console.log('>> Group 2: Open (4名) がエントリー');
  engine.registerEntry('長友佑都', 'チームOpenY', 4, 'open', new Date(baseTime.getTime() + 2000));

  console.log('>> Group 3: Open (2名) がエントリー');
  engine.registerEntry('三笘薫', 'チームOpenZ', 2, 'open', new Date(baseTime.getTime() + 3000));
  printState(engine, 'Open同士 [4名+2名=6名] が Next Next枠に割り当て！');
}

async function runScenario3_SuggestTips() {
  console.log('\n\n######################################################');
  console.log('🧪 シナリオ3: 【サジェストTips機能の動作検証】');
  console.log('######################################################');

  const engine = new MatchingEngine();
  const baseTime = new Date('2026-10-03T12:00:00Z');

  // まずNextとNext Nextを埋める
  engine.registerEntry('先客A', 'チームA', 6, 'open', new Date(baseTime.getTime() + 1000));
  engine.registerEntry('先客B', 'チームB', 6, 'open', new Date(baseTime.getTime() + 2000));
  printState(engine, 'NextとNext Nextが埋まった状態');

  console.log('>> 待機列に 4名 のOpenグループ (チームDelta) がエントリー');
  engine.registerEntry('久保建英', 'チームDelta', 4, 'open', new Date(baseTime.getTime() + 3000));
  printState(engine, 'Delta (4名) 待機中 -> サジェストTipsに注目');

  console.log('>> Tipsに従い 2名 のOpenグループ (チームEcho) がエントリー');
  engine.registerEntry('堂安律', 'チームEcho', 2, 'open', new Date(baseTime.getTime() + 4000));

  console.log('>> 進行中の試合を進める（NextをCurrentへ繰り上げ）');
  engine.advanceMatchLifecycle(new Date(baseTime.getTime() + 5000));
  printState(engine, '試合進行後: Delta(4名) + Echo(2名) が Next Next枠へ即座にマッチ！');
}

async function runScenario4_FlexibleMatching() {
  console.log('\n\n######################################################');
  console.log('🧪 シナリオ4: 【柔軟マッチング（5名フォールバック・時間経過判定）】');
  console.log('######################################################');

  // テスト用にしきい値を5秒に設定
  const engine = new MatchingEngine({ flexibleWaitTimeSeconds: 5 });
  const t0 = new Date('2026-10-03T13:00:00Z');

  console.log('>> Group A (3名, Open) と Group B (2名, Open) がエントリー（計5名）');
  engine.registerEntry('田中', 'チーム3名', 3, 'open', t0);
  engine.registerEntry('木村', 'チーム2名', 2, 'open', new Date(t0.getTime() + 1000));

  printState(engine, 'エントリー直後（まだ5秒未満なので6人目を待つ）');

  console.log('>> ⏰ 6秒経過... (規定待機時間を超過)');
  const tFuture = new Date(t0.getTime() + 6000);
  engine.recalculateSlots(tFuture);

  printState(engine, '6秒経過後: 柔軟マッチングが発動し、計5名 [3名 vs 2名] で試合成立！');
}

async function runScenario5_AdminSkip() {
  console.log('\n\n######################################################');
  console.log('🧪 シナリオ5: 【運営側Adminスキップ（不在時の無効化＆即時繰り上げ）】');
  console.log('######################################################');

  const engine = new MatchingEngine();
  const t0 = new Date('2026-10-03T14:00:00Z');

  console.log('>> [グループ1: 3名], [グループ2: 3名] でNext枠を構成');
  const g1 = engine.registerEntry('山田', '組1', 3, 'open', t0);
  engine.registerEntry('佐藤', '組2', 3, 'open', new Date(t0.getTime() + 1000));

  console.log('>> 後続の待機組 [グループ3: 3名], [グループ4: 3名] を登録（Next Next枠へ）');
  engine.registerEntry('鈴木', '組3', 3, 'open', new Date(t0.getTime() + 2000));
  engine.registerEntry('高橋', '組4', 3, 'open', new Date(t0.getTime() + 3000));

  printState(engine, 'スキップ前: Next枠に組1+組2、Next Next枠に組3+組4');

  console.log(`\n⚠️ 運営操作: Next枠の「組1」が呼び出しても不在！スキップボタンを実行！`);
  const skipped = engine.skipEntry(g1.id, '呼び出し時不在のため無効化');
  console.log(`スキップ実行結果: ${skipped}`);

  printState(engine, 'スキップ直後: 組1は無効化、組2は再編され、後続が自動繰り上げ');

  const g1Status = engine.getGroupStatus(g1.id);
  console.log(`組1の現在状態: status=${g1.status}, skipReason="${g1.skipReason}", slot=${g1Status?.slotName}`);
}

async function runScenario6_FifoPriority() {
  console.log('\n\n######################################################');
  console.log('🧪 シナリオ6: 【FIFO優先とビンパッキング [4名, 1名, 2名, 1名]】');
  console.log('######################################################');

  const engine = new MatchingEngine();
  const t0 = new Date('2026-10-03T15:00:00Z');

  console.log('>> 4名(A), 1名(B), 2名(C), 1名(D) が連続エントリー');
  engine.registerEntry('Aさん', 'チームA(4名)', 4, 'open', new Date(t0.getTime() + 1000));
  engine.registerEntry('Bさん', 'チームB(1名)', 1, 'open', new Date(t0.getTime() + 2000));
  engine.registerEntry('Cさん', 'チームC(2名)', 2, 'open', new Date(t0.getTime() + 3000));
  engine.registerEntry('Dさん', 'チームD(1名)', 1, 'open', new Date(t0.getTime() + 4000));

  printState(engine, 'エントリー後: 先頭A(4名)に対して [4名+1名+1名=6名] がFIFO順でマッチ成立！');
}

export async function runAllScenarios() {
  await runScenario1_ExactMatch();
  await runScenario2_ClosedAndOpen();
  await runScenario3_SuggestTips();
  await runScenario4_FlexibleMatching();
  await runScenario5_AdminSkip();
  await runScenario6_FifoPriority();
}
