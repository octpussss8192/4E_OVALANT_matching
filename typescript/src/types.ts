/**
 * 3x3 サバゲーマッチングシステム 型定義
 */

export type MatchingPreference = 'closed' | 'open';

export type EntryStatus =
  | 'waiting'
  | 'called'
  | 'in_match'
  | 'completed'
  | 'skipped'
  | 'cancelled';

export interface EntryGroup {
  id: string;
  entryNumber: number;
  leaderName: string;
  teamName: string;
  memberCount: number; // 1〜6名
  preference: MatchingPreference;
  status: EntryStatus;
  createdAt: Date;
  calledAt?: Date;
  matchedAt?: Date;
  skippedAt?: Date;
  skipReason?: string;
  assignedMatchId?: string;
}

export type MatchStatus = 'scheduled' | 'calling' | 'in_progress' | 'finished' | 'cancelled';

export interface TeamMemberAllocation {
  group: EntryGroup;
  playerCount: number; // このチームに割り振られた人数
}

export interface MatchTeamAssignment {
  teamRed: TeamMemberAllocation[];
  teamBlue: TeamMemberAllocation[];
  teamRedCount: number; // 3名
  teamBlueCount: number; // 3名
}

export interface Match {
  id: string;
  matchNumber: number;
  status: MatchStatus;
  isClosedMatch: boolean;
  allocatedDurationMinutes: number;
  assignedGroups: EntryGroup[];
  totalPlayers: number;
  teams?: MatchTeamAssignment;
  startedAt?: Date;
  endedAt?: Date;
  createdAt: Date;
}

export interface SystemConfig {
  maxPlayersPerMatch: number; // 6名 (3 vs 3)
  standardMatchDurationMinutes: number; // 10分
  closedMatchDurationMinutes: number; // 8分
  turnaroundDurationMinutes: number; // 2分
}

export interface SuggestionTip {
  recommendedPartySize: number | null;
  message: string;
}

export interface QueueDisplayState {
  currentMatch: Match | null;
  nextMatch: Match | null;
  nextNextMatch: Match | null;
  suggestionTip: SuggestionTip;
  totalWaitingGroups: number;
  totalWaitingPlayers: number;
}

export interface GroupQueueStatus {
  group: EntryGroup;
  aheadGroupCount: number;
  estimatedWaitMinutes: number;
  slotName: 'current' | 'next' | 'next_next' | 'waiting' | 'inactive';
}
