"""3x3 サバゲーマッチングシステム シナリオ検証スクリプト (scenarios.py)

このファイルでは、マッチングアルゴリズムが想定通りに動くか確認するための
シミュレーションシナリオ（テストケース）を定義しています。

実行方法:
  python scenarios.py
"""

from __future__ import annotations
import sys
from datetime import datetime, timedelta
from typing import Optional

# Windows コンソールでの文字化け・UnicodeEncodeError防止
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from models import Match, Preference
from matching_engine import MatchingEngine


def format_match_line(match: Optional[Match], label: str) -> str:
    """試合スロットを1行の文字列にフォーマットして返します。"""
    if match is None:
        return f"  [{label}]: (空きスロット)"

    group_strs = [
        f"{g.team_name}({g.member_count}名/{g.preference.value})"
        for g in match.assigned_groups
    ]
    match_type = "【貸切/Closed】" if match.is_closed_match else "【通常/Open】"
    duration = f"{match.allocated_duration_minutes}分"

    team_str = ""
    if match.teams:
        red_parts = [
            f"{t.group.team_name}({t.player_count}名)" for t in match.teams.team_red
        ]
        blue_parts = [
            f"{t.group.team_name}({t.player_count}名)" for t in match.teams.team_blue
        ]
        red_str = " + ".join(red_parts)
        blue_str = " + ".join(blue_parts)
        team_str = f" -> [Red: {red_str} ({match.teams.team_red_count}名) vs Blue: {blue_str} ({match.teams.team_blue_count}名)]"

    return f"  [{label}]: Match #{match.match_number} {match_type} 計{match.total_players}名 ({duration}) : {' + '.join(group_strs)}{team_str}"


def print_monitor(engine: MatchingEngine, title: str) -> None:
    """待機モニタ風の出力を行います。"""
    state = engine.get_display_state()
    print("\n" + "=" * 60)
    print(f"🔷 {title}")
    print("=" * 60)
    print(
        f"【待機状況】 待機グループ数: {state['total_waiting_groups']}組 / 待機人数: {state['total_waiting_players']}名"
    )
    print(f"【サジェストTips】💡 {state['suggestion_tip'].message}")
    print("【試合スロット状況】")
    print(format_match_line(state["current_match"], "Current (進行中)"))
    print(format_match_line(state["next_match"], "Next (呼出中)"))
    print(format_match_line(state["next_next_match"], "Next Next (待機)"))
    print("-" * 60)


# =============================================================================
# 各シナリオの定義
# =============================================================================

def scenario_1_exact_match():
    print("\n\n" + "#" * 60)
    print("🧪 シナリオ1: 【分割なしのぴったり3vs3 [3名, 2名, 1名] のOpen組】")
    print("#" * 60)

    engine = MatchingEngine()
    t0 = datetime(2026, 10, 10, 10, 0, 0)

    print_monitor(engine, "初期状態（待機なし）")

    print(">> Group A (3名, Open) がエントリー")
    engine.register_entry("山田太郎", "チームAlpha", 3, Preference.OPEN, t0 + timedelta(seconds=1))
    print_monitor(engine, "Group A 登録後")

    print(">> Group B (2名, Open) がエントリー")
    engine.register_entry("佐藤花子", "チームBravo", 2, Preference.OPEN, t0 + timedelta(seconds=2))
    print_monitor(engine, "Group B 登録後（合計5名: 3vs3厳守のため6名に満たず保留）")

    print(">> Group C (1名, Open) がエントリー（合計6名到達！）")
    engine.register_entry("鈴木一郎", "ソロCharlie", 1, Preference.OPEN, t0 + timedelta(seconds=3))
    print_monitor(engine, "Group C 登録後 -> [3名] vs [2名+1名] で分割なしの厳密な 3 vs 3 が成立！")


def scenario_2_closed_and_open():
    print("\n\n" + "#" * 60)
    print("🧪 シナリオ2: 【Closed（貸切6名）と通常Openの共存 & 貸切時間短縮】")
    print("#" * 60)

    engine = MatchingEngine()
    t0 = datetime(2026, 10, 10, 11, 0, 0)

    print(">> Group 1: 貸切希望 (Closed 6名) がエントリー")
    engine.register_entry("本田圭佑", "チーム貸切X", 6, Preference.CLOSED, t0 + timedelta(seconds=1))
    print_monitor(engine, "ClosedグループがNext枠に単独配分（内戦3vs3 / 試合時間8分）")

    print(">> Group 2: Open (3名) がエントリー")
    engine.register_entry("長友佑都", "チームOpenY", 3, Preference.OPEN, t0 + timedelta(seconds=2))

    print(">> Group 3: Open (3名) がエントリー")
    engine.register_entry("三笘薫", "チームOpenZ", 3, Preference.OPEN, t0 + timedelta(seconds=3))
    print_monitor(engine, "Open同士 [3名 vs 3名] が Next Next枠に割り当て！")


def scenario_3_suggest_tips():
    print("\n\n" + "#" * 60)
    print("🧪 シナリオ3: 【3vs3即時成立に向けたサジェストTips機能の動作検証】")
    print("#" * 60)

    engine = MatchingEngine()
    t0 = datetime(2026, 10, 10, 12, 0, 0)

    # Next枠とNext Next枠を埋める
    engine.register_entry("先客A", "チームA", 6, Preference.OPEN, t0 + timedelta(seconds=1))
    engine.register_entry("先客B", "チームB", 6, Preference.OPEN, t0 + timedelta(seconds=2))
    print_monitor(engine, "NextとNext Nextが埋まった状態")

    print(">> 待機列に 4名 のOpenグループ (チームDelta) がエントリー")
    engine.register_entry("久保建英", "チームDelta", 4, Preference.OPEN, t0 + timedelta(seconds=3))
    print_monitor(engine, "Delta (4名) 待機中 -> サジェストTipsに注目（あと2名で3vs3成立）")

    print(">> Tipsに従い 2名 のOpenグループ (チームEcho) がエントリー")
    engine.register_entry("堂安律", "チームEcho", 2, Preference.OPEN, t0 + timedelta(seconds=4))

    print(">> 進行中の試合を進める（NextをCurrentへ繰り上げ）")
    engine.advance_match_lifecycle(t0 + timedelta(seconds=5))
    print_monitor(engine, "試合進行後: Delta(4名) + Echo(2名) が分割配分され 3 vs 3 として Next Next枠へ即座にマッチ！")


def scenario_4_group_splitting():
    print("\n\n" + "#" * 60)
    print("🧪 シナリオ4: 【グループ分割による 3 vs 3 編成 [4名組 + 2名組]】")
    print("#" * 60)

    engine = MatchingEngine()
    t0 = datetime(2026, 10, 10, 13, 0, 0)

    print(">> Group A (4名, Open) と Group B (2名, Open) がエントリー（計6名）")
    engine.register_entry("田中", "チーム4名組", 4, Preference.OPEN, t0)
    engine.register_entry("木村", "チーム2名組", 2, Preference.OPEN, t0 + timedelta(seconds=1))

    print_monitor(engine, "エントリー後: 4名組が [Red 3名] と [Blue 1名] に分割され、完全な 3 vs 3 が成立！")


def scenario_5_admin_skip():
    print("\n\n" + "#" * 60)
    print("🧪 シナリオ5: 【運営側Adminスキップ（不在時の無効化＆即時繰り上げ）】")
    print("#" * 60)

    engine = MatchingEngine()
    t0 = datetime(2026, 10, 10, 14, 0, 0)

    print(">> [組1: 3名], [組2: 3名] でNext枠を構成")
    g1 = engine.register_entry("山田", "組1", 3, Preference.OPEN, t0)
    engine.register_entry("佐藤", "組2", 3, Preference.OPEN, t0 + timedelta(seconds=1))

    print(">> 後続の待機組 [組3: 3名], [組4: 3名] を登録（Next Next枠へ）")
    engine.register_entry("鈴木", "組3", 3, Preference.OPEN, t0 + timedelta(seconds=2))
    engine.register_entry("高橋", "組4", 3, Preference.OPEN, t0 + timedelta(seconds=3))

    print_monitor(engine, "スキップ前: Next枠に組1+組2、Next Next枠に組3+組4")

    print("\n⚠️ 運営操作: Next枠の「組1」が呼び出しても不在！スキップを実行！")
    skipped = engine.skip_entry(g1.id, "呼出不在のため無効化")
    print(f"スキップ実行結果: {skipped}")

    print_monitor(engine, "スキップ直後: 組1は無効化、組2は待機列に戻り、後続の組3+組4がNext枠へ自動繰り上げ")


def scenario_6_five_plus_one_split():
    print("\n\n" + "#" * 60)
    print("🧪 シナリオ6: 【5名グループ＋1名ソロのグループ分割 3 vs 3】")
    print("#" * 60)

    engine = MatchingEngine()
    t0 = datetime(2026, 10, 10, 15, 0, 0)

    print(">> 5名グループ (チームGiant) と 1名ソロ (ソロプレイヤー) がエントリー")
    engine.register_entry("大谷", "チームGiant(5名)", 5, Preference.OPEN, t0 + timedelta(seconds=1))
    engine.register_entry("ダルビッシュ", "ソロプレイヤー(1名)", 1, Preference.OPEN, t0 + timedelta(seconds=2))

    print_monitor(engine, "エントリー後: 5名組が [Red 3名] と [Blue 2名] に分割され、ソロと合流して 3 vs 3 成立！")


def run_all_scenarios():
    """全シナリオを順番に実行"""
    scenario_1_exact_match()
    scenario_2_closed_and_open()
    scenario_3_suggest_tips()
    scenario_4_group_splitting()
    scenario_5_admin_skip()
    scenario_6_five_plus_one_split()


if __name__ == "__main__":
    run_all_scenarios()
