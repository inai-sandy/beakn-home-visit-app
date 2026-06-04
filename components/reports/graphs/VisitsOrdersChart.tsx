'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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

import type { TwoSeriesDayRow } from '@/lib/reports/graphs';

interface Props {
  data: TwoSeriesDayRow[];
  windowLabel: string;
}

interface TooltipRow {
  payload?: TwoSeriesDayRow;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipRow[];
  label?: string;
}

function VisitsTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.[0]?.payload) return null;
  const { a: visits, b: orders } = payload[0].payload;
  const day = label ? formatTickDay(label) : '';
  return (
    <div style={CHART_STYLES.tooltip.contentStyle}>
      <p className="font-medium text-foreground">{day}</p>
      <p className="mt-1 flex items-center gap-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm"
          style={{ background: CHART_PALETTE.secondary }}
        />
        <span>Visits</span>
        <span className="ml-auto font-semibold">{visits}</span>
      </p>
      <p className="flex items-center gap-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm"
          style={{ background: CHART_PALETTE.success }}
        />
        <span>Orders</span>
        <span className="ml-auto font-semibold">{orders}</span>
      </p>
    </div>
  );
}

export function VisitsOrdersChart({ data, windowLabel }: Props) {
  const totalVisits = data.reduce((s, r) => s + r.a, 0);
  const totalOrders = data.reduce((s, r) => s + r.b, 0);
  const isEmpty = totalVisits === 0 && totalOrders === 0;

  return (
    <ChartCard
      title="Visits & orders by day"
      subtitle="Distinct request counts per IST day"
      icon="bar_chart"
      badge={`${totalVisits} visits · ${totalOrders} orders`}
      isEmpty={isEmpty}
      emptyHint={`No visits or orders completed in ${windowLabel}.`}
    >
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
          barCategoryGap="20%"
        >
          <CartesianGrid
            stroke={CHART_STYLES.grid.stroke}
            strokeDasharray={CHART_STYLES.grid.strokeDasharray}
            vertical={false}
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
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={32}
            tick={CHART_STYLES.axis.tick}
          />
          <Tooltip
            content={<VisitsTooltip />}
            cursor={CHART_STYLES.tooltip.cursor}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value) =>
              value === 'a' ? 'Visits completed' : 'Orders confirmed'
            }
          />
          <Bar
            dataKey="a"
            fill={CHART_PALETTE.secondary}
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="b"
            fill={CHART_PALETTE.success}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
