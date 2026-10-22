import { useEffect, useState } from 'react';
import { NEUTRAL } from '../../sim/api.ts';
import type { PlayerMeta } from '../../protocol.ts';
import { ISSUE_TEXT } from '../home/fighters.ts';
import { navigate } from '../route.ts';
import type { HudSnapshot } from '../store.ts';
import { css, useEnv, useHud } from './context.ts';

export function fighterOf(hud: HudSnapshot, faction: number): PlayerMeta | undefined {
  for (const p of hud.players.values()) if (p.faction === faction) return p;
  return undefined;
}

export function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    const url = `${location.origin}${location.pathname}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt('Copy this link to share the battle', url);
    }
  };
  return (
    <button className="btn btn-gold" onClick={() => void copy()} aria-live="polite">
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        {copied ? (
          <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path
            d="M6.5 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.9.9M9.5 6.5a3 3 0 0 0-4.2 0L3 8.8A3 3 0 0 0 7.2 13l.9-.9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        )}
      </svg>
      {copied ? (
        'Copied'
      ) : (
        <span>
          Copy<span className="label-wide"> link</span>
        </span>
      )}
    </button>
  );
}

function useRematch(logins: string[]) {
  const { api } = useEnv();
  const [state, setState] = useState<{ busy: boolean; problem: string | null }>({ busy: false, problem: null });
  const rematch = async () => {
    setState({ busy: true, problem: null });
    const res = await api.createRoom(logins);
    if (res.ok) {
      navigate({ kind: 'room', slug: res.slug });
      return;
    }
    const problem = res.error === 'rejected_fighters' ? res.rejected.map((r) => `@${r.login}: ${ISSUE_TEXT[r.reason].toLowerCase()}`).join('. ') : res.message;
    setState({ busy: false, problem });
  };
  return { ...state, rematch };
}

export function RoomOverlay() {
  const hud = useHud();
  const [dismissed, setDismissed] = useState(false);
  const round = hud.round;
  const ended = round?.status === 'ended' || hud.winner !== NEUTRAL;
  const fighters = [...hud.players.values()].sort((a, b) => a.faction - b.faction);
  const { busy, problem, rematch } = useRematch(fighters.map((p) => p.login));
  if (!round || !ended || dismissed) return null;
  const winnerId = round.winnerFaction ?? (hud.winner !== NEUTRAL ? hud.winner : null);
  const winner = winnerId !== null ? fighterOf(hud, winnerId) : undefined;
  const color = css(winnerId !== null ? (hud.factions[winnerId]?.color ?? 0xd4af5f) : 0xd4af5f);
  const ranked = [...hud.standings].sort((a, b) => b.score - a.score);
  return (
    <div className="ended" role="dialog" aria-label="Battle results">
      <div className="panel ended-card room-ended" style={{ ['--c' as string]: color }}>
        <div className="ended-eyebrow">{hud.winner !== NEUTRAL ? 'Skirmish won by domination' : 'Skirmish concluded'}</div>
        <div className="victor">
          {winner && <img className="victor-avatar" src={winner.avatarUrl} alt="" width={96} height={96} />}
          <span className="victor-laurel" aria-hidden>
            ♛
          </span>
        </div>
        <div className="ended-eyebrow">Victory to</div>
        <div className="ended-winner">{winner ? `@${winner.login}` : 'No one'}</div>
        <table className="standings-table ended-results">
          <thead>
            <tr>
              <th>#</th>
              <th>Fighter</th>
              <th>Score</th>
              <th>Land</th>
              <th>Held</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((f, i) => {
              const p = fighterOf(hud, f.id);
              return (
                <tr key={f.id} style={{ cursor: 'default' }}>
                  <td className="place" data-p={i + 1}>
                    {i + 1}
                  </td>
                  <td>
                    <span className="who">
                      {p ? (
                        <img className="who-avatar" src={p.avatarUrl} alt="" width={22} height={22} style={{ borderColor: css(f.color) }} />
                      ) : (
                        <span className="swatch" style={{ background: css(f.color) }} />
                      )}
                      {p ? `@${p.login}` : f.name}
                    </span>
                  </td>
                  <td className="mono">{Math.floor(f.score).toLocaleString()}</td>
                  <td className="mono">{(f.territory * 100).toFixed(0)}%</td>
                  <td className="mono">{f.objectivesHeld}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {problem && (
          <p className="notice" role="status">
            {problem}
          </p>
        )}
        <div className="ended-actions">
          <button className="btn btn-gold" onClick={() => void rematch()} disabled={busy || fighters.length < 2}>
            {busy ? 'Mustering…' : 'Rematch'}
          </button>
          <button className="btn" onClick={() => navigate({ kind: 'home' })}>
            New battle
          </button>
          <button className="btn btn-quiet" onClick={() => setDismissed(true)}>
            View the final field
          </button>
        </div>
      </div>
    </div>
  );
}
