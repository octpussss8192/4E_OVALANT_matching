"""新機能テスト: 3/2スタッフ補充 & 不在スキップ即時再探索
"""
from matching_engine import MatchingEngine
from models import Preference
from scenarios import format_match_line

def test_three_two_staff():
    print("=== テストA: 3名組 + 2名組 (計5名 + スタッフ1名) ===")
    engine = MatchingEngine()
    engine.register_entry("山田", "3名組A", 3, Preference.OPEN)
    engine.register_entry("佐藤", "2名組B", 2, Preference.OPEN)

    state = engine.get_display_state()
    print(format_match_line(state["next_match"], "Next (呼出中)"))
    assert state["next_match"] is not None
    assert state["next_match"].is_staff_assisted is True

def test_skip_and_rematch():
    print("\n=== テストB: 不在スキップ時の即時再探索 & 再マッチング ===")
    engine = MatchingEngine()
    g1 = engine.register_entry("山田", "組1(3名)", 3, Preference.OPEN)
    g2 = engine.register_entry("佐藤", "組2(3名)", 3, Preference.OPEN)
    g3 = engine.register_entry("鈴木", "後続(2名)", 2, Preference.OPEN)

    print("--- スキップ前 ---")
    state = engine.get_display_state()
    print(format_match_line(state["next_match"], "Next (呼出中)"))
    print("待機人数:", state["total_waiting_players"])

    print("\n>> 運営操作: 組1を不在スキップ！")
    engine.skip_entry(g1.id, "呼出不在")

    print("\n--- スキップ直後 ---")
    state = engine.get_display_state()
    # 組2(3名) と 後続(2名) がスタッフ補充ですぐにマッチングされたか？
    print(format_match_line(state["next_match"], "Next (呼出中)"))
    assert state["next_match"] is not None
    assert any(g.id == g2.id for g in state["next_match"].assigned_groups)
    assert any(g.id == g3.id for g in state["next_match"].assigned_groups)
    print("✅ 組2(3名) と 後続(2名) が即座に再マッチングされました！")

if __name__ == "__main__":
    test_three_two_staff()
    test_skip_and_rematch()
