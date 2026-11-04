"use client";
import { useState } from "react";
import { money } from "@/lib/demo";

const chartValues = [
  "4800000",
  "4920000",
  "4860000",
  "5240000",
  "5180000",
  "5680000",
  "5540000",
  "6080000",
  "5920000",
  "6340000",
  "6780000",
  "6428000",
];
export function CashflowChart() {
  const [period, setPeriod] = useState("Month");
  const [hover, setHover] = useState<number | null>(null);
  const points =
    period === "Month"
      ? "0,145 50,138 100,142 150,116 200,120 250,90 300,100 350,70 400,80 450,55 500,30 550,48"
      : "0,160 50,154 100,142 150,140 200,114 250,126 300,93 350,100 400,65 450,74 500,35 550,48";
  return (
    <section className="panel cashflow-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">THE BIG PICTURE</span>
          <h2>Money in motion</h2>
        </div>
        <div className="segmented" aria-label="Chart period">
          {["Month", "Year"].map((value) => (
            <button
              key={value}
              aria-pressed={period === value}
              className={period === value ? "active" : ""}
              onClick={() => {
                setPeriod(value);
                setHover(null);
              }}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-legend">
        <span>
          <i className="legend-dot" />
          Money in
        </span>
        <span>
          <i className="legend-dot muted" />
          Money out
        </span>
        <span className="chart-value">
          {hover === null
            ? "Illustrative cash flow"
            : `${period === "Month" ? "Day" : "Month"} ${hover + 1}: ${money(chartValues[hover])}`}
        </span>
      </div>
      <div className="cashflow-chart">
        <div className="y-axis">
          <span>$70k</span>
          <span>$50k</span>
          <span>$30k</span>
        </div>
        <div className="plot">
          <svg
            viewBox="0 0 550 200"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${period} illustrative cash flow chart, rising from $48,000 to $64,280`}
          >
            <defs>
              <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#91704f" stopOpacity=".19" />
                <stop offset="100%" stopColor="#91704f" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 25H550M0 95H550M0 165H550" className="chart-grid" />
            <polygon
              points={`0,200 ${points} 550,200`}
              fill="url(#chart-fill)"
            />
            <polyline
              points="0,165 50,150 100,162 150,147 200,155 250,135 300,150 350,126 400,138 450,116 500,132 550,115"
              className="secondary-line"
            />
            <polyline points={points} className="primary-line" />
            {hover !== null && (
              <line
                x1={hover * 50}
                x2={hover * 50}
                y1="0"
                y2="200"
                className="chart-guide"
              />
            )}
          </svg>
          <div className="chart-hit-zones">
            {chartValues.map((amount, index) => (
              <button
                key={index}
                onPointerEnter={() => setHover(index)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
                onPointerLeave={() => setHover(null)}
                aria-label={`Sample ${index + 1}: ${money(amount)}`}
              />
            ))}
          </div>
          <div className="x-axis">
            {(period === "Month"
              ? ["OCT 01", "OCT 08", "OCT 15", "OCT 22", "OCT 31"]
              : ["JAN", "APR", "JUL", "OCT", "DEC"]
            ).map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
export function AllocationRing({ total = "6428000" }: { total?: string }) {
  return (
    <div className="allocation-ring">
      <svg
        viewBox="0 0 240 240"
        role="img"
        aria-label="Illustrative allocation: 50 percent payroll, 30 percent operations, 20 percent reserves"
      >
        <circle cx="120" cy="120" r="96" className="ring-track" />
        <circle
          cx="120"
          cy="120"
          r="96"
          stroke="#4b252e"
          strokeDasharray="292 604"
          strokeDashoffset="0"
        />
        <circle
          cx="120"
          cy="120"
          r="96"
          stroke="#ba8262"
          strokeDasharray="171 604"
          strokeDashoffset="-302"
        />
        <circle
          cx="120"
          cy="120"
          r="96"
          stroke="#d5c5ab"
          strokeDasharray="111 604"
          strokeDashoffset="-483"
        />
      </svg>
      <div>
        <span className="eyebrow">TOTAL ALLOCATED</span>
        <strong>{money(total, false)}</strong>
        <span>Illustrative distribution</span>
      </div>
    </div>
  );
}
