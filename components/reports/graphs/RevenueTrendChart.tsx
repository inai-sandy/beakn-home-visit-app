'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartCard } from './ChartCard';
import {
  CHART_PALETTE,
  CHART_STYLES,
  formatPaiseFull,
  formatPaiseShort,
  formatTickDay,
} from './chart-theme';

import type { DayBucketRow } from '@/lib/reports/graphs';

interface Props {
  data: DayBucketRow[];
  windowLabel: string;
}

interface TooltipRow {
  payload?: DayBucketRow;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipRow[];
  label?: string;
}

function RevenueTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.[0]?.payload) return null;
  const value = payload[0].payload.value;
  const day = label ? formatTickDay(label) : '';
  return (
    <div style={CHART_STYLES.tooltip.contentStyle}>
      <p className="font-medium text-foreground">{day}</p>
      <p className="text-primary font-semibold mt-0.5">
        {formatPaiseFull(value)}
      </p>
    </div>
  );
}

export function RevenueTrendChart({ data, windowLabel }: Props) {
  const total = data.reduce((s, r) => s + r.value, 0);
  const isEmpty = total === 0;

  return (
    <ChartCard
      title="Revenue trend"
      subtitle="Net cash (inbound − outbound) per day"
      icon="trending_up"
      badge={`Total ${formatPaiseShort(total)}`}
      isEmpty={isEmpty}
      emptyHint={`No payments recorded in ${windowLabel}.`}
    >
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart
          data={data}
          margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
        >
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor={CHART_PALETTE.primary}
                stopOpacity={0.4}
              />
              <stop
                offset="95%"
                stopColor={CHART_PALETTE.primary}
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke={CHART_STYLES.grid.stroke}
            strokeDasharray={CHART_STYLES.grid.strokeDasharray}
          />
          <XAxis
            dataKey="day"
            tickFormatter={formatTickDay}
            interval="preserveStartEnd"
            minTickGap={28}
            tickLine={false}
            axisLine={{ stroke: CHART_STYLES.axis.stroke }}
            tick={CHART_STYLES.axis.tick}
          />
          <YAxis
            tickFormatter={formatPaiseShort}
            tickLine={false}
            axisLine={false}
            width={56}
            tick={CHART_STYLES.axis.tick}
          />
          <Tooltip
            content={<RevenueTooltip />}
            cursor={CHART_STYLES.tooltip.cursor}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={CHART_PALETTE.primary}
            strokeWidth={2.5}
            fill="url(#revFill)"
            activeDot={{ r: 5, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
