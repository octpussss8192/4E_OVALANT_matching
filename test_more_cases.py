"""追加エッジケース検証スクリプト (test_more_cases.py)
"""
from matching_engine import MatchingEngine
from models import Preference

def test_pattern_solos():
    print("=== テスト4: ソロプレイヤー×6名 ===")
    engine = MatchingEngine()
    for i in range(1, 7):
        engine.register_entry(f"Solo{i}", f"ソロ{i}", 1, Preference.OPEN)
    
    state = engine.get_display_state()
    match = state["next_match"]
    if match and match.teams:
        print("マッチ成立!")
        print("Red Count:", match.teams.team_red_count, [(t.group.team_name, t.player_count) for t in match.teams.team_red])
        print("Blue Count:", match.teams.team_blue_count, [(t.group.team_name, t.player_count) for t in match.teams.team_blue])

def test_pattern_two_two_one_one():
    print("\n=== テスト5: 2名, 2名, 1名, 1名 (計6名) ===")
    engine = MatchingEngine()
    engine.register_entry("A", "2名A", 2, Preference.OPEN)
    engine.register_entry("B", "2名B", 2, Preference.OPEN)
    engine.register_entry("C", "1名C", 1, Preference.OPEN)
    engine.register_entry("D", "1名D", 1, Preference.OPEN)
    
    state = engine.get_display_state()
    match = state["next_match"]
    if match and match.teams:
        print("マッチ成立!")
        print("Red:", [(t.group.team_name, t.player_count) for t in match.teams.team_red])
        print("Blue:", [(t.group.team_name, t.player_count) for t in match.teams.team_blue])

def test_pattern_closed_then_open():
    print("\n=== テスト6: 貸切6名が先頭で、後続にOpen 6名 ===")
    engine = MatchingEngine()
    engine.register_entry("C", "貸切組", 6, Preference.CLOSED)
    engine.register_entry("O1", "Open3名A", 3, Preference.OPEN)
    engine.register_entry("O2", "Open3名B", 3, Preference.OPEN)
    
    state = engine.get_display_state()
    print("Next Match (Closed?):", state["next_match"].is_closed_match if state["next_match"] else None)
    print("Next Next Match (Open?):", state["next_next_match"].is_closed_match if state["next_next_match"] else None)

if __name__ == "__main__":
    test_pattern_solos()
    test_pattern_two_two_one_one()
    test_pattern_closed_then_open()
