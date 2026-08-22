import { describe, it, expect } from 'vitest';
import { normPhone, normPersonName, householdKey, buildHouseholds, type HouseholdSource } from '@/lib/household';

/**
 * The grouping rules are the ledger: a wrong merge hands one family's history
 * to another, a wrong split hides a repeat complainant. The cases below come
 * from the shapes actually seen in Purulia's rows — +91 prefixes, honorific
 * stacking, families filing again months later with a corrected spelling.
 */

describe('normPhone', () => {
  it('strips formatting to bare digits', () => {
    expect(normPhone('+91 90000-51310')).toBe('9000051310');
    expect(normPhone('9000051310')).toBe('9000051310');
  });
  it('keeps the last ten digits of anything longer', () => {
    expect(normPhone('919000051310')).toBe('9000051310');
    expect(normPhone('0091-9000051310')).toBe('9000051310');
  });
  it('rejects fragments too short to be a number', () => {
    expect(normPhone('90000')).toBe('');
    expect(normPhone(null)).toBe('');
    expect(normPhone('')).toBe('');
  });
});

describe('normPersonName', () => {
  it('folds case and punctuation', () => {
    expect(normPersonName('Bikash  Bauri.')).toBe('bikash bauri');
  });
  it('strips stacked honorifics', () => {
    expect(normPersonName('Md Sk Rahim')).toBe('rahim');
    expect(normPersonName('Shri Bikash Bauri')).toBe('bikash bauri');
    expect(normPersonName('Smt. Parbati Hansda')).toBe('parbati hansda');
  });
  it('leaves Bengali script alone beyond whitespace', () => {
    expect(normPersonName('  মমতা  সোরেন ')).toBe('মমতা সোরেন');
  });
});

describe('householdKey', () => {
  it('prefers the phone when present', () => {
    expect(householdKey({ phone: '+919000051310', citizenName: 'A', village: 'x' })).toBe('P:9000051310');
  });
  it('falls back to normalised name+village without a phone', () => {
    expect(householdKey({ citizenName: 'Shri Ramesh Soren', village: 'Majura ' })).toBe('N:ramesh soren|majura');
  });
  it('returns empty when nothing trustworthy remains', () => {
    expect(householdKey({})).toBe('');
    expect(householdKey({ citizenName: 'Ramesh' })).toBe(''); // name alone would merge namesakes
  });
});

describe('buildHouseholds', () => {
  const rows: HouseholdSource[] = [
    { ticketNo: 'T1', citizenName: 'Mamoni Soren', phone: '+91 9000051310', village: 'Majura', status: 'RESOLVED', category: 'HEALTH', satisfactionRating: 5, createdAt: '2026-08-01T10:00:00Z' },
    { ticketNo: 'T2', citizenName: 'Mamoni Soren', phone: '919000051310', village: 'Majura', status: 'IN_PROGRESS', category: 'WATER', createdAt: '2026-08-09T10:00:00Z' },
    { ticketNo: 'T3', citizenName: 'Shri Ramesh Soren', village: 'Majura', status: 'OPEN', category: 'ROAD', createdAt: '2026-08-05T10:00:00Z' },
    { ticketNo: 'T4', citizenName: 'Ramesh Soren', village: 'MAJURA', status: 'RESOLVED', category: 'ROAD', createdAt: '2026-08-07T10:00:00Z' },
    { ticketNo: 'T5', citizenName: '', phone: '', village: '', status: 'OPEN', createdAt: '2026-08-08T10:00:00Z' },
  ];

  it('merges the same family across formats and months', () => {
    const { households } = buildHouseholds(rows);
    const byKey = new Map(households.map((h) => [h.key, h]));
    expect(byKey.get('P:9000051310')?.total).toBe(2);
    expect(byKey.get('P:9000051310')?.tickets).toEqual(['T1', 'T2']); // row order
    expect(byKey.get('N:ramesh soren|majura')?.total).toBe(2);
  });

  it('counts open and resolved honestly', () => {
    const { households } = buildHouseholds(rows);
    const h = households.find((x) => x.key === 'P:9000051310')!;
    expect(h.resolved).toBe(1);
    expect(h.open).toBe(1);
  });

  it('carries ratings and an average', () => {
    const { households } = buildHouseholds(rows);
    const h = households.find((x) => x.key === 'P:9000051310')!;
    expect(h.ratings).toEqual([5]);
    expect(h.avgRating).toBe(5);
  });

  it('names the top categories by frequency', () => {
    const { households } = buildHouseholds(rows);
    const h = households.find((x) => x.key === 'N:ramesh soren|majura')!;
    expect(h.topCategories).toEqual(['ROAD']);
  });

  it('keeps an unmergeable row out rather than forcing it into a family', () => {
    const { households, ungrouped } = buildHouseholds(rows);
    expect(ungrouped).toBe(1);
    expect(households.length).toBe(2);
  });

  it('sorts the busiest family first', () => {
    const { households } = buildHouseholds(rows);
    expect(households[0].total).toBeGreaterThanOrEqual(households[1].total);
  });
});
