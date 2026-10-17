"""3x3 サバゲーマッチングエンジン (matching_engine.py)

このファイルはマッチングシステムの『頭脳』となるアルゴリズム本体です。
あなたがアルゴリズムを自由に改造・実験できるように、分かりやすい構造と丁寧なコメントで書いています。

主なアルゴリズム関数:
  - find_next_match()   : 待機列から合計6名（または貸切6名）のマッチ候補を選定
  - assign_teams()      : 6名のプレイヤーを「赤3名 vs 青3名」に分割・配分
  - calculate_suggestion(): モニタに表示する「あと何名ですぐ案内できるか」のTips計算
"""

from __future__ import annotations
import uuid
from datetime import datetime
from typing import Optional

from models import (
    EntryGroup,
    Preference,
    EntryStatus,
    Match,
    MatchStatus,
    MatchTeams,
    TeamAllocation,
    SystemConfig,
    SuggestionTip,
)


class MatchingEngine:
    """マッチングエンジン本体クラス"""

    def __init__(self, config: Optional[SystemConfig] = None) -> None:
        self.config: SystemConfig = config or SystemConfig()
        self.entries: list[EntryGroup] = []  # 登録された全グループの履歴
        self.matches: list[Match] = []        # 生成された全試合の履歴
        self._next_entry_number: int = 101    # 整理券番号のカウンター
        self._next_match_number: int = 1      # 試合番号のカウンター

    # =========================================================================
    # 1. エントリー受付 (受付窓口)
    # =========================================================================
    def register_entry(
        self,
        leader_name: str,
        team_name: str,
        member_count: int,
        preference: Preference = Preference.OPEN,
        created_at: Optional[datetime] = None,
    ) -> EntryGroup:
        """新しいグループを受付・登録し、即座にスロット再計算を行います。

        Raises:
            ValueError: 人数が1〜6名以外の場合、または貸切なのに6名でない場合
        """
        if not (1 <= member_count <= 6):
            raise ValueError(f"メンバー数は1〜6名である必要があります。（入力値: {member_count}名）")

        # 3x3厳守ルール: 貸切（Closed）は仲間内で3vs3対戦を行うため「ちょうど6名」のみ許可
        if preference == Preference.CLOSED and member_count != 6:
            raise ValueError(
                f"貸切（Closed）は3 vs 3対戦のため、ちょうど6名である必要があります。（入力値: {member_count}名）"
            )

        now = created_at or datetime.now()
        group = EntryGroup(
            id=f"entry-{uuid.uuid4().hex[:6]}",
            entry_number=self._next_entry_number,
            leader_name=leader_name,
            team_name=team_name,
            member_count=member_count,
            preference=preference,
            status=EntryStatus.WAITING,
            created_at=now,
        )
        self._next_entry_number += 1
        self.entries.append(group)

        # エントリー登録後、すぐにマッチング可能かスロットを再計算
        self.recalculate_slots(now)
        return group

    # =========================================================================
    # 2. ★【アルゴリズム①】マッチング探索 (どのグループでマッチを作るか？)
    # =========================================================================
    def find_next_match(
        self,
        waiting_pool: list[EntryGroup],
        current_time: datetime,
    ) -> Optional[Match]:
        """待機中のグループから、次に試合を行う組み合わせを探索します。

        【探索優先順位】:
        1. 先頭が貸切（Closed 6名）なら即座に貸切マッチ成立
        2. 先頭Openグループを含めて「合計6名」（一般プレイヤーのみ）を作れるか探索
        3. 先頭Openグループを含めて「合計5名」（3/2編成 ＋ 運営スタッフ1名助っ人）を作れるか探索
        4. 先頭がマッチできない場合（詰まり防止）:
           後続グループ同士で「合計6名」または「合計5名」が作れるなら、追い越しマッチを許可してフィールドを遊ばせない！
        """
        if not waiting_pool:
            return None

        # 待機列の先頭グループ
        first_group = waiting_pool[0]

        # --- パターンA: 先頭が貸切（Closed 6名）の場合 ---
        if first_group.preference == Preference.CLOSED:
            return self._create_match([first_group], is_closed=True, created_at=current_time)

        # --- パターンB: 通常（Open）の組み合わせ探索 ---
        open_groups = [g for g in waiting_pool if g.preference == Preference.OPEN]
        if not open_groups:
            return None

        # 1. 先頭グループを含む組み合わせの探索
        target_group = open_groups[0]
        candidate_pool = open_groups[1:]

        # 1-a. 単独6名
        if target_group.member_count == 6:
            return self._create_match([target_group], is_closed=False, created_at=current_time)

        # 1-b. 先頭＋後続で合計6名（通常マッチ）
        exact_six = self._find_exact_sum(candidate_pool, 6 - target_group.member_count)
        if exact_six is not None:
            return self._create_match([target_group] + exact_six, is_closed=False, created_at=current_time)

        # 1-c. 先頭＋後続で合計5名（3/2許可 ＋ 運営スタッフ1名助っ人参加）
        if target_group.member_count <= 5:
            needed_for_five = 5 - target_group.member_count
            if needed_for_five == 0:
                return self._create_match([target_group], is_closed=False, created_at=current_time)
            exact_five = self._find_exact_sum(candidate_pool, needed_for_five)
            if exact_five is not None:
                return self._create_match([target_group] + exact_five, is_closed=False, created_at=current_time)

        # 2. 先頭グループがマッチできない場合の「先頭詰まり防止（追い越しマッチング）」
        # 後続グループ群 candidate_pool から 6名 または 5名 を探索
        if len(candidate_pool) >= 2:
            sub_target = candidate_pool[0]
            sub_pool = candidate_pool[1:]
            if sub_target.member_count == 6:
                return self._create_match([sub_target], is_closed=False, created_at=current_time)
            exact_six_sub = self._find_exact_sum(sub_pool, 6 - sub_target.member_count)
            if exact_six_sub is not None:
                return self._create_match([sub_target] + exact_six_sub, is_closed=False, created_at=current_time)

            if sub_target.member_count <= 5:
                needed_five_sub = 5 - sub_target.member_count
                if needed_five_sub == 0:
                    return self._create_match([sub_target], is_closed=False, created_at=current_time)
                exact_five_sub = self._find_exact_sum(sub_pool, needed_five_sub)
                if exact_five_sub is not None:
                    return self._create_match([sub_target] + exact_five_sub, is_closed=False, created_at=current_time)

        return None

    def _find_exact_sum(
        self,
        candidates: list[EntryGroup],
        target_sum: int,
    ) -> Optional[list[EntryGroup]]:
        """到着順（FIFO）を優先して、合計が target_sum になる組み合わせを探す（部分和探索）。"""
        result: list[EntryGroup] = []

        def search(index: int, current_sum: int) -> bool:
            if current_sum == target_sum:
                return True
            if current_sum > target_sum or index >= len(candidates):
                return False

            result.append(candidates[index])
            if search(index + 1, current_sum + candidates[index].member_count):
                return True
            result.pop()

            if search(index + 1, current_sum):
                return True
            return False

        if search(0, 0):
            return result
        return None

    # =========================================================================
    # 3. ★【アルゴリズム②】チーム編成 (赤3名 vs 青3名 にどう分けるか？)
    # =========================================================================
    def assign_teams(self, groups: list[EntryGroup]) -> MatchTeams:
        """選ばれたグループ（合計6名または5名）を「Red 3名 vs Blue 3名」に配分します。
        合計5名の場合は、足りない1名を「運営スタッフ（シフトから参加）」として補充します。
        どんな人数のグループ構成でも（[2, 2, 2] 等も含め）、厳密に各チーム3名を作成します。
        """
        total_players = sum(g.member_count for g in groups)
        is_staff_needed = (total_players == 5)

        # 単一グループで6名の場合（Closed または 6名Open）
        if len(groups) == 1 and groups[0].member_count == 6:
            g = groups[0]
            return MatchTeams(
                team_red=[TeamAllocation(group=g, player_count=3)],
                team_blue=[TeamAllocation(group=g, player_count=3)],
                team_red_count=3,
                team_blue_count=3,
            )

        # ステップ1: グループを分割せずに Red（3名）が作れるか試す
        exact_three = self._find_exact_sum(groups, 3)
        if exact_three is not None:
            red_ids = {g.id for g in exact_three}
            team_red = [TeamAllocation(group=g, player_count=g.member_count) for g in exact_three]
            team_blue = [
                TeamAllocation(group=g, player_count=g.member_count)
                for g in groups
                if g.id not in red_ids
            ]
            if is_staff_needed:
                team_blue.append(TeamAllocation(group=None, player_count=1, is_staff=True))
            return MatchTeams(team_red=team_red, team_blue=team_blue, team_red_count=3, team_blue_count=3)

        # ステップ2: 分割が必要な場合（[2, 2, 2], [4, 2], [5, 1], [4, 1] など）
        team_red: list[TeamAllocation] = []
        team_blue: list[TeamAllocation] = []
        red_rem = 3
        blue_rem = 2 if is_staff_needed else 3

        # 人数の大きい順にソート（仲間同士のまとまりを維持）
        sorted_groups = sorted(groups, key=lambda g: g.member_count, reverse=True)

        for g in sorted_groups:
            count = g.member_count
            if red_rem >= count:
                team_red.append(TeamAllocation(group=g, player_count=count))
                red_rem -= count
            elif red_rem > 0:
                to_red = red_rem
                to_blue = count - to_red
                team_red.append(TeamAllocation(group=g, player_count=to_red))
                red_rem = 0
                if to_blue > 0:
                    team_blue.append(TeamAllocation(group=g, player_count=to_blue))
                    blue_rem -= to_blue
            else:
                team_blue.append(TeamAllocation(group=g, player_count=count))
                blue_rem -= count

        if is_staff_needed:
            team_blue.append(TeamAllocation(group=None, player_count=1, is_staff=True))

        return MatchTeams(team_red=team_red, team_blue=team_blue, team_red_count=3, team_blue_count=3)

    # =========================================================================
    # 4. ★【アルゴリズム③】サジェストTips (モニタへの案内表示)
    # =========================================================================
    def calculate_suggestion(self, waiting_groups: list[EntryGroup]) -> SuggestionTip:
        """待機列の状況から、あと何名いれば即座に対戦成立するかを算出します。"""
        open_waiting = [g for g in waiting_groups if g.preference == Preference.OPEN]

        if not open_waiting:
            return SuggestionTip(
                recommended_party_size=3,
                message="現在待機列なし！何名様でもすぐにご案内可能です。",
            )

        total_players = sum(g.member_count for g in open_waiting)
        if total_players >= 5:
            return SuggestionTip(
                recommended_party_size=1,
                message="まもなく対戦マッチングが成立します！",
            )

        needed = 5 - total_players
        return SuggestionTip(
            recommended_party_size=needed,
            message=f"現在【{needed}名】組なら、すぐにご案内可能です！（3vs3即時成立・スタッフ助っ人あり）",
        )

    # =========================================================================
    # 5. 試合インスタンス生成の内部処理
    # =========================================================================
    def _create_match(
        self,
        groups: list[EntryGroup],
        is_closed: bool,
        created_at: datetime,
    ) -> Match:
        duration = (
            self.config.closed_match_duration_minutes
            if is_closed
            else self.config.standard_match_duration_minutes
        )
        total_players = sum(g.member_count for g in groups)
        is_staff_assisted = (total_players == 5)
        teams = self.assign_teams(groups)

        match = Match(
            id=f"match-{self._next_match_number}",
            match_number=self._next_match_number,
            status=MatchStatus.SCHEDULED,
            is_closed_match=is_closed,
            allocated_duration_minutes=duration,
            assigned_groups=groups,
            total_players=6,  # スタッフ補充により常に6名対戦
            teams=teams,
            is_staff_assisted=is_staff_assisted,
            created_at=created_at,
        )
        self._next_match_number += 1
        return match

    # =========================================================================
    # 6. スロット管理 (Current / Next / Next Next の自動繰り上げ)
    # =========================================================================
    def recalculate_slots(self, current_time: Optional[datetime] = None) -> None:
        """Next（呼出中）枠および Next Next（待機中）枠の空きを検知し、自動でマッチを補充します。"""
        now = current_time or datetime.now()

        # 待機中グループ（到着順）
        waiting_groups = [
            g for g in self.entries if g.status == EntryStatus.WAITING
        ]
        waiting_groups.sort(key=lambda g: g.created_at)

        calling_match = next((m for m in self.matches if m.status == MatchStatus.CALLING), None)
        scheduled_match = next((m for m in self.matches if m.status == MatchStatus.SCHEDULED), None)

        # Next枠が空いていて、Next Next枠があれば即座にNextへ繰り上げ昇格
        if calling_match is None and scheduled_match is not None:
            scheduled_match.status = MatchStatus.CALLING
            for g in scheduled_match.assigned_groups:
                g.status = EntryStatus.CALLED
                if not g.called_at:
                    g.called_at = now
            calling_match = scheduled_match
            scheduled_match = None

        # Next枠が依然として空いている場合、新規マッチを探索してNext枠へ配分
        if calling_match is None and waiting_groups:
            new_match = self.find_next_match(waiting_groups, now)
            if new_match is not None:
                new_match.status = MatchStatus.CALLING
                for g in new_match.assigned_groups:
                    g.status = EntryStatus.CALLED
                    g.called_at = now
                    g.matched_at = now
                    g.assigned_match_id = new_match.id
                self.matches.append(new_match)
                calling_match = new_match

        # 再度待機中グループを取得（Nextに選ばれたものを除外）
        remaining_waiting = [
            g for g in self.entries if g.status == EntryStatus.WAITING
        ]
        remaining_waiting.sort(key=lambda g: g.created_at)

        # Next Next枠が空いていれば、新規マッチを探索してNext Next枠へ配分
        if scheduled_match is None and remaining_waiting:
            new_match = self.find_next_match(remaining_waiting, now)
            if new_match is not None:
                new_match.status = MatchStatus.SCHEDULED
                for g in new_match.assigned_groups:
                    g.status = EntryStatus.CALLED  # 案内準備完了
                    g.matched_at = now
                    g.assigned_match_id = new_match.id
                self.matches.append(new_match)

    # =========================================================================
    # 7. 試合ライフサイクル進行 (Advance Match)
    # =========================================================================
    def advance_match_lifecycle(self, current_time: Optional[datetime] = None) -> None:
        """試合を1サイクル進めます。
        Current（進行中）は終了 ➔ Next（呼出中）がCurrentへ ➔ Next Next（待機中）がNextへ繰り上がります。
        """
        now = current_time or datetime.now()

        current = next((m for m in self.matches if m.status == MatchStatus.IN_PROGRESS), None)
        nxt = next((m for m in self.matches if m.status == MatchStatus.CALLING), None)
        nxt_nxt = next((m for m in self.matches if m.status == MatchStatus.SCHEDULED), None)

        # 進行中の試合を終了
        if current:
            current.status = MatchStatus.FINISHED
            current.ended_at = now
            for g in current.assigned_groups:
                g.status = EntryStatus.COMPLETED

        # 呼出中の試合をフィールド内（進行中）へ
        if nxt:
            nxt.status = MatchStatus.IN_PROGRESS
            nxt.started_at = now
            for g in nxt.assigned_groups:
                g.status = EntryStatus.IN_MATCH

        # 次々回の試合を呼出中へ
        if nxt_nxt:
            nxt_nxt.status = MatchStatus.CALLING
            for g in nxt_nxt.assigned_groups:
                g.status = EntryStatus.CALLED
                if not g.called_at:
                    g.called_at = now

        # 空いた枠を自動補充
        self.recalculate_slots(now)

    # =========================================================================
    # 8. 運営側操作: 不在スキップ機能
    # =========================================================================
    def skip_entry(
        self,
        entry_id: str,
        reason: str = "呼び出し時不在のため無効化",
        current_time: Optional[datetime] = None,
    ) -> bool:
        """指定されたグループをスキップ（無効化）し、後続グループを即時繰り上げます。"""
        now = current_time or datetime.now()
        group = next((e for e in self.entries if e.id == entry_id), None)
        if not group:
            return False

        if group.status in (EntryStatus.COMPLETED, EntryStatus.SKIPPED, EntryStatus.CANCELLED):
            return False

        group.status = EntryStatus.SKIPPED
        group.skipped_at = now
        group.skip_reason = reason

        # もし試合枠にアサインされていた場合は、その試合枠を再編
        if group.assigned_match_id:
            match = next((m for m in self.matches if m.id == group.assigned_match_id), None)
            if match and match.status != MatchStatus.FINISHED:
                if match.is_closed_match:
                    match.status = MatchStatus.CANCELLED
                else:
                    # Open枠の場合は残ったグループを待機状態に戻して即時再マッチング
                    for remaining in match.assigned_groups:
                        if remaining.id != group.id:
                            remaining.status = EntryStatus.WAITING
                            remaining.assigned_match_id = None
                    match.status = MatchStatus.CANCELLED
            group.assigned_match_id = None

        # スキップに伴い、空いたスロットを即座に再計算・繰り上げ
        self.recalculate_slots(now)
        return True

    # =========================================================================
    # 9. 画面表示用データの取得
    # =========================================================================
    def get_display_state(self) -> dict:
        """待機モニタに表示するためのスロット情報・待機状況を辞書で取得します。"""
        current_match = next((m for m in self.matches if m.status == MatchStatus.IN_PROGRESS), None)
        next_match = next((m for m in self.matches if m.status == MatchStatus.CALLING), None)
        next_next_match = next((m for m in self.matches if m.status == MatchStatus.SCHEDULED), None)

        waiting_groups = [g for g in self.entries if g.status == EntryStatus.WAITING]
        total_waiting_players = sum(g.member_count for g in waiting_groups)
        suggestion_tip = self.calculate_suggestion(waiting_groups)

        return {
            "current_match": current_match,
            "next_match": next_match,
            "next_next_match": next_next_match,
            "suggestion_tip": suggestion_tip,
            "total_waiting_groups": len(waiting_groups),
            "total_waiting_players": total_waiting_players,
        }

    def get_all_entries(self) -> list[EntryGroup]:
        """全エントリーグループのリストを取得"""
        return self.entries
