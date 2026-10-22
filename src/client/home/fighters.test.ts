import { describe, expect, it } from 'vitest';
import { addTokens, isLogin, markRejected, rosterProblem, type Chip } from './fighters.ts';

const ok = (login: string): Chip => ({ login, issue: null });

describe('GitHub login syntax', () => {
  it('accepts what GitHub accepts', () => {
    for (const login of ['a', 'a-b', 'A1-b2-c3', 'x'.repeat(39)]) expect(isLogin(login), login).toBe(true);
  });

  it('refuses what GitHub refuses', () => {
    for (const login of ['', '-a', 'a-', 'a--b', 'a_b', 'a.b', 'x'.repeat(40), 'ünï']) expect(isLogin(login), login).toBe(false);
  });
});

describe('adding fighters', () => {
  it('splits a pasted list on commas and whitespace and strips @ and profile URLs', () => {
    const { chips, skipped } = addTokens([], '@alpha, beta\n https://github.com/gamma/ ,,delta');
    expect(chips).toEqual([ok('alpha'), ok('beta'), ok('gamma'), ok('delta')]);
    expect(skipped).toEqual([]);
  });

  it('keeps a malformed login as a marked chip so the player sees why', () => {
    expect(addTokens([], 'good bad--name').chips).toEqual([ok('good'), { login: 'bad--name', issue: 'syntax' }]);
    expect(addTokens([], 'helper[bot]').chips).toEqual([{ login: 'helper[bot]', issue: 'bot' }]);
  });

  it('skips case-insensitive duplicates and anything past eight fighters', () => {
    const { chips, skipped } = addTokens([ok('Alpha')], 'alpha b c d e f g h i');
    expect(chips.map((c) => c.login)).toEqual(['Alpha', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(skipped).toEqual([
      { token: 'alpha', why: 'duplicate' },
      { token: 'i', why: 'full' },
    ]);
  });
});

describe('server rejections', () => {
  it('marks each rejected chip with its reason, matching logins case-insensitively', () => {
    const marked = markRejected(
      [ok('Alpha'), ok('beta'), ok('gamma')],
      [
        { login: 'alpha', reason: 'too_new' },
        { login: 'gamma', reason: 'no_public_activity' },
      ],
    );
    expect(marked).toEqual([{ login: 'Alpha', issue: 'too_new' }, ok('beta'), { login: 'gamma', issue: 'no_public_activity' }]);
  });
});

describe('roster readiness', () => {
  it('needs two clean fighters', () => {
    expect(rosterProblem([])).toBe('Add at least 2 more');
    expect(rosterProblem([ok('a')])).toBe('Add at least 1 more');
    expect(rosterProblem([ok('a'), ok('b')])).toBeNull();
    expect(rosterProblem([ok('a'), ok('b'), { login: 'c', issue: 'bot' }])).toBe('Remove the marked fighter to continue');
  });
});
