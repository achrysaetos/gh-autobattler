import { UnitKind, UNIT_KINDS } from '../../sim/api.ts';
import type { DayLedger } from '../../rules/types.ts';
import { rankTitle } from '../../rules/names.ts';
import { css, useEnv, useHud } from './context.ts';
import { UnitIcon } from './icons.tsx';

const KIND_ROWS = [
  { kind: UnitKind.Infantry, label: 'Infantry', soldiers: 'infantry', why: 'commits' },
  { kind: UnitKind.Archer, label: 'Archers', soldiers: 'archers', why: 'reviews' },
  { kind: UnitKind.Cavalry, label: 'Cavalry', soldiers: 'cavalry', why: 'merged PRs' },
] as const;

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function DayCell({ day, today, color }: { day: DayLedger; today: boolean; color: string }) {
  const date = new Date(`${day.day}T00:00:00Z`);
  const raised = day.infantry + day.archers + day.cavalry;
  const reasons = [
    day.commits > 0 && `${plural(day.commits, 'commit')} → ${day.infantry} infantry`,
    day.reviews > 0 && `${plural(day.reviews, 'review')} → ${day.archers} ${day.archers === 1 ? 'archer' : 'archers'}`,
    day.mergedPrs > 0 && `${plural(day.mergedPrs, 'merged PR')} → ${day.cavalry} cavalry`,
  ].filter(Boolean) as string[];
  const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (
    <div className="day" data-active={raised > 0} data-today={today} aria-label={`${label}: ${reasons.join(', ') || 'no counted activity'}`}>
      <span className="day-num">{date.getUTCDate()}</span>
      <span className="day-units">
        {Array.from({ length: day.infantry }, (_, k) => <UnitIcon key={`i${k}`} kind={UnitKind.Infantry} color={color} />)}
        {Array.from({ length: day.archers }, (_, k) => <UnitIcon key={`a${k}`} kind={UnitKind.Archer} color={color} />)}
        {Array.from({ length: day.cavalry }, (_, k) => <UnitIcon key={`c${k}`} kind={UnitKind.Cavalry} color={color} />)}
      </span>
      <span className="day-tip">
        <strong>{label}</strong>
        <br />
        {reasons.length ? reasons.map((r) => <div key={r}>{r}</div>) : 'No counted activity'}
      </span>
    </div>
  );
}

export function PlayerPanel({ className = '' }: { className?: string }) {
  const hud = useHud();
  const { store, openProfile } = useEnv();
  const id = hud.selectedPlayerId;
  const player = id !== null ? hud.players.get(id) : undefined;
  if (!player) return null;
  const faction = hud.factions[player.faction];
  const color = css(faction?.color ?? 0xd4af5f);
  const war = hud.warStates.get(player.playerId);
  const alive = hud.alive.get(player.playerId) ?? [0, 0, 0];
  const army = player.army;
  const isViewer = hud.viewerPlayerId === player.playerId;
  const days = army.days.slice(-28);
  const lead = days.length ? (new Date(`${days[0]!.day}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const soldiers = army.infantry + army.archers + army.cavalry;
  const fielded = player.fielded.infantry + player.fielded.archers + player.fielded.cavalry;

  return (
    <section className={`panel player ${className}`} aria-label={`${player.login}'s warband`}>
      <div className="player-head">
        {player.avatarUrl ? <img className="avatar" src={player.avatarUrl} alt="" style={{ ['--c' as string]: color }} /> : <div className="avatar" style={{ ['--c' as string]: color }} />}
        <div style={{ minWidth: 0 }}>
          <a className="player-login" href={`https://github.com/${player.login}`} target="_blank" rel="noreferrer noopener">
            @{player.login}
          </a>
          <div className="player-faction">
            <span className="swatch" style={{ background: color }} />
            {faction?.name ?? 'Unassigned'}
            {isViewer && <span style={{ color: 'var(--gold-bright)' }}>· you</span>}
            {player.demo && <span title="Demo soldier for the preview">· demo</span>}
          </div>
          <div className="rank">
            <span className="rank-pips" aria-hidden>
              {[1, 2, 3, 4].map((r) => (
                <i key={r} data-on={army.rank >= r} />
              ))}
            </span>
            {rankTitle(army.rank)} · +{army.rank * 8}% HP & damage
          </div>
        </div>
        <button className="icon-btn close" onClick={() => store.select(null)} aria-label="Close player panel">
          ×
        </button>
      </div>

      <div className="section">
        <div className="panel-title">Warband</div>
        <table className="troops">
          <thead>
            <tr>
              <th>Kind</th>
              <th title="Soldiers earned over the last 28 days">Soldiers</th>
              <th title="Soldiers fielded after the 2400 unit cap">Fielded</th>
              <th title="Alive on the battlefield now">Alive</th>
            </tr>
          </thead>
          <tbody>
            {KIND_ROWS.map((row) => {
              const s = army[row.soldiers];
              const f = player.fielded[row.soldiers];
              const a = alive[row.kind];
              return (
                <tr key={row.kind}>
                  <td>
                    <span className="troop-name">
                      <UnitIcon kind={row.kind} color={color} />
                      {row.label}
                    </span>
                    <div className="bar" style={{ ['--c' as string]: color }}>
                      <i style={{ width: `${f ? Math.min(100, (a / f) * 100) : 0}%` }} />
                    </div>
                  </td>
                  <td className="mono">{s}</td>
                  <td className="mono">{f}</td>
                  <td className="mono">{a}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {fielded < soldiers && (
          <div className="ledger-foot">
            <span>Scaled to the 2400 unit field cap</span>
            <span className="mono">
              {fielded}/{soldiers}
            </span>
          </div>
        )}
      </div>

      <div className="section">
        <div className="panel-title">This round</div>
        <div className="tally">
          <div className="tally-cell">
            <label>Kills</label>
            <span className="mono">{war?.kills ?? 0}</span>
          </div>
          <div className="tally-cell">
            <label>Losses</label>
            <span className="mono">{war?.losses ?? 0}</span>
          </div>
          <div className="tally-cell">
            <label>Captures</label>
            <span className="mono">{war?.captures ?? 0}</span>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="panel-title">Tour of duty · 28 days</div>
        <div className="ledger" role="list">
          {DOW.map((d, i) => (
            <div key={`dow${i}`} className="ledger-dow">
              {d}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`pad${i}`} />
          ))}
          {days.map((day, i) => (
            <DayCell key={day.day} day={day} today={i === days.length - 1} color={color} />
          ))}
        </div>
        <div className="ledger-foot">
          <span>
            <span className="mono">{army.activeDays}</span> active days · streak <span className="mono">{army.streak}</span>
          </span>
          <span>
            {UNIT_KINDS.map((k) => (
              <UnitIcon key={k} kind={k} color={color} />
            ))}{' '}
            <span className="mono">{soldiers}</span>
          </span>
        </div>
      </div>

      <div className="player-actions">
        <button className="btn" onClick={() => store.setFollowing(!hud.following)} aria-pressed={hud.following}>
          {hud.following ? 'Following warband' : 'Follow warband'}
        </button>
        <button className="btn" onClick={() => openProfile(player.playerId)}>
          Service record
        </button>
      </div>
    </section>
  );
}
