import { describe, expect, it } from 'vitest';
import { multiplierText, normalise, payoutText, pctLabel, pctText } from './format';

describe('pctText', () => {
  it('rounds normal prices', () => {
    expect(pctText(0.7712)).toBe('77');
    expect(pctText(0.5)).toBe('50');
  });
  it('never returns an empty string', () => {
    expect(pctText(undefined)).toBe('–');
    expect(pctText(Number.NaN)).toBe('–');
    expect(pctText(null)).toBe('–');
  });
  it('handles the edges', () => {
    expect(pctText(0)).toBe('0');
    expect(pctText(1)).toBe('100');
    expect(pctText(0.003)).toBe('<1');
    expect(pctText(0.997)).toBe('>99');
    expect(pctText(1.4)).toBe('100');
    expect(pctText(-0.2)).toBe('0');
  });
  it('labels for screen readers', () => {
    expect(pctLabel(0.77)).toBe('77 percent');
    expect(pctLabel(undefined)).toBe('no price yet');
  });
});

describe('payoutText', () => {
  it('formats normal multipliers', () => {
    expect(payoutText(0.77)).toBe('$1 pays $1.30');
    expect(payoutText(0.77, { points: true })).toBe('1 pt pays 1.30');
  });
  it('rounds long shots for people', () => {
    expect(payoutText(0.0065, { points: true })).toBe('1 pt pays 100+');
    expect(payoutText(0.05)).toBe('$1 pays $20');
    expect(multiplierText(0.12)).toBe('8.33');
  });
  it('handles 0, 1 and missing', () => {
    expect(payoutText(0)).toBe('Long shot, no takers yet');
    expect(payoutText(1)).toBe('Sure thing, no payout');
    expect(payoutText(undefined)).toBe('No price yet');
    expect(multiplierText(1)).toBeNull();
  });
});

describe('normalise', () => {
  it('sums to one and survives an empty pool', () => {
    expect(normalise([0.2, 0.2])).toEqual([0.5, 0.5]);
    expect(normalise([0, 0, 0])).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(normalise([undefined, 0.5])).toEqual([0, 1]);
  });
});
