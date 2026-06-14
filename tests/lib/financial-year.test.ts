import { describe, expect, it } from 'vitest';

import {
  financialYearBounds,
  financialYearLabel,
  financialYearStartYear,
  financialYearToDate,
} from '@/lib/date';

// HVA-289: FY = Apr 1 → Mar 31. FY2026 = Apr 1 2026 → Mar 31 2027.
describe('financial-year helpers', () => {
  describe('financialYearStartYear', () => {
    it('April–December belong to the FY that started that April', () => {
      expect(financialYearStartYear('2026-04-01')).toBe(2026);
      expect(financialYearStartYear('2026-06-14')).toBe(2026);
      expect(financialYearStartYear('2026-12-31')).toBe(2026);
    });
    it('January–March belong to the FY that started the previous April', () => {
      expect(financialYearStartYear('2027-01-01')).toBe(2026);
      expect(financialYearStartYear('2027-03-31')).toBe(2026);
    });
    it('rolls to the next FY on April 1', () => {
      expect(financialYearStartYear('2027-04-01')).toBe(2027);
    });
  });

  describe('financialYearBounds', () => {
    it('spans Apr 1 → Mar 31 of the next year', () => {
      expect(financialYearBounds('2026-06-14')).toEqual({
        start: '2026-04-01',
        end: '2027-03-31',
      });
    });
    it('maps a Jan date back to the prior April start', () => {
      expect(financialYearBounds('2027-02-10')).toEqual({
        start: '2026-04-01',
        end: '2027-03-31',
      });
    });
  });

  describe('financialYearToDate', () => {
    it('runs from FY start to the given day inclusive', () => {
      expect(financialYearToDate('2026-06-14')).toEqual({
        fromDate: '2026-04-01',
        toDate: '2026-06-14',
      });
    });
    it('on FY start day, from === to', () => {
      expect(financialYearToDate('2026-04-01')).toEqual({
        fromDate: '2026-04-01',
        toDate: '2026-04-01',
      });
    });
  });

  describe('financialYearLabel', () => {
    it('formats as "FY YYYY–YY"', () => {
      expect(financialYearLabel('2026-06-14')).toBe('FY 2026–27');
      expect(financialYearLabel('2027-02-01')).toBe('FY 2026–27');
      expect(financialYearLabel('2027-04-01')).toBe('FY 2027–28');
    });
  });
});
