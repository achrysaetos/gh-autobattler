import { useEffect, useState } from 'react';
import type { ProfileResponse, StandingsResponse } from '../../protocol.ts';
import { css, useEnv, useHud } from './context.ts';
import { MedalIcon } from './icons.tsx';
import { Modal } from './Modal.tsx';

type Tab = 'round' | 'lifetime';

type Load<T> = { status: 'loading' } | { status: 'done'; data: T } | { status: 'error'; error: string };

function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Load<T> {
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    load().then(
      (data) => live && setState({ status: 'done', data }),
      (e: unknown) => live && setState({ status: 'error', error: e instanceof Error ? e.message : 'Request failed' }),
    );
    return () => {
      live = false;
    };
  }, deps);
  return state;
}

function RoundTable({ onPick }: { onPick(id: number): void }) {
  const hud = useHud();
  const rows = [...hud.players.values()]
    .map((p) => ({ p, war: hud.warStates.get(p.playerId) }))
    .sort((a, b) => (b.war?.kills ?? 0) - (a.war?.kills ?? 0) || (b.war?.captures ?? 0) - (a.war?.captures ?? 0) || a.p.playerId - b.p.playerId);
  if (!rows.length) return <div className="loading-inline">No armies yet.</div>;
  return (
    <table className="standings-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Commander</th>
          <th>Soldiers</th>
          <th>Kills</th>
          <th>Losses</th>
          <th>Captures</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ p, war }, i) => (
          <tr key={p.playerId} onClick={() => onPick(p.playerId)}>
            <td className="place" data-p={i + 1}>
              {i + 1}
            </td>
            <td>
              <span className="who">
                <img src={p.avatarUrl} alt="" />
                <span>
                  @{p.login}
                  <br />
                  <span style={{ color: css(hud.factions[p.faction]?.color ?? 0x999999), fontSize: 11 }}>{hud.factions[p.faction]?.name}</span>
                </span>
              </span>
            </td>
            <td className="mono">{p.army.infantry + p.army.archers + p.army.cavalry}</td>
            <td className="mono">{war?.kills ?? 0}</td>
            <td className="mono">{war?.losses ?? 0}</td>
            <td className="mono">{war?.captures ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LifetimeTable({ onPick }: { onPick(id: number): void }) {
  const { api } = useEnv();
  const load = useLoad<StandingsResponse>(() => api.standings(), []);
  if (load.status === 'error') return <div className="loading-inline">The quartermaster could not be reached. {load.error}</div>;
  if (load.status === 'loading') return <div className="loading-inline">Consulting the rolls…</div>;
  const data = load.data;
  if (!data.lifetime.length) return <div className="loading-inline">No service records yet.</div>;
  return (
    <table className="standings-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Commander</th>
          <th>Rounds won</th>
          <th>Played</th>
          <th>Kills</th>
          <th>Captures</th>
          <th>Peak</th>
        </tr>
      </thead>
      <tbody>
        {data.lifetime.map((row, i) => (
          <tr key={row.playerId} onClick={() => onPick(row.playerId)}>
            <td className="place" data-p={i + 1}>
              {i + 1}
            </td>
            <td>
              <span className="who">
                <img src={row.avatarUrl} alt="" />@{row.login}
              </span>
            </td>
            <td className="mono">{row.stats.roundsWon}</td>
            <td className="mono">{row.stats.roundsPlayed}</td>
            <td className="mono">{row.stats.kills.toLocaleString()}</td>
            <td className="mono">{row.stats.captures}</td>
            <td className="mono">{row.stats.peakSoldiers}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StandingsModal({ onClose }: { onClose(): void }) {
  const [tab, setTab] = useState<Tab>('round');
  const { openProfile } = useEnv();
  return (
    <Modal
      title="Standings"
      subtitle="Click a commander to open their service record."
      onClose={onClose}
      tabs={
        <div className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={tab === 'round'} onClick={() => setTab('round')}>
            This round
          </button>
          <button className="tab" role="tab" aria-selected={tab === 'lifetime'} onClick={() => setTab('lifetime')}>
            Lifetime
          </button>
        </div>
      }
    >
      {tab === 'round' ? <RoundTable onPick={openProfile} /> : <LifetimeTable onPick={openProfile} />}
    </Modal>
  );
}

export function ProfileModal({ playerId, onClose }: { playerId: number; onClose(): void }) {
  const { api, store } = useEnv();
  const load = useLoad<ProfileResponse | null>(() => api.profile(playerId), [playerId]);
  const data = load.status === 'done' ? load.data : null;
  const title = data ? `@${data.login}` : 'Service record';
  return (
    <Modal title={title} subtitle="Service record across every round" onClose={onClose}>
      {load.status === 'error' && <div className="loading-inline">The quartermaster could not be reached. {load.error}</div>}
      {load.status === 'loading' && <div className="loading-inline">Unrolling the record…</div>}
      {load.status === 'done' && !data && <div className="loading-inline">No service record for this commander.</div>}
      {data && (
        <>
          <div className="player-head" style={{ marginTop: 12 }}>
            <img className="avatar" src={data.avatarUrl} alt="" />
            <div className="tally" style={{ flex: 1 }}>
              <div className="tally-cell">
                <label>Rounds won</label>
                <span className="mono">
                  {data.stats.roundsWon}/{data.stats.roundsPlayed}
                </span>
              </div>
              <div className="tally-cell">
                <label>Kills</label>
                <span className="mono">{data.stats.kills.toLocaleString()}</span>
              </div>
              <div className="tally-cell">
                <label>Captures</label>
                <span className="mono">{data.stats.captures}</span>
              </div>
              <div className="tally-cell">
                <label>Losses</label>
                <span className="mono">{data.stats.losses.toLocaleString()}</span>
              </div>
              <div className="tally-cell">
                <label>Peak soldiers</label>
                <span className="mono">{data.stats.peakSoldiers}</span>
              </div>
              <div className="tally-cell">
                <label>Medals</label>
                <span className="mono">{data.medals.length}</span>
              </div>
            </div>
          </div>
          <h3>Medals</h3>
          {data.medals.length ? (
            <div className="medals">
              {data.medals.map((m) => (
                <div key={m.id} className="medal">
                  <MedalIcon seed={m.id} />
                  <div>
                    <b>{m.name}</b>
                    <span>{m.description}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p>No medals yet. They are earned by consistency, peer acceptance, and taking ground.</p>
          )}
          <h3>Campaigns</h3>
          {data.history.length ? (
            <table className="standings-table">
              <thead>
                <tr>
                  <th>Round</th>
                  <th>Faction</th>
                  <th>Result</th>
                  <th>Kills</th>
                  <th>Captures</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((h) => (
                  <tr key={h.roundId} style={{ cursor: 'default' }}>
                    <td>{h.roundName}</td>
                    <td>{h.faction}</td>
                    <td style={{ color: h.won ? 'var(--gold-bright)' : 'var(--muted)' }}>{h.won ? 'Victory' : 'Defeat'}</td>
                    <td className="mono">{h.kills}</td>
                    <td className="mono">{h.captures}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>This is their first campaign.</p>
          )}
          {store.players.has(playerId) && (
            <div className="player-actions">
              <button
                className="btn btn-gold"
                onClick={() => {
                  store.select(playerId);
                  onClose();
                }}
              >
                Find on the battlefield
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
