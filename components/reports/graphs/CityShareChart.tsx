'use client';

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

import { ChartCard } from './ChartCard';
import {
  CHART_SERIES,
  CHART_STYLES,
  formatPaiseFull,
  formatPaiseShort,
} from './chart-theme';

import type { CityShareRow } from '@/lib/reports/graphs';

interface Props {
  data: CityShareRow[];
  windowLabel: string;
}

interface TooltipRow {
  payload?: CityShareRow & { percentage: number };
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipRow[];
}

function CityTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.[0]?.payload) return null;
  const r = payload[0].payload;
  return (
    <div style={CHART_STYLES.tooltip.contentStyle}>
      <p className="font-medium text-foreground">{r.cityName}</p>
      <p className="mt-0.5 text-primary font-semibold">
        {formatPaiseFull(r.revenuePaise)}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {r.percentage.toFixed(1)}% of total
      </p>
    </div>
  );
}

export function CityShareChart({ data, windowLabel }: Props) {
  const total = data.reduce((s, r) => s + r.revenuePaise, 0);
  const isEmpty = total === 0;

  const dataWithPct = data.map((r) => ({
    ...r,
    percentage: total > 0 ? (r.revenuePaise / total) * 100 : 0,
  }));

  return (
    <ChartCard
      title="Revenue by city"
      subtitle="Share of net cash across active cities"
      icon="public"
      badge={`${data.length} ${data.length === 1 ? 'city' : 'cities'}`}
      isEmpty={isEmpty}
      emptyHint={`No city-attributed revenue in ${windowLabel}.`}
      bodyMinHeight={320}
    >
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-center">
        <div className="sm:col-span-3 relative">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Tooltip
                content={<CityTooltip />}
                cursor={false}
              />
              <Pie
                data={dataWithPct}
                dataKey="revenuePaise"
                nameKey="cityName"
                cx="50%"
                cy="50%"
                innerRadius={65}
                outerRadius={100}
                paddingAngle={dataWithPct.length > 1 ? 2 : 0}
                stroke="var(--card)"
                strokeWidth={2}
              >
                {dataWithPct.map((_r, idx) => (
                  <Cell
                    key={idx}
                    fill={CHART_SERIES[idx % CHART_SERIES.length]}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Total
            </p>
            <p className="text-base sm:text-lg font-bold tracking-tight">
              {formatPaiseShort(total)}
            </p>
          </div>
        </div>
        <ul className="sm:col-span-2 space-y-1.5 text-[12px] max-h-[260px] overflow-y-auto pr-1">
          {dataWithPct.map((r, idx) => (
            <li
              key={r.cityId}
              className="flex items-center gap-2 leading-tight"
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: CHART_SERIES[idx % CHART_SERIES.length] }}
                aria-hidden
              />
              <span className="truncate flex-1">{r.cityName}</span>
              <span className="text-muted-foreground tabular-nums">
                {r.percentage.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}
