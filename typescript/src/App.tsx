import React, { useState, useRef, useEffect } from 'react';
import { MatchingEngine } from './matchingEngine.ts';
import type { EntryGroup, MatchingPreference } from './types.ts';
import { Users, Play, SkipForward, XCircle, CheckCircle } from 'lucide-react';

export default function App() {
  const engineRef = useRef(new MatchingEngine());
  const [, setVersion] = useState(0);

  // Form states
  const [leaderName, setLeaderName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [memberCount, setMemberCount] = useState<number>(3);
  const [preference, setPreference] = useState<MatchingPreference>('open');

  const update = () => setVersion((v) => v + 1);

  // 定期的なキュー再計算 (時間経過によるフレキシブルマッチングの発火のため)
  useEffect(() => {
    const timer = setInterval(() => {
      engineRef.current.recalculateSlots();
      update();
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaderName || !teamName) return;
    try {
      engineRef.current.registerEntry(leaderName, teamName, memberCount, preference);
      setLeaderName('');
      setTeamName('');
      setMemberCount(3);
      update();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleAdvanceMatch = () => {
    engineRef.current.advanceMatchLifecycle();
    update();
  };

  const handleSkip = (entryId: string) => {
    engineRef.current.skipEntry(entryId);
    update();
  };

  const displayState = engineRef.current.getQueueDisplayState();
  const allEntries = engineRef.current.getAllEntries();
  const waitingEntries = allEntries.filter(e => e.status === 'waiting');

  const renderMatchCard = (title: string, match: any, statusColor: string) => {
    if (!match) {
      return (
        <div className="match-card" style={{ opacity: 0.5 }}>
          <h3 className="match-status" style={{ color: 'var(--text-muted)' }}>{title} (空き)</h3>
          <p>該当なし</p>
        </div>
      );
    }

    return (
      <div className="match-card" style={{ borderColor: statusColor }}>
        <h3 className="match-status" style={{ color: statusColor }}>{title} - Match #{match.matchNumber}</h3>
        <div className="match-teams">
          <div className="team team-red">
            <div className="team-name">Red Team</div>
            <div className="team-members">
              {match.teams?.teamRed.map((g: EntryGroup) => (
                <div key={g.id}>{g.teamName} ({g.memberCount}名) - {g.leaderName}</div>
              ))}
              <div style={{ marginTop: '0.5rem', fontWeight: 'bold' }}>計: {match.teams?.teamRedCount}名</div>
            </div>
          </div>
          <div className="vs-badge">VS</div>
          <div className="team team-blue">
            <div className="team-name">Blue Team</div>
            <div className="team-members">
              {match.teams?.teamBlue.map((g: EntryGroup) => (
                <div key={g.id}>{g.teamName} ({g.memberCount}名) - {g.leaderName}</div>
              ))}
              <div style={{ marginTop: '0.5rem', fontWeight: 'bold' }}>計: {match.teams?.teamBlueCount}名</div>
            </div>
          </div>
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Type: {match.isClosedMatch ? '貸切 (Closed)' : '野良 (Open)'} / 枠: {match.allocatedDurationMinutes}分
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard-container">
      <header className="header">
        <h1>4E OVALANT <span style={{ color: 'var(--text-primary)' }}>MATCHING</span></h1>
        <button className="btn btn-primary" onClick={handleAdvanceMatch} style={{ width: 'auto' }}>
          <Play size={20} />
          試合を進行する
        </button>
      </header>

      <div className="grid-layout">
        {/* Left Column: Form & Queue */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          <div className="glass-panel">
            <h2><Users size={24} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.5rem' }}/> エントリー追加</h2>
            <form onSubmit={handleRegister}>
              <div className="form-group">
                <label>代表者名</label>
                <input className="form-control" value={leaderName} onChange={e => setLeaderName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>チーム名</label>
                <input className="form-control" value={teamName} onChange={e => setTeamName(e.target.value)} required />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>人数 (1-6)</label>
                  <input type="number" min="1" max="6" className="form-control" value={memberCount} onChange={e => setMemberCount(parseInt(e.target.value))} required />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>希望</label>
                  <select className="form-control" value={preference} onChange={e => setPreference(e.target.value as MatchingPreference)}>
                    <option value="open">野良 (Open)</option>
                    <option value="closed">貸切 (Closed)</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="btn">登録する</button>
            </form>
          </div>

          <div className="glass-panel" style={{ flex: 1 }}>
            <h2>待機列 ({waitingEntries.length}組 / 計{displayState.totalWaitingPlayers}名)</h2>
            <div style={{ padding: '0.5rem', background: 'rgba(69, 162, 158, 0.1)', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem' }}>
              💡 {displayState.suggestionTip.message}
            </div>
            
            <ul className="queue-list">
              {waitingEntries.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>待機中のグループはありません</div>
              ) : (
                waitingEntries.map((group) => (
                  <li key={group.id} className="queue-item">
                    <div className="queue-item-info">
                      <h4>{group.teamName} <span style={{ fontWeight: 'normal', color: 'var(--text-muted)', fontSize: '0.9rem' }}>({group.leaderName})</span></h4>
                      <div className="queue-item-meta">
                        <span>#{group.entryNumber}</span>
                        <span>{group.memberCount}名</span>
                        <span>{new Date(group.createdAt).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <span className={`badge ${group.preference === 'open' ? 'badge-open' : 'badge-closed'}`}>
                        {group.preference}
                      </span>
                      <button 
                        onClick={() => handleSkip(group.id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.25rem' }}
                        title="スキップ（不在）"
                      >
                        <XCircle size={20} />
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        {/* Right Column: Matches */}
        <div className="match-display">
          <div className="glass-panel">
            {renderMatchCard('CURRENT (試合中)', displayState.currentMatch, 'var(--success)')}
          </div>
          <div className="glass-panel">
            {renderMatchCard('NEXT (呼び出し中)', displayState.nextMatch, 'var(--accent-color)')}
          </div>
          <div className="glass-panel" style={{ opacity: 0.8 }}>
            {renderMatchCard('NEXT NEXT (待機)', displayState.nextNextMatch, 'var(--text-muted)')}
          </div>

          <div className="stats-bar">
            <div className="stat-item">
              <div className="stat-value">{allEntries.length}</div>
              <div className="stat-label">Total Entries</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">{engineRef.current.getAllMatches().length}</div>
              <div className="stat-label">Matches Formed</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
