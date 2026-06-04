'use client';

import {
  Bar,
  BarChart,
  Cell,
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
} from './chart-theme';

import type { ExecLeaderRow } from '@/lib/reports/graphs';

interface Props {
  data: ExecLeaderRow[];
  windowLabel: string;
  /** When the page is rendered in exec scope the bar reads "you" so the
   *  caller knows the chart is intentionally degraded. */
  isExecScope?: boolean;
}

interface TooltipRow {
  payload?: ExecLeaderRow;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipRow[];
}

function ExecTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.[0]?.payload) return null;
  const r = payload[0].payload;
  return (
    <div style={CHART_STYLES.tooltip.contentStyle}>
      <p className="font-medium text-foreground">{r.execName}</p>
      <p className="mt-1 flex items-center gap-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm"
          style={{ background: CHART_PALETTE.success }}
        />
        <span>Orders</span>
        <span className="ml-auto font-semibold">{r.ordersConfirmed}</span>
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5">
        {formatPaiseFull(r.revenuePaise)} revenue
      </p>
    </div>
  );
}

export function TopExecsChart({ data, windowLabel, isExecScope }: Props) {
  const isEmpty = data.length === 0;

  return (
    <ChartCard
      title={isExecScope ? 'Your performance' : 'Top execs by orders'}
      subtitle={
        isExecScope
          ? 'Orders confirmed in this window'
          : 'Top 5 execs · attributed via assigned_exec_user_id'
      }
      icon="emoji_events"
      badge={isEmpty ? undefined : `${data.length} ${isExecScope ? 'row' : 'execs'}`}
      isEmpty={isEmpty}
      emptyHint={`No orders confirmed in ${windowLabel}.`}
      bodyMinHeight={data.length === 0 ? 280 : Math.max(180, data.length * 56)}
    >
      <ResponsiveContainer
        width="100%"
        height={Math.max(180, data.length * 56)}
      >
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 24, left: 0, bottom: 0 }}
          barCategoryGap="22%"
        >
          <XAxis
            type="number"
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={CHART_STYLES.axis.tick}
          />
          <YAxis
            type="category"
            dataKey="execName"
            tickLine={false}
            axisLine={false}
            width={130}
            tick={{ ...CHART_STYLES.axis.tick, fontSize: 11 }}
          />
          <Tooltip
            content={<ExecTooltip />}
            cursor={CHART_STYLES.tooltip.cursor}
          />
          <Bar
            dataKey="ordersConfirmed"
            radius={[0, 6, 6, 0]}
            label={{
              position: 'right',
              fontSize: 12,
              fontWeight: 600,
              fill: 'rgba(15, 118, 110, 1)',
            }}
          >
            {data.map((_row, idx) => (
              <Cell
                key={idx}
                fill={CHART_PALETTE.success}
                fillOpacity={1 - Math.min(0.4, idx * 0.12)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
