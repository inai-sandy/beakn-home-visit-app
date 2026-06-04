'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartCard } from './ChartCard';
import {
  CHART_PALETTE,
  CHART_STYLES,
  formatTickDay,
} from './chart-theme';

import type { ConversionDayRow } from '@/lib/reports/graphs';

interface Props {
  data: ConversionDayRow[];
  windowLabel: string;
}

interface TooltipRow {
  payload?: ConversionDayRow;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipRow[];
  label?: string;
}

function ConversionTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.[0]?.payload) return null;
  const r = payload[0].payload;
  const day = label ? formatTickDay(label) : '';
  return (
    <div style={CHART_STYLES.tooltip.contentStyle}>
      <p className="font-medium text-foreground">{day}</p>
      <p className="mt-0.5 font-semibold text-base" style={{ color: CHART_PALETTE.tertiary }}>
        {r.conversionPct.toFixed(1)}%
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5">
        {r.ordersCount} orders / {r.quotationsCount} quotations
      </p>
    </div>
  );
}

export function ConversionTrendChart({ data, windowLabel }: Props) {
  const totalQuotations = data.reduce((s, r) => s + r.quotationsCount, 0);
  const totalOrders = data.reduce((s, r) => s + r.ordersCount, 0);
  const overall =
    totalQuotations > 0 ? (totalOrders / totalQuotations) * 100 : 0;
  const isEmpty = totalQuotations === 0 && totalOrders === 0;

  return (
    <ChartCard
      title="Conversion rate trend"
      subtitle="Orders ÷ quotations · per IST day"
      icon="percent"
      badge={
        totalQuotations > 0
          ? `Overall ${overall.toFixed(1)}%`
          : '—'
      }
      isEmpty={isEmpty}
      emptyHint={`No quotations or orders in ${windowLabel}.`}
    >
      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
        >
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
            tickFormatter={(v: number) => `${v}%`}
            tickLine={false}
            axisLine={false}
            width={42}
            domain={[0, 100]}
            tick={CHART_STYLES.axis.tick}
          />
          <Tooltip
            content={<ConversionTooltip />}
            cursor={CHART_STYLES.tooltip.cursor}
          />
          <Line
            type="monotone"
            dataKey="conversionPct"
            stroke={CHART_PALETTE.tertiary}
            strokeWidth={2.5}
            dot={{ r: 3, strokeWidth: 0, fill: CHART_PALETTE.tertiary }}
            activeDot={{ r: 5, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
