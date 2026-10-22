import { useEffect, useState } from 'react';
import type { RoomFighter, RoomSummary, RoomsResponse } from '../../protocol.ts';
import { css, useNow } from '../hud/context.ts';
import { Link } from '../hud/Link.tsx';
import { formatMinutes } from '../hud/Scoreboard.tsx';
import type { Api } from '../net/api.ts';

const POLL_MS = 5000;
const CARD_ROWS = 4;

function useRooms(api: Api): { rooms: RoomsResponse | null; stale: boolean } {
  const [rooms, setRooms] = useState<RoomsResponse | null>(null);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.rooms().then(
        (r) => {
          if (!alive) return;
          setRooms(r);
          setStale(false);
        },
        () => alive && setStale(true),
      );
    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [api]);
  return { rooms, stale };
}

function agoText(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

function Avatar({ f, size }: { f: RoomFighter; size: number }) {
  return <img className="room-avatar" src={f.avatarUrl} alt={`@${f.login}`} title={`@${f.login}`} width={size} height={size} style={{ ['--c' as string]: css(f.color) }} />;
}

function ScoreBar({ fighters }: { fighters: RoomFighter[] }) {
  const total = fighters.reduce((s, f) => s + f.score, 0);
  return (
    <div className="room-bar" aria-hidden>
      {fighters.map((f) => (
        <i key={f.faction} style={{ flexGrow: total > 0 ? f.score : 1, background: css(f.color) }} />
      ))}
    </div>
  );
}

function LiveCard({ room, now }: { room: RoomSummary; now: number }) {
  const ranked = [...room.fighters].sort((a, b) => b.score - a.score);
  const left = room.endsAt - now;
  return (
    <Link to={{ kind: 'room', slug: room.slug }} className="panel room-card" aria-label={`Watch ${room.fighters.map((f) => `@${f.login}`).join(' versus ')}`}>
      <div className="room-card-head">
        <span className="live-tag">
          <span className="live-dot" />
          Live
        </span>
        <span className="room-clock mono" data-urgent={left < 60_000}>
          {formatMinutes(left)}
        </span>
        <span className="room-left">left</span>
      </div>
      <div className="room-avatars">
        {room.fighters.map((f) => (
          <Avatar key={f.faction} f={f} size={34} />
        ))}
      </div>
      <ScoreBar fighters={room.fighters} />
      <ol className="room-scores">
        {ranked.slice(0, CARD_ROWS).map((f) => (
          <li key={f.faction}>
            <span className="swatch" style={{ background: css(f.color) }} />
            <span className="room-login">@{f.login}</span>
            <span className="mono">{Math.floor(f.score).toLocaleString()}</span>
          </li>
        ))}
        {ranked.length > CARD_ROWS && <li className="room-more">and {ranked.length - CARD_ROWS} more</li>}
      </ol>
      <span className="room-watch">
        Watch <span aria-hidden>→</span>
      </span>
    </Link>
  );
}

function ResultCard({ room, now }: { room: RoomSummary; now: number }) {
  const winner = room.fighters.find((f) => f.login === room.winnerLogin);
  const others = room.fighters.filter((f) => f !== winner);
  return (
    <Link to={{ kind: 'room', slug: room.slug }} className="panel result-card" style={{ ['--c' as string]: css(winner?.color ?? 0xd4af5f) }}>
      {winner && (
        <span className="result-victor">
          <Avatar f={winner} size={40} />
          <span className="result-crown" aria-hidden>
            ♛
          </span>
        </span>
      )}
      <span className="result-text">
        <span className="result-winner">{winner ? `@${winner.login}` : 'No victor'}</span>
        <span className="result-over">
          over{' '}
          {others
            .slice(0, 3)
            .map((f) => `@${f.login}`)
            .join(', ')}
          {others.length > 3 ? ` and ${others.length - 3} more` : ''}
        </span>
      </span>
      <span className="result-when">{agoText(now - room.endsAt)}</span>
    </Link>
  );
}

export function RoomBoard({ api }: { api: Api }) {
  const { rooms, stale } = useRooms(api);
  const now = useNow(1000);
  const live = rooms?.live.filter((r) => r.status === 'active') ?? [];
  return (
    <>
      <section className="board" aria-labelledby="board-live">
        <div className="board-head">
          <h2 id="board-live" className="board-title">
            Fields of battle
          </h2>
          <span className="board-count">{rooms ? `${live.length} live` : 'Scouting…'}</span>
          {stale && <span className="board-stale">Scouts are late. Showing the last report.</span>}
        </div>
        {rooms && live.length === 0 && (
          <div className="board-empty">
            <svg width="38" height="38" viewBox="0 0 40 40" aria-hidden>
              <path d="M8 34V8M8 9c6-4 11 4 17 0s9-1 9-1v14s-3-3-9 1-11-4-17 0" fill="none" stroke="#d4af5f" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            <div>
              <strong>The fields are quiet.</strong>
              <br />
              No battles are being fought right now. Name two developers above and yours will be the first one here.
            </div>
          </div>
        )}
        {live.length > 0 && (
          <div className="room-grid">
            {live.map((r) => (
              <LiveCard key={r.slug} room={r} now={now} />
            ))}
          </div>
        )}
      </section>
      {rooms && rooms.recent.length > 0 && (
        <section className="board" aria-labelledby="board-recent">
          <div className="board-head">
            <h2 id="board-recent" className="board-title">
              Recent results
            </h2>
          </div>
          <div className="result-grid">
            {rooms.recent.map((r) => (
              <ResultCard key={r.slug} room={r} now={now} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
