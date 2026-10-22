import { Fragment, type ReactNode } from 'react';
import { UnitKind } from '../../sim/api.ts';
import type { FeedItem } from '../../protocol.ts';
import type { BattleLine } from '../store.ts';
import { css, useEnv, useHud, useNow } from './context.ts';
import { UnitIcon } from './icons.tsx';

type Line = { kind: 'feed'; at: number; item: FeedItem } | { kind: 'battle'; at: number; line: BattleLine };

const TOKEN = /(@[A-Za-z0-9][A-Za-z0-9-]*)|([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#\d+)?)|(\+\d+ (?:infantry|archers?|cavalry))/g;

function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function Message({ text, url, onLogin }: { text: string; url: string | null; onLogin(login: string): void }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index;
    if (i > last) parts.push(text.slice(last, i));
    const [whole, login, ref, gain] = m;
    if (login) {
      parts.push(
        <span key={i} className="login" role="button" tabIndex={0} onClick={() => onLogin(login.slice(1))} onKeyDown={(e) => e.key === 'Enter' && onLogin(login.slice(1))}>
          {login}
        </span>,
      );
    } else if (ref) {
      const href = url ?? `https://github.com/${ref.replace(/#(\d+)$/, '/pull/$1')}`;
      parts.push(
        <a key={i} className="ref" href={href} target="_blank" rel="noreferrer noopener">
          {ref}
        </a>,
      );
    } else if (gain) {
      parts.push(
        <span key={i} className="gain">
          {gain}
        </span>,
      );
    } else parts.push(whole);
    last = i + whole.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <div className="feed-msg">{parts.map((p, k) => <Fragment key={k}>{p}</Fragment>)}</div>;
}

const KIND_LABEL: Record<FeedItem['kind'] | 'battle', string> = {
  enlist: 'Enlisted',
  reinforce: 'Reinforcements',
  capture: 'Capture',
  round: 'Round',
  domination: 'Domination',
  battle: 'Battle report',
};

export function Dispatches({ className = '' }: { className?: string }) {
  const hud = useHud();
  const { store } = useEnv();
  useNow(5000);
  const lines: Line[] = [
    ...hud.feed.map((item): Line => ({ kind: 'feed', at: item.at, item })),
    ...hud.battle.map((line): Line => ({ kind: 'battle', at: line.at, line })),
  ].sort((a, b) => b.at - a.at);

  const selectLogin = (login: string) => {
    for (const p of hud.players.values()) if (p.login === login) store.select(p.playerId);
  };

  return (
    <section className={`panel dispatches ${className}`} aria-label="War dispatches">
      <div className="panel-title">War Dispatches</div>
      <div className="feed">
        {lines.length === 0 && <div className="hint-card">The field is quiet. Dispatches appear as soldiers muster and strongholds change hands.</div>}
        {lines.slice(0, 60).map((l) => {
          const faction = l.kind === 'feed' ? l.item.faction : l.line.faction;
          const color = faction !== null && faction >= 0 ? css(hud.factions[faction]?.color ?? 0xd4af5f) : '#d4af5f';
          const kind = l.kind === 'feed' ? l.item.kind : 'battle';
          const units = l.kind === 'feed' ? l.item.units : null;
          return (
            <div key={l.kind === 'feed' ? `f${l.item.id}` : l.line.id} className="feed-item" data-kind={kind} style={{ ['--c' as string]: color }}>
              <div>
                <Message text={l.kind === 'feed' ? l.item.message : l.line.message} url={l.kind === 'feed' ? l.item.url : null} onLogin={selectLogin} />
                <div className="feed-meta">
                  <span className="kind">{KIND_LABEL[kind]}</span>
                  <span>{ago(store.serverNow() - l.at)}</span>
                  {units && (
                    <span className="pips" aria-label={`${units.infantry} infantry, ${units.archers} archers, ${units.cavalry} cavalry`}>
                      {Array.from({ length: Math.min(6, units.infantry) }, (_, k) => <UnitIcon key={`i${k}`} kind={UnitKind.Infantry} color={color} />)}
                      {Array.from({ length: Math.min(3, units.archers) }, (_, k) => <UnitIcon key={`a${k}`} kind={UnitKind.Archer} color={color} />)}
                      {Array.from({ length: Math.min(3, units.cavalry) }, (_, k) => <UnitIcon key={`c${k}`} kind={UnitKind.Cavalry} color={color} />)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
