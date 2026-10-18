/**
 * OVALANT matching system frontend TypeScript types
 */

export type PreferenceType = 'closed' | 'open';

export type EntryStatus =
  | 'waiting'
  | 'called'
  | 'in_match'
  | 'completed'
  | 'skipped'
  | 'cancelled';

export type MatchStatus =
  | 'scheduled'
  | 'calling'
  | 'in_progress'
  | 'finished'
  | 'cancelled';

export type TeamSideType = 'red' | 'blue';

export interface EntryGroup {
  id: string;
  entry_number: number;
  session_id: string;
  leader_name: string;
  team_name: string;
  headcount: number;
  preference: PreferenceType;
  status: EntryStatus;
  assigned_match_id?: string | null;
  skip_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamSideAssignment {
  team_side: TeamSideType;
  groups: EntryGroup[];
  total_count: number;
}

export interface MatchTeams {
  red: TeamSideAssignment;
  blue: TeamSideAssignment;
}

export interface Match {
  id: string;
  match_number: number;
  status: MatchStatus;
  is_closed_match: boolean;
  duration_minutes: number;
  assigned_groups: EntryGroup[];
  total_players: number;
  teams?: MatchTeams | null;
  started_at?: string | null;
  ended_at?: string | null;
  created_at: string;
}

export interface SuggestionTip {
  recommended_party_size?: number | null;
  message: string;
}

export interface EntryResponse {
  entry: EntryGroup;
  ahead_groups_count: number;
  estimated_wait_minutes: number;
  slot_name: 'waiting' | 'next_next' | 'next' | 'current' | 'inactive';
}

export interface QueueStatusResponse {
  current_match: Match | null;
  next_match: Match | null;
  next_next_match: Match | null;
  suggestion_tip: SuggestionTip;
  total_waiting_groups: number;
  total_waiting_players: number;
  waiting_groups: EntryGroup[];
  all_entries?: EntryGroup[];
}

export interface CreateEntryRequest {
  session_id: string;
  leader_name: string;
  team_name: string;
  headcount: number;
  preference: PreferenceType;
}
