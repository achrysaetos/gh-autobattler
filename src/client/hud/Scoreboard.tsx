import { css, useEnv, useHud, useNow } from './context.ts';

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

function Tower({ gold }: { gold: boolean }) {
  return (
    <svg width="10" height="11" viewBox="0 0 10 11" aria-label={gold ? 'objectives held, including the Citadel' : 'objectives held'} style={{ verticalAlign: '-1px' }}>
      <path d="M1 11V3h1.6V1h1.6v2h1.6V1h1.6v2H9v8Z" fill={gold ? '#f0d28a' : '#9a937f'} />
    </svg>
  );
}

const TREND_GLYPH = { 1: '▲', 0: '–', [-1]: '▼' } as const;

export function Scoreboard() {
  const hud = useHud();
  const { store } = useEnv();
  useNow(1000);
  const round = hud.round;
  if (!round) return null;
  const now = store.serverNow();
  const ended = round.status === 'ended';
  const leader = [...hud.standings].sort((a, b) => b.score - a.score)[0];
  return (
    <div className="scoreboard">
      <div className="round-line">
        <span className="round-name">{round.name}</span>
        <span className="round-clock-label">{ended ? 'Intermission' : 'Ends in'}</span>
        <span className="round-clock">{formatCountdown((ended ? (round.intermissionEndsAt ?? now) : round.endsAt) - now)}</span>
      </div>
      {hud.standings.length > 0 && (
        <div className="banners">
          {hud.standings.map((f) => {
            const isLeader = leader?.id === f.id && f.score > 0;
            return (
              <div
                key={f.id}
                className="banner"
                data-leader={isLeader}
                style={{ ['--c' as string]: css(f.color) }}
                title={`${f.name} · ${f.players} players · ${f.alive} soldiers on the field`}
              >
                {isLeader && <span className="crown" aria-label="Leading">♛</span>}
                <div className="banner-head">
                  <span className="banner-name">{f.name}</span>
                </div>
                <div className="banner-score">
                  <span className="mono">{Math.floor(f.score).toLocaleString()}</span>
                  <span className="trend" data-t={f.trend} aria-label={f.trend > 0 ? 'gaining ground' : f.trend < 0 ? 'losing ground' : 'holding'}>
                    {TREND_GLYPH[f.trend]}
                  </span>
                </div>
                <div className="banner-stats">
                  <span>
                    <span className="mono">{(f.territory * 100).toFixed(0)}%</span> land
                  </span>
                  <span>
                    <span className="mono">{f.objectivesHeld}</span> <Tower gold={f.holdsCitadel} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
