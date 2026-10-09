"""3x3 サバゲーマッチングシステム 対話型CLI (cli.py)

ターミナル上で手動でグループエントリー、待機モニタ確認、試合進行、スキップ操作を
対話形式でシミュレーションできます。

実行方法:
  python cli.py
"""

from __future__ import annotations
import sys

# Windows コンソールでの文字化け防止
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from models import Preference, EntryStatus
from matching_engine import MatchingEngine
from scenarios import format_match_line


def print_menu():
    print("\n" + "=" * 56)
    print("🎮 3x3 サバゲーマッチングシステム 対話型CLI (Python版)")
    print("=" * 56)
    print("コマンド一覧:")
    print("  1: グループ新規エントリー (受付)")
    print("  2: 現在の待機・スロット状況を表示 (モニタ画面)")
    print("  3: 試合を1サイクル進める (Advance Match)")
    print("  4: 運営スキップ (不在グループの無効化)")
    print("  5: グループ一覧・ステータス詳細")
    print("  6: サンプル待機データを自動生成投入")
    print("  0: 終了")
    print("-" * 56)


def interactive_mode():
    engine = MatchingEngine()
    print_menu()

    while True:
        try:
            choice = input("\n選択してください (0-6) > ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\n終了します。")
            break

        if choice == "0":
            print("CLIを終了しました。お疲れ様でした！")
            break

        elif choice == "1":
            # 新規エントリー
            print("\n--- 📝 グループ新規エントリー ---")
            team_name = input("チーム名: ").strip() or "名無しチーム"
            leader_name = input("代表者名: ").strip() or "代表者"
            count_str = input("人数 (1〜6名): ").strip()
            try:
                count = int(count_str)
            except ValueError:
                print("❌ 数値を入力してください。")
                continue

            pref_str = input("希望 [1: 通常(Open) / 2: 貸切(Closed・6名限定)]: ").strip()
            pref = Preference.CLOSED if pref_str == "2" else Preference.OPEN

            try:
                g = engine.register_entry(leader_name, team_name, count, pref)
                print(
                    f"✅ エントリー完了: [整理券 #{g.entry_number}] {g.team_name} "
                    f"({g.member_count}名 / {g.preference.value})"
                )
            except ValueError as e:
                print(f"❌ エラー: {e}")

        elif choice == "2":
            # モニタ画面表示
            state = engine.get_display_state()
            print("\n--- 📺 待機モニタ画面 ---")
            print(f"💡 サジェストTips: {state['suggestion_tip'].message}")
            print(
                f"👥 待機合計: {state['total_waiting_groups']}組 ({state['total_waiting_players']}名)"
            )
            print(format_match_line(state["current_match"], "進行中 Current"))
            print(format_match_line(state["next_match"], "呼出中 Next"))
            print(format_match_line(state["next_next_match"], "待機中 Next Next"))

        elif choice == "3":
            # 試合進行
            engine.advance_match_lifecycle()
            print("⏩ 試合を1サイクル進めました。（Current終了 ➔ Next繰り上げ）")

        elif choice == "4":
            # 運営スキップ
            active_entries = [
                e
                for e in engine.get_all_entries()
                if e.status not in (EntryStatus.COMPLETED, EntryStatus.SKIPPED, EntryStatus.CANCELLED)
            ]
            if not active_entries:
                print("現在スキップ可能なアクティブなグループはありません。")
                continue

            print("\n現在アクティブなグループ一覧:")
            for idx, e in enumerate(active_entries, 1):
                print(
                    f"  [{idx}] #{e.entry_number} {e.team_name} "
                    f"({e.member_count}名, 状態: {e.status.value})"
                )

            target_idx_str = input("スキップする番号を選択: ").strip()
            try:
                target_idx = int(target_idx_str) - 1
                if 0 <= target_idx < len(active_entries):
                    target = active_entries[target_idx]
                    engine.skip_entry(target.id, reason="運営による呼出不在スキップ")
                    print(
                        f"⚠️ #{target.entry_number} {target.team_name} をスキップ・無効化しました。"
                    )
                else:
                    print("無効な番号です。")
            except ValueError:
                print("数値を入力してください。")

        elif choice == "5":
            # 全グループ一覧
            entries = engine.get_all_entries()
            if not entries:
                print("エントリー履歴がまだありません。")
                continue

            print("\n--- 📋 全グループ一覧 ---")
            for g in entries:
                match_info = f" (Match ID: {g.assigned_match_id})" if g.assigned_match_id else ""
                print(
                    f"#{g.entry_number} {g.team_name} ({g.member_count}名, {g.preference.value}) | "
                    f"代表: {g.leader_name} | 状態: {g.status.value}{match_info}"
                )

        elif choice == "6":
            # サンプルデータ投入
            print("🤖 サンプルグループを4組投入します...")
            engine.register_entry("山田", "Alpha", 3, Preference.OPEN)
            engine.register_entry("佐藤", "Bravo", 2, Preference.OPEN)
            engine.register_entry("鈴木", "Charlie", 1, Preference.OPEN)
            engine.register_entry("貸切組", "Delta貸切", 6, Preference.CLOSED)
            print("投入完了！「2」を押してスロット状況を確認してください。")

        else:
            print("無効な入力です。0〜6の数字を入力してください。")


if __name__ == "__main__":
    interactive_mode()
