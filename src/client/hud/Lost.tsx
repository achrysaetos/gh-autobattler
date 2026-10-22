import { Crest } from './icons.tsx';
import { Link } from './Link.tsx';

function LostCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel lost-card" role="alert">
      <Crest className="lost-crest" />
      <div className="ended-eyebrow">Dispatch returned unopened</div>
      <h1 className="lost-title">{title}</h1>
      <p>{body}</p>
      <div className="lost-actions">
        <Link to={{ kind: 'home' }} className="btn btn-gold">
          Pick your fighters
        </Link>
        <Link to={{ kind: 'campaign' }} className="btn">
          Watch the campaign
        </Link>
      </div>
    </div>
  );
}

export function LostPage() {
  return (
    <div className="lost-page">
      <LostCard title="This road leads nowhere" body="There is nothing at this address. The war is still on, though." />
    </div>
  );
}

export function RoomLost() {
  return (
    <div className="ended lost-overlay">
      <LostCard title="No battle on this field" body="This room does not exist, or it ended long enough ago that the field was cleared. Pick new fighters to start another." />
    </div>
  );
}
