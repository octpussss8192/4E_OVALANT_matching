"""3x3 サバゲーマッチングシステム データモデル定義 (models.py)

このファイルでは、システム全体で使用するデータ構造（グループ、試合、ステータス等）を定義しています。
@dataclass を使用しているため、属性（.name や .member_count など）で直感的にアクセスできます。
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class Preference(str, Enum):
    """マッチングの希望形式"""
    OPEN = "open"      # 通常（他のグループと合流して3vs3対戦を行う）
    CLOSED = "closed"  # 貸切（仲間内だけで3vs3内戦を行う・6名限定）


class EntryStatus(str, Enum):
    """エントリーグループの状態"""
    WAITING = "waiting"      # 待機中（マッチング待ち）
    CALLED = "called"        # 呼出済み（案内完了・スロット入り）
    IN_MATCH = "in_match"    # 試合進行中
    COMPLETED = "completed"  # 試合終了
    SKIPPED = "skipped"      # 呼び出し不在等でスキップ・無効化
    CANCELLED = "cancelled"  # キャンセル


class MatchStatus(str, Enum):
    """試合スロットの状態"""
    SCHEDULED = "scheduled"      # Next Next枠（次々回・準備中）
    CALLING = "calling"          # Next枠（次回・呼出案内中）
    IN_PROGRESS = "in_progress"  # Current枠（フィールド内で試合進行中）
    FINISHED = "finished"        # 終了
    CANCELLED = "cancelled"      # 中止


@dataclass
class EntryGroup:
    """エントリーした1グループのデータ"""
    id: str                                # グループ固有ID
    entry_number: int                      # 整理券番号（例: 101, 102...）
    leader_name: str                       # 代表者名
    team_name: str                         # チーム名
    member_count: int                      # 人数（1〜6名）
    preference: Preference                 # 希望（OPEN / CLOSED）
    status: EntryStatus = EntryStatus.WAITING  # 現在の状態
    created_at: datetime = field(default_factory=datetime.now)  # 受付時刻
    called_at: Optional[datetime] = None   # 呼出時刻
    matched_at: Optional[datetime] = None  # マッチング成立時刻
    skipped_at: Optional[datetime] = None  # スキップ時刻
    skip_reason: Optional[str] = None      # スキップ理由
    assigned_match_id: Optional[str] = None  # 割り当てられた試合ID


@dataclass
class TeamAllocation:
    """チーム（赤または青）内のグループと参加人数"""
    group: EntryGroup
    player_count: int  # このチームに所属する人数（グループ分割時は元の人数より少なくなります）


@dataclass
class MatchTeams:
    """1試合の赤チーム・青チームの割り当て（厳密に3名 vs 3名）"""
    team_red: list[TeamAllocation] = field(default_factory=list)
    team_blue: list[TeamAllocation] = field(default_factory=list)
    team_red_count: int = 3   # 赤チーム合計人数（常に3名）
    team_blue_count: int = 3  # 青チーム合計人数（常に3名）


@dataclass
class Match:
    """1つの試合スロット"""
    id: str                                # 試合ID
    match_number: int                      # 試合番号（第1試合、第2試合...）
    status: MatchStatus                    # 試合ステータス
    is_closed_match: bool                  # 貸切試合かどうか
    allocated_duration_minutes: int        # 試合時間（通常: 10分 / 貸切: 8分）
    assigned_groups: list[EntryGroup]      # 参加グループ一覧
    total_players: int = 6                 # 合計参加人数（常に6名）
    teams: Optional[MatchTeams] = None     # 赤・青チームの編成内訳
    started_at: Optional[datetime] = None  # 開始時刻
    ended_at: Optional[datetime] = None    # 終了時刻
    created_at: datetime = field(default_factory=datetime.now)


@dataclass
class SystemConfig:
    """システムの各種設定値"""
    max_players_per_match: int = 6         # 1試合の合計人数（3 vs 3 = 6名）
    standard_match_duration_minutes: int = 10  # 通常試合の時間（分）
    closed_match_duration_minutes: int = 8     # 貸切試合の時間（分）
    turnaround_duration_minutes: int = 2       # 転換・インターバル時間（分）


@dataclass
class SuggestionTip:
    """待機モニタに表示する案内Tips"""
    recommended_party_size: Optional[int]  # 推奨グループ人数（例: 2名）
    message: str                           # 表示メッセージ
