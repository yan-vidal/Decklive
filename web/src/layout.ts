// Posições dos elementos móveis (design D1): centro em proporção da janela, uma por orientação,
// só para quem foi movido. Sem entrada, o elemento fica onde o CSS padrão o põe.
import type { StorageLike } from './settings';

export type LayoutOrientation = 'landscape' | 'portrait';
export type FixedId = 'clock' | 'date' | 'place' | 'description';

export const LAYOUT_KEY = 'decklive.layout.v1';
export const FIXED_IDS: ReadonlyArray<FixedId> = ['clock', 'date', 'place', 'description'];
const ORIENTATIONS: ReadonlyArray<LayoutOrientation> = ['landscape', 'portrait'];

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export type Positions = { [id: string]: Point };

export interface LayoutData {
  landscape: Positions;
  portrait: Positions;
}

// Tela quadrada conta como deitada.
export function layoutOrientation(w: number, h: number): LayoutOrientation {
  return w >= h ? 'landscape' : 'portrait';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function unit(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? clamp(v, 0, 1) : null;
}

// Ao ler: só ids fixos com x e y numéricos, limitados a 0..1; o resto some.
export function validateLayout(raw: unknown): LayoutData {
  const out: LayoutData = { landscape: {}, portrait: {} };
  if (!raw || typeof raw !== 'object') return out;
  for (const o of ORIENTATIONS) {
    const side = (raw as Record<string, unknown>)[o];
    if (!side || typeof side !== 'object') continue;
    for (const id of FIXED_IDS) {
      const p = (side as Record<string, unknown>)[id] as Record<string, unknown> | undefined;
      if (!p || typeof p !== 'object') continue;
      const x = unit(p.x);
      const y = unit(p.y);
      if (x !== null && y !== null) out[o][id] = { x, y };
    }
  }
  return out;
}

// Canto superior esquerdo do elemento de tamanho `size` com o centro em `p`, sempre dentro da janela.
export function placeBox(p: Point, size: Size, view: Size): { left: number; top: number } {
  return {
    left: clamp(p.x * view.w - size.w / 2, 0, Math.max(0, view.w - size.w)),
    top: clamp(p.y * view.h - size.h / 2, 0, Math.max(0, view.h - size.h)),
  };
}

// Centro que de fato aparece: as setas encostadas na borda não acumulam deslocamento invisível.
export function clampCenter(p: Point, size: Size, view: Size): Point {
  const b = placeBox(p, size, view);
  return { x: (b.left + size.w / 2) / view.w, y: (b.top + size.h / 2) / view.h };
}

// Terço da janela onde o centro fica: 0, 1 ou 2.
export function third(v: number): number {
  return v < 1 / 3 ? 0 : v > 2 / 3 ? 2 : 1;
}

export type Align = 'left' | 'center' | 'right';
const ALIGNS: ReadonlyArray<Align> = ['left', 'center', 'right'];

// Valores CSS de um elemento movido. Cada eixo se prende pelo terço: borda perto (left/top ou
// right/bottom) ou centro (translate de -50%). Assim, quando o texto muda (outra foto, outro dia),
// ele cresce para longe da borda e o meio continua no meio.
export interface Anchored {
  left: string;
  right: string;
  top: string;
  bottom: string;
  transform: string;
  align: Align;
}

function px(v: number): string {
  return Math.round(v * 100) / 100 + 'px';
}

export function anchorBox(p: Point, size: Size, view: Size): Anchored {
  const b = placeBox(p, size, view);
  const cx = b.left + size.w / 2;
  const cy = b.top + size.h / 2;
  const tx = third(cx / view.w);
  const ty = third(cy / view.h);
  return {
    left: tx === 0 ? px(b.left) : tx === 1 ? px(cx) : 'auto',
    right: tx === 2 ? px(view.w - b.left - size.w) : 'auto',
    top: ty === 0 ? px(b.top) : ty === 1 ? px(cy) : 'auto',
    bottom: ty === 2 ? px(view.h - b.top - size.h) : 'auto',
    transform: 'translate(' + (tx === 1 ? '-50%' : '0') + ', ' + (ty === 1 ? '-50%' : '0') + ')',
    align: ALIGNS[tx],
  };
}

export class LayoutStore {
  private value: LayoutData;
  private listeners: ((l: LayoutData) => void)[] = [];

  constructor(private storage: StorageLike | null) {
    this.value = validateLayout(read(storage));
  }

  get(): LayoutData {
    return this.value;
  }

  position(o: LayoutOrientation, id: string): Point | null {
    const p = this.value[o][id];
    return p ? p : null;
  }

  // `save` false durante o arraste: vale na hora e só vai para o navegador no fim.
  set(o: LayoutOrientation, id: string, p: Point, save = true): void {
    this.value[o][id] = { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
    if (save) this.save();
    this.emit();
  }

  // Restaurar posições padrão: apaga os ids fixos nas duas orientações (as áreas ficam em outra chave).
  restore(): void {
    for (const o of ORIENTATIONS) for (const id of FIXED_IDS) delete this.value[o][id];
    this.save();
    this.emit();
  }

  // Ajustes recebidos de outra tela: troca todas as posições.
  replace(raw: unknown): void {
    this.value = validateLayout(raw);
    this.save();
    this.emit();
  }

  // Melhor esforço, como as preferências.
  save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(LAYOUT_KEY, JSON.stringify(this.value));
    } catch (e) {
      // Cota cheia ou bloqueio: segue só em memória.
    }
  }

  subscribe(fn: (l: LayoutData) => void): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.value);
  }
}

function read(storage: StorageLike | null): unknown {
  if (!storage) return null;
  try {
    const text = storage.getItem(LAYOUT_KEY);
    return text ? JSON.parse(text) : null;
  } catch (e) {
    return null;
  }
}

// --- Aplicação no DOM -------------------------------------------------------------------------

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Blocos de local e descrição de uma camada do palco.
export interface InfoBlocks {
  layer: HTMLElement;
  place: HTMLElement;
  desc: HTMLElement;
}

export interface LayoutElements {
  // #clock-box: coluna do padrão (relógio, data e aviso).
  column: HTMLElement;
  clock: HTMLElement;
  date: HTMLElement;
  notice: HTMLElement;
  // As duas camadas do palco, e a da frente (sem foto, a primeira).
  layers(): InfoBlocks[];
  front(): InfoBlocks;
}

// Classe de #app que esconde cada elemento pelos ajustes.
const HIDDEN_BY: { [id: string]: string } = {
  clock: 'no-clock',
  date: 'no-date',
  place: 'no-place',
  description: 'no-description',
};

// Classe de #app e prefixo das variáveis de cada camada, para local e descrição (design D2).
const INFO_VAR: { [id: string]: string } = { place: 'place', description: 'desc' };
const INFO_IDS: ReadonlyArray<FixedId> = ['place', 'description'];

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export class LayoutView {
  // Chamado depois de cada aplicação (o editor redesenha os contornos).
  onApply: (() => void) | null = null;

  constructor(
    private app: HTMLElement,
    private store: LayoutStore,
    private els: LayoutElements,
  ) {
    store.subscribe(() => this.apply());
  }

  // getBoundingClientRect mantém a fração: clientHeight arredonda (844,375 vira 844 num celular com DPR 3),
  // e os elementos presos pela borda de baixo ou da direita andariam menos que 1% por passo.
  view(): Size {
    const r = this.app.getBoundingClientRect();
    return { w: r.width || this.app.clientWidth || 1, h: r.height || this.app.clientHeight || 1 };
  }

  orientation(): LayoutOrientation {
    const v = this.view();
    return layoutOrientation(v.w, v.h);
  }

  shown(id: FixedId): boolean {
    return !this.app.classList.contains(HIDDEN_BY[id]);
  }

  element(id: FixedId): HTMLElement {
    if (id === 'clock') return this.els.clock;
    if (id === 'date') return this.els.date;
    const info = this.els.front();
    return id === 'place' ? info.place : info.desc;
  }

  rect(id: FixedId): Rect {
    return rectOf(this.element(id));
  }

  // Põe todos os elementos na posição da orientação atual.
  apply(): void {
    const o = this.orientation();
    const view = this.view();
    const clock = this.store.position(o, 'clock');
    // O aviso acompanha o relógio movido; no padrão, fica na coluna, abaixo da data.
    const notice = this.els.notice;
    const host = clock && this.shown('clock') ? this.els.clock : this.els.column;
    if (notice.parentNode !== host) host.appendChild(notice);
    this.place(this.els.clock, clock, view);
    this.place(this.els.date, this.store.position(o, 'date'), view);
    for (const id of INFO_IDS) this.app.classList.toggle(INFO_VAR[id] + '-moved', !!this.store.position(o, id));
    for (const blocks of this.els.layers()) this.applyLayer(blocks);
    if (this.onApply) this.onApply();
  }

  // Local e descrição de uma camada: o Stage chama antes de ela ir para a frente (texto novo).
  applyLayer(blocks: InfoBlocks): void {
    const o = this.orientation();
    const view = this.view();
    for (const id of INFO_IDS) {
      const p = this.store.position(o, id);
      if (p) this.placeInfo(blocks.layer, id === 'place' ? blocks.place : blocks.desc, INFO_VAR[id], p, view);
    }
  }

  // Novo centro (proporção da janela), limitado pelo tamanho atual do elemento.
  moveTo(id: FixedId, p: Point, save = true): void {
    const r = this.rect(id);
    const view = this.view();
    this.store.set(this.orientation(), id, clampCenter(p, { w: r.width, h: r.height }, view), save);
  }

  save(): void {
    this.store.save();
  }

  // Relógio e data: posição própria em #clock-box, que cobre a janela.
  private place(el: HTMLElement, p: Point | null, view: Size): void {
    const s = el.style;
    if (!p) {
      el.classList.remove('moved');
      s.left = s.right = s.top = s.bottom = s.transform = s.textAlign = '';
      return;
    }
    el.classList.add('moved');
    const r = rectOf(el);
    const a = anchorBox(p, { w: r.width, h: r.height }, view);
    s.left = a.left;
    s.right = a.right;
    s.top = a.top;
    s.bottom = a.bottom;
    s.transform = a.transform;
    s.textAlign = a.align;
  }

  // Local e descrição: a classe fica em #app e as variáveis em cada camada, medidas pelo texto dela.
  // Com uma variável só em #app, a foto seguinte (de outra altura) sairia do centro guardado ou
  // saltaria no começo do crossfade.
  private placeInfo(layer: HTMLElement, el: HTMLElement, name: string, p: Point, view: Size): void {
    const r = el.getBoundingClientRect();
    const a = anchorBox(p, { w: r.width, h: r.height }, view);
    const st = layer.style;
    const pre = '--dl-pos-' + name + '-';
    st.setProperty(pre + 'left', a.left);
    st.setProperty(pre + 'right', a.right);
    st.setProperty(pre + 'top', a.top);
    st.setProperty(pre + 'bottom', a.bottom);
    st.setProperty(pre + 'transform', a.transform);
    st.setProperty(pre + 'align', a.align);
  }
}
