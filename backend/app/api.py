"""FastAPI route handlers for OVERTER WATCH2026 matching system."""

from fastapi import APIRouter, HTTPException
from .models import (
    CreateEntryRequest,
    EntryResponse,
    QueueStatusResponse,
    SkipEntryRequest,
    ActionSuccessResponse,
    MatchStatus,
    EntryStatus,
)
from .matching_engine import MatchingEngine

router = APIRouter(prefix="/api")

# シングルトンマッチングエンジンインスタンス
engine = MatchingEngine(flexible_wait_seconds=600)


def _ensure_state_loaded(require_fresh: bool = False) -> None:
    """Supabase から最新状態を同期し、通信失敗時は空データや古いメモリによる上書き・消失を防ぐため 503 を返す"""
    if not engine.load_state(require_fresh=require_fresh):
        raise HTTPException(
            status_code=503,
            detail="データベースとの一時的な通信遅延が発生しています。数秒後にもう一度お試しください。",
        )


@router.post("/entries", response_model=EntryResponse)
def create_entry(req: CreateEntryRequest):
    """参加者エントリー受付
    - 同一 session_id からの複数エントリーも許可（警告確認はフロントエンドで実施）
    - 4〜6名は友人が敵味方に分断されるのを防ぐため自動的に Closed
    - 空きスロットがあればマッチング即時起動
    """
    _ensure_state_loaded(require_fresh=True)

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
    _ensure_state_loaded()

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
        is_local_mode=not engine._is_supabase_active(),
    )


@router.get("/entries/{entry_id}", response_model=EntryResponse)
def get_entry_status(entry_id: str):
    """特定のグループ自身の待機順・予想待ち時間を取得"""
    _ensure_state_loaded()

    status_info = engine.get_group_status(entry_id)
    if not status_info:
        raise HTTPException(status_code=404, detail="指定されたエントリーが見つかりません")

    return EntryResponse(
        entry=status_info["entry"],
        ahead_groups_count=status_info["ahead_groups_count"],
        estimated_wait_minutes=status_info["estimated_wait_minutes"],
        slot_name=status_info["slot_name"],
    )


@router.get("/entries/by-session/{session_id}", response_model=list[EntryResponse])
def get_entries_by_session(session_id: str):
    """端末の session_id に紐づく全エントリー（アクティブ順）を取得"""
    _ensure_state_loaded()
    results = []
    matching_entries = [e for e in engine.entries if e.session_id == session_id]
    for e in reversed(matching_entries):
        status_info = engine.get_group_status(e.id)
        if status_info:
            results.append(
                EntryResponse(
                    entry=status_info["entry"],
                    ahead_groups_count=status_info["ahead_groups_count"],
                    estimated_wait_minutes=status_info["estimated_wait_minutes"],
                    slot_name=status_info["slot_name"],
                )
            )
    return results


# --- スタッフ用 (Admin) 操作エンドポイント ---

@router.post("/admin/sample-data", response_model=QueueStatusResponse)
def add_sample_data():
    """デバッグ用: 4組のサンプルデータをアトミックに一括投入し、最新状況を返す"""
    _ensure_state_loaded(require_fresh=True)
    engine.add_sample_groups()
    return get_queue_status()


@router.post("/admin/matches/{match_id}/advance", response_model=ActionSuccessResponse)
def advance_match(match_id: str):
    """試合ステータスを1段階進行 (scheduled -> calling -> in_progress -> finished)"""
    _ensure_state_loaded(require_fresh=True)
    success = engine.advance_match_lifecycle(match_id=match_id)
    if not success:
        raise HTTPException(status_code=400, detail="進行可能な試合スロットがありません")
    return ActionSuccessResponse(success=True, message="試合スロットを進行し、後続を繰り上げました")


@router.post("/admin/entries/{entry_id}/skip", response_model=ActionSuccessResponse)
def skip_entry(entry_id: str, req: SkipEntryRequest = SkipEntryRequest()):
    """不在グループのスキップ・無効化
    - Closed枠ならMatchをキャンセルしNext Nextを繰り上げ
    - Open枠ならMatchを解体し、相方を待機キュー最優先に戻して即座に再マッチング
    """
    _ensure_state_loaded(require_fresh=True)
    res = engine.skip_entry_with_detail(entry_id, reason=req.reason)
    if not res:
        raise HTTPException(status_code=res.status_code, detail=res.message)
    return ActionSuccessResponse(success=True, message=res.message)


@router.post("/admin/entries/{entry_id}/restore", response_model=ActionSuccessResponse)
def restore_entry(entry_id: str):
    """不在スキップされたグループを待機列最優先に救済・復帰"""
    _ensure_state_loaded(require_fresh=True)
    res = engine.restore_entry_with_detail(entry_id)
    if not res:
        raise HTTPException(status_code=res.status_code, detail=res.message)
    return ActionSuccessResponse(success=True, message=res.message)


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

    _ensure_state_loaded()
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
    filename = f"overter_watch_2026_entries_{now_str}.csv"

    return Response(
        content=csv_data,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )


@router.get("/health")
def api_health_check():
    """Vercel 本番環境での Supabase 接続状況をブラウザから一発診断"""
    from .supabase_client import get_supabase_config
    import httpx

    url, key = get_supabase_config()
    configured = bool(url and key)

    status_result = "unknown"
    db_entries_count = 0
    error_detail = None

    if configured:
        try:
            headers = {"apikey": key, "Authorization": f"Bearer {key}"}
            with httpx.Client(base_url=f"{url}/rest/v1", headers=headers, timeout=5.0) as client:
                res = client.get("/entries?select=id,entry_number")
                if res.status_code == 200:
                    status_result = "connected"
                    db_entries_count = len(res.json())
                else:
                    status_result = f"http_{res.status_code}"
                    error_detail = res.text
        except Exception as e:
            status_result = "connection_error"
            error_detail = str(e)

    return {
        "status": "ok",
        "supabase_connection": status_result,
        "supabase_url": url,
        "supabase_entries_count": db_entries_count,
        "in_memory_entries_count": len(engine.entries),
        "in_memory_matches_count": len(engine.matches),
        "error_detail": error_detail,
    }
