"""FastAPI route handlers for OVALANT matching system."""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from .models import (
    CreateEntryRequest,
    EntryResponse,
    QueueStatusResponse,
    SkipEntryRequest,
    ActionSuccessResponse,
    Match,
    MatchStatus,
    EntryStatus,
)
from .matching_engine import MatchingEngine

router = APIRouter(prefix="/api")

# シングルトンマッチングエンジンインスタンス
engine = MatchingEngine(flexible_wait_seconds=600)


@router.post("/entries", response_model=EntryResponse)
def create_entry(req: CreateEntryRequest):
    """参加者エントリー受付
    - 同一 session_id のアクティブな重複をブロック
    - 4〜6名は友人が敵味方に分断されるのを防ぐため自動的に Closed
    - 空きスロットがあればマッチング即時起動
    """
    engine.load_state()

    # アクティブな重複エントリーの検査
    active_entry = next(
        (
            e for e in engine.entries
            if e.session_id == req.session_id and e.status in (EntryStatus.WAITING, EntryStatus.CALLED, EntryStatus.IN_MATCH)
        ),
        None,
    )
    if active_entry:
        raise HTTPException(
            status_code=400,
            detail=f"既に有効なエントリーがあります (整理券番号 #{active_entry.entry_number})",
        )

    entry = engine.register_entry(
        session_id=req.session_id,
        leader_name=req.leader_name,
        team_name=req.team_name,
        headcount=req.headcount,
        preference=req.preference,
    )

    status_info = engine.get_group_status(entry.id)
    if not status_info:
        raise HTTPException(status_code=500, detail="ステータス計算に失敗しました")

    return EntryResponse(
        entry=entry,
        ahead_groups_count=status_info["ahead_groups_count"],
        estimated_wait_minutes=status_info["estimated_wait_minutes"],
        slot_name=status_info["slot_name"],
    )


@router.get("/status", response_model=QueueStatusResponse)
def get_queue_status():
    """現在の全体待機・試合スロット状況（待機モニタ・共有画面用）"""
    engine.load_state()

    current_match = next((m for m in engine.matches if m.status == MatchStatus.IN_PROGRESS), None)
    next_match = next((m for m in engine.matches if m.status == MatchStatus.CALLING), None)
    next_next_match = next((m for m in engine.matches if m.status == MatchStatus.SCHEDULED), None)

    waiting_groups = [e for e in engine.entries if e.status == EntryStatus.WAITING]
    waiting_groups.sort(key=lambda x: x.created_at)

    total_waiting_players = sum(e.headcount for e in waiting_groups)
    tip = engine.calculate_suggestion_tip()

    # 管理ダッシュボード用: 進行中の全有効エントリー（対戦中・呼出中・待機中）※スキップ済・完了済は進行中から除外
    all_active_entries = [
        e for e in engine.entries
        if e.status in (EntryStatus.WAITING, EntryStatus.CALLED, EntryStatus.IN_MATCH)
    ]
    all_active_entries.sort(key=lambda x: x.entry_number)

    # 過去完了分(COMPLETED)も含めた全エントリー履歴
    all_history_entries = sorted(engine.entries, key=lambda x: x.entry_number)

    return QueueStatusResponse(
        current_match=current_match,
        next_match=next_match,
        next_next_match=next_next_match,
        suggestion_tip=tip,
        total_waiting_groups=len(waiting_groups),
        total_waiting_players=total_waiting_players,
        waiting_groups=waiting_groups,
        all_active_entries=all_active_entries,
        all_history_entries=all_history_entries,
    )



@router.get("/entries/{entry_id}", response_model=EntryResponse)
def get_entry_status(entry_id: str):
    """特定のグループ自身の待機順・予想待ち時間を取得"""
    engine.load_state()

    status_info = engine.get_group_status(entry_id)
    if not status_info:
        raise HTTPException(status_code=404, detail="指定されたエントリーが見つかりません")

    return EntryResponse(
        entry=status_info["entry"],
        ahead_groups_count=status_info["ahead_groups_count"],
        estimated_wait_minutes=status_info["estimated_wait_minutes"],
        slot_name=status_info["slot_name"],
    )


# --- スタッフ用 (Admin) 操作エンドポイント ---

@router.post("/admin/sample-data", response_model=QueueStatusResponse)
def add_sample_data():
    """デバッグ用: 4組のサンプルデータをアトミックに一括投入し、最新状況を返す"""
    engine.load_state()
    engine.add_sample_groups()
    return get_queue_status()


@router.post("/admin/matches/{match_id}/advance", response_model=ActionSuccessResponse)
def advance_match(match_id: str):
    """試合ステータスを1段階進行 (scheduled -> calling -> in_progress -> finished)"""
    engine.load_state()
    success = engine.advance_match_lifecycle()
    if not success:
        raise HTTPException(status_code=400, detail="進行可能な試合スロットがありません")
    return ActionSuccessResponse(success=True, message="試合スロットを進行し、後続を繰り上げました")


@router.post("/admin/entries/{entry_id}/skip", response_model=ActionSuccessResponse)
def skip_entry(entry_id: str, req: SkipEntryRequest = SkipEntryRequest()):
    """不在グループのスキップ・無効化
    - Closed枠ならMatchをキャンセルしNext Nextを繰り上げ
    - Open枠ならMatchを解体し、相方を待機キュー最優先に戻して即座に再マッチング
    """
    engine.load_state()
    success = engine.skip_entry(entry_id, reason=req.reason)
    if not success:
        raise HTTPException(status_code=404, detail="スキップ対象のエントリーが見つかりません、または既に無効です")
    return ActionSuccessResponse(success=True, message="不在グループをスキップし、枠の再編成と繰り上げを行いました")


@router.post("/admin/reset", response_model=ActionSuccessResponse)
def reset_system():
    """デバッグ用: 全データのリセット"""
    engine.reset()
    return ActionSuccessResponse(success=True, message="システムをリセットしました")


@router.get("/admin/export-csv")
def export_csv():
    """全エントリー履歴を Excel 対応 UTF-8 BOM付き CSV でダウンロード"""
    from fastapi.responses import Response
    from datetime import datetime
    import io
    import csv

    engine.load_state()
    entries = sorted(engine.entries, key=lambda x: x.entry_number)

    output = io.StringIO()
    # Excel 用 UTF-8 BOM
    output.write("\ufeff")
    writer = csv.writer(output)

    # ヘッダー
    writer.writerow([
        "整理券番号",
        "チーム名",
        "代表者名",
        "参加人数",
        "希望形式",
        "最終ステータス",
        "受付時刻",
        "割当試合ID",
        "スキップ理由",
    ])

    for g in entries:
        status_str = "待機中"
        if g.status.value == "in_match":
            status_str = "対戦中"
        elif g.status.value == "called":
            status_str = "呼出中"
        elif g.status.value == "completed":
            status_str = "対戦完了"
        elif g.status.value == "skipped":
            status_str = "不在スキップ"

        pref_str = "貸切(8分)" if g.preference.value == "closed" else "合流(10分)"
        if hasattr(g.created_at, "strftime"):
            created_str = g.created_at.strftime("%Y-%m-%d %H:%M:%S")
        else:
            created_str = str(g.created_at)

        writer.writerow([
            g.entry_number,
            g.team_name,
            g.leader_name,
            g.headcount,
            pref_str,
            status_str,
            created_str,
            g.assigned_match_id or "",
            g.skip_reason or "",
        ])

    csv_data = output.getvalue().encode("utf-8")
    now_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"ovalant_entries_{now_str}.csv"

    return Response(
        content=csv_data,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )


