"""Core matching engine implementation strictly following OVERTER WATCH2026 rules.
- Rule: '味方は身内、敵は他人' (No group splitting, 1 team max 3 players).
- 4-6 players automatically forced to Closed (8 min duration).
- 1-3 players can choose Open (10 min) or Closed (8 min).
- Flexible 5-player fallback when waiting >= flexible_wait_seconds (default 10 minutes).
- 3-slot pipeline (current, next, next_next) with cascade promotion and skip handling.
"""

from __future__ import annotations
import json
import os
import tempfile
import threading
import uuid
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional
from .models import (
    EntryGroup,
    EntryStatus,
    Match,
    MatchStatus,
    MatchTeams,
    PreferenceType,
    SuggestionTip,
    TeamSideAssignment,
    TeamSideType,
)
from .supabase_client import SupabaseStorage
from .datetime_utils import now_utc, ensure_utc


def _get_storage_path() -> Path:
    env_path = os.environ.get("MATCHING_STATE_PATH")
    if env_path:
        return Path(env_path)
    base_dir = Path(__file__).resolve().parent.parent / "data"
    is_local = (
        os.environ.get("LOCAL_MODE") == "1"
        or os.environ.get("DISABLE_SUPABASE") == "1"
        or os.environ.get("TESTING") == "1"
    )
    filename = "matching_state_test.json" if is_local else "matching_state.json"
    try:
        base_dir.mkdir(parents=True, exist_ok=True)
        return base_dir / filename
    except Exception:
        fallback_dir = Path(tempfile.gettempdir())
        return fallback_dir / f"overter_watch_{filename}"


class MatchingEngine:
    def __init__(
        self,
        flexible_wait_seconds: int = 600,
        storage_path: Optional[Path] = None,
        disable_supabase: Optional[bool] = None,
    ):
        self.flexible_wait_seconds = flexible_wait_seconds
        self.storage_path = storage_path or _get_storage_path()
        if disable_supabase is not None:
            self.disable_supabase = disable_supabase
        else:
            self.disable_supabase = bool(
                os.environ.get("DISABLE_SUPABASE") == "1"
                or os.environ.get("LOCAL_MODE") == "1"
                or os.environ.get("TESTING") == "1"
            )
        self._lock = threading.RLock()

        self.entries: list[EntryGroup] = []
        self.matches: list[Match] = []
        self.next_entry_number: int = 101
        self.next_match_number: int = 1
        self._has_loaded_once: bool = False

        self.supabase = SupabaseStorage()

        self.load_state()

    def _is_supabase_active(self) -> bool:
        return not self.disable_supabase and self.supabase.is_configured()

    def _save_local_snapshot(self) -> None:
        """ローカルディスクへのスナップショット保存"""
        try:
            self.storage_path.parent.mkdir(parents=True, exist_ok=True)
            temp_path = self.storage_path.with_suffix(".tmp")
            data = {
                "next_entry_number": self.next_entry_number,
                "next_match_number": self.next_match_number,
                "entries": [e.model_dump(mode="json") for e in self.entries],
                "matches": [m.model_dump(mode="json") for m in self.matches],
            }
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            temp_path.replace(self.storage_path)
        except Exception as e:
            print(f"[MatchingEngine] Failed to save state to {self.storage_path}: {e}")

    def _reconcile_state(self) -> bool:
        """サーバーレス複数インスタンス競合や通信途絶で生じた不整合（空の幽霊マッチや孤立エントリー）を自己修復する"""
        healed = False
        entries_by_id = {e.id: e for e in self.entries}

        # 1. 各マッチの assigned_groups を最新の entries 実体に再紐付けし、グループ0件の幽霊アクティブ枠を無効化
        for m in self.matches:
            actual_groups = [
                e for e in self.entries
                if e.assigned_match_id == m.id and e.status not in (EntryStatus.SKIPPED, EntryStatus.CANCELLED)
            ]
            if m.status in (MatchStatus.SCHEDULED, MatchStatus.CALLING, MatchStatus.IN_PROGRESS):
                if not actual_groups:
                    m.status = MatchStatus.CANCELLED
                    healed = True
                else:
                    m.assigned_groups = actual_groups
                    if m.teams:
                        red_ids = {g.id for g in m.teams.red.groups}
                        blue_ids = {g.id for g in m.teams.blue.groups}
                        m.teams.red.groups = [
                            entries_by_id[gid] for gid in red_ids
                            if gid in entries_by_id and entries_by_id[gid].assigned_match_id == m.id
                        ]
                        m.teams.blue.groups = [
                            entries_by_id[gid] for gid in blue_ids
                            if gid in entries_by_id and entries_by_id[gid].assigned_match_id == m.id
                        ]

        # 2. 同一スロット（IN_PROGRESS / CALLING / SCHEDULED）に複数マッチが重複存在する場合の正規化
        for slot_status in (MatchStatus.IN_PROGRESS, MatchStatus.CALLING, MatchStatus.SCHEDULED):
            slot_matches = [m for m in self.matches if m.status == slot_status]
            if len(slot_matches) > 1:
                for dup_match in slot_matches[1:]:
                    dup_match.status = MatchStatus.CANCELLED
                    for g in dup_match.assigned_groups:
                        g.status = EntryStatus.WAITING
                        g.assigned_match_id = None
                    healed = True

        # 3. 孤立エントリー（status が called/in_match なのに有効なアクティブ試合が存在しない等）の自己修復
        active_matches_by_id = {
            m.id: m for m in self.matches
            if m.status in (MatchStatus.SCHEDULED, MatchStatus.CALLING, MatchStatus.IN_PROGRESS)
        }
        finished_match_ids = {m.id for m in self.matches if m.status == MatchStatus.FINISHED}

        for e in self.entries:
            if e.status in (EntryStatus.CALLED, EntryStatus.IN_MATCH):
                if e.assigned_match_id and e.assigned_match_id in active_matches_by_id:
                    active_m = active_matches_by_id[e.assigned_match_id]
                    expected_status = (
                        EntryStatus.IN_MATCH if active_m.status == MatchStatus.IN_PROGRESS else EntryStatus.CALLED
                    )
                    if e.status != expected_status:
                        e.status = expected_status
                        healed = True
                elif e.assigned_match_id and e.assigned_match_id in finished_match_ids:
                    e.status = EntryStatus.COMPLETED
                    healed = True
                else:
                    # 割当先マッチがキャンセル・消失している場合は待機列（WAITING）へ安全に戻す
                    e.status = EntryStatus.WAITING
                    e.assigned_match_id = None
                    healed = True
            elif e.status == EntryStatus.WAITING and e.assigned_match_id is not None:
                if e.assigned_match_id in active_matches_by_id:
                    active_m = active_matches_by_id[e.assigned_match_id]
                    e.status = (
                        EntryStatus.IN_MATCH if active_m.status == MatchStatus.IN_PROGRESS else EntryStatus.CALLED
                    )
                else:
                    e.assigned_match_id = None
                healed = True

        if healed:
            self.recalculate_slots()

        return healed

    # --------------------------------------------------------------------------
    # 永続化（Supabase 優先、通信エラー時の白紙巻き戻り防止ロック付き）
    # --------------------------------------------------------------------------
    def save_state(self) -> bool:
        """状態保存"""
        with self._lock:
            ok = True
            # 1. Supabase 同期
            if self._is_supabase_active():
                try:
                    ok = self.supabase.save_state(self.entries, self.matches)
                    # 自動リナンバーが行われた場合に備えて次番号を同期
                    if self.entries:
                        self.next_entry_number = max(
                            self.next_entry_number,
                            max(e.entry_number for e in self.entries) + 1,
                        )
                    if self.matches:
                        self.next_match_number = max(
                            self.next_match_number,
                            max(m.match_number for m in self.matches) + 1,
                        )
                except Exception as e:
                    print(f"[MatchingEngine] Supabase save error: {e}")
                    ok = False

            # 2. ローカルディスクスナップショット保存
            self._save_local_snapshot()
            return ok

    def load_state(self, require_fresh: bool = False) -> bool:
        """状態復元（Supabase 通信失敗時に空データや古いローカルファイルで上書きしない保護付き）"""
        with self._lock:
            # 1. Supabase が有効な環境（本番環境）
            if self._is_supabase_active():
                state = self.supabase.load_state()
                if state is not None:
                    self.entries = state["entries"]
                    self.matches = state["matches"]
                    self.next_entry_number = state["next_entry_number"]
                    self.next_match_number = state["next_match_number"]
                    self._has_loaded_once = True
                    # 万が一の不整合（幽霊マッチ・孤立エントリー）があれば自己修復
                    if self._reconcile_state():
                        self.supabase.save_state(self.entries, self.matches)
                    # 正常取得できた最新状態をローカルスナップショットにも退避
                    self._save_local_snapshot()
                    return True

                # 書き込み系操作（require_fresh=True）の直前に Supabase 同期が失敗した場合は、
                # 古いインメモリ状態で本番DBを上書きするのを防ぐため False（503）を返す
                if require_fresh:
                    print("[MatchingEngine] Fresh Supabase state required for write operation, but load_state failed.")
                    return False

                # 読み取り系操作で既にメモリ上にデータがあれば絶対に破棄・上書きせずそのまま維持する！
                if self._has_loaded_once or self.entries:
                    print("[MatchingEngine] Supabase load_state failed; preserving existing in-memory state.")
                    return True

                # コールドスタート直後でまだ一度も読めていない場合、ローカルスナップショットに非空データがあれば一時復元
                if self.storage_path.exists():
                    try:
                        with open(self.storage_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        loaded_entries = [EntryGroup.model_validate(e) for e in data.get("entries", [])]
                        loaded_matches = [Match.model_validate(m) for m in data.get("matches", [])]
                        if loaded_entries or loaded_matches:
                            self.entries = loaded_entries
                            self.matches = loaded_matches
                            self.next_entry_number = data.get("next_entry_number", 101)
                            self.next_match_number = data.get("next_match_number", 1)
                            self._has_loaded_once = True
                            self._reconcile_state()
                            return True
                    except Exception:
                        pass

                return False

            # 2. ローカル専用モード（テスト環境・Supabase無効時）
            if not self.storage_path.exists():
                self._has_loaded_once = True
                return True
            try:
                with open(self.storage_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.next_entry_number = data.get("next_entry_number", 101)
                self.next_match_number = data.get("next_match_number", 1)
                self.entries = [EntryGroup.model_validate(e) for e in data.get("entries", [])]
                self.matches = [Match.model_validate(m) for m in data.get("matches", [])]
                self._has_loaded_once = True
                self._reconcile_state()
                return True
            except Exception as e:
                print(f"[MatchingEngine] Failed to load state from {self.storage_path}: {e}")
                return False

    def reset(self) -> None:
        """システム全体の全データ初期化"""
        with self._lock:
            self.entries.clear()
            self.matches.clear()
            self.next_entry_number = 101
            self.next_match_number = 1
            self._has_loaded_once = True
            if self._is_supabase_active():
                self.supabase.reset_all()
            self.save_state()

    # --------------------------------------------------------------------------
    # 1. エントリー受付
    # --------------------------------------------------------------------------
    def register_entry(
        self,
        session_id: str,
        leader_name: str,
        team_name: str,
        headcount: int,
        preference: PreferenceType,
        created_at: Optional[datetime] = None,
    ) -> EntryGroup:
        with self._lock:
            now = ensure_utc(created_at) if created_at else now_utc()

            # 4名以上は友人が敵味方に分断されるのを防ぐため強制的に Closed
            actual_preference = PreferenceType.CLOSED if headcount >= 4 else preference

            entry = EntryGroup(
                id=str(uuid.uuid4()),
                entry_number=self.next_entry_number,
                session_id=session_id,
                leader_name=leader_name,
                team_name=team_name,
                headcount=headcount,
                preference=actual_preference,
                status=EntryStatus.WAITING,
                created_at=now,
                updated_at=now,
            )
            self.next_entry_number += 1
            self.entries.append(entry)

            self.recalculate_slots(now)
            self.save_state()
            return entry

    def add_sample_groups(self) -> list[EntryGroup]:
        """デバッグ用: 4組のサンプルデータをアトミックに一括投入"""
        with self._lock:
            now = now_utc()
            samples = [
                ("Alpha 3名組", "田中太郎", 3, PreferenceType.OPEN),
                ("Bravo 2名組", "佐藤花子", 2, PreferenceType.OPEN),
                ("ソロCharlie", "鈴木一郎", 1, PreferenceType.OPEN),
                ("貸切Delta", "高橋健太", 4, PreferenceType.CLOSED),
            ]
            added = []
            for idx, (t_name, l_name, hc, pref) in enumerate(samples):
                created = now + timedelta(seconds=idx)
                actual_pref = PreferenceType.CLOSED if hc >= 4 else pref
                entry = EntryGroup(
                    id=str(uuid.uuid4()),
                    entry_number=self.next_entry_number,
                    session_id=f"test-{int(now.timestamp())}-{idx + 1}",
                    leader_name=l_name,
                    team_name=t_name,
                    headcount=hc,
                    preference=actual_pref,
                    status=EntryStatus.WAITING,
                    created_at=created,
                    updated_at=created,
                )
                self.next_entry_number += 1
                self.entries.append(entry)
                added.append(entry)

            self.recalculate_slots(now)
            self.save_state()
            return added

    def _get_entry(self, entry_id: str) -> Optional[EntryGroup]:
        """self.entries 内のエントリー実体を取得"""
        return next((e for e in self.entries if e.id == entry_id), None)

    # --------------------------------------------------------------------------
    # 2. 運営側操作: スキップ（無効化）
    # --------------------------------------------------------------------------
    def skip_entry(
        self,
        entry_id: str,
        reason: str = "呼び出し時不在のためスキップ",
        current_time: Optional[datetime] = None,
    ) -> bool:
        with self._lock:
            now = ensure_utc(current_time) if current_time else now_utc()
            target = self._get_entry(entry_id)
            if not target:
                return False

            if target.status in (
                EntryStatus.IN_MATCH,
                EntryStatus.COMPLETED,
                EntryStatus.SKIPPED,
                EntryStatus.CANCELLED,
            ):
                return False

            # 現在対戦中 (IN_PROGRESS) の試合に属している場合はスキップ不可ガード
            if target.assigned_match_id:
                assigned_m = next((m for m in self.matches if m.id == target.assigned_match_id), None)
                if assigned_m and assigned_m.status == MatchStatus.IN_PROGRESS:
                    return False

            target.status = EntryStatus.SKIPPED
            target.skip_reason = reason
            target.updated_at = now

            # マッチに割り当てられていた場合の再編
            if target.assigned_match_id:
                match = next((m for m in self.matches if m.id == target.assigned_match_id), None)
                if match and match.status != MatchStatus.FINISHED:
                    was_calling = match.status == MatchStatus.CALLING
                    if match.is_closed_match:
                        # Closed (貸切枠) は代表グループが不在なら枠ごと破棄
                        match.status = MatchStatus.CANCELLED
                    else:
                        # Openマッチ: 不在グループを除外
                        remaining_assigned = [g for g in match.assigned_groups if g.id != target.id]

                        # チーム分けから除外
                        remaining_red = [g for g in (match.teams.red.groups if match.teams else []) if g.id != target.id]
                        remaining_blue = [g for g in (match.teams.blue.groups if match.teams else []) if g.id != target.id]

                        red_player_count = sum(g.headcount for g in remaining_red)
                        blue_player_count = sum(g.headcount for g in remaining_blue)

                        # スロット2 (CALLING: 次の試合) では、
                        # 既に呼出中のため、両チームに2名以上のプレイヤーが残っていれば（3v2 または 2v2）、
                        # マッチを解散させず不足人数（各チーム最大1名）を「運営スタッフ助っ人」として自動補充！
                        is_active_slot = match.status == MatchStatus.CALLING
                        can_support_with_staff = (red_player_count >= 2 and blue_player_count >= 2)

                        if is_active_slot and can_support_with_staff:
                            # 各チームが3名になるよう、不足分を運営スタッフ助っ人として補充
                            red_staff = max(0, 3 - red_player_count)
                            blue_staff = max(0, 3 - blue_player_count)

                            match.assigned_groups = remaining_assigned
                            match.total_players = red_player_count + blue_player_count
                            match.teams = MatchTeams(
                                red=TeamSideAssignment(
                                    team_side=TeamSideType.RED,
                                    groups=remaining_red,
                                    total_count=red_player_count,
                                    staff_count=red_staff,
                                ),
                                blue=TeamSideAssignment(
                                    team_side=TeamSideType.BLUE,
                                    groups=remaining_blue,
                                    total_count=blue_player_count,
                                    staff_count=blue_staff,
                                ),
                            )
                        else:
                            # 片方のチームが0名になった場合、または呼出前の枠(SCHEDULED)で不成立の場合:
                            # マッチを解散し、残されたグループを待機キュー最優先（元の created_at を保持）に戻して再マッチングを行う
                            match.status = MatchStatus.CANCELLED
                            for partner in remaining_assigned:
                                ent = self._get_entry(partner.id)
                                if ent:
                                    ent.status = EntryStatus.WAITING
                                    ent.assigned_match_id = None
                                    ent.updated_at = now
                                partner.status = EntryStatus.WAITING
                                partner.assigned_match_id = None
                                partner.updated_at = now

                            # CALLING (2. 次の試合) が解体され相方が待機列先頭に戻った場合、
                            # 後続の SCHEDULED (3. その次の試合) が相方を追い越して昇格するのを防ぐため、
                            # SCHEDULED も一旦待機プールに戻して created_at 順で公正に再編成する
                            if was_calling and remaining_assigned:
                                for sched_m in self.matches:
                                    if sched_m.status == MatchStatus.SCHEDULED:
                                        sched_m.status = MatchStatus.CANCELLED
                                        for sg in sched_m.assigned_groups:
                                            s_ent = self._get_entry(sg.id)
                                            if s_ent and s_ent.status not in (EntryStatus.SKIPPED, EntryStatus.CANCELLED):
                                                s_ent.status = EntryStatus.WAITING
                                                s_ent.assigned_match_id = None
                                                s_ent.updated_at = now
                                            if sg.status not in (EntryStatus.SKIPPED, EntryStatus.CANCELLED):
                                                sg.status = EntryStatus.WAITING
                                                sg.assigned_match_id = None
                                                sg.updated_at = now
                target.assigned_match_id = None

            # 空いた枠を即座に再計算・繰り上げ
            self.recalculate_slots(now)
            self.save_state()
            return True

    def restore_entry(
        self,
        entry_id: str,
        current_time: Optional[datetime] = None,
    ) -> bool:
        """不在スキップされたグループを待機キューの最優先（先頭）に救済・復帰させる"""
        with self._lock:
            now = ensure_utc(current_time) if current_time else now_utc()
            target = self._get_entry(entry_id)
            if not target:
                return False

            # スキップ状態のものだけが復帰可能（二重復帰や対戦完了・アクティブ枠の誤復帰を防止）
            if target.status != EntryStatus.SKIPPED:
                return False

            target.status = EntryStatus.WAITING
            target.skip_reason = None
            target.assigned_match_id = None
            target.updated_at = now

            # 待機列の最優先にするため、現在の全待機グループの中で最古となるよう created_at を設定
            waiting_entries = [e for e in self.entries if e.status == EntryStatus.WAITING and e.id != target.id]
            if waiting_entries:
                earliest_created = min(ensure_utc(e.created_at) for e in waiting_entries)
                target.created_at = min(ensure_utc(target.created_at), earliest_created - timedelta(seconds=1))
            else:
                target.created_at = now - timedelta(seconds=1)

            # SCHEDULED (3. その次の試合) が存在する場合、復帰したグループを公正に即時再編成できるよう
            # SCHEDULED を一旦解体して待機列と一緒に再編成する
            for sched_m in self.matches:
                if sched_m.status == MatchStatus.SCHEDULED:
                    sched_m.status = MatchStatus.CANCELLED
                    for sg in sched_m.assigned_groups:
                        s_ent = self._get_entry(sg.id)
                        if s_ent and s_ent.status not in (EntryStatus.SKIPPED, EntryStatus.CANCELLED):
                            s_ent.status = EntryStatus.WAITING
                            s_ent.assigned_match_id = None
                            s_ent.updated_at = now
                        if sg.status not in (EntryStatus.SKIPPED, EntryStatus.CANCELLED):
                            sg.status = EntryStatus.WAITING
                            sg.assigned_match_id = None
                            sg.updated_at = now

            self.recalculate_slots(now)
            self.save_state()
            return True

    # --------------------------------------------------------------------------
    # 3. 試合進行操作 (Advance)
    # --------------------------------------------------------------------------
    def advance_match_lifecycle(
        self,
        match_id: Optional[str] = None,
        current_time: Optional[datetime] = None,
    ) -> bool:
        with self._lock:
            now = ensure_utc(current_time) if current_time else now_utc()

            current = next((m for m in self.matches if m.status == MatchStatus.IN_PROGRESS), None)
            next_match = next((m for m in self.matches if m.status == MatchStatus.CALLING), None)
            next_next = next((m for m in self.matches if m.status == MatchStatus.SCHEDULED), None)

            if not current and not next_match and not next_next:
                return False

            # 特定の試合IDが指定され、それが「1. 現在対戦中 (IN_PROGRESS)」の『試合終了』操作だった場合:
            # 現在対戦中の試合のみを終了(FINISHED)してフィールド枠を空ける。
            # 「2. 次の試合 (CALLING)」はまだ受付点呼・不在確認中の可能性があるため勝手に昇格させず、
            # スタッフが『案内完了』を押したタイミングで昇格させる。
            if match_id and current and current.id == match_id:
                current.status = MatchStatus.FINISHED
                current.ended_at = now
                for g in current.assigned_groups:
                    g.status = EntryStatus.COMPLETED
                    g.updated_at = now
                    ent = self._get_entry(g.id)
                    if ent:
                        ent.status = EntryStatus.COMPLETED
                        ent.updated_at = now
                self.recalculate_slots(now)
                self.save_state()
                return True

            # 「2. 次の試合 (CALLING)」の『案内完了』、または全体進行の場合:
            # もし前の「1. 現在対戦中」がまだ終了していなければ自動的に終了させる
            if current:
                current.status = MatchStatus.FINISHED
                current.ended_at = now
                for g in current.assigned_groups:
                    g.status = EntryStatus.COMPLETED
                    g.updated_at = now
                    ent = self._get_entry(g.id)
                    if ent:
                        ent.status = EntryStatus.COMPLETED
                        ent.updated_at = now

            # Next -> Current
            if next_match:
                next_match.status = MatchStatus.IN_PROGRESS
                next_match.started_at = now
                for g in next_match.assigned_groups:
                    g.status = EntryStatus.IN_MATCH
                    g.updated_at = now
                    ent = self._get_entry(g.id)
                    if ent:
                        ent.status = EntryStatus.IN_MATCH
                        ent.updated_at = now

            # Next Next -> Next
            if next_next:
                next_next.status = MatchStatus.CALLING
                for g in next_next.assigned_groups:
                    g.status = EntryStatus.CALLED
                    g.updated_at = now
                    ent = self._get_entry(g.id)
                    if ent:
                        ent.status = EntryStatus.CALLED
                        ent.updated_at = now

            # スロット空き補充
            self.recalculate_slots(now)
            self.save_state()
            return True

    # --------------------------------------------------------------------------
    # 4. スロット（Next, Next Next）の再計算とカスケード昇格
    # --------------------------------------------------------------------------
    def recalculate_slots(self, current_time: Optional[datetime] = None) -> None:
        now = ensure_utc(current_time) if current_time else now_utc()

        # アクティブなスロットを取得
        calling_match = next((m for m in self.matches if m.status == MatchStatus.CALLING), None)
        scheduled_match = next((m for m in self.matches if m.status == MatchStatus.SCHEDULED), None)

        # カスケード昇格: Next(calling) が空いていて Next Next(scheduled) がある場合
        if not calling_match and scheduled_match:
            scheduled_match.status = MatchStatus.CALLING
            for g in scheduled_match.assigned_groups:
                g.status = EntryStatus.CALLED
                g.updated_at = now
                ent = self._get_entry(g.id)
                if ent:
                    ent.status = EntryStatus.CALLED
                    ent.updated_at = now
            calling_match = scheduled_match
            scheduled_match = None

        waiting_pool = [
            e for e in self.entries if e.status == EntryStatus.WAITING
        ]
        waiting_pool.sort(key=lambda x: ensure_utc(x.created_at))

        # Next 枠が依然として空いていれば探索
        if not calling_match and waiting_pool:
            match = self._find_next_combination(waiting_pool, now)
            if match:
                match.status = MatchStatus.CALLING
                for g in match.assigned_groups:
                    g.status = EntryStatus.CALLED
                    g.assigned_match_id = match.id
                    g.updated_at = now
                    ent = self._get_entry(g.id)
                    if ent:
                        ent.status = EntryStatus.CALLED
                        ent.assigned_match_id = match.id
                        ent.updated_at = now
                self.matches.append(match)
                calling_match = match

        # Next Next 枠の探索
        remaining_pool = [
            e for e in self.entries if e.status == EntryStatus.WAITING
        ]
        remaining_pool.sort(key=lambda x: ensure_utc(x.created_at))

        if not scheduled_match and remaining_pool:
            match = self._find_next_combination(remaining_pool, now)
            if match:
                match.status = MatchStatus.SCHEDULED
                for g in match.assigned_groups:
                    g.status = EntryStatus.CALLED  # 案内済
                    g.assigned_match_id = match.id
                    g.updated_at = now
                    ent = self._get_entry(g.id)
                    if ent:
                        ent.status = EntryStatus.CALLED
                        ent.assigned_match_id = match.id
                        ent.updated_at = now
                self.matches.append(match)

    # --------------------------------------------------------------------------
    # 5. マッチング探索アルゴリズム（味方は身内・グループ分割不可・1チーム最大3名）
    # --------------------------------------------------------------------------
    def _find_next_combination(
        self, waiting_pool: list[EntryGroup], current_time: datetime
    ) -> Optional[Match]:
        if not waiting_pool:
            return None

        first_group = waiting_pool[0]

        # Case A: 先頭が Closed (貸切内戦) の場合 -> 単独1枠
        if first_group.preference == PreferenceType.CLOSED:
            return self._create_closed_match(first_group, current_time)

        # Case B: 先頭が Open の場合
        open_groups = [g for g in waiting_pool if g.preference == PreferenceType.OPEN]
        if open_groups:
            target_g0 = open_groups[0]
            candidates = open_groups[1:]

            # 優先度 1: ぴったり6名 (Red 3名 vs Blue 3名) -> 即座に成立
            combo_6 = self._search_open_teams(target_g0, candidates, target_red=3, target_blue=3)
            if combo_6:
                red_groups, blue_groups = combo_6
                return self._create_open_match(red_groups, blue_groups, current_time)

            # 待機時間が閾値（flexible_wait_seconds）を超過しているか判定
            wait_seconds = (ensure_utc(current_time) - ensure_utc(target_g0.created_at)).total_seconds()
            if wait_seconds >= self.flexible_wait_seconds:
                # 優先度 2: 5名マッチング (Red 3名 vs Blue 2名 または Red 2名 vs Blue 3名 + スタッフ1名補充)
                combo_5 = self._search_open_teams(target_g0, candidates, target_red=3, target_blue=2)
                if not combo_5:
                    combo_5 = self._search_open_teams(target_g0, candidates, target_red=2, target_blue=3)
                if combo_5:
                    red_groups, blue_groups = combo_5
                    return self._create_open_match(red_groups, blue_groups, current_time)

                # 優先度 3: 4名マッチング (Red 2名 vs Blue 2名: 2v2 + スタッフ各1名補充)
                combo_4 = self._search_open_teams(target_g0, candidates, target_red=2, target_blue=2)
                if combo_4:
                    red_groups, blue_groups = combo_4
                    return self._create_open_match(red_groups, blue_groups, current_time)

        # Case C: 先頭の Open グループが人数不足で成立しない場合、
        # 後続に単独で枠に入れる Closed (貸切内戦・4名以上) があればスロットを優先的に割当
        closed_groups = [g for g in waiting_pool if g.preference == PreferenceType.CLOSED]
        if closed_groups:
            return self._create_closed_match(closed_groups[0], current_time)

        return None

    def _search_open_teams(
        self,
        g0: EntryGroup,
        candidates: list[EntryGroup],
        target_red: int,
        target_blue: int,
    ) -> Optional[tuple[list[EntryGroup], list[EntryGroup]]]:
        """target_g0 を Red チームの先頭に固定し、
        Red チームの合計人数が target_red、
        Blue チームの合計人数が target_blue になる組み合わせを探索する。
        """
        needed_for_red = target_red - g0.headcount
        if needed_for_red < 0:
            return None

        def find_subsets(
            pool: list[EntryGroup], target_sum: int
        ) -> list[tuple[list[EntryGroup], list[EntryGroup]]]:
            results = []

            def recurse(
                idx: int,
                cur_sum: int,
                chosen: list[EntryGroup],
                unchosen: list[EntryGroup],
            ):
                if cur_sum == target_sum:
                    results.append((chosen, unchosen + pool[idx:]))
                    return
                if cur_sum > target_sum or idx >= len(pool):
                    return

                # pool[idx] を採用 (FIFO優先)
                recurse(idx + 1, cur_sum + pool[idx].headcount, chosen + [pool[idx]], unchosen)
                # pool[idx] を不採用
                recurse(idx + 1, cur_sum, chosen, unchosen + [pool[idx]])

            recurse(0, 0, [], [])
            return results

        if needed_for_red == 0:
            red_candidates_list = [([], candidates)]
        else:
            red_candidates_list = find_subsets(candidates, needed_for_red)

        for red_partners, remaining_pool in red_candidates_list:
            # 残りのプールから Blue (target_blue) を探索
            blue_matches = find_subsets(remaining_pool, target_blue)
            if blue_matches:
                blue_groups, _ = blue_matches[0]
                red_groups = [g0] + red_partners
                return (red_groups, blue_groups)

        return None

    def _create_closed_match(self, group: EntryGroup, current_time: datetime) -> Match:
        match_id = str(uuid.uuid4())
        self.next_match_number += 1

        # Closed は仲間内対戦（8分枠）
        match = Match(
            id=match_id,
            match_number=self.next_match_number - 1,
            status=MatchStatus.SCHEDULED,
            is_closed_match=True,
            duration_minutes=8,
            assigned_groups=[group],
            total_players=group.headcount,
            teams=MatchTeams(
                red=TeamSideAssignment(team_side=TeamSideType.RED, groups=[group], total_count=group.headcount, staff_count=0),
                blue=TeamSideAssignment(team_side=TeamSideType.BLUE, groups=[], total_count=0, staff_count=0),
            ),
            created_at=current_time,
        )
        return match

    def _create_open_match(
        self, red_groups: list[EntryGroup], blue_groups: list[EntryGroup], current_time: datetime
    ) -> Match:
        match_id = str(uuid.uuid4())
        self.next_match_number += 1

        red_count = sum(g.headcount for g in red_groups)
        blue_count = sum(g.headcount for g in blue_groups)
        red_staff = max(0, 3 - red_count)
        blue_staff = max(0, 3 - blue_count)
        all_groups = red_groups + blue_groups

        match = Match(
            id=match_id,
            match_number=self.next_match_number - 1,
            status=MatchStatus.SCHEDULED,
            is_closed_match=False,
            duration_minutes=10,
            assigned_groups=all_groups,
            total_players=red_count + blue_count,
            teams=MatchTeams(
                red=TeamSideAssignment(
                    team_side=TeamSideType.RED,
                    groups=red_groups,
                    total_count=red_count,
                    staff_count=red_staff,
                ),
                blue=TeamSideAssignment(
                    team_side=TeamSideType.BLUE,
                    groups=blue_groups,
                    total_count=blue_count,
                    staff_count=blue_staff,
                ),
            ),
            created_at=current_time,
        )
        return match

    # --------------------------------------------------------------------------
    # 6. サジェストTipsと待機情報算出
    # --------------------------------------------------------------------------
    def calculate_suggestion_tip(self) -> SuggestionTip:
        open_waiting = [
            g for g in self.entries if g.status == EntryStatus.WAITING and g.preference == PreferenceType.OPEN
        ]

        if not open_waiting:
            return SuggestionTip(
                recommended_party_size=None,
                message="現在待機列なし！何名様でもすぐにご案内可能です。",
            )

        # 待機列先頭のOpenグループを見て、あと何名いれば即座にマッチが組めるか計算
        g0 = open_waiting[0]
        if g0.headcount == 1:
            return SuggestionTip(
                recommended_party_size=1,
                message="現在【1名】または【2名】組なら、すぐに対戦マッチング可能です！（Open枠）",
            )
        elif g0.headcount == 2:
            return SuggestionTip(
                recommended_party_size=2,
                message="現在【2名】組（2v2）または【3名】組（3v2）なら、すぐに対戦可能です！",
            )
        else:  # 3名
            return SuggestionTip(
                recommended_party_size=2,
                message="現在【2名】または【3名】組なら、すぐに対戦マッチング可能です！（Open枠）",
            )

    def get_group_status(self, entry_id: str) -> Optional[dict]:
        group = next((e for e in self.entries if e.id == entry_id), None)
        if not group:
            return None

        if group.status in (EntryStatus.COMPLETED, EntryStatus.SKIPPED, EntryStatus.CANCELLED):
            return {
                "entry": group,
                "ahead_groups_count": 0,
                "estimated_wait_minutes": 0,
                "slot_name": "inactive",
            }

        slot_name = "waiting"
        if group.assigned_match_id:
            m = next((match for match in self.matches if match.id == group.assigned_match_id), None)
            if m:
                if m.status == MatchStatus.IN_PROGRESS:
                    slot_name = "current"
                elif m.status == MatchStatus.CALLING:
                    slot_name = "next"
                elif m.status == MatchStatus.SCHEDULED:
                    slot_name = "next_next"

        ahead_count = 0
        if slot_name == "waiting":
            ahead_count = sum(
                1 for e in self.entries
                if e.status == EntryStatus.WAITING and ensure_utc(e.created_at) < ensure_utc(group.created_at)
            )

        # 予想待ち時間（1サイクル約10〜12分）
        cycle_minutes = 12
        if slot_name == "current":
            wait_min = 0
        elif slot_name == "next":
            wait_min = 5
        elif slot_name == "next_next":
            wait_min = 15
        else:
            wait_min = 20 + (ahead_count // 2) * cycle_minutes

        return {
            "entry": group,
            "ahead_groups_count": ahead_count,
            "estimated_wait_minutes": wait_min,
            "slot_name": slot_name,
        }
