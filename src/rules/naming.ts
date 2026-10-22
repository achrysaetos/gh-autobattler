import { mulberry32, pick } from './prng.ts';

const ROMAN: readonly [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

const ENGAGEMENTS = ['The Siege of', 'The Battle of', 'The March on', 'The Fall of', 'The Defense of', 'The Relief of'];
const HEADS = ['Ash', 'Brack', 'Cold', 'Dun', 'Elder', 'Fen', 'Grey', 'Hollow', 'Iron', 'Kestrel', 'Lark', 'Mire', 'North', 'Oak', 'Raven', 'Salt', 'Thorn', 'Wold'];
const TAILS = ['ford', 'wick', 'mere', 'holt', 'gate', 'barrow', 'stead', 'crag', 'moor', 'reach', 'haven', 'fell', 'combe', 'mark'];

export function roman(n: number): string {
  let rest = Math.max(1, Math.floor(n));
  let out = '';
  for (const [value, glyph] of ROMAN) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

export function campaignName(campaign: number, seed: number): string {
  const rng = mulberry32(seed);
  const engagement = pick(rng, ENGAGEMENTS);
  const place = pick(rng, HEADS) + pick(rng, TAILS);
  return `Campaign ${roman(campaign)} · ${engagement} ${place}`;
}

export function roomName(logins: readonly string[]): string {
  return logins.map((l) => `@${l}`).join(' vs ');
}
