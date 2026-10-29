// Palco: duas camadas alternadas por opacity, com carga e decodificação antes da troca.
// Cada camada tem a foto, o véu e os textos da foto; só a foto se move (design D4 e D5).
import type { Crop, PlaylistItem } from './api';
import type { InfoBlocks } from './layout';
import { orientationOf, type Orientation } from './screen';
import { Deck } from './shuffle';
import type { FitMode } from './settings';

// Movimento de câmera (design D4): ampliação no modo `fill`, redução no `fit` e
// deslocamento como fração da folga que a ampliação cria.
export const MOTION_ZOOM = 1.06;
export const FIT_ZOOM = 0.97;
export const MOTION_PAN = 0.6;

// Igual a --dl-crossfade.
export const CROSSFADE_MS = 600;
// Todas as fotos falharam: espera antes de tentar a volta de novo.
export const ALL_FAILED_RETRY_MS = 30 * 1000;

const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// Modo `fill` (design D9): escala que cobre a janela com o corte, centro do corte no
// centro da janela e deslocamento para não mostrar borda vazia. Nunca deforma.
export function fillBox(crop: Crop, iw: number, ih: number, vw: number, vh: number): Box {
  const s = Math.max(vw / (crop.w * iw), vh / (crop.h * ih));
  const width = iw * s;
  const height = ih * s;
  const left = clamp(vw / 2 - (crop.x + crop.w / 2) * width, vw - width, 0);
  const top = clamp(vh / 2 - (crop.y + crop.h / 2) * height, vh - height, 0);
  return { left, top, width, height };
}

// `auto`: preenche quando a orientação bate; foto `square` só bate com tela quadrada.
export function resolveMode(mode: FitMode, photo: Orientation, screen: Orientation): 'fill' | 'fit' {
  if (mode !== 'auto') return mode;
  return photo === screen ? 'fill' : 'fit';
}

// Pular outra orientação: `square` nunca é pulada; se nada sobrar, mostra todas.
export function visibleItems(items: PlaylistItem[], screen: Orientation, skipOther: boolean): PlaylistItem[] {
  if (!skipOther) return items;
  const kept = items.filter((i) => i.orientation === 'square' || i.orientation === screen);
  return kept.length > 0 ? kept : items;
}

// translate(x px, y px) scale(s), com a origem no centro da janela.
export interface Motion {
  x: number;
  y: number;
  s: number;
}

// Aproximação (A → B) ou afastamento (B → A), e a diagonal do deslocamento (0 a 3).
export interface Plan {
  zoomIn: boolean;
  diagonal: number;
}

// Sinais (x, y) do deslocamento em cada diagonal.
const DIAGONALS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

// A cada foto mostrada, a direção alterna e a diagonal gira.
export function nextPlan(prev: Plan | null): Plan {
  return prev ? { zoomIn: !prev.zoomIn, diagonal: (prev.diagonal + 1) % 4 } : { zoomIn: true, diagonal: 0 };
}

// Pontas do movimento. `fill`: A = 100% e B = 106% deslocado 60% da folga; com a origem no centro
// da janela, qualquer estado com |x| ≤ (s − 1)·vw/2 e |y| ≤ (s − 1)·vh/2 continua cobrindo a janela.
// `fit`: de 97% a 100%, sem deslocamento, e a foto continua inteira.
export function motionEnds(fill: boolean, plan: Plan, vw: number, vh: number): { from: Motion; to: Motion } {
  let a: Motion;
  let b: Motion;
  if (fill) {
    const d = DIAGONALS[plan.diagonal % 4];
    const k = (MOTION_PAN * (MOTION_ZOOM - 1)) / 2;
    a = { x: 0, y: 0, s: 1 };
    b = { x: d[0] * k * vw, y: d[1] * k * vh, s: MOTION_ZOOM };
  } else {
    a = { x: 0, y: 0, s: FIT_ZOOM };
    b = { x: 0, y: 0, s: 1 };
  }
  return plan.zoomIn ? { from: a, to: b } : { from: b, to: a };
}

// Estado no progresso p (0 a 1), igual ao da transição linear do navegador.
export function motionAt(from: Motion, to: Motion, p: number): Motion {
  const q = Math.min(1, Math.max(0, p));
  return { x: from.x + (to.x - from.x) * q, y: from.y + (to.y - from.y) * q, s: from.s + (to.s - from.s) * q };
}

// Sem notação científica, que CSS antigo não lê.
function px(v: number): string {
  return (Math.abs(v) < 1e-6 ? 0 : v) + 'px';
}

// Sempre a mesma lista de funções: o navegador interpola componente a componente, e todo
// ponto intermediário fica na região (convexa) que cobre a janela.
export function transformOf(m: Motion): string {
  return 'translate(' + px(m.x) + ', ' + px(m.y) + ') scale(' + m.s + ')';
}

// transform-origin no centro da janela, em coordenadas do img.
export function originOf(box: Box, vw: number, vh: number): string {
  return px(vw / 2 - box.left) + ' ' + px(vh / 2 - box.top);
}

// Trecho do movimento em curso: sai do progresso p0 no instante t0 e chega ao fim em `ms`.
export interface Move {
  plan: Plan;
  p0: number;
  t0: number;
  ms: number;
}

export function progressOf(m: Move, now: number): number {
  return m.ms > 0 ? Math.min(1, m.p0 + ((1 - m.p0) * (now - m.t0)) / m.ms) : 1;
}

// Pausa (modo de edição): guarda o progresso de agora e o tempo que falta; ao retomar, só o t0 muda.
export function pauseMove(m: Move, now: number): Move {
  return { plan: m.plan, p0: progressOf(m, now), t0: now, ms: Math.max(0, m.t0 + m.ms - now) };
}

interface Layer {
  el: HTMLDivElement;
  img: HTMLImageElement;
  info: HTMLDivElement;
  // Blocos posicionáveis (design D2): local e descrição (título e resumo).
  placeBlock: HTMLDivElement;
  desc: HTMLDivElement;
  place: HTMLSpanElement;
  title: HTMLDivElement;
  text: HTMLDivElement;
  item: PlaylistItem | null;
  ready: boolean;
  // Caixa do img no modo `fill`; null no `fit`.
  box: Box | null;
  // Movimento em curso; null com a foto parada.
  move: Move | null;
}

// Marcador do local; a cor vem do texto.
const PIN =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7zm0 9.6a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2z"/></svg>';

// Textos da foto. Campo vazio não aparece; os ajustes "Local" e "Descrição" escondem por classes em #app.
function fillInfo(l: Layer): void {
  const item = l.item;
  const place = (item && item.place) || '';
  const title = (item && item.title) || '';
  const text = (item && item.text) || '';
  l.place.textContent = place;
  l.title.textContent = title;
  l.text.textContent = text;
  l.info.className = 'info' + (place ? ' has-place' : '') + (title ? ' has-title' : '') + (text ? ' has-text' : '');
}

function blocksOf(l: Layer): InfoBlocks {
  return { layer: l.el, place: l.placeBlock, desc: l.desc };
}

export interface StageOptions {
  mode: FitMode;
  skipOther: boolean;
  // Segundos por foto.
  interval: number;
  motion: boolean;
}

export class Stage {
  private layers: Layer[];
  private front = -1;
  private all: PlaylistItem[] = [];
  private deck = new Deck<PlaylistItem>((i) => i.id);
  private due = false;
  private token = 0;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Movimento da última foto mostrada.
  private plan: Plan | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private vw: number;
  private vh: number;
  // Orientação da faixa para a qual os cortes da playlist foram calculados.
  private cropScreen: Orientation | null = null;
  // Modo de edição: sem troca e sem movimento; `remaining` é o tempo da troca que falta.
  private paused = false;
  private timerDue = 0;
  private remaining: number | null = null;

  constructor(
    root: HTMLElement,
    private opts: StageOptions,
    vw: number,
    vh: number,
  ) {
    this.vw = vw;
    this.vh = vh;
    this.layers = [0, 1].map(() => {
      const el = document.createElement('div');
      el.className = 'layer';
      const img = document.createElement('img');
      img.alt = '';
      // O véu fica abaixo dos textos, e os dois trocam com a foto no mesmo crossfade.
      const veil = document.createElement('div');
      veil.className = 'veil';
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML =
        '<div class="info-place">' + PIN + '<span></span></div><div class="info-desc"><div class="info-title"></div><div class="info-text"></div></div>';
      el.appendChild(img);
      el.appendChild(veil);
      el.appendChild(info);
      root.appendChild(el);
      const placeBlock = info.children[0] as HTMLDivElement;
      const desc = info.children[1] as HTMLDivElement;
      return {
        el,
        img,
        info,
        placeBlock,
        desc,
        place: placeBlock.lastChild as HTMLSpanElement,
        title: desc.children[0] as HTMLDivElement,
        text: desc.children[1] as HTMLDivElement,
        item: null,
        ready: false,
        box: null,
        move: null,
      };
    });
  }

  get screen(): Orientation {
    return orientationOf(this.vw, this.vh);
  }

  get count(): number {
    return this.all.length;
  }

  // Texto novo numa camada prestes a aparecer (ou na atual): layout.ts posiciona local e descrição dela.
  onInfo: ((blocks: InfoBlocks) => void) | null = null;

  // Local e descrição das duas camadas, e os da frente (sem foto, os da primeira).
  infoBlocks(): InfoBlocks[] {
    return this.layers.map(blocksOf);
  }

  frontInfo(): InfoBlocks {
    return blocksOf(this.current() || this.layers[0]);
  }

  // Nova playlist (inclusive de outra faixa): a foto atual ganha o corte novo na hora.
  setItems(items: PlaylistItem[], cropScreen: Orientation): void {
    this.all = items;
    this.cropScreen = cropScreen;
    const cur = this.current();
    if (cur && cur.item) {
      const id = cur.item.id;
      const updated = items.filter((i) => i.id === id)[0];
      if (updated) {
        cur.item = updated;
        fillInfo(cur);
        if (this.onInfo) this.onInfo(blocksOf(cur));
        this.layout(cur);
      }
    }
    if (items.length === 0) {
      this.clearAll();
      return;
    }
    this.restartDeck();
  }

  setOptions(patch: Partial<StageOptions>): void {
    const prev = this.opts;
    this.opts = Object.assign({}, prev, patch);
    if (this.opts.motion !== prev.motion) this.toggleMotion();
    if (this.opts.mode !== prev.mode) this.relayout();
    if (this.opts.skipOther !== prev.skipOther && this.all.length > 0) this.restartDeck();
    if (this.opts.interval !== prev.interval && this.front >= 0 && !this.due) {
      this.startTimer();
      // O movimento da foto atual termina junto com o novo tempo.
      const cur = this.current();
      if (cur && cur.move) this.applyMove(cur, this.opts.interval * 1000 + CROSSFADE_MS);
    }
  }

  // Modo de edição (design D3): a foto atual fica, parada onde o movimento estava.
  pause(): void {
    if (this.paused) return;
    const now = Date.now();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.remaining = Math.max(0, this.timerDue - now);
    }
    this.paused = true;
    for (const l of this.layers) {
      if (!l.move) continue;
      l.move = pauseMove(l.move, now);
      this.applyMove(l);
    }
  }

  // Retoma de onde parou: o movimento termina no mesmo ponto e a troca vem no tempo que faltava.
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    const now = Date.now();
    for (const l of this.layers) {
      if (!l.move) continue;
      l.move.t0 = now;
      this.applyMove(l);
    }
    if (this.remaining !== null) {
      const ms = this.remaining;
      this.remaining = null;
      this.startTimer(ms);
    } else if (this.due) {
      this.swap();
    }
  }

  resize(vw: number, vh: number): void {
    const before = this.screen;
    this.vw = vw;
    this.vh = vh;
    this.relayout();
    if (this.screen !== before && this.opts.skipOther && this.all.length > 0) this.restartDeck();
  }

  private current(): Layer | null {
    return this.front >= 0 ? this.layers[this.front] : null;
  }

  private back(): Layer {
    return this.layers[this.front === 0 ? 1 : 0];
  }

  private restartDeck(): void {
    const cur = this.current();
    const items = visibleItems(this.all, this.screen, this.opts.skipOther);
    this.deck.reset(items, cur && cur.item ? cur.item.id : null);
    this.failures = 0;
    // Sem foto na tela, a primeira entra assim que estiver pronta.
    if (!cur) this.due = true;
    this.preload();
  }

  private relayout(): void {
    for (const l of this.layers) if (l.item) this.layout(l);
  }

  private layout(l: Layer): void {
    const item = l.item;
    if (!item) return;
    const mode = resolveMode(this.opts.mode, item.orientation, this.screen);
    const s = l.img.style;
    l.el.style.backgroundColor = item.color;
    l.el.classList.toggle('fit', mode === 'fit');
    if (mode === 'fit') {
      s.left = s.top = s.width = s.height = '';
      l.box = null;
    } else {
      const iw = l.img.naturalWidth || item.width;
      const ih = l.img.naturalHeight || item.height;
      // Corte de outra orientação (logo após girar, ou playlist guardada de outra faixa): foto inteira centrada.
      const crop = this.cropScreen === this.screen ? item.crop : FULL_CROP;
      const box = fillBox(crop, iw, ih, this.vw, this.vh);
      s.left = box.left + 'px';
      s.top = box.top + 'px';
      s.width = box.width + 'px';
      s.height = box.height + 'px';
      l.box = box;
    }
    // Reenquadramento: o movimento segue do progresso em que está, com a geometria nova.
    if (l.move) this.applyMove(l);
  }

  // Liga o movimento na camada que acaba de ir para a frente, durante todo o tempo dela na tela.
  private startMove(l: Layer, plan: Plan, ms: number): void {
    l.move = { plan, p0: 0, t0: Date.now(), ms };
    this.applyMove(l);
  }

  // Põe a foto no estado do progresso atual, sem transição, força um reflow e só então liga a
  // transição linear até o estado final (Chromium 53 e Safari 12 não têm Web Animations).
  // `ms` refaz o tempo que falta; sem ele, o fim continua o mesmo. Sem movimento, volta ao parado.
  private applyMove(l: Layer, ms?: number): void {
    const m = l.move;
    const s = l.img.style;
    if (!m) {
      s.transition = s.transform = s.transformOrigin = '';
      return;
    }
    if (this.paused) {
      // Parada no progresso guardado; um tempo novo (outro intervalo) vale ao retomar.
      if (ms !== undefined) m.ms = ms;
      const ends = motionEnds(l.box !== null, m.plan, this.vw, this.vh);
      s.transition = 'none';
      s.transformOrigin = l.box ? originOf(l.box, this.vw, this.vh) : '';
      s.transform = transformOf(motionAt(ends.from, ends.to, m.p0));
      return;
    }
    const now = Date.now();
    const p = progressOf(m, now);
    const end = m.t0 + m.ms;
    m.p0 = p;
    m.t0 = now;
    m.ms = ms !== undefined ? ms : Math.max(0, end - now);
    const ends = motionEnds(l.box !== null, m.plan, this.vw, this.vh);
    s.transition = 'none';
    s.transformOrigin = l.box ? originOf(l.box, this.vw, this.vh) : '';
    s.transform = transformOf(motionAt(ends.from, ends.to, p));
    if (p >= 1 || m.ms <= 0) return;
    // Reflow: o navegador grava o estado de agora como início da transição.
    l.img.getBoundingClientRect();
    s.transition = 'transform ' + Math.round(m.ms) + 'ms linear';
    s.transform = transformOf(ends.to);
  }

  // Desligado: as duas camadas param na hora. Ligado no meio de uma foto: ela sai do enquadramento
  // parado (sem salto), na velocidade de sempre: aproxima em `fill` (A = 100%) e afasta em `fit`
  // (B = 100%); a seguinte vai na direção contrária.
  private toggleMotion(): void {
    if (!this.opts.motion) {
      for (const l of this.layers) {
        l.move = null;
        this.applyMove(l);
      }
      return;
    }
    const cur = this.current();
    if (!cur || this.due) return;
    this.plan = { zoomIn: cur.box !== null, diagonal: this.plan ? this.plan.diagonal : 0 };
    this.startMove(cur, this.plan, this.opts.interval * 1000 + CROSSFADE_MS);
  }

  private clearLayer(l: Layer): void {
    l.item = null;
    l.ready = false;
    l.img.onload = l.img.onerror = null;
    // removeAttribute em vez de src = '': evita um pedido à própria página em navegadores antigos.
    l.img.removeAttribute('src');
    l.move = null;
    this.applyMove(l);
    fillInfo(l);
  }

  private clearAll(): void {
    this.token++;
    this.stopTimers();
    for (const l of this.layers) {
      this.clearLayer(l);
      l.el.className = 'layer';
      l.el.style.backgroundColor = '';
    }
    this.front = -1;
    this.due = false;
  }

  private stopTimers(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.timer = this.retryTimer = null;
    this.remaining = null;
  }

  // Baixa e decodifica a próxima foto na camada escondida.
  private preload(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const back = this.back();
    const token = ++this.token;
    this.clearLayer(back);
    back.el.className = 'layer';
    const cur = this.current();
    let item = this.deck.next();
    if (!item) return;
    if (cur && cur.item && item.id === cur.item.id) {
      // Só uma foto visível: fica na tela, sem troca.
      if (this.deck.size <= 1) return;
      item = this.deck.next();
      if (!item) return;
    }
    back.item = item;
    fillInfo(back);
    const img = back.img;
    const done = () => {
      if (token !== this.token) return;
      back.ready = true;
      this.failures = 0;
      if (this.due) this.swap();
    };
    img.onload = () => {
      if (token !== this.token) return;
      // decode() onde houver; senão o load basta.
      if (typeof img.decode === 'function') img.decode().then(done, done);
      else done();
    };
    img.onerror = () => {
      if (token !== this.token) return;
      this.failures++;
      if (this.failures >= this.deck.size) {
        // Nenhuma carregou: a atual continua e a volta recomeça mais tarde.
        this.clearLayer(back);
        this.failures = 0;
        this.retryTimer = setTimeout(() => this.preload(), ALL_FAILED_RETRY_MS);
      } else {
        this.preload();
      }
    };
    img.src = item.src;
  }

  private startTimer(ms: number = this.opts.interval * 1000): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.paused) {
      this.remaining = ms;
      return;
    }
    this.timerDue = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.due = true;
      this.swap();
    }, ms);
  }

  // Troca só com a próxima pronta; a nova camada sobe por cima da atual. Em pausa, espera o resume().
  private swap(): void {
    const next = this.back();
    if (this.paused || !next.ready || !next.item) return;
    const prev = this.current();
    this.due = false;
    this.layout(next);
    if (this.onInfo) this.onInfo(blocksOf(next));
    // Começa com o crossfade e dura o tempo da foto mais o crossfade de saída; depois fica parada no fim.
    this.plan = nextPlan(this.plan);
    if (this.opts.motion) this.startMove(next, this.plan, this.opts.interval * 1000 + CROSSFADE_MS);
    if (prev) {
      prev.ready = false;
      prev.el.classList.remove('front');
      prev.el.classList.add('prev');
    }
    next.el.classList.remove('prev');
    next.el.classList.add('front');
    this.front = this.layers.indexOf(next);
    this.startTimer();
    const prevItem = prev ? prev.item : null;
    setTimeout(() => {
      const back = this.back();
      // Só a atual e a próxima ficam em memória; pula se alguém já recarregou a camada de trás.
      if (back.item === prevItem) this.preload();
    }, CROSSFADE_MS + 50);
  }
}
