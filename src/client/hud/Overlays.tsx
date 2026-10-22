import { useEffect, useState } from 'react';
import type { ConnState } from '../net/connection.ts';
import { css, useEnv, useHud, useNow } from './context.ts';
import { Crest } from './icons.tsx';
import { formatCountdown } from './Scoreboard.tsx';

const SPLASH_STATUS: Record<ConnState['phase'], string> = {
  connecting: 'Riding for the front',
  syncing: 'Unfurling the war map',
  live: 'The field is yours',
  resyncing: 'Redrawing the lines',
  offline: 'Messenger lost. Retrying',
  refused: 'Turned away at the gate',
};

export function Splash() {
  const hud = useHud();
  const { room } = useEnv();
  const ready = hud.hasWorld && hud.conn.phase === 'live';
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setGone(true), 700);
    return () => clearTimeout(t);
  }, [ready]);
  if (gone) return null;
  return (
    <div className="splash" data-done={ready} aria-live="polite">
      <div className="splash-inner">
        <div className="splash-crest" aria-hidden>
          <svg className="spin" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="48" fill="none" stroke="#d4af5f" strokeOpacity="0.4" strokeWidth="0.8" strokeDasharray="2 5" />
          </svg>
          <Crest />
        </div>
        <h1 className="splash-title">PUSHFRONT</h1>
        <div className="splash-tag">{room ? 'A public skirmish fought by GitHub activity.' : 'A persistent war fought by public GitHub activity.'}</div>
        <div className="splash-status">{SPLASH_STATUS[hud.conn.phase]}</div>
        <div className="splash-bar">
          <i />
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ onRules }: { onRules(): void }) {
  const hud = useHud();
  if (!hud.hasWorld || hud.players.size > 0 || hud.round?.status === 'ended') return null;
  return (
    <div className="panel empty" role="status">
      <Crest className="brand-mark" />
      <h2>No armies yet</h2>
      <p>Be the first to enlist. Your public commits, reviews, and merged pull requests from the last 28 days muster into soldiers that march on the Citadel without you.</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <a className="btn btn-gold" href="/auth/github">
          Enlist with GitHub
        </a>
        <button className="btn" onClick={onRules}>
          Articles of War
        </button>
      </div>
    </div>
  );
}

export function OfflineBanner() {
  const hud = useHud();
  const now = useNow(500);
  const c = hud.conn;
  if (!hud.hasWorld) return null;
  if (c.phase === 'offline') {
    return (
      <div className="offline-banner" role="status">
        Lost contact with the front. Retrying in {Math.max(0, Math.ceil((c.retryAt - now) / 1000))}s
      </div>
    );
  }
  if (c.phase === 'resyncing') {
    return (
      <div className="offline-banner" role="status" style={{ background: 'rgba(40,34,18,.92)', borderColor: 'rgba(212,175,95,.5)', color: 'var(--bone)' }}>
        {c.reason === 'desync' ? 'Our maps disagreed with headquarters. Redrawing the lines…' : 'Catching up with the front…'}
      </div>
    );
  }
  return null;
}

export function Toasts() {
  const hud = useHud();
  return (
    <div className="toasts" aria-live="polite">
      {hud.toasts.slice(-3).map((t) => (
        <div key={t.id} className="toast" style={{ ['--c' as string]: css(hud.factions[t.faction]?.color ?? 0xd4af5f) }}>
          <div className="toast-title">{t.title}</div>
          <div className="toast-sub">{t.subtitle}</div>
        </div>
      ))}
    </div>
  );
}

export function RoundOverlay() {
  const hud = useHud();
  const { store } = useEnv();
  const [dismissed, setDismissed] = useState(false);
  useNow(1000);
  const round = hud.round;
  const winnerId = round?.winnerFaction ?? (hud.winner >= 0 ? hud.winner : null);
  if (!round || dismissed || (round.status !== 'ended' && hud.winner < 0)) return null;
  const winner = winnerId !== null ? hud.factions[winnerId] : undefined;
  const color = css(winner?.color ?? 0xd4af5f);
  const ranked = [...hud.standings].sort((a, b) => b.score - a.score);
  const heroes = [...hud.players.values()]
    .filter((p) => p.faction === winnerId)
    .map((p) => ({ p, k: hud.warStates.get(p.playerId)?.kills ?? 0 }))
    .sort((a, b) => b.k - a.k)
    .slice(0, 3);
  return (
    <div className="ended" role="dialog" aria-label="Round results">
      <div className="panel ended-card" style={{ ['--c' as string]: color }}>
        <div className="ended-eyebrow">{round.name} · concluded</div>
        <div className="ended-banner">{winner?.name[0] ?? '?'}</div>
        <div className="ended-eyebrow">Victory to the</div>
        <div className="ended-winner">{winner?.name ?? 'No one'}</div>
        <table className="standings-table ended-results">
          <thead>
            <tr>
              <th>#</th>
              <th>Faction</th>
              <th>Score</th>
              <th>Land</th>
              <th>Held</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((f, i) => (
              <tr key={f.id} style={{ cursor: 'default' }}>
                <td className="place" data-p={i + 1}>
                  {i + 1}
                </td>
                <td>
                  <span className="who">
                    <span className="swatch" style={{ background: css(f.color) }} />
                    {f.name}
                  </span>
                </td>
                <td className="mono">{Math.floor(f.score).toLocaleString()}</td>
                <td className="mono">{(f.territory * 100).toFixed(0)}%</td>
                <td className="mono">{f.objectivesHeld}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {heroes.length > 0 && (
          <p className="ended-next">
            Most decorated: {heroes.map(({ p, k }) => `@${p.login} (${k} kills)`).join(', ')}
          </p>
        )}
        <p className="ended-next">
          {round.intermissionEndsAt ? `New factions form on a new map in ${formatCountdown(round.intermissionEndsAt - store.serverNow())}.` : 'The next round begins shortly.'}
        </p>
        <button className="btn" onClick={() => setDismissed(true)}>
          View the final field
        </button>
      </div>
    </div>
  );
}
