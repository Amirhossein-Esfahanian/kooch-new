"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

type TrendItem = { date: string; count: number };
type PropertyItem = { propertyId: number; propertyName: string; count: number };

type AdminReportChartProps =
  | {
      kind: "trend";
      data: TrendItem[];
      formatDate: (value: string) => string;
    }
  | {
      kind: "properties";
      data: PropertyItem[];
    };

const number = (value: number) => value.toLocaleString("fa-IR");

function PropertyAxisTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
}) {
  return (
    <foreignObject x={x - 172} y={y - 24} width={164} height={48}>
      <div className="flex h-full items-center justify-end text-right text-[11px] leading-4 text-muted-foreground" dir="rtl">
        {payload?.value}
      </div>
    </foreignObject>
  );
}

function BarCountLabel({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  value,
}: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string;
}) {
  const count = Number(value);
  if (!Number.isFinite(count)) return null;

  return (
    <text
      x={Number(x) + Number(width) + 8}
      y={Number(y) + Number(height) / 2}
      dy="0.35em"
      fill="var(--muted-foreground)"
      fontSize={11}
      textAnchor="start"
    >
      {number(count)}
    </text>
  );
}

function ReportTooltip({
  active,
  payload,
  kind,
  formatDate,
}: TooltipContentProps & {
  kind: AdminReportChartProps["kind"];
  formatDate?: (value: string) => string;
}) {
  const item = payload[0]?.payload as TrendItem | PropertyItem | undefined;
  if (!active || !item) return null;

  const title = kind === "trend"
    ? formatDate?.((item as TrendItem).date)
    : (item as PropertyItem).propertyName;

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-right text-xs text-popover-foreground shadow-lg" dir="rtl">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-muted-foreground">تعداد رزرو: {number(item.count)}</p>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="grid min-h-64 place-items-center rounded-lg bg-muted px-4 text-center text-sm text-muted-foreground" role="status">
      داده‌ای برای نمایش نمودار وجود ندارد.
    </div>
  );
}

export function AdminReportChart(props: AdminReportChartProps) {
  if (props.data.length === 0) return <EmptyChart />;

  if (props.kind === "trend") {
    return (
      <div className="h-72 min-w-0 w-full" role="img" aria-label="نمودار روند ایجاد رزروها" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={props.data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={props.formatDate}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={24}
              tickMargin={10}
              height={38}
            />
            <YAxis
              allowDecimals={false}
              tickFormatter={number}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={42}
            />
            <Tooltip
              content={(tooltipProps) => (
                <ReportTooltip {...tooltipProps} kind="trend" formatDate={props.formatDate} />
              )}
              cursor={{ stroke: "var(--border)" }}
            />
            <Line
              dataKey="count"
              type="linear"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={{ fill: "var(--card)", stroke: "var(--primary)", strokeWidth: 2, r: 2.5 }}
              activeDot={{ fill: "var(--primary)", r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const chartHeight = Math.max(272, props.data.length * 56);

  return (
    <div className="min-w-0 w-full overflow-x-hidden" role="img" aria-label="نمودار تفکیک اقامتگاه" dir="ltr">
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={props.data} layout="vertical" margin={{ top: 8, right: 48, bottom: 4, left: 8 }} barCategoryGap="28%">
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            allowDecimals={false}
            domain={[0, (dataMax: number) => Math.max(1, Math.ceil(dataMax * 1.15))]}
            tickFormatter={number}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            type="category"
            dataKey="propertyName"
            interval={0}
            tick={<PropertyAxisTick />}
            tickLine={false}
            axisLine={false}
            width={180}
          />
          <Tooltip
            content={(tooltipProps) => <ReportTooltip {...tooltipProps} kind="properties" />}
            cursor={{ fill: "var(--muted)" }}
          />
          <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 4, 4]} isAnimationActive={false}>
            <LabelList dataKey="count" content={<BarCountLabel />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
