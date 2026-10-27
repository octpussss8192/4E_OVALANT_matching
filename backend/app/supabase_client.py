"""Supabase REST API client for OVERTER WATCH2026 backend.
Enables real-time shared state across all Vercel Serverless Functions.
"""

import os
import time
from typing import Optional, Any
from datetime import datetime
import httpx
from .models import (
    EntryGroup,
    EntryStatus,
    Match,
    MatchStatus,
    MatchTeams,
    PreferenceType,
    TeamSideAssignment,
    TeamSideType,
)
from .datetime_utils import parse_iso_datetime

DEFAULT_SUPABASE_URL = "https://wfvujsbcwelbkysrioxp.supabase.co"
DEFAULT_SUPABASE_KEY = "sb_publishable_hz-XugfYZSwLEtXqjsTnAw_zY9xLlD_"


def get_supabase_config() -> tuple[str, str]:
    # pytest実行中またはテストフラグ有効時は、本番DB誤操作を防止するため空値を返す
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("TESTING") == "1":
        return "", ""

    url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or DEFAULT_SUPABASE_URL
    ).rstrip("/")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        or DEFAULT_SUPABASE_KEY
    )
    return url, key


class SupabaseStorage:
    """Supabase REST API を通じた共有ステート永続化"""

    def __init__(self, url: Optional[str] = None, key: Optional[str] = None):
        default_url, default_key = get_supabase_config()
        self.url = (url or default_url).rstrip("/")
        self.key = key or default_key
        self._client: Optional[httpx.Client] = None

    def is_configured(self) -> bool:
        return bool(self.url and self.key)

    def _get_client(self) -> httpx.Client:
        if self._client is None or self._client.is_closed:
            headers = {
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            }
            # Vercel Serverless のコールドスタート遅延を吸収するためタイムアウトを10秒に設定
            self._client = httpx.Client(
                base_url=f"{self.url}/rest/v1",
                headers=headers,
                timeout=10.0,
            )
        return self._client

    def load_state(self) -> Optional[dict[str, Any]]:
        """Supabase から entries と matches を読み込んでインメモリ復元用 dict を返す。
        接続瞬断・コールドスタート対策として最大2回試行する。
        """
        if not self.is_configured():
            return None

        for attempt in range(2):
            try:
                client = self._get_client()
                r_entries = client.get("/entries?select=*&order=entry_number.asc")
                r_matches = client.get("/matches?select=*&order=match_number.asc")

                if r_entries.status_code != 200 or r_matches.status_code != 200:
                    print(f"[SupabaseStorage] load_state fetch error (attempt {attempt + 1}): entries={r_entries.status_code}, matches={r_matches.status_code}")
                    if attempt == 0:
                        time.sleep(0.3)
                        continue
                    return None

                r_links = client.get("/match_entries?select=*")
                raw_links = r_links.json() if r_links.status_code == 200 else []

                raw_entries = r_entries.json()
                raw_matches = r_matches.json()

                # EntryGroup オブジェクトに復元
                entries: list[EntryGroup] = []
                for e in raw_entries:
                    try:
                        entries.append(
                            EntryGroup(
                                id=str(e["id"]),
                                entry_number=int(e["entry_number"]),
                                session_id=str(e["session_id"]),
                                leader_name=str(e["leader_name"]),
                                team_name=str(e["team_name"]),
                                headcount=int(e["headcount"]),
                                preference=PreferenceType(e["preference"]),
                                status=EntryStatus(e["status"]),
                                assigned_match_id=str(e["assigned_match_id"]) if e.get("assigned_match_id") else None,
                                skip_reason=e.get("skip_reason"),
                                created_at=parse_iso_datetime(e["created_at"]),
                                updated_at=parse_iso_datetime(e["updated_at"]),
                            )
                        )
                    except Exception as parse_err:
                        print(f"[SupabaseStorage] Entry parse error: {parse_err}")

                entries_by_id = {e.id: e for e in entries}

                # Match オブジェクトに復元
                matches: list[Match] = []
                for m in raw_matches:
                    try:
                        m_id = str(m["id"])
                        assigned_groups = [
                            e for e in entries if e.assigned_match_id == m_id
                        ]

                        # チーム割り当ての復元
                        m_links = [l for l in raw_links if str(l.get("match_id")) == m_id]
                        red_group_ids = {str(l["entry_id"]) for l in m_links if l.get("team_side") == "red"}
                        blue_group_ids = {str(l["entry_id"]) for l in m_links if l.get("team_side") == "blue"}

                        red_groups = [entries_by_id[gid] for gid in red_group_ids if gid in entries_by_id]
                        blue_groups = [entries_by_id[gid] for gid in blue_group_ids if gid in entries_by_id]

                        red_count = sum(g.headcount for g in red_groups)
                        blue_count = sum(g.headcount for g in blue_groups)

                        teams = MatchTeams(
                            red=TeamSideAssignment(
                                team_side=TeamSideType.RED,
                                groups=red_groups,
                                total_count=red_count,
                                staff_count=max(0, 3 - red_count) if not bool(m["is_closed_match"]) else 0,
                            ),
                            blue=TeamSideAssignment(
                                team_side=TeamSideType.BLUE,
                                groups=blue_groups,
                                total_count=blue_count,
                                staff_count=max(0, 3 - blue_count) if not bool(m["is_closed_match"]) else 0,
                            ),
                        )

                        matches.append(
                            Match(
                                id=m_id,
                                match_number=int(m["match_number"]),
                                status=MatchStatus(m["status"]),
                                is_closed_match=bool(m["is_closed_match"]),
                                duration_minutes=int(m["duration_minutes"]),
                                assigned_groups=assigned_groups,
                                total_players=int(m["total_players"]),
                                teams=teams,
                                started_at=parse_iso_datetime(m["started_at"]) if m.get("started_at") else None,
                                ended_at=parse_iso_datetime(m["ended_at"]) if m.get("ended_at") else None,
                                created_at=parse_iso_datetime(m["created_at"]),
                            )
                        )
                    except Exception as parse_err:
                        print(f"[SupabaseStorage] Match parse error: {parse_err}")

                next_entry_num = max([e.entry_number for e in entries], default=100) + 1
                next_match_num = max([m.match_number for m in matches], default=0) + 1

                return {
                    "entries": entries,
                    "matches": matches,
                    "next_entry_number": next_entry_num,
                    "next_match_number": next_match_num,
                }
            except Exception as e:
                print(f"[SupabaseStorage] load_state exception (attempt {attempt + 1}): {e}")
                if attempt == 0:
                    time.sleep(0.3)
                    continue
                return None

        return None

    def save_state(self, entries: list[EntryGroup], matches: list[Match]) -> bool:
        """entries, matches, match_entries を Supabase に upsert 同期"""
        if not self.is_configured():
            return True
        try:
            entries_payload = [
                {
                    "id": e.id,
                    "entry_number": e.entry_number,
                    "session_id": e.session_id,
                    "leader_name": e.leader_name,
                    "team_name": e.team_name,
                    "headcount": e.headcount,
                    "preference": e.preference.value,
                    "status": e.status.value,
                    "assigned_match_id": e.assigned_match_id,
                    "skip_reason": e.skip_reason,
                    "created_at": e.created_at.isoformat(),
                    "updated_at": e.updated_at.isoformat(),
                }
                for e in entries
            ]

            matches_payload = [
                {
                    "id": m.id,
                    "match_number": m.match_number,
                    "status": m.status.value,
                    "is_closed_match": m.is_closed_match,
                    "duration_minutes": m.duration_minutes,
                    "total_players": m.total_players,
                    "started_at": m.started_at.isoformat() if m.started_at else None,
                    "ended_at": m.ended_at.isoformat() if m.ended_at else None,
                    "created_at": m.created_at.isoformat(),
                }
                for m in matches
            ]

            links_payload = []
            for m in matches:
                if m.teams:
                    for g in m.teams.red.groups:
                        links_payload.append({
                            "match_id": m.id,
                            "entry_id": g.id,
                            "team_side": "red",
                        })
                    for g in m.teams.blue.groups:
                        links_payload.append({
                            "match_id": m.id,
                            "entry_id": g.id,
                            "team_side": "blue",
                        })

            client = self._get_client()
            if matches_payload:
                client.post("/matches?on_conflict=id", json=matches_payload)

            if entries_payload:
                client.post("/entries?on_conflict=id", json=entries_payload)

            if links_payload:
                client.post("/match_entries?on_conflict=match_id,entry_id", json=links_payload)

            return True
        except Exception as e:
            print(f"[SupabaseStorage] save_state exception: {e}")
            return False

    def reset_all(self) -> bool:
        """Supabase の全データを消去"""
        if not self.is_configured():
            return True
        try:
            client = self._get_client()
            client.delete("/match_entries?match_id=neq.00000000-0000-0000-0000-000000000000")
            client.delete("/entries?id=neq.00000000-0000-0000-0000-000000000000")
            client.delete("/matches?id=neq.00000000-0000-0000-0000-000000000000")
            return True
        except Exception as e:
            print(f"[SupabaseStorage] reset_all exception: {e}")
            return False
