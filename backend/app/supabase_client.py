"""Supabase REST API client for OVALANT backend.
Uses httpx to interact with Supabase PostgREST API seamlessly in Vercel Serverless Functions.
"""

import os
from typing import Optional, Any
import httpx
from datetime import datetime

DEFAULT_SUPABASE_URL = "https://wfvujsbcwelbkysrioxp.supabase.co"
DEFAULT_SUPABASE_KEY = "sb_publishable_hz-XugfYZSwLEtXqjsTnAw_zY9xLlD_"

def get_supabase_config() -> tuple[str, str]:
    url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or DEFAULT_SUPABASE_URL
    ).rstrip("/")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_KEY")
        or DEFAULT_SUPABASE_KEY
    )
    return url, key


class SupabaseStorage:
    def __init__(self):
        self.url, self.key = get_supabase_config()
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation,resolution=merge-duplicates",
        }
        self.base_url = f"{self.url}/rest/v1"

    def is_configured(self) -> bool:
        return bool(self.url and self.key)

    def load_all(self) -> Optional[dict[str, Any]]:
        """Supabase から全 entries, matches, match_entries を読み込む"""
        if not self.is_configured():
            return None
        try:
            with httpx.Client(base_url=self.base_url, headers=self.headers, timeout=5.0) as client:
                r_entries = client.get("/entries?select=*&order=entry_number.asc")
                if r_entries.status_code != 200:
                    print(f"[SupabaseStorage] Failed to fetch entries: {r_entries.status_code} {r_entries.text}")
                    return None

                r_matches = client.get("/matches?select=*&order=match_number.asc")
                if r_matches.status_code != 200:
                    print(f"[SupabaseStorage] Failed to fetch matches: {r_matches.status_code} {r_matches.text}")
                    return None

                r_links = client.get("/match_entries?select=*")
                links = r_links.json() if r_links.status_code == 200 else []

                return {
                    "entries": r_entries.json(),
                    "matches": r_matches.json(),
                    "match_entries": links,
                }
        except Exception as e:
            print(f"[SupabaseStorage] load_all exception: {e}")
            return None

    def sync_entries(self, entries_data: list[dict[str, Any]]) -> bool:
        """エントリーリストを一括 upsert"""
        if not self.is_configured() or not entries_data:
            return True
        try:
            with httpx.Client(base_url=self.base_url, headers=self.headers, timeout=5.0) as client:
                res = client.post("/entries", json=entries_data)
                if res.status_code not in (200, 201):
                    print(f"[SupabaseStorage] Failed to upsert entries: {res.status_code} {res.text}")
                    return False
                return True
        except Exception as e:
            print(f"[SupabaseStorage] sync_entries exception: {e}")
            return False

    def sync_matches(self, matches_data: list[dict[str, Any]], links_data: list[dict[str, Any]]) -> bool:
        """マッチとチーム割り当てを一括 upsert"""
        if not self.is_configured():
            return True
        try:
            with httpx.Client(base_url=self.base_url, headers=self.headers, timeout=5.0) as client:
                if matches_data:
                    res = client.post("/matches", json=matches_data)
                    if res.status_code not in (200, 201):
                        print(f"[SupabaseStorage] Failed to upsert matches: {res.status_code} {res.text}")

                if links_data:
                    res_l = client.post("/match_entries", json=links_data)
                    if res_l.status_code not in (200, 201):
                        print(f"[SupabaseStorage] Failed to upsert match_entries: {res_l.status_code} {res_l.text}")

                return True
        except Exception as e:
            print(f"[SupabaseStorage] sync_matches exception: {e}")
            return False

    def reset_all(self) -> bool:
        """全テーブルを安全にクリア（TRUNCATE/DELETE）"""
        if not self.is_configured():
            return True
        try:
            with httpx.Client(base_url=self.base_url, headers=self.headers, timeout=5.0) as client:
                client.delete("/match_entries?match_id=neq.00000000-0000-0000-0000-000000000000")
                client.delete("/entries?id=neq.00000000-0000-0000-0000-000000000000")
                client.delete("/matches?id=neq.00000000-0000-0000-0000-000000000000")
                return True
        except Exception as e:
            print(f"[SupabaseStorage] reset_all exception: {e}")
            return False
