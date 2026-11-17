/**
 * Chart.js 공통 설정 — 색은 CSS 토큰에서 읽어 라이트/다크 모드 모두 대응.
 * 규칙: 얇은 막대(둥근 끝 4px), 2px 선, 가는 실선 격자, 호버 툴팁, 2계열 이상이면 범례.
 */
import {
  BarController, BarElement, CategoryScale, Chart, Filler, Legend, LinearScale, LineController, LineElement,
  PointElement, Tooltip, type ChartConfiguration, type ChartDataset,
} from 'chart.js';

Chart.register(BarController, BarElement, CategoryScale, Filler, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip);

const live: Chart[] = [];

export function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export const SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7'];

export function destroyCharts() {
  while (live.length) live.pop()!.destroy();
}

export interface ChartOpts {
  yTitle?: string;
  xTitle?: string;
  yMin?: number;
  yMax?: number;
  legend?: boolean;
  /** 툴팁 값 포맷 */
  format?: (v: number) => string;
  /** x축 눈금 간격 자동 생략 */
  autoSkip?: boolean;
  stacked?: boolean;
}

export function mount(
  host: HTMLElement | null,
  type: 'bar' | 'line',
  labels: (string | number)[],
  datasets: ChartDataset<'bar' | 'line', unknown[]>[],
  o: ChartOpts = {},
): Chart | null {
  if (!host) return null;
  host.innerHTML = '';
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  const ink2 = css('--ink-2');
  const muted = css('--muted');
  const grid = css('--grid');
  const axis = css('--axis');
  const font = { family: getComputedStyle(document.body).fontFamily, size: 11 };
  const fmt = o.format ?? ((v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3)));
  const cfg: ChartConfiguration<'bar' | 'line', unknown[], string | number> = {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 4, right: 4 } },
      plugins: {
        legend: {
          display: o.legend ?? datasets.length > 1,
          position: 'top',
          align: 'start',
          labels: {
            color: ink2, font, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', padding: 10,
            // 대칭 기준선의 아래쪽(−)은 범례에서 생략
            filter: (item) => !item.text.startsWith('−'),
          },
        },
        tooltip: {
          backgroundColor: css('--ink'),
          titleColor: css('--page'),
          bodyColor: css('--page'),
          titleFont: { ...font, weight: 'bold' },
          bodyFont: font,
          padding: 8,
          cornerRadius: 8,
          boxPadding: 4,
          filter: (item) => item.raw != null && !String(item.dataset.label).startsWith('−'),
          callbacks: {
            label: (ctx) => {
              const raw = ctx.raw as number | [number, number] | { y: number };
              const v = Array.isArray(raw) ? `${fmt(raw[0])} ~ ${fmt(raw[1])}` : fmt(typeof raw === 'number' ? raw : raw.y);
              return ` ${ctx.dataset.label}: ${v}`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: o.stacked,
          grid: { display: false },
          border: { color: axis },
          ticks: { color: muted, font, autoSkip: o.autoSkip ?? true, maxRotation: 0 },
          title: o.xTitle ? { display: true, text: o.xTitle, color: muted, font } : undefined,
        },
        y: {
          stacked: o.stacked,
          min: o.yMin,
          max: o.yMax,
          grid: { color: grid },
          border: { display: false },
          ticks: { color: muted, font, maxTicksLimit: 6 },
          title: o.yTitle ? { display: true, text: o.yTitle, color: muted, font } : undefined,
        },
      },
    },
  };
  const chart = new Chart(canvas, cfg as ChartConfiguration);
  live.push(chart);
  return chart;
}

/** 막대 계열 (얇은 막대, 둥근 끝) */
export function bars(label: string, data: unknown[], color: string | string[], extra: Record<string, unknown> = {}) {
  return {
    type: 'bar' as const,
    label,
    data,
    backgroundColor: color,
    borderRadius: 4,
    borderSkipped: 'start' as const,
    categoryPercentage: 0.8,
    barPercentage: 0.9,
    order: 2,
    ...extra,
  };
}

/** 선 계열 (2px) */
export function line(label: string, data: unknown[], color: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'line' as const,
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0,
    order: 1,
    ...extra,
  };
}

/** 수평 기준선 (예: 기대값, ±2σ) */
export function refLine(label: string, value: number, n: number, color: string, width = 1.5) {
  return line(label, new Array(n).fill(value), color, { borderWidth: width, pointHoverRadius: 0 });
}
