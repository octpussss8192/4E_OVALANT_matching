import * as readline from 'node:readline';
import { MatchingEngine } from './matchingEngine.ts';
import { runAllScenarios } from './scenarios.ts';
import type { MatchingPreference } from './types.ts';

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function promptQuestion(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function interactiveMode() {
  const engine = new MatchingEngine({ flexibleWaitTimeSeconds: 30 });
  const rl = createPrompt();

  console.log('\n======================================================');
  console.log('🎮 3x3 サバゲーマッチングシステム 対話型CLI');
  console.log('======================================================');
  console.log('コマンド一覧:');
  console.log('  1: グループ新規エントリー (受付)');
  console.log('  2: 現在の待機・スロット状況を表示 (モニタ画面)');
  console.log('  3: 試合を1サイクル進める (Advance Match)');
  console.log('  4: 運営スキップ (不在グループの無効化)');
  console.log('  5: グループ一覧・ステータス詳細');
  console.log('  6: サンプル待機データを自動生成投入');
  console.log('  0: 終了');
  console.log('------------------------------------------------------');

  let running = true;
  while (running) {
    const choice = (await promptQuestion(rl, '\n選択してください (0-6) > ')).trim();

    switch (choice) {
      case '1': {
        const teamName = (await promptQuestion(rl, 'チーム名: ')).trim() || '名無しチーム';
        const leaderName = (await promptQuestion(rl, '代表者名: ')).trim() || '代表者';
        const countStr = (await promptQuestion(rl, '人数 (1〜6): ')).trim();
        const count = parseInt(countStr, 10);
        if (isNaN(count) || count < 1 || count > 6) {
          console.log('❌ 1〜6の数値を入力してください。');
          break;
        }
        const prefInput = (await promptQuestion(rl, '希望 [1: Open(他と合流OK) / 2: Closed(貸切)]: ')).trim();
        const pref: MatchingPreference = prefInput === '2' ? 'closed' : 'open';

        const g = engine.registerEntry(leaderName, teamName, count, pref);
        console.log(`✅ エントリー完了: [整理券番号 #${g.entryNumber}] ${g.teamName} (${g.memberCount}名 / ${g.preference})`);
        break;
      }

      case '2': {
        const state = engine.getQueueDisplayState();
        console.log('\n--- 📺 待機モニタ画面 ---');
        console.log(`💡 サジェストTips: ${state.suggestionTip.message}`);
        console.log(`👥 待機合計: ${state.totalWaitingGroups}組 (${state.totalWaitingPlayers}名)`);
        
        const printSlot = (m: any, label: string) => {
          if (!m) {
            console.log(`  [${label}]: (空き)`);
            return;
          }
          const groups = m.assignedGroups.map((g: any) => `${g.teamName}(${g.memberCount}名)`).join(' + ');
          const type = m.isClosedMatch ? '貸切' : '通常';
          let teamStr = '';
          if (m.teams) {
            const red = m.teams.teamRed.map((g: any) => g.teamName).join('+');
            const blue = m.teams.teamBlue.map((g: any) => g.teamName).join('+');
            teamStr = ` | 赤:${red}(${m.teams.teamRedCount}) vs 青:${blue}(${m.teams.teamBlueCount})`;
          }
          console.log(`  [${label}]: Match #${m.matchNumber} (${type}/${m.allocatedDurationMinutes}分) -> ${groups}${teamStr}`);
        };

        printSlot(state.currentMatch, '進行中 Current');
        printSlot(state.nextMatch, '呼出中 Next');
        printSlot(state.nextNextMatch, '待機中 Next Next');
        break;
      }

      case '3': {
        engine.advanceMatchLifecycle();
        console.log('⏩ 試合を1サイクル進めました。（Current終了 -> Next繰り上げ）');
        break;
      }

      case '4': {
        const entries = engine.getAllEntries().filter((e) => e.status !== 'completed' && e.status !== 'skipped');
        if (entries.length === 0) {
          console.log('スキップ可能なグループはありません。');
          break;
        }
        console.log('\n現在アクティブなグループ:');
        entries.forEach((e, idx) => {
          console.log(`  [${idx + 1}] #${e.entryNumber} ${e.teamName} (${e.memberCount}名, status: ${e.status})`);
        });
        const targetIdxStr = await promptQuestion(rl, 'スキップする番号を選択: ');
        const targetIdx = parseInt(targetIdxStr, 10) - 1;
        if (targetIdx >= 0 && targetIdx < entries.length) {
          const target = entries[targetIdx];
          engine.skipEntry(target.id, '運営による呼出不在スキップ');
          console.log(`⚠️ #${target.entryNumber} ${target.teamName} をスキップ・無効化しました。`);
        } else {
          console.log('無効な選択です。');
        }
        break;
      }

      case '5': {
        console.log('\n--- 📋 全グループ一覧 ---');
        const all = engine.getAllEntries();
        for (const g of all) {
          const s = engine.getGroupStatus(g.id);
          console.log(
            `#${g.entryNumber} ${g.teamName} (${g.memberCount}名, ${g.preference}) | 状態:${g.status} | スロット:${s?.slotName} | 予想待ち:${s?.estimatedWaitMinutes}分`
          );
        }
        break;
      }

      case '6': {
        console.log('🤖 テスト用グループを4組投入します...');
        engine.registerEntry('山田', 'Alpha', 3, 'open');
        engine.registerEntry('佐藤', 'Bravo', 2, 'open');
        engine.registerEntry('鈴木', 'Charlie', 1, 'open');
        engine.registerEntry('貸切組', 'Delta貸切', 4, 'closed');
        console.log('投入完了！「2」で状態を確認してください。');
        break;
      }

      case '0':
        running = false;
        break;

      default:
        console.log('無効な入力です。');
    }
  }

  rl.close();
  console.log('CLIを終了しました。');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--interactive') || args.includes('-i')) {
    await interactiveMode();
  } else {
    // デフォルトは全シナリオの自動実行＆デバッグ検証
    console.log('======================================================');
    console.log('🚀 3x3サバゲーマッチングシステム シナリオ検証デバッグ');
    console.log('======================================================');
    await runAllScenarios();
    console.log('\n💡 インタラクティブにコマンドを試す場合は以下を実行してください:');
    console.log('   node --experimental-strip-types src/cli.ts --interactive\n');
  }
}

main().catch(console.error);
