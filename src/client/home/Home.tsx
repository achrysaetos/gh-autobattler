import { useCallback, useState, type FormEvent } from 'react';
import { ROOM_MAX_FIGHTERS, ROOM_MIN_FIGHTERS, type CreateRoomResponse } from '../../protocol.ts';
import { ArticlesOfWar } from '../hud/ArticlesOfWar.tsx';
import { Crest } from '../hud/icons.tsx';
import { Link } from '../hud/Link.tsx';
import type { Api } from '../net/api.ts';
import { navigate } from '../route.ts';
import { FighterChips } from './FighterChips.tsx';
import { addTokens, markRejected, rosterProblem, type Chip } from './fighters.ts';
import { RoomBoard } from './RoomBoard.tsx';

type Failure = Exclude<CreateRoomResponse, { ok: true } | { error: 'rejected_fighters' }>;

const FAILURE_TEXT: Record<Failure['error'], string | null> = {
  rate_limited: 'You have started several battles in a short time. Give it a minute, then try again.',
  rooms_full: 'Every field is in use right now. Fields free up as battles end, usually within a few minutes.',
  github_unavailable: 'GitHub is not answering, so the armies cannot be mustered yet. Try again in a moment.',
  internal_error: 'Something broke on our side while mustering. Try again in a moment.',
  invalid_request: null,
};

export function Home({ api }: { api: Api }) {
  const [chips, setChips] = useState<Chip[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [rules, setRules] = useState(false);
  const closeRules = useCallback(() => setRules(false), []);

  const problem = rosterProblem(chips);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const roster = draft ? addTokens(chips, draft).chips : chips;
    setChips(roster);
    setDraft('');
    setTried(true);
    setNotice(null);
    if (rosterProblem(roster) !== null || busy) return;
    setBusy(true);
    const res = await api.createRoom(roster.map((c) => c.login));
    if (res.ok) {
      navigate({ kind: 'room', slug: res.slug });
      return;
    }
    setBusy(false);
    if (res.error === 'rejected_fighters') setChips(markRejected(roster, res.rejected));
    else setNotice(FAILURE_TEXT[res.error] ?? res.message);
  };

  return (
    <div className="home">
      <div className="home-backdrop" aria-hidden>
        <WarTable />
      </div>
      <header className="home-top">
        <Link to={{ kind: 'home' }} className="brand brand-home">
          <Crest className="brand-mark" />
          <div>
            <div className="brand-name">PUSHFRONT</div>
            <div className="brand-sub">Public GitHub activity, at war</div>
          </div>
        </Link>
        <nav className="home-nav">
          <button className="btn btn-quiet" onClick={() => setRules(true)}>
            Articles of War
          </button>
          <Link to={{ kind: 'campaign' }} className="btn">
            The campaign <span aria-hidden>→</span>
          </Link>
        </nav>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <div className="hero-copy">
            <div className="eyebrow">War room · public skirmish</div>
            <h1 className="hero-title">Pick your fighters</h1>
            <p className="hero-pitch">
              Real public GitHub activity becomes armies. Name the developers, and their commits, code reviews, and merged pull requests from the last 28 days muster into infantry,
              archers, and cavalry. Then they fight for ten minutes with no one at the controls.
            </p>
          </div>
          <ul className="hero-facts">
            <li>
              <strong>
                {ROOM_MIN_FIGHTERS} to {ROOM_MAX_FIGHTERS}
              </strong>{' '}
              fighters
            </li>
            <li>
              <strong>10</strong> minute battle
            </li>
            <li>
              <strong>28</strong> days of public work
            </li>
            <li>
              <strong>No</strong> sign-in
            </li>
          </ul>

          <form className="panel muster" onSubmit={(e) => void submit(e)} noValidate>
            <div className="panel-title">Muster roll</div>
            <FighterChips chips={chips} onChips={setChips} draft={draft} onDraft={setDraft} disabled={busy} />
            <div className="muster-foot">
              <span className="muster-count" aria-live="polite">
                <span className="mono">{chips.length}</span> / {ROOM_MAX_FIGHTERS} fighters
              </span>
              <span className="muster-hint">{tried && problem ? problem : 'Press Enter or comma after each name. Pasting a list works.'}</span>
            </div>
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            <button className="btn btn-gold btn-battle" type="submit" disabled={busy}>
              {busy ? 'Mustering the armies…' : 'To battle'}
              {!busy && (
                <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
                  <path d="M4 16 15 5M11 4h5v5M3 13l4 4M2 18l2-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <p className="muster-fine">Only public activity is read. Adding someone here does not enlist them in the campaign.</p>
          </form>
        </section>

        <RoomBoard api={api} />
      </main>

      <footer className="home-foot">
        <span>Pushfront measures public activity, consistency, and peer acceptance. It never claims to measure engineering quality.</span>
      </footer>
      {rules && <ArticlesOfWar onClose={closeRules} />}
    </div>
  );
}

function WarTable() {
  const rings = [120, 210, 300, 390, 480];
  const spokes = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6);
  return (
    <svg className="war-table" viewBox="-500 -500 1000 1000">
      <defs>
        <radialGradient id="table-glow">
          <stop offset="0" stopColor="#d4af5f" stopOpacity="0.16" />
          <stop offset="0.7" stopColor="#d4af5f" stopOpacity="0.03" />
          <stop offset="1" stopColor="#d4af5f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle r="500" fill="url(#table-glow)" />
      {rings.map((r) => (
        <circle key={r} r={r} fill="none" stroke="#d4af5f" strokeOpacity={0.12} strokeWidth="1" strokeDasharray={r % 180 === 30 ? '3 9' : undefined} />
      ))}
      {spokes.map((a) => (
        <line key={a} x1={Math.cos(a) * 120} y1={Math.sin(a) * 120} x2={Math.cos(a) * 480} y2={Math.sin(a) * 480} stroke="#d4af5f" strokeOpacity="0.07" />
      ))}
      <path d="M0-36 31-18v36L0 36-31 18v-36Z" fill="none" stroke="#d4af5f" strokeOpacity="0.35" strokeWidth="1.5" />
    </svg>
  );
}
