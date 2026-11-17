import { describe, expect, it } from 'vitest';
import { takeSessionFromUrl } from './session';

describe('takeSessionFromUrl (launcher handoff)', () => {
  it('adopts #party=CODE&host=TOKEN and clears the fragment', () => {
    let cleared = 0;
    const s = takeSessionFromUrl({ hash: '#party=abcd&host=tok-123' }, () => cleared++);
    expect(s).toEqual({ partyCode: 'ABCD', hostToken: 'tok-123' });
    expect(cleared).toBe(1);
  });

  it('ignores an empty or partial fragment', () => {
    let cleared = 0;
    expect(takeSessionFromUrl({ hash: '' }, () => cleared++)).toBeNull();
    expect(takeSessionFromUrl({ hash: '#party=ABCD' }, () => cleared++)).toBeNull();
    expect(takeSessionFromUrl({ hash: '#host=x' }, () => cleared++)).toBeNull();
    expect(cleared).toBe(0);
  });
});
