-- ==============================================================================
-- OVALANT 3v3 リアルタイム予約・マッチングシステム データベーススキーマ
-- Supabase PostgreSQL 向けマイグレーションファイル
-- ==============================================================================

-- 既存の拡張機能を有効化
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. ENUM 型の定義
-- ------------------------------------------------------------------------------

-- エントリー希望タイプ (closed: 貸切・身内戦 / open: 他グループ合流)
DO $$ BEGIN
    CREATE TYPE preference_type AS ENUM ('closed', 'open');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- グループの受付・待機ステータス
DO $$ BEGIN
    CREATE TYPE entry_status AS ENUM (
        'waiting',    -- 待機中
        'called',     -- 呼出中 (受付案内中)
        'in_match',   -- 試合進行中
        'completed',  -- 終了
        'skipped',    -- 不在無効化 (再エントリー必要)
        'cancelled'   -- キャンセル
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 試合枠のステータス (3スロット制)
DO $$ BEGIN
    CREATE TYPE match_status AS ENUM (
        'scheduled',   -- Next Next (次々回待機)
        'calling',     -- Next (呼出・準備中)
        'in_progress', -- Current (対戦フィールドで試合中)
        'finished',    -- 終了
        'cancelled'    -- 中止
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- チームサイド (Open枠の3vs3チーム分け用)
DO $$ BEGIN
    CREATE TYPE team_side_type AS ENUM ('red', 'blue');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ------------------------------------------------------------------------------
-- 2. シーケンスの定義 (通番用)
-- ------------------------------------------------------------------------------

-- 整理券番号 (101から開始)
CREATE SEQUENCE IF NOT EXISTS entry_number_seq START WITH 101 INCREMENT BY 1;

-- 試合通番 (1から開始)
CREATE SEQUENCE IF NOT EXISTS match_number_seq START WITH 1 INCREMENT BY 1;

-- ------------------------------------------------------------------------------
-- 3. テーブル定義
-- ------------------------------------------------------------------------------

-- ① matches テーブル (試合スロット管理)
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_number INT NOT NULL UNIQUE DEFAULT nextval('match_number_seq'),
    status match_status NOT NULL DEFAULT 'scheduled',
    is_closed_match BOOLEAN NOT NULL DEFAULT false,
    duration_minutes INT NOT NULL DEFAULT 10,
    total_players INT NOT NULL CHECK (total_players >= 1 AND total_players <= 6),
    started_at TIMESTAMPTZ NULL,
    ended_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ② entries テーブル (参加グループの受付キュー)
CREATE TABLE IF NOT EXISTS entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_number INT NOT NULL UNIQUE DEFAULT nextval('entry_number_seq'),
    session_id VARCHAR(64) NOT NULL,
    leader_name VARCHAR(50) NOT NULL,
    team_name VARCHAR(50) NOT NULL,
    headcount INT NOT NULL CHECK (headcount >= 1 AND headcount <= 6),
    preference preference_type NOT NULL,
    status entry_status NOT NULL DEFAULT 'waiting',
    assigned_match_id UUID NULL REFERENCES matches(id) ON DELETE SET NULL,
    skip_reason VARCHAR(100) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ③ match_entries テーブル (試合とグループの中間テーブル・チーム振り分け)
CREATE TABLE IF NOT EXISTS match_entries (
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    team_side team_side_type NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (match_id, entry_id)
);

-- ------------------------------------------------------------------------------
-- 4. インデックスの作成
-- ------------------------------------------------------------------------------

-- キューのFIFO取得用 (waitingかつ作成日時順)
CREATE INDEX IF NOT EXISTS idx_entries_waiting_queue 
    ON entries (status, created_at) 
    WHERE status = 'waiting';

-- 端末識別IDによる高速検索用
CREATE INDEX IF NOT EXISTS idx_entries_session 
    ON entries (session_id, status);

-- アクティブな試合スロット検索用
CREATE INDEX IF NOT EXISTS idx_matches_active_status 
    ON matches (status) 
    WHERE status IN ('scheduled', 'calling', 'in_progress');

-- ------------------------------------------------------------------------------
-- 5. 更新日時自動トリガー
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_entries_updated_at ON entries;
CREATE TRIGGER trg_entries_updated_at
    BEFORE UPDATE ON entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_matches_updated_at ON matches;
CREATE TRIGGER trg_matches_updated_at
    BEFORE UPDATE ON matches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------------------------
-- 6. Row Level Security (RLS) ポリシー
-- ------------------------------------------------------------------------------

ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_entries ENABLE ROW LEVEL SECURITY;

-- 参加者用・匿名アクセス (全体状況や試合スロット、自身のセッションはSELECT可能)
DROP POLICY IF EXISTS "Public can view active matches" ON matches;
CREATE POLICY "Public can view active matches" 
    ON matches FOR SELECT 
    USING (true);

DROP POLICY IF EXISTS "Public can view waiting entries summary" ON entries;
CREATE POLICY "Public can view waiting entries summary" 
    ON entries FOR SELECT 
    USING (true);

DROP POLICY IF EXISTS "Public can view match team assignments" ON match_entries;
CREATE POLICY "Public can view match team assignments" 
    ON match_entries FOR SELECT 
    USING (true);

-- サービスロール (FastAPIバックエンド) は全操作を許可
DROP POLICY IF EXISTS "Service role full access on matches" ON matches;
CREATE POLICY "Service role full access on matches" 
    ON matches FOR ALL 
    USING (auth.jwt() ->> 'role' = 'service_role' OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access on entries" ON entries;
CREATE POLICY "Service role full access on entries" 
    ON entries FOR ALL 
    USING (auth.jwt() ->> 'role' = 'service_role' OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access on match_entries" ON match_entries;
CREATE POLICY "Service role full access on match_entries" 
    ON match_entries FOR ALL 
    USING (auth.jwt() ->> 'role' = 'service_role' OR auth.role() = 'service_role');

-- ------------------------------------------------------------------------------
-- 7. Supabase Realtime 設定
-- ------------------------------------------------------------------------------

-- Realtime publication にテーブルを追加して変更をリアルタイム配信
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE entries;
ALTER PUBLICATION supabase_realtime ADD TABLE matches;
ALTER PUBLICATION supabase_realtime ADD TABLE match_entries;
