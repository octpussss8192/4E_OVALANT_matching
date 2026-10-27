"""Unit tests for OVERTER WATCH2026 matching engine and API endpoints."""

import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.models import PreferenceType, MatchStatus, EntryStatus
from backend.app.matching_engine import MatchingEngine

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_system_state():
    """各テスト前にシステム状態をリセット"""
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
    engine = MatchingEngine(flexible_wait_seconds=5)  # テスト用に5秒設定
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
