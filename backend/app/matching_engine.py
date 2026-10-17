"""Core matching engine implementation strictly following OVALANT rules.
- Rule: '味方は身内、敵は他人' (No group splitting, 1 team max 3 players).
- 4-6 players automatically forced to Closed (8 min duration).
- 1-3 players can choose Open (10 min) or Closed (8 min).
- Flexible 5-player fallback when waiting >= 10 minutes.
- 3-slot pipeline (current, next, next_next) with cascade promotion and skip handling.
"""

from __future__ import annotations
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


class MatchingEngine:
    def __init__(self, flexible_wait_seconds: int = 600):
        self.entries: list[EntryGroup] = []
        self.matches: list[Match] = []
        self.next_entry_number: int = 101
        self.next_match_number: int = 1
        self.flexible_wait_seconds: int = flexible_wait_seconds  # デフォルト10分 (600秒)

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
        now = created_at or datetime.now()

        # 4名以上は友人が敵味方に分断されるのを防ぐため強制的に Closed
        actual_preference = PreferenceType.CLOSED if headcount >= 4 else preference

        entry = EntryGroup(
            id=f"entry-{int(now.timestamp() * 1000)}-{len(self.entries) + 1}",
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
        return entry

    # --------------------------------------------------------------------------
    # 2. 運営側操作: スキップ（無効化）
    # --------------------------------------------------------------------------
    def skip_entry(
        self,
        entry_id: str,
        reason: str = "呼び出し時不在のためスキップ",
        current_time: Optional[datetime] = None,
    ) -> bool:
        now = current_time or datetime.now()
        target = next((e for e in self.entries if e.id == entry_id), None)
        if not target:
            return False

        if target.status in (EntryStatus.COMPLETED, EntryStatus.SKIPPED, EntryStatus.CANCELLED):
            return False

        target.status = EntryStatus.SKIPPED
        target.skip_reason = reason
        target.updated_at = now

        # マッチに割り当てられていた場合の再編
        if target.assigned_match_id:
            match = next((m for m in self.matches if m.id == target.assigned_match_id), None)
            if match and match.status != MatchStatus.FINISHED:
                if match.is_closed_match:
                    # Closedマッチは枠ごと破棄
                    match.status = MatchStatus.CANCELLED
                else:
                    # Openマッチは解体し、残された相方グループは元のcreated_atを維持して待機キュー最優先に戻す
                    match.status = MatchStatus.CANCELLED
                    for partner in match.assigned_groups:
                        if partner.id != target.id:
                            partner.status = EntryStatus.WAITING
                            partner.assigned_match_id = None
                            partner.updated_at = now
            target.assigned_match_id = None

        # 空いた枠を即座に再計算・繰り上げ
        self.recalculate_slots(now)
        return True

    # --------------------------------------------------------------------------
    # 3. 試合進行操作 (Advance)
    # --------------------------------------------------------------------------
    def advance_match_lifecycle(self, current_time: Optional[datetime] = None) -> bool:
        now = current_time or datetime.now()

        current = next((m for m in self.matches if m.status == MatchStatus.IN_PROGRESS), None)
        next_match = next((m for m in self.matches if m.status == MatchStatus.CALLING), None)
        next_next = next((m for m in self.matches if m.status == MatchStatus.SCHEDULED), None)

        if not current and not next_match and not next_next:
            return False

        # Current 終了
        if current:
            current.status = MatchStatus.FINISHED
            current.ended_at = now
            for g in current.assigned_groups:
                g.status = EntryStatus.COMPLETED
                g.updated_at = now

        # Next -> Current
        if next_match:
            next_match.status = MatchStatus.IN_PROGRESS
            next_match.started_at = now
            for g in next_match.assigned_groups:
                g.status = EntryStatus.IN_MATCH
                g.updated_at = now

        # Next Next -> Next
        if next_next:
            next_next.status = MatchStatus.CALLING
            for g in next_next.assigned_groups:
                g.status = EntryStatus.CALLED
                g.updated_at = now

        # スロット空き補充
        self.recalculate_slots(now)
        return True

    # --------------------------------------------------------------------------
    # 4. スロット（Next, Next Next）の再計算とカスケード昇格
    # --------------------------------------------------------------------------
    def recalculate_slots(self, current_time: Optional[datetime] = None) -> None:
        now = current_time or datetime.now()

        # アクティブなスロットを取得
        calling_match = next((m for m in self.matches if m.status == MatchStatus.CALLING), None)
        scheduled_match = next((m for m in self.matches if m.status == MatchStatus.SCHEDULED), None)

        # カスケード昇格: Next(calling) が空いていて Next Next(scheduled) がある場合
        if not calling_match and scheduled_match:
            scheduled_match.status = MatchStatus.CALLING
            for g in scheduled_match.assigned_groups:
                g.status = EntryStatus.CALLED
                g.updated_at = now
            calling_match = scheduled_match
            scheduled_match = None

        waiting_pool = [
            e for e in self.entries if e.status == EntryStatus.WAITING
        ]
        waiting_pool.sort(key=lambda x: x.created_at)

        # Next 枠が依然として空いていれば探索
        if not calling_match and waiting_pool:
            match = self._find_next_combination(waiting_pool, now)
            if match:
                match.status = MatchStatus.CALLING
                for g in match.assigned_groups:
                    g.status = EntryStatus.CALLED
                    g.assigned_match_id = match.id
                    g.updated_at = now
                self.matches.append(match)
                calling_match = match

        # Next Next 枠の探索
        remaining_pool = [
            e for e in self.entries if e.status == EntryStatus.WAITING
        ]
        remaining_pool.sort(key=lambda x: x.created_at)

        if not scheduled_match and remaining_pool:
            match = self._find_next_combination(remaining_pool, now)
            if match:
                match.status = MatchStatus.SCHEDULED
                for g in match.assigned_groups:
                    g.status = EntryStatus.CALLED  # 案内済
                    g.assigned_match_id = match.id
                    g.updated_at = now
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
        # Openグループのみを対象に、1チーム最大3名・グループ分割なしで探索
        open_groups = [g for g in waiting_pool if g.preference == PreferenceType.OPEN]
        if not open_groups:
            return None

        target_g0 = open_groups[0]
        candidates = open_groups[1:]

        # Step 1: ぴったり6名 (Red 3名 vs Blue 3名) の探索
        combo_6 = self._search_open_teams(target_g0, candidates, target_red=3, target_blue=3)
        if combo_6:
            red_groups, blue_groups = combo_6
            return self._create_open_match(red_groups, blue_groups, current_time)

        # Step 2: 待機時間閾値チェック（柔軟5名マッチング）
        wait_seconds = (current_time - target_g0.created_at).total_seconds()
        if wait_seconds >= self.flexible_wait_seconds:
            # 5名マッチング (Red 3名 vs Blue 2名 または Red 2名 vs Blue 3名)
            combo_5 = self._search_open_teams(target_g0, candidates, target_red=3, target_blue=2)
            if not combo_5:
                combo_5 = self._search_open_teams(target_g0, candidates, target_red=2, target_blue=3)
            if combo_5:
                red_groups, blue_groups = combo_5
                return self._create_open_match(red_groups, blue_groups, current_time)

        return None

    def _search_open_teams(
        self,
        g0: EntryGroup,
        candidates: list[EntryGroup],
        target_red: int,
        target_blue: int,
    ) -> Optional[tuple[list[EntryGroup], list[EntryGroup]]]:
        """g0 を Red に固定し、グループ分割なしで Red(target_red) と Blue(target_blue) を満たす組み合わせを FIFO 探索"""
        if g0.headcount > target_red:
            return None

        needed_for_red = target_red - g0.headcount

        # Red の残りを埋めるグループ群を探索
        def find_subsets(
            pool: list[EntryGroup], target_sum: int, start_idx: int = 0
        ) -> list[tuple[list[EntryGroup], list[EntryGroup]]]:
            # 返り値: [(選ばれたグループ, 残りのプール)]
            results = []

            def recurse(idx: int, cur_sum: int, chosen: list[EntryGroup], unchosen: list[EntryGroup]):
                if cur_sum == target_sum:
                    # 残りをすべて unchosen に追加
                    results.append((list(chosen), unchosen + pool[idx:]))
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
        match_id = f"match-{self.next_match_number}"
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
                red=TeamSideAssignment(team_side=TeamSideType.RED, groups=[group], total_count=group.headcount),
                blue=TeamSideAssignment(team_side=TeamSideType.BLUE, groups=[], total_count=0),
            ),
            created_at=current_time,
        )
        return match

    def _create_open_match(
        self, red_groups: list[EntryGroup], blue_groups: list[EntryGroup], current_time: datetime
    ) -> Match:
        match_id = f"match-{self.next_match_number}"
        self.next_match_number += 1

        red_count = sum(g.headcount for g in red_groups)
        blue_count = sum(g.headcount for g in blue_groups)
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
                red=TeamSideAssignment(team_side=TeamSideType.RED, groups=red_groups, total_count=red_count),
                blue=TeamSideAssignment(team_side=TeamSideType.BLUE, groups=blue_groups, total_count=blue_count),
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
        # 1チーム最大3名なので、先頭グループが1名なら [2名] を、2名なら [1名] をサジェスト
        g0 = open_waiting[0]
        if g0.headcount == 1:
            return SuggestionTip(
                recommended_party_size=2,
                message="現在【2名】組なら、すぐにご案内可能です！（Open枠）",
            )
        elif g0.headcount == 2:
            return SuggestionTip(
                recommended_party_size=1,
                message="現在【1名】組なら、すぐにご案内可能です！（Open枠）",
            )
        else:  # 3名
            return SuggestionTip(
                recommended_party_size=3,
                message="現在【3名】組なら、すぐに対戦相手とマッチング可能です！（Open枠）",
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
                if e.status == EntryStatus.WAITING and e.created_at < group.created_at
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
