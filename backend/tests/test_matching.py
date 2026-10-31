"""Unit tests for OVERTER WATCH2026 matching engine and API endpoints."""

import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
import backend.app.api as api_module
from backend.app.main import app
from backend.app.models import PreferenceType, MatchStatus, EntryStatus
from backend.app.matching_engine import MatchingEngine

# 本番Supabase連携を強制的に無効化
api_module.engine.disable_supabase = True

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_system_state():
    """各テスト前にシステム状態をリセット（テスト専用インメモリ環境）"""
    api_module.engine.disable_supabase = True
    client.post("/api/admin/reset")


def test_closed_auto_assignment_for_large_groups():
    """4〜6名エントリー時は、友人の敵味方分断を防ぐため強制的に Closed (8分) になる"""
    res = client.post(
        "/api/entries",
        json={
            "session_id": "session-4p",
            "leader_name": "山田太郎",
            "team_name": "4人組チーム",
            "headcount": 4,
            "preference": "open",  # open を希望しても自動的に closed に補正
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["entry"]["preference"] == "closed"
    assert data["slot_name"] == "next"  # 空きスロット Next に即時配分

    # 全体ステータス確認
    status_res = client.get("/api/status")
    status_data = status_res.json()
    next_match = status_data["next_match"]
    assert next_match is not None
    assert next_match["is_closed_match"] is True
    assert next_match["duration_minutes"] == 8
    assert next_match["total_players"] == 4


def test_open_matching_no_group_split_3_2_1():
    """Open枠: [3名, 2名, 1名] の組み合わせでグループ分割なし (Red 3名 vs Blue 3名) が成立"""
    # 1組目: 3名 Open
    r1 = client.post(
        "/api/entries",
        json={
            "session_id": "s1",
            "leader_name": "リーダーA",
            "team_name": "チームA(3名)",
            "headcount": 3,
            "preference": "open",
        },
    )
    assert r1.status_code == 200
    # まだ3名なのでマッチング保留
    assert r1.json()["slot_name"] == "waiting"

    # 2組目: 2名 Open
    r2 = client.post(
        "/api/entries",
        json={
            "session_id": "s2",
            "leader_name": "リーダーB",
            "team_name": "チームB(2名)",
            "headcount": 2,
            "preference": "open",
        },
    )
    assert r2.status_code == 200
    assert r2.json()["slot_name"] == "waiting"

    # 3組目: 1名 Open (合計6名到達！)
    r3 = client.post(
        "/api/entries",
        json={
            "session_id": "s3",
            "leader_name": "リーダーC",
            "team_name": "ソロC(1名)",
            "headcount": 1,
            "preference": "open",
        },
    )
    assert r3.status_code == 200

    # 試合スロット確認
    status_res = client.get("/api/status")
    status_data = status_res.json()
    match = status_data["next_match"]
    assert match is not None
    assert match["total_players"] == 6
    assert match["duration_minutes"] == 10
    assert match["is_closed_match"] is False

    # チーム分けの検証: グループ分割なしで Red 3名 vs Blue 3名
    red_count = match["teams"]["red"]["total_count"]
    blue_count = match["teams"]["blue"]["total_count"]
    assert red_count == 3
    assert blue_count == 3


def test_admin_skip_with_partner_rematch():
    """不在スキップ時: Open枠の相方グループは待機キュー最優先に戻り、後続と再マッチング"""
    # 組1 (3名) と 組2 (3名) で Next枠を構成
    r1 = client.post(
        "/api/entries",
        json={"session_id": "s1", "leader_name": "A", "team_name": "組1", "headcount": 3, "preference": "open"},
    )
    r2 = client.post(
        "/api/entries",
        json={"session_id": "s2", "leader_name": "B", "team_name": "組2", "headcount": 3, "preference": "open"},
    )
    g1_id = r1.json()["entry"]["id"]
    g2_id = r2.json()["entry"]["id"]

    # 後続に 組3 (3名) が待機
    r3 = client.post(
        "/api/entries",
        json={"session_id": "s3", "leader_name": "C", "team_name": "組3", "headcount": 3, "preference": "open"},
    )
    g3_id = r3.json()["entry"]["id"]

    # スキップ前: Next枠に組1+組2、待機列に組3
    status1 = client.get("/api/status").json()
    assert status1["next_match"] is not None
    assert status1["total_waiting_groups"] == 1

    # 運営が「組1」を不在スキップ
    skip_res = client.post(f"/api/admin/entries/{g1_id}/skip", json={"reason": "呼出不在"})
    assert skip_res.status_code == 200

    # スキップ後: 組1は無効化、残された組2(3名)と後続の組3(3名)で即座に再マッチングが成立！
    status2 = client.get("/api/status").json()
    next_match = status2["next_match"]
    assert next_match is not None
    group_ids_in_match = [g["id"] for g in next_match["assigned_groups"]]
    assert g2_id in group_ids_in_match
    assert g3_id in group_ids_in_match
    assert g1_id not in group_ids_in_match


def test_flexible_5_player_fallback_after_waiting():
    """待機時間が閾値を超過した際、合計5名 (3名 vs 2名) で柔軟マッチングが発動"""
    import tempfile
    from pathlib import Path
    engine = MatchingEngine(flexible_wait_seconds=5, storage_path=Path(tempfile.mktemp(suffix='.json')), disable_supabase=True)
    t0 = datetime(2026, 10, 17, 10, 0, 0)

    # 3名 と 2名 がエントリー
    g1 = engine.register_entry("s1", "A", "組3名", 3, PreferenceType.OPEN, created_at=t0)
    g2 = engine.register_entry("s2", "B", "組2名", 2, PreferenceType.OPEN, created_at=t0 + timedelta(seconds=1))

    # エントリー直後 (5秒未満) は保留
    assert len(engine.matches) == 0

    # 6秒経過したタイミングで再計算
    t_after = t0 + timedelta(seconds=6)
    engine.recalculate_slots(current_time=t_after)

    # 柔軟マッチングが発動して合計5名で成立
    assert len(engine.matches) == 1
    match = engine.matches[0]
    assert match.total_players == 5
    assert match.teams.red.total_count == 3
    assert match.teams.blue.total_count == 2


def test_multiple_entries_allowed():
    """同一 session_id による複数エントリーの許可（追加エントリー仕様）"""
    r1 = client.post(
        "/api/entries",
        json={"session_id": "same-device", "leader_name": "初手", "team_name": "A", "headcount": 2, "preference": "open"},
    )
    assert r1.status_code == 200
    entry1 = r1.json()["entry"]

    r2 = client.post(
        "/api/entries",
        json={"session_id": "same-device", "leader_name": "2回目", "team_name": "B", "headcount": 2, "preference": "open"},
    )
    assert r2.status_code == 200
    entry2 = r2.json()["entry"]
    assert entry1["id"] != entry2["id"]
    assert entry2["entry_number"] > entry1["entry_number"]

    # session_id によるエントリー一覧逆引きテスト
    r_list = client.get("/api/entries/by-session/same-device")
    assert r_list.status_code == 200
    session_entries = r_list.json()
    assert len(session_entries) == 2
    # 最新（2回目）が先頭に来ていること
    assert session_entries[0]["entry"]["id"] == entry2["id"]
    assert session_entries[1]["entry"]["id"] == entry1["id"]


def test_state_preserved_when_supabase_transiently_fails(tmp_path):
    """Supabase の load_state が一時的な通信エラー (None) を返しても、既存の予約者データが消えないことを検証"""
    eng = MatchingEngine(storage_path=tmp_path / "state.json", disable_supabase=False)
    # 擬似的に Supabase が有効かつ1回ロード済みで2組の予約者がいる状態を作る
    eng._is_supabase_active = lambda: True
    eng._has_loaded_once = True
    eng.supabase.save_state = lambda entries, matches: True

    e1 = eng.register_entry("sess-1", "予約者1", "チーム1", 2, PreferenceType.OPEN)
    e2 = eng.register_entry("sess-2", "予約者2", "チーム2", 2, PreferenceType.OPEN)
    assert len(eng.entries) == 2

    # ここで Supabase 通信が一時的に失敗して None を返したと仮定
    eng.supabase.load_state = lambda: None

    # load_state を呼んでも予約者データが白紙（0件）にリセットされず維持されること！
    ok = eng.load_state()
    assert ok is True
    assert len(eng.entries) == 2
    assert eng.entries[0].id == e1.id
    assert eng.entries[1].id == e2.id
    assert eng.next_entry_number == 103


def test_cold_start_supabase_failure_prevents_empty_overwrite(tmp_path):
    """コールドスタート直後（未ロードかつローカルファイルなし）に Supabase 通信が失敗した場合、
    空データ（101番）で初期化して DB を破壊するのを防ぐため False を返すことを検証"""
    eng = MatchingEngine(storage_path=tmp_path / "non_existent.json", disable_supabase=False)
    eng._is_supabase_active = lambda: True
    eng._has_loaded_once = False
    eng.entries.clear()
    eng.supabase.load_state = lambda: None

    ok = eng.load_state()
    assert ok is False


def test_duplicate_entry_number_409_conflict_auto_renumbering():
    """複数サーバーレスインスタンス間で entry_number=101 が衝突 (409 Conflict) した際、
    自動的にリモートの最大番号+1へリナンバーして予約者データを確実に保存することを検証"""
    from backend.app.supabase_client import SupabaseStorage
    from backend.app.models import EntryGroup

    storage = SupabaseStorage(url="https://example.supabase.co", key="dummy-key")
    storage.is_configured = lambda: True

    posted_payloads = []

    class DummyResponse:
        def __init__(self, status_code, data=None, text=""):
            self.status_code = status_code
            self._data = data or []
            self.text = text

        def json(self):
            return self._data

    class MockClient:
        is_closed = False

        def post(self, path, json=None):
            if path.startswith("/entries"):
                posted_payloads.append(json)
                # もし entry_number=101 が別IDで送られてきたら 409 Conflict をシミュレート
                for item in json:
                    if item["entry_number"] == 101 and item["id"] != "existing-id-101":
                        return DummyResponse(409, text="duplicate key value violates unique constraint")
                return DummyResponse(201)
            return DummyResponse(201)

        def get(self, path):
            if path == "/entries?select=id,entry_number":
                # リモートには既に #101 と #102 が存在する状態を返す
                return DummyResponse(200, data=[
                    {"id": "existing-id-101", "entry_number": 101},
                    {"id": "existing-id-102", "entry_number": 102},
                ])
            if path == "/matches?select=id":
                return DummyResponse(200, data=[])
            return DummyResponse(200, data=[])

        def delete(self, path):
            return DummyResponse(200)

        def close(self):
            pass

    storage._client = MockClient()

    # 新しい予約者が誤って entry_number=101 で採番されてしまったケース
    new_entry = EntryGroup(
        id="new-user-uuid-999",
        entry_number=101,
        session_id="s-new",
        leader_name="新規予約者",
        team_name="新規チーム",
        headcount=3,
        preference=PreferenceType.OPEN,
    )

    saved = storage.save_state([new_entry], [])
    assert saved is True
    # 衝突解決によって 103 番に自動リナンバーされていること！
    assert new_entry.entry_number == 103
    assert len(posted_payloads) == 2
    assert posted_payloads[-1][0]["entry_number"] == 103



def test_reconcile_state_heals_ghost_matches_and_orphaned_entries(tmp_path):
    """サーバーレス複数インスタンス競合で生じた空の幽霊マッチや孤立エントリーが自己修復されることを検証"""
    from backend.app.models import EntryGroup, Match, MatchStatus

    eng = MatchingEngine(storage_path=tmp_path / "reconcile.json", disable_supabase=True)

    # 1. グループが0件なのに CALLING のまま残った幽霊マッチ
    ghost_match = Match(
        id="ghost-match-1",
        match_number=1,
        status=MatchStatus.CALLING,
        is_closed_match=False,
        duration_minutes=10,
        assigned_groups=[],
        total_players=6,
    )

    # 2. status が CALLED なのに assigned_match_id が消失した孤立エントリー2組（合計6名）
    orphan1 = EntryGroup(
        id="orphan-1",
        entry_number=101,
        session_id="s-o1",
        leader_name="孤立リーダー1",
        team_name="孤立チーム1",
        headcount=3,
        preference=PreferenceType.OPEN,
        status=EntryStatus.CALLED,
        assigned_match_id="non-existent-match",
    )
    orphan2 = EntryGroup(
        id="orphan-2",
        entry_number=102,
        session_id="s-o2",
        leader_name="孤立リーダー2",
        team_name="孤立チーム2",
        headcount=3,
        preference=PreferenceType.OPEN,
        status=EntryStatus.CALLED,
        assigned_match_id=None,
    )

    eng.matches = [ghost_match]
    eng.entries = [orphan1, orphan2]

    healed = eng._reconcile_state()
    assert healed is True
    # 幽霊マッチは CANCELLED に無効化されていること
    assert ghost_match.status == MatchStatus.CANCELLED
    # 孤立していた2組（3名+3名）は WAITING に救出された上で、即座に新しい CALLING マッチに再編成されていること！
    active_calling = [m for m in eng.matches if m.status == MatchStatus.CALLING]
    assert len(active_calling) == 1
    assert active_calling[0].id != "ghost-match-1"
    assert len(active_calling[0].assigned_groups) == 2


def test_cannot_skip_entry_in_current_in_progress_match():
    """現在対戦中 (IN_PROGRESS) のグループに対する不在スキップは拒否され、対戦中の試合が壊れないことを検証"""
    r1 = client.post(
        "/api/entries",
        json={"session_id": "s1", "leader_name": "A", "team_name": "赤3名", "headcount": 3, "preference": "open"},
    )
    r2 = client.post(
        "/api/entries",
        json={"session_id": "s2", "leader_name": "B", "team_name": "青3名", "headcount": 3, "preference": "open"},
    )
    g1_id = r1.json()["entry"]["id"]

    status_before = client.get("/api/status").json()
    next_match_id = status_before["next_match"]["id"]

    # 案内完了 (Next -> Current: IN_PROGRESS)
    adv_res = client.post(f"/api/admin/matches/{next_match_id}/advance")
    assert adv_res.status_code == 200

    status_in_progress = client.get("/api/status").json()
    assert status_in_progress["current_match"] is not None
    assert status_in_progress["current_match"]["id"] == next_match_id

    # 現在対戦中のグループに対するスキップは拒否されること (400 または 404)
    skip_res = client.post(f"/api/admin/entries/{g1_id}/skip", json={"reason": "誤操作スキップ"})
    assert skip_res.status_code in (400, 404)

    # 対戦中の試合とグループがそのまま維持されていること
    status_after = client.get("/api/status").json()
    assert status_after["current_match"] is not None
    assert status_after["current_match"]["id"] == next_match_id
    assert len(status_after["current_match"]["assigned_groups"]) == 2


def test_skip_in_calling_dissolves_scheduled_to_preserve_fifo_priority():
    """3名組が4組 (#101, #102, #103, #104) エントリーし、
    Next (#101 vs #102) と Next Next (#103 vs #104) が組まれている状態で、
    Next の #101 を不在スキップした際、受付前で待っている相方 #102 が追い越されず、
    即座に #102 vs #103 で Next 枠が再編成されることを検証"""
    ids = []
    for i in range(1, 5):
        r = client.post(
            "/api/entries",
            json={
                "session_id": f"s{i}",
                "leader_name": f"リーダー{i}",
                "team_name": f"組{i}",
                "headcount": 3,
                "preference": "open",
            },
        )
        ids.append(r.json()["entry"]["id"])

    g1_id, g2_id, g3_id, g4_id = ids

    # スキップ前: Next は g1+g2, Next Next は g3+g4
    st1 = client.get("/api/status").json()
    assert {g["id"] for g in st1["next_match"]["assigned_groups"]} == {g1_id, g2_id}
    assert {g["id"] for g in st1["next_next_match"]["assigned_groups"]} == {g3_id, g4_id}

    # Next の g1 を不在スキップ
    skip_res = client.post(f"/api/admin/entries/{g1_id}/skip", json={"reason": "不在"})
    assert skip_res.status_code == 200

    # スキップ後: 受付前にいた g2 が最優先で g3 と組まれ Next 枠に入り、g4 が待機列に戻ること！
    st2 = client.get("/api/status").json()
    assert st2["next_match"] is not None
    assert {g["id"] for g in st2["next_match"]["assigned_groups"]} == {g2_id, g3_id}
    assert st2["next_next_match"] is None
    assert [g["id"] for g in st2["waiting_groups"]] == [g4_id]


def test_skip_in_calling_with_staff_support_serializes_total_staff_in_api():
    """Next (CALLING) 枠で [Red: 3名組, Blue: 2名組 + 1名組] のうち Blue 1名組が不在スキップされた際、
    試合枠は維持されてスタッフ1名が補充され、かつ API の JSON に total_staff=1 が含まれることを検証"""
    client.post(
        "/api/entries",
        json={"session_id": "s1", "leader_name": "A", "team_name": "赤3名", "headcount": 3, "preference": "open"},
    )
    client.post(
        "/api/entries",
        json={"session_id": "s2", "leader_name": "B", "team_name": "青2名", "headcount": 2, "preference": "open"},
    )
    r3 = client.post(
        "/api/entries",
        json={"session_id": "s3", "leader_name": "C", "team_name": "青1名", "headcount": 1, "preference": "open"},
    )
    g3_id = r3.json()["entry"]["id"]

    # 青1名組を不在スキップ -> 残り Red 3名 vs Blue 2名 なのでスタッフ1名補充で試合維持
    skip_res = client.post(f"/api/admin/entries/{g3_id}/skip", json={"reason": "不在"})
    assert skip_res.status_code == 200

    st = client.get("/api/status").json()
    next_match = st["next_match"]
    assert next_match is not None
    assert next_match["total_players"] == 5
    assert next_match["total_staff"] == 1
    assert next_match["teams"]["blue"]["staff_count"] == 1


def test_advance_specific_match_slot_independently():
    """『試合終了 (Current)』と『案内完了 (Next)』がそれぞれのスロットを正確に進行させることを検証:
    1. Next の『案内完了』を押すと Next -> Current に昇格し、Next Next -> Next に繰り上がる。
    2. Current の『試合終了』を押すと Current のみが FINISHED になって枠が空き、
       点呼中の Next が勝手に Current に吸い込まれないこと。"""
    # サンプルデータ4組投入 (Next: 第1試合 Open 6名, Next Next: 第2試合 Closed 4名)
    st0 = client.post("/api/admin/sample-data").json()
    m1_id = st0["next_match"]["id"]
    m2_id = st0["next_next_match"]["id"]
    assert st0["current_match"] is None

    # 1. 第1試合 (Next) の『案内完了』を押す -> 第1試合が Current、第2試合が Next になる
    res1 = client.post(f"/api/admin/matches/{m1_id}/advance")
    assert res1.status_code == 200
    st1 = client.get("/api/status").json()
    assert st1["current_match"]["id"] == m1_id
    assert st1["next_match"]["id"] == m2_id
    assert st1["next_next_match"] is None

    # 2. 第1試合 (Current) の『試合終了』を押す -> 第1試合が終了して Current が空になり、
    # 第2試合はまだ受付点呼完了前なので Next に留まること！
    res2 = client.post(f"/api/admin/matches/{m1_id}/advance")
    assert res2.status_code == 200
    st2 = client.get("/api/status").json()
    assert st2["current_match"] is None
    assert st2["next_match"]["id"] == m2_id

    # 3. 第2試合 (Next) の点呼が終わって『案内完了』を押す -> 第2試合が Current に昇格する
    res3 = client.post(f"/api/admin/matches/{m2_id}/advance")
    assert res3.status_code == 200
    st3 = client.get("/api/status").json()
    assert st3["current_match"]["id"] == m2_id
    assert st3["next_match"] is None


def test_full_event_day_simulation(tmp_path):
    """イベント1日を通した総合シミュレーション:
    - Open(1〜3名) と Closed(4〜6名、および2〜3名任意貸切) の混在エントリー
    - 2. 次の試合(CALLING)での不在スキップ（スタッフ補充維持パターン & 解体・優先再編成パターン）
    - 1. 現在対戦中(IN_PROGRESS)での不在スキップ拒否ガード
    - 10分経過後の5名・4名柔軟マッチング発動
    - 全試合終了後のデータ整合性（幽霊マッチ0件・孤立エントリー0件）"""
    eng = MatchingEngine(
        flexible_wait_seconds=600,
        storage_path=tmp_path / "sim_state.json",
        disable_supabase=True,
    )
    t = datetime(2026, 10, 31, 10, 0, 0)

    # Wave 1: 6組エントリー
    g1 = eng.register_entry("s1", "L1", "Alpha(3)", 3, PreferenceType.OPEN, created_at=t)
    t += timedelta(seconds=10)
    g2 = eng.register_entry("s2", "L2", "Bravo(2)", 2, PreferenceType.OPEN, created_at=t)
    t += timedelta(seconds=10)
    g3 = eng.register_entry("s3", "L3", "Charlie(1)", 1, PreferenceType.OPEN, created_at=t)
    t += timedelta(seconds=10)
    g4 = eng.register_entry("s4", "L4", "Delta貸切(5)", 5, PreferenceType.OPEN, created_at=t)  # 自動Closed
    t += timedelta(seconds=10)
    g5 = eng.register_entry("s5", "L5", "Echo(3)", 3, PreferenceType.OPEN, created_at=t)
    t += timedelta(seconds=10)
    g6 = eng.register_entry("s6", "L6", "Foxtrot(3)", 3, PreferenceType.OPEN, created_at=t)

    assert g4.preference == PreferenceType.CLOSED

    # 初期スロット確認: Next = g1+g2+g3 (Open 6名), Next Next = g4 (Closed 5名), Waiting = g5, g6
    calling = next(m for m in eng.matches if m.status == MatchStatus.CALLING)
    scheduled = next(m for m in eng.matches if m.status == MatchStatus.SCHEDULED)
    assert {g.id for g in calling.assigned_groups} == {g1.id, g2.id, g3.id}
    assert {g.id for g in scheduled.assigned_groups} == {g4.id}

    # Next の Charlie(1名) が不在スキップ -> スタッフ1名補充で Next 枠維持
    t += timedelta(seconds=30)
    assert eng.skip_entry(g3.id, current_time=t) is True
    assert calling.status == MatchStatus.CALLING
    assert calling.total_players == 5
    assert calling.total_staff == 1

    # Next(calling) を案内完了 -> Current(IN_PROGRESS) へ昇格、g4 が Next へ、g5+g6 が Next Next へ
    t += timedelta(seconds=30)
    assert eng.advance_match_lifecycle(match_id=calling.id, current_time=t) is True
    assert calling.status == MatchStatus.IN_PROGRESS

    # 現在対戦中(IN_PROGRESS)の g1 を誤ってスキップしようとしても拒否されること
    assert eng.skip_entry(g1.id, current_time=t) is False
    assert calling.status == MatchStatus.IN_PROGRESS
    assert g1.status == EntryStatus.IN_MATCH

    # Current(calling) の試合終了 -> Current のみが FINISHED になり、Next(g4) はまだ CALLING に留まる
    t += timedelta(minutes=10)
    assert eng.advance_match_lifecycle(match_id=calling.id, current_time=t) is True
    assert calling.status == MatchStatus.FINISHED
    assert g1.status == EntryStatus.COMPLETED
    assert g2.status == EntryStatus.COMPLETED
    assert scheduled.status == MatchStatus.CALLING  # g4 はまだ受付点呼中

    # g4(Closed) が受付に来ず不在スキップ -> g4 のマッチが CANCELLED になり、Next Next の g5+g6 が Next(CALLING) に昇格
    t += timedelta(seconds=20)
    assert eng.skip_entry(g4.id, current_time=t) is True
    assert g4.status == EntryStatus.SKIPPED
    m_56 = next(m for m in eng.matches if m.status == MatchStatus.CALLING)
    assert {g.id for g in m_56.assigned_groups} == {g5.id, g6.id}

    # Wave 2: 端数の 2名組(g7) と 2名組(g8) がエントリー -> 10分未満は待機、10分経過で 2v2(+スタッフ各1名) 成立
    t += timedelta(seconds=10)
    g7 = eng.register_entry("s7", "L7", "Golf(2)", 2, PreferenceType.OPEN, created_at=t)
    g8 = eng.register_entry("s8", "L8", "Hotel(2)", 2, PreferenceType.OPEN, created_at=t + timedelta(seconds=5))
    assert g7.status == EntryStatus.WAITING
    assert g8.status == EntryStatus.WAITING

    # 10分経過後に再計算 -> Next Next(SCHEDULED) に 4名マッチ(スタッフ2名補充) として成立
    t_flex = t + timedelta(seconds=605)
    eng.recalculate_slots(current_time=t_flex)
    m_78 = next(m for m in eng.matches if m.status == MatchStatus.SCHEDULED)
    assert m_78.total_players == 4
    assert m_78.total_staff == 2

    # 残りの試合を順次案内完了・試合終了まで進める
    assert eng.advance_match_lifecycle(match_id=m_56.id, current_time=t_flex) is True  # m_56 -> IN_PROGRESS, m_78 -> CALLING
    assert eng.advance_match_lifecycle(match_id=m_56.id, current_time=t_flex + timedelta(minutes=10)) is True  # m_56 -> FINISHED
    assert eng.advance_match_lifecycle(match_id=m_78.id, current_time=t_flex + timedelta(minutes=11)) is True  # m_78 -> IN_PROGRESS
    assert eng.advance_match_lifecycle(match_id=m_78.id, current_time=t_flex + timedelta(minutes=21)) is True  # m_78 -> FINISHED

    # 全試合完了後の整合性検証: アクティブな試合0件、待機中エントリー0件、不整合修復不要(healed == False)
    assert [m for m in eng.matches if m.status in (MatchStatus.SCHEDULED, MatchStatus.CALLING, MatchStatus.IN_PROGRESS)] == []
    assert [e for e in eng.entries if e.status not in (EntryStatus.COMPLETED, EntryStatus.SKIPPED)] == []
    assert eng._reconcile_state() is False


def test_skip_2p_in_calling_prevents_broken_1v2_and_rematches():
    """Next (CALLING) 枠で [Red: 2名組 + 1名組, Blue: 3名組] のうち Red 2名組が不在スキップされた際、
    不成立な 1名 vs 3名 (助っ人2名) のまま固定されず、一旦解体されて待機列の後続2名組と再編成されることを検証"""
    r1 = client.post(
        "/api/entries",
        json={"session_id": "s1", "leader_name": "A", "team_name": "赤2名", "headcount": 2, "preference": "open"},
    )
    r2 = client.post(
        "/api/entries",
        json={"session_id": "s2", "leader_name": "B", "team_name": "赤1名", "headcount": 1, "preference": "open"},
    )
    r3 = client.post(
        "/api/entries",
        json={"session_id": "s3", "leader_name": "C", "team_name": "青3名", "headcount": 3, "preference": "open"},
    )
    r4 = client.post(
        "/api/entries",
        json={"session_id": "s4", "leader_name": "D", "team_name": "待機2名", "headcount": 2, "preference": "open"},
    )

    g1_id = r1.json()["entry"]["id"]
    g2_id = r2.json()["entry"]["id"]
    g3_id = r3.json()["entry"]["id"]
    g4_id = r4.json()["entry"]["id"]

    # 赤2名組 (g1) を不在スキップ
    skip_res = client.post(f"/api/admin/entries/{g1_id}/skip", json={"reason": "不在"})
    assert skip_res.status_code == 200

    # 1v3 のまま残らず、g2(1名) + g3(3名) + g4(2名) で 3v3 フルマッチが再編成されること！
    st = client.get("/api/status").json()
    next_match = st["next_match"]
    assert next_match is not None
    assert next_match["total_players"] == 6
    assert {g["id"] for g in next_match["assigned_groups"]} == {g2_id, g3_id, g4_id}


def test_restore_skipped_entry_to_front_of_queue():
    """不在スキップされたグループをスタッフが救済（復帰）した際、
    ステータスが復帰し、待機列の最優先として即座に再マッチングされることを検証"""
    r1 = client.post(
        "/api/entries",
        json={"session_id": "s1", "leader_name": "A", "team_name": "組1", "headcount": 3, "preference": "open"},
    )
    r2 = client.post(
        "/api/entries",
        json={"session_id": "s2", "leader_name": "B", "team_name": "組2", "headcount": 3, "preference": "open"},
    )
    g1_id = r1.json()["entry"]["id"]
    g2_id = r2.json()["entry"]["id"]

    # 1. 組1 を不在スキップ
    skip_res = client.post(f"/api/admin/entries/{g1_id}/skip", json={"reason": "不在"})
    assert skip_res.status_code == 200

    st_skipped = client.get(f"/api/entries/{g1_id}").json()
    assert st_skipped["entry"]["status"] == "skipped"

    # 2. 戻ってきた組1 をスタッフが救済復帰
    restore_res = client.post(f"/api/admin/entries/{g1_id}/restore")
    assert restore_res.status_code == 200

    # 3. 組1 が待機列・マッチ枠に復帰していること
    st_restored = client.get(f"/api/entries/{g1_id}").json()
    assert st_restored["entry"]["status"] in ("waiting", "called")

    # Next枠に 組1 と 組2 が再度マッチングされていること
    st_queue = client.get("/api/status").json()
    assert st_queue["next_match"] is not None
    group_ids = [g["id"] for g in st_queue["next_match"]["assigned_groups"]]
    assert g1_id in group_ids
    assert g2_id in group_ids

    # 4. すでにアクティブなグループに対する二重復帰は400で拒否されること
    restore_again = client.post(f"/api/admin/entries/{g1_id}/restore")
    assert restore_again.status_code == 400
