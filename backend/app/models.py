"""Pydantic models and data structures for OVALANT matching system."""

from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class PreferenceType(str, Enum):
    CLOSED = "closed"  # 貸切・身内戦 (8分)
    OPEN = "open"      # 他グループ合流 (10分)


class EntryStatus(str, Enum):
    WAITING = "waiting"      # 待機中
    CALLED = "called"        # 呼出中 (受付・準備中)
    IN_MATCH = "in_match"    # 対戦中
    COMPLETED = "completed"  # 終了
    SKIPPED = "skipped"      # 不在スキップ (無効化)
    CANCELLED = "cancelled"  # 取消


class MatchStatus(str, Enum):
    SCHEDULED = "scheduled"      # Next Next (次々回待機枠)
    CALLING = "calling"          # Next (呼出・準備枠)
    IN_PROGRESS = "in_progress"  # Current (対戦フィールドで試合中)
    FINISHED = "finished"        # 終了
    CANCELLED = "cancelled"      # 中止


class TeamSideType(str, Enum):
    RED = "red"
    BLUE = "blue"


class EntryGroup(BaseModel):
    """参加1グループのデータ"""
    id: str
    entry_number: int
    session_id: str
    leader_name: str
    team_name: str
    headcount: int = Field(ge=1, le=6)
    preference: PreferenceType
    status: EntryStatus = EntryStatus.WAITING
    assigned_match_id: Optional[str] = None
    skip_reason: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


class TeamSideAssignment(BaseModel):
    """チーム（赤または青）への配属"""
    team_side: TeamSideType
    groups: list[EntryGroup] = Field(default_factory=list)
    total_count: int = 0


class MatchTeams(BaseModel):
    """1試合の赤チーム・青チーム内訳（味方は身内、敵は他人。グループ分割不可）"""
    red: TeamSideAssignment
    blue: TeamSideAssignment


class Match(BaseModel):
    """試合スロット（Current / Next / Next Next）"""
    id: str
    match_number: int
    status: MatchStatus
    is_closed_match: bool
    duration_minutes: int  # Open: 10分 / Closed: 8分
    assigned_groups: list[EntryGroup] = Field(default_factory=list)
    total_players: int = 0
    teams: Optional[MatchTeams] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.now)


class SuggestionTip(BaseModel):
    """待機モニタ用サジェストTips"""
    recommended_party_size: Optional[int] = None
    message: str


# --- API リクエスト / レスポンス モデル ---

class CreateEntryRequest(BaseModel):
    session_id: str = Field(min_length=1, description="端末識別用UUID")
    leader_name: str = Field(min_length=1, max_length=50)
    team_name: str = Field(min_length=1, max_length=50)
    headcount: int = Field(ge=1, le=6, description="参加人数 1〜6名")
    preference: PreferenceType

    @field_validator("preference")
    @classmethod
    def validate_preference_for_headcount(cls, v: PreferenceType, info) -> PreferenceType:
        # 4〜6名は友人が敵味方に分断されるのを防ぐため強制的に Closed
        headcount = info.data.get("headcount")
        if headcount and headcount >= 4:
            return PreferenceType.CLOSED
        return v


class EntryResponse(BaseModel):
    entry: EntryGroup
    ahead_groups_count: int
    estimated_wait_minutes: int
    slot_name: str  # "waiting" | "next_next" | "next" | "current" | "inactive"


class QueueStatusResponse(BaseModel):
    current_match: Optional[Match] = None
    next_match: Optional[Match] = None
    next_next_match: Optional[Match] = None
    suggestion_tip: SuggestionTip
    total_waiting_groups: int
    total_waiting_players: int
    waiting_groups: list[EntryGroup] = Field(default_factory=list)


class SkipEntryRequest(BaseModel):
    reason: str = Field(default="呼び出し時不在のためスキップ")


class ActionSuccessResponse(BaseModel):
    success: bool
    message: str
