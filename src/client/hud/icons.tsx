import { UnitKind } from '../../sim/api.ts';

export function UnitIcon({ kind, color = '#ece3cd' }: { kind: UnitKind; color?: string }) {
  return (
    <svg className="unit-icon" viewBox="-16 -16 32 32" aria-hidden>
      {kind === UnitKind.Infantry && (
        <>
          <circle r="11" fill={color} stroke="#15130f" strokeWidth="3" />
          <circle r="3.5" fill="#15130f" opacity="0.55" />
        </>
      )}
      {kind === UnitKind.Archer && <path d="M13 0 -9 -12 -3 0 -9 12Z" fill={color} stroke="#15130f" strokeWidth="3" strokeLinejoin="round" />}
      {kind === UnitKind.Cavalry && <path d="M15 0 0 -8 -15 0 0 8Z" fill={color} stroke="#15130f" strokeWidth="3" strokeLinejoin="round" />}
    </svg>
  );
}

export function Crest({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 72" aria-hidden>
      <defs>
        <linearGradient id="crest-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#252c34" />
          <stop offset="1" stopColor="#0f1317" />
        </linearGradient>
        <linearGradient id="crest-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3d995" />
          <stop offset="1" stopColor="#a47c35" />
        </linearGradient>
      </defs>
      <path d="M32 3 59 13v21c0 17-12 29-27 35C17 63 5 51 5 34V13Z" fill="url(#crest-fill)" stroke="url(#crest-gold)" strokeWidth="3" />
      <path d="M32 11 51 18v16c0 12-8 21-19 26-11-5-19-14-19-26V18Z" fill="none" stroke="#d4af5f" strokeOpacity="0.35" strokeWidth="1.2" />
      <path d="M23 50V22h11a8 8 0 0 1 0 16H23" fill="none" stroke="url(#crest-gold)" strokeWidth="4.5" strokeLinejoin="round" />
      <path d="M38 44l8 8M46 44l-8 8" stroke="#d4af5f" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function MedalIcon({ seed }: { seed: string }) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const ribbons = ['#b8443a', '#3f78b8', '#3c8f6e', '#7b55b0', '#c08a2e'];
  const ribbon = ribbons[Math.abs(h) % ribbons.length];
  return (
    <svg width="30" height="38" viewBox="0 0 30 38" aria-hidden>
      <path d="M8 0h14l-3 14H11Z" fill={ribbon} />
      <path d="M8 0h4l3 14h-4Z" fill="rgba(0,0,0,.25)" />
      <circle cx="15" cy="25" r="11" fill="#d4af5f" stroke="#7a5d27" strokeWidth="1.5" />
      <circle cx="15" cy="25" r="7.5" fill="none" stroke="#f6e1a6" strokeWidth="1" />
      <path d="M15 19.5l1.6 3.4 3.7.4-2.8 2.5.8 3.6-3.3-1.9-3.3 1.9.8-3.6-2.8-2.5 3.7-.4Z" fill="#7a5d27" />
    </svg>
  );
}
