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
    # 2. ★【アルゴリズム①】マッチング探索 (どのグループで6名を作るか？)
    # =========================================================================
    def find_next_match(
        self,
        waiting_pool: list[EntryGroup],
        current_time: datetime,
    ) -> Optional[Match]:
        """待機中のグループから、次に試合を行う組み合わせを探索します。

        【改造のヒント】:
        現在は「FIFO（到着順）最優先」で、先頭のグループを必ず含めて合計6名になる
        組み合わせを探しています。
        待ち時間が長いグループの優先度を高めたり、人数に応じたマッチング順序を変えたい
        場合は、このメソッドの探索ロジックを改造してください。
        """
        if not waiting_pool:
            return None

        # 待機列の先頭グループ（最も長く待っているグループ）
        first_group = waiting_pool[0]

        # --- パターンA: 先頭が貸切（Closed 6名）の場合 ---
        if first_group.preference == Preference.CLOSED:
            return self._create_match([first_group], is_closed=True, created_at=current_time)

        # --- パターンB: 先頭が通常（Open）の場合 ---
        # Open希望のグループのみを対象に組み合わせを探索
        open_groups = [g for g in waiting_pool if g.preference == Preference.OPEN]
        if not open_groups:
            return None

        target_group = open_groups[0]
        needed_players = self.config.max_players_per_match - target_group.member_count

        # 先頭グループ単独で6名の場合
        if needed_players == 0:
            return self._create_match([target_group], is_closed=False, created_at=current_time)

        # 先頭グループ以外の候補から、残りの人数（needed_players）に一致する組み合わせを探す
        candidate_pool = open_groups[1:]
        exact_combo = self._find_exact_sum(candidate_pool, needed_players)

        if exact_combo is not None:
            # 先頭グループ ＋ ピッタリ人数になる後続グループたち で合計6名マッチ成立！
            matched_groups = [target_group] + exact_combo
            return self._create_match(matched_groups, is_closed=False, created_at=current_time)

        # 合計6名が集まらない場合はマッチ不成立（3 vs 3を厳守するため待機）
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

            # candidates[index] を採用する場合 (先に並んだ人を優先)
            result.append(candidates[index])
            if search(index + 1, current_sum + candidates[index].member_count):
                return True
            result.pop()  # バックトラック（戻す）

            # candidates[index] を採用しない場合
            if search(index + 1, current_sum):
                return True

            return False

        if search(0, 0):
            return result
        return None

    # =========================================================================
    # 3. ★【アルゴリズム②】チーム編成 (6名を 赤3名 vs 青3名 にどう分けるか？)
    # =========================================================================
    def assign_teams(self, groups: list[EntryGroup]) -> MatchTeams:
        """選ばれたグループ（合計6名）を「Red 3名 vs Blue 3名」に配分します。

        【方針】:
        1. グループを分割せずに 3名 vs 3名 に分けられるなら、仲間同士を分断しない（最優先）
           （例: [3名] vs [3名]、[3名] vs [2名+1名]、[2名+1名] vs [2名+1名] など）
        2. 4名や5名グループがいて分割が必要な場合は、最も人数の多いグループを分割して
           Redに3名、残りをBlueに回して「3 vs 3」を厳密に成立させる。

        【改造のヒント】:
        「友達同士で対戦したいからあえて2人ずつに割りたい」「ソロプレイヤーを均等に配分したい」
        など、チーム分けのこだわりを反映したい場合はここを改造してください。
        """
        # 単一グループで6名の場合（Closed または 6名Open）
        if len(groups) == 1 and groups[0].member_count == 6:
            g = groups[0]
            return MatchTeams(
                team_red=[TeamAllocation(group=g, player_count=3)],
                team_blue=[TeamAllocation(group=g, player_count=3)],
                team_red_count=3,
                team_blue_count=3,
            )

        # ステップ1: グループを分割せずに ちょうど3名 のチームが作れるか試す
        exact_three = self._find_exact_three_without_split(groups)
        if exact_three is not None:
            red_ids = {g.id for g in exact_three}
            team_red = [TeamAllocation(group=g, player_count=g.member_count) for g in exact_three]
            team_blue = [
                TeamAllocation(group=g, player_count=g.member_count)
                for g in groups
                if g.id not in red_ids
            ]
            return MatchTeams(team_red=team_red, team_blue=team_blue, team_red_count=3, team_blue_count=3)

        # ステップ2: 分割が必要な場合（4名または5名グループが含まれる場合）
        # 人数の多い順にソート（最も人数の大きいグループを分割対象にする）
        sorted_groups = sorted(groups, key=lambda g: g.member_count, reverse=True)
        large_group = sorted_groups[0]
        other_groups = sorted_groups[1:]

        # large_group から 3名 を赤チームへ
        team_red = [TeamAllocation(group=large_group, player_count=3)]

        # large_group の残り人数を青チームへ
        remaining_count = large_group.member_count - 3
        team_blue = []
        if remaining_count > 0:
            team_blue.append(TeamAllocation(group=large_group, player_count=remaining_count))

        # 残りのグループを青チームへ（合計でちょうど3名になる）
        for g in other_groups:
            team_blue.append(TeamAllocation(group=g, player_count=g.member_count))

        return MatchTeams(team_red=team_red, team_blue=team_blue, team_red_count=3, team_blue_count=3)

    def _find_exact_three_without_split(self, groups: list[EntryGroup]) -> Optional[list[EntryGroup]]:
        """グループを分割せずに合計人数が3名になる部分集合を探す"""
        result: list[EntryGroup] = []

        def search(idx: int, current_sum: int) -> bool:
            if current_sum == 3:
                return True
            if current_sum > 3 or idx >= len(groups):
                return False

            result.append(groups[idx])
            if search(idx + 1, current_sum + groups[idx].member_count):
                return True
            result.pop()

            if search(idx + 1, current_sum):
                return True
            return False

        if search(0, 0):
            return result
        return None

    # =========================================================================
    # 4. ★【アルゴリズム③】サジェストTips (モニタへの案内表示)
    # =========================================================================
    def calculate_suggestion(self, waiting_groups: list[EntryGroup]) -> SuggestionTip:
        """待機列の状況から、あと何名いれば3vs3（6名）が即座に成立するかを算出します。"""
        open_waiting = [g for g in waiting_groups if g.preference == Preference.OPEN]

        if not open_waiting:
            return SuggestionTip(
                recommended_party_size=3,
                message="現在待機列なし！何名様でもすぐにご案内可能です。",
            )

        total_players = sum(g.member_count for g in open_waiting)
        remainder = total_players % 6
        deficit = (6 - remainder) % 6

        if deficit == 0:
            return SuggestionTip(
                recommended_party_size=3,
                message="現在6名が待機中！まもなく3vs3マッチが成立します。",
            )

        return SuggestionTip(
            recommended_party_size=deficit,
            message=f"現在【{deficit}名】組なら、すぐにご案内可能です！（3vs3即時成立）",
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
        teams = self.assign_teams(groups)

        match = Match(
            id=f"match-{self._next_match_number}",
            match_number=self._next_match_number,
            status=MatchStatus.SCHEDULED,
            is_closed_match=is_closed,
            allocated_duration_minutes=duration,
            assigned_groups=groups,
            total_players=6,
            teams=teams,
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
