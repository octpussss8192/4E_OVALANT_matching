"""エッジケース検証テストスクリプト (test_edge_cases.py)
"""
from matching_engine import MatchingEngine
from models import Preference

def test_pattern_c_two_two_two():
    print("=== テスト1: 2名×3組 (計6名) ===")
    engine = MatchingEngine()
    g1 = engine.register_entry("A", "チームA(2名)", 2, Preference.OPEN)
    g2 = engine.register_entry("B", "チームB(2名)", 2, Preference.OPEN)
    g3 = engine.register_entry("C", "チームC(2名)", 2, Preference.OPEN)

    state = engine.get_display_state()
    match = state["next_match"]
    if match and match.teams:
        print("マッチ成立!")
        print("Red:", [(t.group.team_name, t.player_count) for t in match.teams.team_red])
        print("Blue:", [(t.group.team_name, t.player_count) for t in match.teams.team_blue])
    else:
        print("マッチ不成立")

def test_pattern_hol_blocking():
    print("\n=== テスト2: 先頭が4名で、後から3名+3名が来た場合 (Head-of-Line Blocking) ===")
    engine = MatchingEngine()
    g1 = engine.register_entry("A", "先頭4名組", 4, Preference.OPEN)
    g2 = engine.register_entry("B", "後続3名組1", 3, Preference.OPEN)
    g3 = engine.register_entry("C", "後続3名組2", 3, Preference.OPEN)

    state = engine.get_display_state()
    print("Next Match:", state["next_match"])
    print("待機グループ数:", state["total_waiting_groups"])

def test_pattern_four_four():
    print("\n=== テスト3: 4名組 + 4名組 (計8名) ===")
    engine = MatchingEngine()
    g1 = engine.register_entry("A", "4名組1", 4, Preference.OPEN)
    g2 = engine.register_entry("B", "4名組2", 4, Preference.OPEN)

    state = engine.get_display_state()
    print("Next Match:", state["next_match"])
    print("待機人数:", state["total_waiting_players"])

if __name__ == "__main__":
    test_pattern_c_two_two_two()
    test_pattern_hol_blocking()
    test_pattern_four_four()
