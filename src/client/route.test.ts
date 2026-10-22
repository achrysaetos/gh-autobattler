import { describe, expect, it } from 'vitest';
import { parseRoute, pathFor, streamPathFor } from './route.ts';

describe('routes', () => {
  it('maps paths to views', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
    expect(parseRoute('/campaign')).toEqual({ kind: 'campaign' });
    expect(parseRoute('/campaign/')).toEqual({ kind: 'campaign' });
    expect(parseRoute('/r/brisk-otter-42')).toEqual({ kind: 'room', slug: 'brisk-otter-42' });
    expect(parseRoute('/r/brisk-otter-42/')).toEqual({ kind: 'room', slug: 'brisk-otter-42' });
  });

  it('sends malformed and unknown paths to the lost view', () => {
    for (const path of ['/r', '/r/', '/r/a/b', '/r/%3Cscript%3E', '/rooms', '/campaigns']) expect(parseRoute(path), path).toEqual({ kind: 'lost', path });
  });

  it('round-trips every view through its path', () => {
    for (const path of ['/', '/campaign', '/r/demo']) expect(pathFor(parseRoute(path))).toBe(path);
  });

  it('streams the campaign and rooms from their own socket URLs', () => {
    expect(streamPathFor({ kind: 'campaign' })).toBe('/ws');
    expect(streamPathFor({ kind: 'room', slug: 'demo' })).toBe('/ws?room=demo');
  });
});
