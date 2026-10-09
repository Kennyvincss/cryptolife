// HUD: identity (top-left), money (top-right), minimap (bottom-left), contextual
// prompts (bottom-right), chat, toasts, phone shell and panel host.

import { levelFromXp, xpForLevel } from '../../shared/catalog.js';
import { DISTRICTS, districtAt } from '../../shared/city.js';
import { music } from '../audio/music.js';
import { act } from '../net/client.js';
import { clockString, emit, fmt, on, portfolioValue, store } from '../state.js';
import type { Interactable } from '../systems/interact.js';
import { labelOf } from '../systems/interact.js';
import { APP_BY_ID, APPS, type AppCtx } from './apps.js';
import { run, toast } from './components.js';
import { SIM, add, h, view } from './dom.js';
import { drawFullMap, drawMinimap, type MapMarks } from './map.js';
import { PANELS } from './panels.js';

export class HUD {
  root: HTMLElement;
  private idEl: HTMLElement;
  private moneyEl: HTMLElement;
  private promptsEl: HTMLElement;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private locEl: HTMLElement;
  private speedEl: HTMLElement;
  private chatLog: HTMLElement;
  private chatInput: HTMLInputElement;
  private chatCh: 'nearby' | 'zone' = 'nearby';
  private phoneEl: HTMLElement;
  private phoneBody: HTMLElement;
  private phoneTitle: HTMLElement;
  private panelEl: HTMLElement;
  private panelBody: HTMLElement;
  private panelTitle: HTMLElement;
  private mapEl: HTMLElement;
  private helpEl: HTMLElement;
  private rideEl: HTMLElement;
  private wpEl: HTMLElement;
  private reactEl: HTMLElement;
  private unmountPhone: (() => void) | null = null;
  private unmountPanel: (() => void) | null = null;
  private currentPanel: string | null = null;
  phoneOpen = false;
  panelOpen = false;
  mapOpen = false;
  chatOpen = false;
  onMapClick?: (x: number, z: number) => void;
  mapMarks: () => MapMarks = () => ({ player: { x: 0, z: 0, heading: 0 } });

  constructor() {
    this.root = h('div#hud');
    document.body.append(this.root);
    this.idEl = h('div.hud-id');
    this.moneyEl = h('div.hud-money');
    this.promptsEl = h('div.hud-prompts');
    this.mini = h('canvas.minimap', { width: 220, height: 220 }) as HTMLCanvasElement;
    this.miniCtx = this.mini.getContext('2d')!;
    this.locEl = h('div.hud-loc');
    this.speedEl = h('div.hud-speed');
    this.rideEl = h('div.hud-ride');
    this.wpEl = h('div.hud-wp');
    this.reactEl = h('div.reacts');
    this.chatLog = h('div.chat-log');
    this.chatInput = h('input.chat-input', { placeholder: 'Say something… (Enter to send, Tab to switch channel)', maxlength: 300 }) as HTMLInputElement;
    const chatCh = h('span.chat-ch', 'NEARBY');
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const t = this.chatInput.value.trim();
        if (t) run(act('chat.send', { ch: this.chatCh, text: t }));
        this.chatInput.value = '';
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
      else if (e.key === 'Tab') { e.preventDefault(); this.chatCh = this.chatCh === 'nearby' ? 'zone' : 'nearby'; chatCh.textContent = this.chatCh === 'nearby' ? 'NEARBY' : 'VENUE'; }
      e.stopPropagation();
    });
    const chat = h('div.chat', this.chatLog, h('div.chat-row', chatCh, this.chatInput));

    this.phoneTitle = h('div.ph-title');
    this.phoneBody = h('div.ph-body.scroll');
    this.phoneEl = h('div.phone',
      h('div.ph-notch'),
      h('div.ph-status', h('span.ph-clock'), h('span', '5G ▮▮▮ 🔋')),
      h('div.ph-head', h('button.ph-back', { onclick: () => this.openApp(null) }, '‹'), this.phoneTitle, h('button.ph-x', { onclick: () => this.togglePhone(false) }, '✕')),
      this.phoneBody,
      h('div.ph-home', { onclick: () => this.openApp(null) }));
    this.panelTitle = h('div.pn-title');
    this.panelBody = h('div.pn-body.scroll');
    this.panelEl = h('div.panel', h('div.pn-head', this.panelTitle, h('button.pn-x', { onclick: () => this.closePanel() }, '✕')), this.panelBody);
    this.mapEl = h('div.bigmap');
    this.helpEl = h('div.help', h('h3', 'Crypto City — controls'), h('pre', 'WASD move · Shift run · Space jump\nMouse look (click the world to lock, Esc to unlock) · Wheel zoom\nE / R — interact (shown bottom-right)\nF — enter / exit vehicles, board rides\nP — phone · M — map · T — chat · H — this help\n1 wave · 2 dance · 3 phone · 4 talk · C reset camera\n\nIn a car: W/S throttle/brake/reverse · A/D steer · Space handbrake · L lights'), h('small.muted', 'Everything with money uses SIMULATED currency.'));
    this.helpEl.style.display = 'none';

    add(this.root,
      h('div.tl', this.idEl),
      h('div.tr', this.moneyEl, h('div#toasts')),
      h('div.bl', this.locEl, this.mini, chat),
      h('div.br', this.speedEl, this.promptsEl),
      this.rideEl, this.wpEl, this.reactEl,
      this.phoneEl, this.panelEl, this.mapEl, this.helpEl,
      h('div.hint', 'P phone · M map · T chat · H help'),
      h('div#fade'),
    );

    on('me', () => this.renderTop());
    on('prices', () => this.renderMoney());
    on('notify', (m: any) => toast(m.text, m.kind));
    on('chat', (m: any) => this.addChat(m));
    on('react', (m: any) => this.addReact(m.emoji, m.from));
    on('invite', (m: any) => this.invite(m));
    on('net', (ok: boolean) => { if (!ok) toast('Connection lost — reconnecting…', 'warn'); });
    this.renderTop();
  }

  renderTop() {
    const me = store.me;
    if (!me) return;
    const lvl = levelFromXp(me.xp);
    const pct = Math.min(100, ((me.xp - xpForLevel(lvl)) / (xpForLevel(lvl + 1) - xpForLevel(lvl))) * 100);
    this.idEl.innerHTML = '';
    add(this.idEl,
      h('div.avatar', { style: { background: me.look.colors.top ?? '#334' } }, me.username[0].toUpperCase()),
      h('div', h('b', '@' + me.username), h('div.muted', me.career), h('div', `Lv ${lvl} `, h('span.bar.small', h('i', { style: { width: pct + '%' } })), ` · Rep ${me.reputation}`),
        h('div.buffs', me.buffs.rested > Date.now() ? h('span', { title: 'Well rested +10% XP' }, '😴+') : null, me.buffs.fed > Date.now() ? h('span', { title: 'Well fed +10% XP' }, '🍽+') : null, me.job ? h('span', '💼 ' + me.job.title) : null)));
    this.renderMoney();
  }
  renderMoney() {
    const me = store.me;
    if (!me) return;
    this.moneyEl.innerHTML = '';
    add(this.moneyEl, h('div.cash', fmt.usd(me.cash), ' ', SIM()), h('div.port', 'Portfolio ', fmt.usd(portfolioValue())), h('div.clock', '🕒 ' + clockString() + ' · Day ' + store.clock.day));
  }

  setPrompts(items: Interactable[], extra: string[] = []) {
    const key = items.map((i) => i.key + labelOf(i)).join('|') + extra.join('|');
    if (this.promptsEl.dataset.k === key) return;
    this.promptsEl.dataset.k = key;
    this.promptsEl.innerHTML = '';
    add(this.promptsEl, items.map((i) => h('div.prompt', h('kbd', i.key), labelOf(i))), extra.map((e) => h('div.prompt', h('kbd', e.split(' ')[0]), e.split(' ').slice(1).join(' '))));
  }

  setSpeed(kmh: number | null, condition?: number) {
    this.speedEl.style.display = kmh === null ? 'none' : 'block';
    if (kmh !== null) this.speedEl.innerHTML = `<b>${Math.round(kmh)}</b><small>km/h</small>${condition !== undefined ? `<div class="cond">condition ${Math.round(condition)}%</div>` : ''}`;
  }

  frame(marks: MapMarks, yaw: number, zone: string, zoneLabel: string) {
    drawMinimap(this.miniCtx, 220, marks, yaw);
    const d = zone === 'street' ? districtAt(marks.player.x, marks.player.z) : null;
    const loc = zone === 'street' ? (d ? DISTRICTS[d].name : 'City outskirts') : zoneLabel;
    if (this.locEl.textContent !== loc) this.locEl.textContent = loc;
    if (this.mapOpen) this.renderMap();
    const pc = this.phoneEl.querySelector('.ph-clock');
    if (pc) pc.textContent = clockString();
    // ride widget
    const r = store.me?.ride;
    const show = r && !['completed', 'cancelled'].includes(r.status);
    this.rideEl.style.display = show ? 'block' : 'none';
    if (show && r) {
      const txt = r.role === 'rider' ? `🚕 ${r.status === 'searching' ? 'Finding driver…' : r.status === 'assigned' ? `${r.driverName} is coming` : r.status === 'arrived' ? 'Driver arrived — press F near the car' : 'Riding to ' + r.destName}` : `🚗 ${r.status === 'searching' ? `Request: ${r.riderName} → ${r.destName} (${fmt.usd(r.fare)}) — open Drive app` : r.status === 'assigned' ? `Pick up ${r.riderName}` : `Drop off at ${r.destName}`}`;
      if (this.rideEl.textContent !== txt) this.rideEl.textContent = txt;
    }
  }

  setWaypointLabel(t: string | null) { this.wpEl.style.display = t ? 'block' : 'none'; if (t) this.wpEl.textContent = t; }

  // ---------------- phone ----------------
  togglePhone(open = !this.phoneOpen, app?: string, data?: any) {
    this.phoneOpen = open;
    this.phoneEl.classList.toggle('open', open);
    if (open) { this.openApp(app ?? null, data); emit('ui', true); }
    else { this.unmountPhone?.(); this.unmountPhone = null; emit('ui', false); }
  }
  openApp(id: string | null, data?: any) {
    this.unmountPhone?.();
    this.phoneBody.innerHTML = '';
    if (!id) {
      this.phoneTitle.textContent = 'Crypto City';
      add(this.phoneBody, h('div.ph-grid', APPS.map((a) => h('div.app', { onclick: () => this.openApp(a.id) }, h('div.ic', { style: { background: a.color } }, a.icon), h('small', a.name)))),
        h('div.ph-music', { onclick: () => this.openApp('music') }, '🎵 ', music.playing ? `${music.current().title} — ${music.current().artist}` : 'Music paused'));
      return;
    }
    const app = APP_BY_ID[id];
    this.phoneTitle.textContent = app.name;
    const ctx: AppCtx = { data, open: (a, d) => this.openApp(a, d), close: () => this.togglePhone(false), panel: false };
    this.unmountPhone = view(this.phoneBody, (el, rr) => app.render(el, rr, ctx), app.deps ?? ['me']);
  }

  // ---------------- panels ----------------
  openPanel(name: string, data?: any) {
    if (name.startsWith('phone:')) { this.togglePhone(true, name.slice(6), data); return; }
    if (name === 'bigmap') { this.toggleMap(true); return; }
    if (name === 'help') { this.toggleHelp(); return; }
    this.closePanel(true);
    const map: Record<string, string> = { trade: 'market', jobs: 'jobs', projects: 'projects', project: 'projects', airdrops: 'airdrops', dao: 'dao', events: 'events', news: 'news', profile: 'profile', garage: 'garage' };
    this.panelOpen = true;
    this.currentPanel = name;
    this.panelEl.classList.add('open');
    emit('ui', true);
    const ctx: AppCtx = { data, open: (a, d) => this.openPanel(a in PANELS ? a : 'app:' + a, d), close: () => this.closePanel(), panel: true };
    let appId = map[name];
    if (name.startsWith('app:')) appId = name.slice(4);
    if (appId) {
      const app = APP_BY_ID[appId];
      this.panelTitle.textContent = app.name;
      this.panelEl.classList.toggle('wide', appId === 'market');
      this.unmountPanel = view(this.panelBody, (el, rr) => app.render(el, rr, ctx), app.deps ?? ['me']);
      return;
    }
    const p = PANELS[name];
    if (!p) { this.closePanel(); return; }
    this.panelTitle.textContent = typeof p.title === 'function' ? p.title(data) : p.title;
    this.panelEl.classList.toggle('wide', !!p.wide);
    this.unmountPanel = view(this.panelBody, (el, rr) => p.render(el, rr, data, ctx), ['me']);
  }
  closePanel(silent = false) {
    if (!this.panelOpen) return;
    const p = this.currentPanel ? PANELS[this.currentPanel] : null;
    this.unmountPanel?.(); this.unmountPanel = null;
    this.panelOpen = false;
    this.panelEl.classList.remove('open');
    this.currentPanel = null;
    p?.onClose?.();
    if (!silent) emit('ui', false);
  }

  // ---------------- map ----------------
  toggleMap(open = !this.mapOpen) {
    this.mapOpen = open;
    this.mapEl.style.display = open ? 'block' : 'none';
    if (open) this.renderMap(true);
    emit('ui', open);
  }
  private mapCanvas: HTMLCanvasElement | null = null;
  private toWorld: ((x: number, y: number) => { x: number; z: number }) | null = null;
  renderMap(init = false) {
    if (init || !this.mapCanvas) {
      this.mapEl.innerHTML = '';
      this.mapCanvas = h('canvas', { width: Math.min(1100, innerWidth - 80), height: Math.min(820, innerHeight - 120) }) as HTMLCanvasElement;
      this.mapCanvas.addEventListener('click', (e) => {
        if (!this.toWorld) return;
        const r = this.mapCanvas!.getBoundingClientRect();
        const w = this.toWorld((e.clientX - r.left) * (this.mapCanvas!.width / r.width), (e.clientY - r.top) * (this.mapCanvas!.height / r.height));
        this.onMapClick?.(w.x, w.z);
      });
      add(this.mapEl, h('div.mh', h('b', 'CRYPTO CITY'), h('span.muted', ' — click to set a GPS waypoint · M to close'), h('button.pn-x', { onclick: () => this.toggleMap(false) }, '✕')), this.mapCanvas,
        h('div.legend', Object.values(DISTRICTS).map((d) => h('span', h('i', { style: { background: d.color } }), d.name))));
    }
    this.toWorld = drawFullMap(this.mapCanvas.getContext('2d')!, this.mapCanvas.width, this.mapCanvas.height, this.mapMarks());
  }

  toggleHelp() { this.helpEl.style.display = this.helpEl.style.display === 'none' ? 'block' : 'none'; }

  // ---------------- chat ----------------
  openChat() { this.chatOpen = true; this.root.classList.add('chatting'); this.chatInput.focus(); }
  closeChat() { this.chatOpen = false; this.root.classList.remove('chatting'); this.chatInput.blur(); }
  addChat(m: { ch: string; from: string; text: string }) {
    const ch = m.ch === 'nearby' ? 'NEARBY' : m.ch.startsWith('zone:') ? 'VENUE' : m.ch.startsWith('dm:') ? 'DM' : m.ch.split(':')[0].toUpperCase();
    const line = h('div.cl', h('span.ch', ch), h('b', ' @' + m.from + ': '), m.text);
    this.chatLog.append(line);
    while (this.chatLog.children.length > 40) this.chatLog.firstElementChild?.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    line.classList.add('fresh');
    setTimeout(() => line.classList.remove('fresh'), 12000);
    if (ch === 'DM' && m.from !== store.me?.username) toast(`💬 @${m.from}: ${m.text.slice(0, 80)}`, 'social');
  }
  systemChat(text: string) { this.addChat({ ch: 'system', from: 'city', text }); }

  addReact(emoji: string, from: string) {
    const e = h('div.react', { style: { left: 30 + Math.random() * 40 + '%' } }, emoji, h('small', '@' + from));
    this.reactEl.append(e);
    setTimeout(() => e.remove(), 3000);
  }

  private invite(m: { from: string; ownerId: string; text: string }) {
    const box = h('div.toast.invite', m.text, h('div', h('button.btn.primary.small', { onclick: () => { box.remove(); emit('acceptInvite', m.ownerId); } }, 'Visit'), h('button.btn.ghost.small', { onclick: () => box.remove() }, 'Dismiss')));
    document.getElementById('toasts')?.prepend(box);
    setTimeout(() => box.remove(), 30000);
  }

  fade(on: boolean) { document.getElementById('fade')!.classList.toggle('on', on); }
  get blocking() { return this.phoneOpen || this.panelOpen || this.mapOpen || this.chatOpen; }
}
