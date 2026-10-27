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
