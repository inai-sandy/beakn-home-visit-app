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
  CHART_SERIES,
  CHART_STYLES,
} from './chart-theme';

import type { FunnelStageRow } from '@/lib/reports/graphs';

interface Props {
  data: FunnelStageRow[];
  windowLabel: string;
}

interface TooltipRow {
  payload?: FunnelStageRow;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipRow[];
}

function FunnelTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.[0]?.payload) return null;
  const r = payload[0].payload;
  return (
    <div style={CHART_STYLES.tooltip.contentStyle}>
      <p className="font-medium text-foreground">{r.stageName}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">
        Stage {r.sequence}
      </p>
      <p className="mt-1 font-semibold">
        {r.requestsReached.toLocaleString('en-IN')} request
        {r.requestsReached === 1 ? '' : 's'} reached
      </p>
    </div>
  );
}

export function StatusFunnelChart({ data, windowLabel }: Props) {
  const top = data[0]?.requestsReached ?? 0;
  const isEmpty = data.every((r) => r.requestsReached === 0);

  return (
    <ChartCard
      title="Status funnel"
      subtitle="Distinct requests that reached each stage"
      icon="route"
      badge={`Top stage: ${top}`}
      isEmpty={isEmpty}
      emptyHint={`No status transitions in ${windowLabel}.`}
      bodyMinHeight={360}
    >
      <ResponsiveContainer width="100%" height={Math.max(360, data.length * 32)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
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
            dataKey="stageName"
            tickLine={false}
            axisLine={false}
            width={170}
            tick={{ ...CHART_STYLES.axis.tick, fontSize: 11 }}
          />
          <Tooltip
            content={<FunnelTooltip />}
            cursor={CHART_STYLES.tooltip.cursor}
          />
          <Bar
            dataKey="requestsReached"
            radius={[0, 6, 6, 0]}
            label={{
              position: 'right',
              fontSize: 11,
              fill: 'rgba(100, 116, 139, 0.85)',
            }}
          >
            {data.map((_row, idx) => (
              <Cell
                key={idx}
                fill={CHART_SERIES[idx % CHART_SERIES.length]}
                fillOpacity={
                  // Progressive fade so the funnel "feels" like a funnel.
                  1 - Math.min(0.5, idx * 0.05)
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
