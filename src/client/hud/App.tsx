import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Api } from '../net/api.ts';
import type { LockstepRunner } from '../net/runner.ts';
import { Battlefield } from '../render/battlefield.ts';
import type { Store } from '../store.ts';
import { ArticlesOfWar } from './ArticlesOfWar.tsx';
import { HudContext, useEnv, useHud, useMediaQuery, type HudEnv } from './context.ts';
import { Dispatches } from './Dispatches.tsx';
import { Crest } from './icons.tsx';
import { EmptyState, OfflineBanner, RoundOverlay, Splash, Toasts } from './Overlays.tsx';
import { PlayerPanel } from './PlayerPanel.tsx';
import { Scoreboard } from './Scoreboard.tsx';
import { ProfileModal, StandingsModal } from './Standings.tsx';

type Dialog = { kind: 'rules' } | { kind: 'standings' } | { kind: 'profile'; playerId: number } | null;

const PHASE_LABEL = { connecting: 'Connecting', syncing: 'Syncing', live: 'Live', resyncing: 'Resyncing', offline: 'Offline', refused: 'Closed' } as const;

function ConnectionPill() {
  const hud = useHud();
  return (
    <span className="conn" data-phase={hud.conn.phase} title={`Lockstep connection: ${hud.conn.phase}`}>
      <span className="conn-dot" />
      <span className="conn-label">{PHASE_LABEL[hud.conn.phase]}</span>
    </span>
  );
}

function CommandBar({ onDialog, mock, withFeed }: { onDialog(d: Dialog): void; mock: boolean; withFeed: boolean }) {
  const hud = useHud();
  const { store } = useEnv();
  const viewer = hud.viewerPlayerId !== null ? hud.players.get(hud.viewerPlayerId) : undefined;
  return (
    <div className="command">
      <div className="brand">
        <Crest className="brand-mark" />
        <div>
          <div className="brand-name">PUSHFRONT</div>
          <div className="brand-sub">{mock ? 'Preview battle · mock server' : 'Public GitHub activity, at war'}</div>
        </div>
        <ConnectionPill />
      </div>
      <div className="command-row">
        {viewer ? (
          <button className="btn btn-gold" onClick={() => store.select(viewer.playerId)}>
            <img src={viewer.avatarUrl} alt="" width={18} height={18} style={{ borderRadius: 4 }} />
            Your army
          </button>
        ) : (
          <a className="btn btn-gold" href="/auth/github">
            <span>
              Enlist<span className="label-wide"> with GitHub</span>
            </span>
          </a>
        )}
        <button className="btn" onClick={() => onDialog({ kind: 'rules' })}>
          <span>
            Articles<span className="label-wide"> of War</span>
          </span>
        </button>
        <button className="icon-btn" onClick={() => onDialog({ kind: 'standings' })} aria-label="Standings" title="Standings">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="M4 2h8v3a4 4 0 0 1-8 0Z M4 3H1.5v1.5A2.5 2.5 0 0 0 4 7 M12 3h2.5v1.5A2.5 2.5 0 0 1 12 7 M8 9v3 M5 14h6" fill="none" stroke="#f0d28a" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {withFeed && hud.hasWorld && <Dispatches />}
    </div>
  );
}

function Minimap() {
  const { battlefield } = useEnv();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    battlefield?.attachMinimap(ref.current);
    return () => battlefield?.attachMinimap(null);
  }, [battlefield]);
  return (
    <div className="panel minimap">
      <canvas ref={ref} aria-label="Minimap. Click to move the camera." />
      <div className="minimap-ring" />
      <span className="compass">N</span>
    </div>
  );
}

function MapControls() {
  const { battlefield } = useEnv();
  return (
    <div className="map-controls">
      <button className="icon-btn" onClick={() => battlefield?.zoomBy(1.4)} aria-label="Zoom in">
        +
      </button>
      <button className="icon-btn" onClick={() => battlefield?.zoomBy(1 / 1.4)} aria-label="Zoom out">
        −
      </button>
      <button className="icon-btn" onClick={() => battlefield?.overview()} aria-label="Show the whole field" style={{ fontSize: 13 }}>
        ⤢
      </button>
    </div>
  );
}

type SheetTab = 'dispatches' | 'player';

function MobileSheet() {
  const hud = useHud();
  const [tab, setTab] = useState<SheetTab>('dispatches');
  const [open, setOpen] = useState(false);
  const selected = hud.selectedPlayerId;
  useEffect(() => {
    if (selected !== null) {
      setTab('player');
      setOpen(true);
    }
  }, [selected]);
  return (
    <div className="sheet" style={{ height: open ? '56vh' : 92 }}>
      <button className="sheet-grip" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse panel' : 'Expand panel'} />
      <div className="tabs" role="tablist">
        <button
          className="tab"
          role="tab"
          aria-selected={tab === 'dispatches'}
          onClick={() => {
            setTab('dispatches');
            setOpen(true);
          }}
        >
          Dispatches
        </button>
        <button
          className="tab"
          role="tab"
          aria-selected={tab === 'player'}
          onClick={() => {
            setTab('player');
            setOpen(true);
          }}
        >
          {selected !== null ? `@${hud.players.get(selected)?.login ?? 'Commander'}` : 'Commander'}
        </button>
      </div>
      {open && (
        <div className="sheet-body">
          {tab === 'dispatches' && <Dispatches />}
          {tab === 'player' && (selected !== null ? <PlayerPanel /> : <div className="hint-card">Tap a soldier on the field to see their commander, warband, and 28-day tour of duty.</div>)}
        </div>
      )}
    </div>
  );
}

function SideColumn() {
  const hud = useHud();
  return (
    <div className="side">
      {hud.selectedPlayerId !== null ? (
        <PlayerPanel />
      ) : (
        hud.hasWorld &&
        hud.players.size > 0 && (
          <div className="panel hint-card">
            <strong>Select a soldier</strong>
            <br />
            Click any unit to see its commander, warband, and the 28-day tour of duty that raised it.
          </div>
        )
      )}
    </div>
  );
}

function Hud({ mock }: { mock: boolean }) {
  const mobile = useMediaQuery('(max-width: 760px)');
  const [dialog, setDialog] = useState<Dialog>(null);
  const env = useEnv();
  const close = useCallback(() => setDialog(null), []);
  const hud = useHud();
  return (
    <HudContext.Provider value={{ ...env, openProfile: (playerId) => setDialog({ kind: 'profile', playerId }) }}>
      <div className="hud">
        <CommandBar onDialog={setDialog} mock={mock} withFeed={!mobile} />
        <Scoreboard />
        <Toasts />
        {!mobile && <SideColumn />}
        {hud.hasWorld && <Minimap />}
        {!mobile && hud.hasWorld && <MapControls />}
        {!mobile && hud.hasWorld && (
          <div className="keys-hint">
            Drag or <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> to pan · scroll to zoom · double-click to focus · click a soldier
          </div>
        )}
        {mobile && hud.hasWorld && <MobileSheet />}
        <OfflineBanner />
        <EmptyState onRules={() => setDialog({ kind: 'rules' })} />
        <RoundOverlay />
        {dialog?.kind === 'rules' && <ArticlesOfWar onClose={close} />}
        {dialog?.kind === 'standings' && <StandingsModal onClose={close} />}
        {dialog?.kind === 'profile' && <ProfileModal playerId={dialog.playerId} onClose={close} />}
        <Splash />
      </div>
    </HudContext.Provider>
  );
}

export function App({ store, runner, api, mock }: { store: Store; runner: LockstepRunner; api: Api; mock: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [battlefield, setBattlefield] = useState<Battlefield | null>(null);
  useEffect(() => {
    const bf = new Battlefield(runner, store);
    let alive = true;
    void document.fonts.load('700 13px Cinzel').finally(() => {
      if (!alive) return;
      void bf.mount(host.current!).then(() => {
        if (!alive) return;
        setBattlefield(bf);
        if (mock) Object.assign(window, { pushfront: { ...(window as { pushfront?: object }).pushfront, battlefield: bf } });
      });
    });
    return () => {
      alive = false;
      bf.destroy();
    };
  }, [runner, store, mock]);
  const env = useMemo<HudEnv>(() => ({ store, api, battlefield, openProfile: () => {} }), [store, api, battlefield]);
  return (
    <HudContext.Provider value={env}>
      <div className="app">
        <div className="stage" ref={host} />
        <Hud mock={mock} />
      </div>
    </HudContext.Provider>
  );
}
