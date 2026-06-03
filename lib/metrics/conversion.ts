import { loadOrdersCount } from './orders';
import { loadVisits } from './visits';
import type { DateRange, MetricLoader, MetricScope } from './types';

// =============================================================================
// SSOT: conversion_pct
// =============================================================================
//
// conversion_pct = (orders_count / visits) * 100, rounded to int.
// Returns null when visits == 0 (no denominator → no defined ratio).
//
// This loader composes the orders_count + visits loaders so the
// formula is identical to the underlying tiles. If a portal shows
// "visits = 12" + "orders = 3" + "conversion = 25%" the three numbers
// will always agree by construction — they share the source.
// =============================================================================

export const loadConversionPct: MetricLoader<number | null> = async (
  scope: MetricScope,
  range: DateRange,
) => {
  const [orders, visits] = await Promise.all([
    loadOrdersCount(scope, range),
    loadVisits(scope, range),
  ]);
  if (visits === 0) return null;
  return Math.round((orders / visits) * 100);
};
