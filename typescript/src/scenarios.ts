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
    const red = match.teams.teamRed.map((t) => `${t.group.teamName}(${t.playerCount}名)`).join(' + ');
    const blue = match.teams.teamBlue.map((t) => `${t.group.teamName}(${t.playerCount}名)`).join(' + ');
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
  console.log('🧪 シナリオ1: 【分割なしのぴったり3vs3マッチング [3名, 2名, 1名] のOpen組】');
  console.log('######################################################');

  const engine = new MatchingEngine();
  const baseTime = new Date('2026-10-03T10:00:00Z');

  printState(engine, '初期状態（待機なし）');

  console.log('>> Group A (3名, Open) がエントリー');
  engine.registerEntry('山田太郎', 'チームAlpha', 3, 'open', new Date(baseTime.getTime() + 1000));
  printState(engine, 'Group A 登録後');

  console.log('>> Group B (2名, Open) がエントリー');
  engine.registerEntry('佐藤花子', 'チームBravo', 2, 'open', new Date(baseTime.getTime() + 2000));
  printState(engine, 'Group B 登録後（合計5名: 3vs3厳守のため6名に満たずマッチ保留）');

  console.log('>> Group C (1名, Open) がエントリー（合計6名到達！）');
  engine.registerEntry('鈴木一郎', 'ソロプレイヤーCharlie', 1, 'open', new Date(baseTime.getTime() + 3000));
  printState(engine, 'Group C 登録後 -> [3名] vs [2名+1名] で分割なしの厳密な 3 vs 3 が成立！');

  const statusAlpha = engine.getGroupStatus(engine.getAllEntries()[0].id);
  console.log(`📊 チームAlphaのステータス: スロット=${statusAlpha?.slotName}, 予想待ち時間=${statusAlpha?.estimatedWaitMinutes}分`);
}

async function runScenario2_ClosedAndOpen() {
  console.log('\n\n######################################################');
  console.log('🧪 シナリオ2: 【Closed（貸切6名）とOpenの共存 & 貸切試合時間短縮】');
  console.log('######################################################');

  const engine = new MatchingEngine();
  const baseTime = new Date('2026-10-03T11:00:00Z');

  console.log('>> Group 1: 貸切希望 (Closed 6名) がエントリー');
  engine.registerEntry('本田圭佑', 'チーム貸切X', 6, 'closed', new Date(baseTime.getTime() + 1000));
  printState(engine, 'ClosedグループがNext枠に単独配分（内戦3vs3 / 試合時間は8分に短縮）');

  console.log('>> Group 2: Open (3名) がエントリー');
  engine.registerEntry('長友佑都', 'チームOpenY', 3, 'open', new Date(baseTime.getTime() + 2000));

  console.log('>> Group 3: Open (3名) がエントリー');
  engine.registerEntry('三笘薫', 'チームOpenZ', 3, 'open', new Date(baseTime.getTime() + 3000));
  printState(engine, 'Open同士 [3名 vs 3名] が Next Next枠に割り当て！');
}

async function runScenario3_SuggestTips() {
  console.log('\n\n######################################################');
  console.log('🧪 シナリオ3: 【3vs3即時成立に向けたサジェストTips機能の動作検証】');
  console.log('######################################################');

  const engine = new MatchingEngine();
  const baseTime = new Date('2026-10-03T12:00:00Z');

  // まずNextとNext Nextを埋める
  engine.registerEntry('先客A', 'チームA', 6, 'open', new Date(baseTime.getTime() + 1000));
  engine.registerEntry('先客B', 'チームB', 6, 'open', new Date(baseTime.getTime() + 2000));
  printState(engine, 'NextとNext Nextが埋まった状態');

  console.log('>> 待機列に 4名 のOpenグループ (チームDelta) がエントリー');
  engine.registerEntry('久保建英', 'チームDelta', 4, 'open', new Date(baseTime.getTime() + 3000));
  printState(engine, 'Delta (4名) 待機中 -> サジェストTipsに注目（あと2名で3vs3成立）');

  console.log('>> Tipsに従い 2名 のOpenグループ (チームEcho) がエントリー');
  engine.registerEntry('堂安律', 'チームEcho', 2, 'open', new Date(baseTime.getTime() + 4000));

  console.log('>> 進行中の試合を進める（NextをCurrentへ繰り上げ）');
  engine.advanceMatchLifecycle(new Date(baseTime.getTime() + 5000));
  printState(engine, '試合進行後: Delta(4名) + Echo(2名) が分割配分され 3 vs 3 として Next Next枠へ即座にマッチ！');
}

async function runScenario4_GroupSplitting() {
  console.log('\n\n######################################################');
  console.log('🧪 シナリオ4: 【グループ分割による3 vs 3編成 [4名組 + 2名組]】');
  console.log('######################################################');

  const engine = new MatchingEngine();
  const t0 = new Date('2026-10-03T13:00:00Z');

  console.log('>> Group A (4名, Open) と Group B (2名, Open) がエントリー（計6名）');
  engine.registerEntry('田中', 'チーム4名組', 4, 'open', t0);
  engine.registerEntry('木村', 'チーム2名組', 2, 'open', new Date(t0.getTime() + 1000));

  printState(engine, 'エントリー後: 4名組が [Red 3名] と [Blue 1名] に分割され、完全な 3 vs 3 が成立！');
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

async function runScenario6_FivePlusOneSplit() {
  console.log('\n\n######################################################');
  console.log('🧪 シナリオ6: 【5名グループ＋1名ソロのグループ分割 3 vs 3】');
  console.log('######################################################');

  const engine = new MatchingEngine();
  const t0 = new Date('2026-10-03T15:00:00Z');

  console.log('>> 5名グループ (チームGiant) と 1名ソロ (ソロプレイヤー) がエントリー');
  engine.registerEntry('大谷', 'チームGiant(5名)', 5, 'open', new Date(t0.getTime() + 1000));
  engine.registerEntry('ダルビッシュ', 'ソロプレイヤー(1名)', 1, 'open', new Date(t0.getTime() + 2000));

  printState(engine, 'エントリー後: 5名組が [Red 3名] と [Blue 2名] に分割され、ソロ(1名)と合流して 3 vs 3 成立！');
}

export async function runAllScenarios() {
  await runScenario1_ExactMatch();
  await runScenario2_ClosedAndOpen();
  await runScenario3_SuggestTips();
  await runScenario4_GroupSplitting();
  await runScenario5_AdminSkip();
  await runScenario6_FivePlusOneSplit();
}
