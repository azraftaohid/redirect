import React, { useState, useRef, useEffect } from "react";
import type { DailyClickPoint } from "@/utils/stats";
import { formatUtcDay } from "@/utils/stats";

interface DailyChartProps {
  data: DailyClickPoint[];
  days: number;
}

export function DailyChart({ data, days }: DailyChartProps): React.ReactElement {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(max-width: 640px)").matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(max-width: 640px)");
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  if (!data || data.length === 0) {
    return (
      <div className="h-48 sm:h-60 flex items-center justify-center text-xs text-zinc-400">
        No timeseries data available
      </div>
    );
  }

  // Adjust aspect ratio and height for mobile screens so graph doesn't render too small
  const width = isMobile ? 480 : 800;
  const height = isMobile ? 280 : 260;
  const paddingLeft = isMobile ? 36 : 45;
  const paddingRight = isMobile ? 12 : 20;
  const paddingTop = isMobile ? 20 : 25;
  const paddingBottom = isMobile ? 30 : 35;

  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const rawMax = Math.max(...data.map((d) => d.clicks));
  // Round max up to neat round number
  const maxClicks = Math.max(5, Math.ceil(rawMax * 1.15));

  const isAreaChart = days > 30;

  // Coordinate mapping
  const getX = (index: number) => {
    if (data.length === 1) return paddingLeft + plotWidth / 2;
    return paddingLeft + (index / (data.length - 1)) * plotWidth;
  };

  const getY = (clicks: number) => {
    return paddingTop + plotHeight - (clicks / maxClicks) * plotHeight;
  };

  // Pointer interaction
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (clientX - paddingLeft * (rect.width / width)) / (plotWidth * (rect.width / width))));
    const index = Math.round(ratio * (data.length - 1));
    if (index >= 0 && index < data.length) {
      setHoverIndex(index);
    }
  };

  const handlePointerLeave = () => {
    setHoverIndex(null);
  };

  // Build SVG path for Area Chart
  const linePoints = data.map((d, i) => `${getX(i)},${getY(d.clicks)}`).join(" L ");
  const linePath = `M ${linePoints}`;
  const areaPath = `M ${getX(0)},${paddingTop + plotHeight} L ${linePoints} L ${getX(
    data.length - 1
  )},${paddingTop + plotHeight} Z`;

  // X Axis tick intervals
  const tickCount = Math.min(isMobile ? 4 : 6, data.length);
  const tickStep = Math.max(1, Math.floor((data.length - 1) / (tickCount - 1)));
  const xTicks: number[] = [];
  for (let i = 0; i < data.length; i += tickStep) {
    xTicks.push(i);
  }
  if (!xTicks.includes(data.length - 1)) {
    xTicks.push(data.length - 1);
  }

  const activePoint = hoverIndex !== null ? data[hoverIndex] : null;
  const activeX = hoverIndex !== null ? getX(hoverIndex) : 0;
  const activeY = activePoint ? getY(activePoint.clicks) : 0;

  return (
    <div className="relative w-full select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible cursor-crosshair touch-none"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <defs>
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" className="text-zinc-900 dark:text-zinc-100" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.0" className="text-zinc-900 dark:text-zinc-100" />
          </linearGradient>
        </defs>

        {/* Y Grid lines */}
        {[0, 0.5, 1].map((pct) => {
          const y = paddingTop + plotHeight * (1 - pct);
          const val = Math.round(maxClicks * pct);
          return (
            <g key={pct}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={width - paddingRight}
                y2={y}
                stroke="currentColor"
                strokeDasharray="4 4"
                className="text-zinc-200 dark:text-zinc-800"
                strokeWidth="1"
              />
              <text
                x={paddingLeft - 8}
                y={y + 3}
                textAnchor="end"
                className="text-[10px] fill-zinc-400 font-mono select-none"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* X Axis ticks & labels */}
        {xTicks.map((i) => {
          const pt = data[i];
          if (!pt) return null;
          const x = getX(i);
          return (
            <text
              key={i}
              x={x}
              y={height - 10}
              textAnchor="middle"
              className="text-[10px] fill-zinc-400 font-mono select-none"
            >
              {formatUtcDay(pt.day)}
            </text>
          );
        })}

        {/* Chart Body: Area Chart or Bar Chart */}
        {isAreaChart ? (
          <g>
            <path d={areaPath} fill="url(#areaGradient)" />
            <path
              d={linePath}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-zinc-900 dark:text-zinc-100"
            />
          </g>
        ) : (
          <g>
            {data.map((d, i) => {
              const xCenter = getX(i);
              const barWidth = Math.max(4, Math.min(24, (plotWidth / data.length) * 0.7));
              const x = xCenter - barWidth / 2;
              const y = getY(d.clicks);
              const barHeight = Math.max(1, paddingTop + plotHeight - y);
              const isHovered = hoverIndex === i;

              return (
                <rect
                  key={d.day}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx="3"
                  className={
                    isHovered
                      ? "fill-zinc-950 dark:fill-zinc-50 transition-colors"
                      : "fill-zinc-300 dark:fill-zinc-700 hover:fill-zinc-500 dark:hover:fill-zinc-400 transition-colors"
                  }
                />
              );
            })}
          </g>
        )}

        {/* Hover Guide & Dot */}
        {hoverIndex !== null && activePoint && (
          <g pointerEvents="none">
            <line
              x1={activeX}
              y1={paddingTop}
              x2={activeX}
              y2={paddingTop + plotHeight}
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-zinc-400 dark:text-zinc-500"
              strokeDasharray="2 2"
            />
            <circle
              cx={activeX}
              cy={activeY}
              r="4.5"
              className="fill-white dark:fill-zinc-900 stroke-zinc-900 dark:stroke-zinc-100"
              strokeWidth="2.5"
            />
          </g>
        )}
      </svg>

      {/* Floating Scrub Tooltip */}
      {hoverIndex !== null && activePoint && (
        <div
          className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs rounded-lg px-2.5 py-1.5 shadow-lg border border-zinc-700 dark:border-zinc-300 z-10 transition-transform duration-75 flex flex-col items-center gap-0.5 whitespace-nowrap"
          style={{
            left: `${(activeX / width) * 100}%`,
            top: `${Math.max(10, (activeY / height) * 100 - 8)}%`,
          }}
        >
          <span className="font-semibold text-xs">
            {activePoint.clicks.toLocaleString()} {activePoint.clicks === 1 ? "click" : "clicks"}
          </span>
          <span className="text-[10px] opacity-75 font-mono">
            {formatUtcDay(activePoint.day)}
          </span>
        </div>
      )}
    </div>
  );
}
