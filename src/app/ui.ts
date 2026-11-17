/** 화면 조각 헬퍼 (문자열 템플릿) */

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const fx = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '–');
export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
export const pv = (p: number) => (p < 0.001 ? '<0.001' : p.toFixed(3));
export const won = (x: number) => `${Math.round(x).toLocaleString('ko-KR')}원`;
export const eok = (x: number, d = 1) => `${(x / 1e8).toFixed(d)}억`;

/** 판정 배지: 아이콘 + 짧은 글자 + p (색만으로 의미 전달하지 않음) */
export function badge(p: number, label: 'p' | 'q' = 'p', alpha = 0.05): string {
  return p < alpha
    ? `<span class="badge sig">! 유의 <small>${label} ${pv(p)}</small></span>`
    : `<span class="badge ok">✓ 무작위 <small>${label} ${pv(p)}</small></span>`;
}

function ballClass(n: number): string {
  if (n <= 10) return 'y';
  if (n <= 20) return 'b';
  if (n <= 30) return 'r';
  if (n <= 40) return 'g';
  return 'gr';
}

export function balls(nums: readonly number[], bonus?: number, size: '' | 'sm' | 'xs' = ''): string {
  const b = (n: number) => `<span class="ball ${ballClass(n)} ${size}">${n}</span>`;
  return `<div class="balls">${nums.map(b).join('')}${bonus ? `<span class="plus">+</span>${b(bonus)}` : ''}</div>`;
}

export function tile(label: string, value: string, note = ''): string {
  return `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
}

/** 카드: 제목 + (오른쪽) 배지 + 내용 + (선택) 접힌 이론 */
export function card(title: string, body: string, opts: { badge?: string; theory?: string; id?: string; cls?: string } = {}): string {
  return `<section class="card${opts.cls ? ` ${opts.cls}` : ''}"${opts.id ? ` id="${opts.id}"` : ''}>
    <div class="card-head"><h2>${title}</h2>${opts.badge ?? ''}</div>
    ${body}
    ${opts.theory ? `<details class="theory"><summary>이론</summary><div class="body">${opts.theory}</div></details>` : ''}
  </section>`;
}

/** 접이식 섹션 (검정 탭): 펼칠 때 차트를 그린다 */
export function section(id: string, title: string, badgeHtml: string, body: string, theoryHtml = ''): string {
  return `<details class="section" data-section="${id}">
    <summary><span class="s-title">${title}</span>${badgeHtml}</summary>
    <div class="s-body">${body}${theoryHtml ? `<details class="theory"><summary>이론</summary><div class="body">${theoryHtml}</div></details>` : ''}</div>
  </details>`;
}

export const formula = (s: string) => `<div class="formula">${esc(s)}</div>`;

export const chartBox = (id: string, size: '' | 'tall' | 'short' = '') => `<div class="chart ${size}" id="${id}" role="img"></div>`;

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);

export const loading = (msg = '계산 중…') => `<div class="loading"><div class="spinner"></div>${msg}</div>`;

/** 배경색 위의 글자색 */
export function inkOn(hex: string): string {
  const m = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#0b0b0b' : '#ffffff';
}

/** 두 hex 색 사이 보간 (t ∈ [0,1]) */
export function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
