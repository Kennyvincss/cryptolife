// Minimal DOM helpers for the HUD, phone and panels.

import { isTyping } from '../engine/input.js';
import { on } from '../state.js';

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, any>;

export function h(sel: string, attrs?: Attrs | Child, ...children: Child[]): HTMLElement {
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const tag = m?.[1] || 'div';
  const el = document.createElement(tag);
  for (const part of (m?.[2] ?? '').match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs as Child); attrs = undefined; }
  for (const [k, v] of Object.entries((attrs as Attrs) ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  const add = (c: Child) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(add); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

/** Append children (arrays / null allowed). */
export function add(el: HTMLElement, ...children: Child[]) {
  const f = (c: Child) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(f); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(f);
  return el;
}

/** Re-render a view on store events (skips while the user is typing inside it). */
export function view(el: HTMLElement, render: (el: HTMLElement, rerender: () => void) => void, deps: string[] = ['me']) {
  let pending = false;
  let alive = true;
  let last = 0;
  let timer = 0;
  const rerender = () => {
    if (!alive) return;
    if (el.contains(document.activeElement) && isTyping()) { pending = true; return; }
    const now = performance.now();
    if (now - last < 250) { clearTimeout(timer); timer = window.setTimeout(rerender, 260); return; }
    last = now;
    pending = false;
    const scrolls = [...el.querySelectorAll('.scroll')].map((s) => s.scrollTop);
    const top = el.scrollTop;
    el.innerHTML = '';
    render(el, rerender);
    el.scrollTop = top;
    [...el.querySelectorAll('.scroll')].forEach((s, i) => (s.scrollTop = scrolls[i] ?? 0));
  };
  rerender();
  const offs = deps.map((d) => on(d, rerender));
  const blur = () => { if (pending) setTimeout(rerender, 50); };
  el.addEventListener('focusout', blur);
  return () => { alive = false; offs.forEach((o) => o()); el.removeEventListener('focusout', blur); };
}

const dataCache = new Map<string, { at: number; data: any; loading: boolean; err?: string }>();
/** Fetch-once-with-TTL data helper for views. */
export function useData<T>(key: string, fetcher: () => Promise<T>, ttl: number, rerender: () => void): { data?: T; err?: string } {
  const c = dataCache.get(key);
  const now = Date.now();
  if (!c || (!c.loading && now - c.at > ttl)) {
    const entry = { at: now, data: c?.data, loading: true, err: undefined as string | undefined };
    dataCache.set(key, entry);
    fetcher().then((d) => { entry.data = d; entry.loading = false; entry.at = Date.now(); rerender(); })
      .catch((e) => { entry.err = e.message; entry.loading = false; rerender(); });
  }
  const cur = dataCache.get(key)!;
  return { data: cur.data, err: cur.err };
}
export function invalidate(prefix: string) { for (const k of [...dataCache.keys()]) if (k.startsWith(prefix)) dataCache.delete(k); }

export function btn(label: string, onclick: () => unknown, cls = '', disabled = false) {
  return h('button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { onclick: async (e: Event) => { e.stopPropagation(); const b = e.currentTarget as HTMLButtonElement; b.disabled = true; try { await onclick(); } finally { b.disabled = false; } }, disabled }, label);
}

export function field(label: string, input: HTMLElement) {
  return h('label.field', h('span', label), input);
}
export function input(attrs: Attrs) { return h('input', { autocomplete: 'off', ...attrs }) as HTMLInputElement; }
export function select(options: [string, string][], value: string, onchange?: (v: string) => void) {
  const s = h('select', { onchange: (e: Event) => onchange?.((e.target as HTMLSelectElement).value) }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l))) as HTMLSelectElement;
  return s;
}
export function badge(text: string, cls = '') { return h('span.badge' + (cls ? '.' + cls : ''), text); }
export const SIM = () => badge('SIM', 'sim');
