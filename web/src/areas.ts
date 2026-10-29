// Áreas próprias (design D4/D5): retângulos do usuário com texto, imagem ou o HTML de um endpoint.
// Centro e tamanho em proporção da janela, um por orientação, salvos em `decklive.areas.v1`.
import { withTimeout } from './api';
import { third, type LayoutOrientation, type Point, type Rect } from './layout';
import type { StorageLike } from './settings';
import { renderTemplate } from './template';

export type AreaKind = 'text' | 'image' | 'endpoint';
export type TextSize = 's' | 'm' | 'l';

// Centro (x, y) e tamanho (w, h), tudo em proporção da janela.
export interface AreaRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EndpointConfig {
  url: string;
  // Valor do cabeçalho Authorization; vazio não manda o cabeçalho.
  auth: string;
  // Segundos entre uma resposta e a próxima chamada.
  interval: number;
  template: string;
}

// Só os campos do tipo escolhido.
export interface AreaContent {
  kind: AreaKind;
  text?: string;
  size?: TextSize;
  imageUrl?: string;
  endpoint?: EndpointConfig;
}

export interface Area extends AreaContent {
  id: string;
  layout: { landscape?: AreaRect; portrait?: AreaRect };
}

export const AREAS_KEY = 'decklive.areas.v1';
export const MAX_AREAS = 8;
export const MIN_SIZE = 0.05;
export const KINDS: ReadonlyArray<AreaKind> = ['text', 'image', 'endpoint'];
export const TEXT_SIZES: ReadonlyArray<TextSize> = ['s', 'm', 'l'];
export const ENDPOINT_INTERVALS: ReadonlyArray<number> = [10, 30, 60, 300, 900, 3600];
export const DEFAULT_INTERVAL = 30;
export const ENDPOINT_TIMEOUT_MS = 10 * 1000;
// Limites dos textos: oito áreas cheias ainda cabem no pacote de envio (64 KB).
export const MAX_TEXT = 1000;
export const MAX_URL = 2000;
export const MAX_AUTH = 1000;
export const MAX_TEMPLATE = 4000;
// Nova área: 30% × 20% da janela, no quadrante de cima à esquerda, livre no layout padrão
// (no centro ela nasceria embaixo do relógio e da data, e o clique pegaria eles).
const NEW_RECT: AreaRect = { x: 0.22, y: 0.25, w: 0.3, h: 0.2 };
const ORIENTATIONS: ReadonlyArray<LayoutOrientation> = ['landscape', 'portrait'];
const ID = /^[A-Za-z0-9_-]{1,40}$/;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function num(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

// --- Medidas ------------------------------------------------------------------------------------

// Tamanho entre 5% e a janela inteira, e o centro puxado para a caixa caber.
export function fitRect(r: AreaRect): AreaRect {
  const w = clamp(r.w, MIN_SIZE, 1);
  const h = clamp(r.h, MIN_SIZE, 1);
  return { x: clamp(r.x, w / 2, 1 - w / 2), y: clamp(r.y, h / 2, 1 - h / 2), w, h };
}

// Medida da orientação atual; sem ela, a da outra, limitada para caber.
export function areaRect(a: Area, o: LayoutOrientation): AreaRect {
  return fitRect(a.layout[o] || a.layout[o === 'landscape' ? 'portrait' : 'landscape'] || NEW_RECT);
}

export function moveRect(r: AreaRect, p: Point): AreaRect {
  return fitRect({ x: p.x, y: p.y, w: r.w, h: r.h });
}

// Novo tamanho com o canto superior esquerdo parado (a alça e as setas puxam o canto inferior direito).
export function resizeRect(r: AreaRect, w: number, h: number): AreaRect {
  const f = fitRect(r);
  const left = f.x - f.w / 2;
  const top = f.y - f.h / 2;
  const nw = clamp(w, MIN_SIZE, 1 - left);
  const nh = clamp(h, MIN_SIZE, 1 - top);
  return { x: left + nw / 2, y: top + nh / 2, w: nw, h: nh };
}

// --- Formato salvo --------------------------------------------------------------------------------

function validRect(raw: unknown): AreaRect | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!num(r.x) || !num(r.y) || !num(r.w) || !num(r.h)) return null;
  return fitRect({ x: clamp(r.x, 0, 1), y: clamp(r.y, 0, 1), w: r.w, h: r.h });
}

// Campo a campo: o que vier inválido volta ao padrão. Fica só o que o tipo usa.
export function validateContent(raw: unknown): AreaContent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = KINDS.indexOf(r.kind as AreaKind) >= 0 ? (r.kind as AreaKind) : 'text';
  if (kind === 'image') return { kind, imageUrl: str(r.imageUrl, MAX_URL) };
  if (kind === 'endpoint') {
    const e = (r.endpoint && typeof r.endpoint === 'object' ? r.endpoint : {}) as Record<string, unknown>;
    const interval = ENDPOINT_INTERVALS.indexOf(e.interval as number) >= 0 ? (e.interval as number) : DEFAULT_INTERVAL;
    return {
      kind,
      endpoint: { url: str(e.url, MAX_URL), auth: str(e.auth, MAX_AUTH), interval, template: str(e.template, MAX_TEMPLATE) },
    };
  }
  const size = TEXT_SIZES.indexOf(r.size as TextSize) >= 0 ? (r.size as TextSize) : 'm';
  return { kind, text: str(r.text, MAX_TEXT), size };
}

// Ao ler (e ao receber de outra tela): id válido e único, no máximo 8; sem medida válida, a do centro.
export function validateAreas(raw: unknown): Area[] {
  const out: Area[] = [];
  if (!Array.isArray(raw)) return out;
  const seen: { [id: string]: boolean } = {};
  for (const item of raw) {
    if (out.length >= MAX_AREAS) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !ID.test(r.id) || seen[r.id]) continue;
    seen[r.id] = true;
    const layout: Area['layout'] = {};
    const l = (r.layout && typeof r.layout === 'object' ? r.layout : {}) as Record<string, unknown>;
    for (const o of ORIENTATIONS) {
      const rect = validRect(l[o]);
      if (rect) layout[o] = rect;
    }
    if (!layout.landscape && !layout.portrait) layout.landscape = Object.assign({}, NEW_RECT);
    out.push(Object.assign({ id: r.id }, validateContent(r), { layout }));
  }
  return out;
}

// "Área 3" pelo número do id (estável ao excluir outra); id de outro formato usa a posição.
export function areaLabel(prefix: string, a: Area, index: number): string {
  const m = /^a(\d+)$/.exec(a.id);
  return prefix + ' ' + (m ? m[1] : String(index + 1));
}

export class AreaStore {
  private value: Area[];
  private listeners: (() => void)[] = [];

  constructor(private storage: StorageLike | null) {
    this.value = validateAreas(read(storage));
  }

  list(): Area[] {
    return this.value;
  }

  get(id: string): Area | null {
    return this.value.filter((a) => a.id === id)[0] || null;
  }

  // Nova área de texto vazia na orientação atual; null com 8 áreas. Cada nova desce um pouco, para
  // não cobrir inteira a anterior.
  add(o: LayoutOrientation): Area | null {
    const n = this.value.length;
    if (n >= MAX_AREAS) return null;
    let k = 1;
    while (this.get('a' + k)) k++;
    const area: Area = { id: 'a' + k, kind: 'text', text: '', size: 'm', layout: {} };
    area.layout[o] = fitRect({ x: NEW_RECT.x + 0.03 * n, y: NEW_RECT.y + 0.03 * n, w: NEW_RECT.w, h: NEW_RECT.h });
    this.value.push(area);
    this.commit(true);
    return area;
  }

  setContent(id: string, content: unknown): void {
    const a = this.get(id);
    if (!a) return;
    const next = Object.assign({ id: a.id }, validateContent(content), { layout: a.layout });
    this.value = this.value.map((x) => (x === a ? next : x));
    this.commit(true);
  }

  // `save` false durante o arraste: vale na hora e só vai para o navegador no fim.
  setRect(id: string, o: LayoutOrientation, r: AreaRect, save = true): void {
    const a = this.get(id);
    if (!a) return;
    a.layout[o] = fitRect(r);
    this.commit(save);
  }

  remove(id: string): void {
    this.value = this.value.filter((a) => a.id !== id);
    this.commit(true);
  }

  // Ajustes recebidos de outra tela: troca tudo.
  replace(raw: unknown): void {
    this.value = validateAreas(raw);
    this.commit(true);
  }

  // Melhor esforço, como as preferências.
  save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(AREAS_KEY, JSON.stringify(this.value));
    } catch (e) {
      // Cota cheia ou bloqueio: segue só em memória.
    }
  }

  subscribe(fn: () => void): void {
    this.listeners.push(fn);
  }

  private commit(save: boolean): void {
    if (save) this.save();
    for (const fn of this.listeners) fn();
  }
}

function read(storage: StorageLike | null): unknown {
  if (!storage) return null;
  try {
    const text = storage.getItem(AREAS_KEY);
    return text ? JSON.parse(text) : null;
  } catch (e) {
    return null;
  }
}

// --- Endpoint -----------------------------------------------------------------------------------

// URL de imagem ou de endpoint: https sempre. http só quando a própria página está em http
// (desenvolvimento local), porque aí não há conteúdo misto; numa página https o navegador bloquearia.
export function allowedUrl(url: string, pageProtocol: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch (e) {
    return false;
  }
  return u.protocol === 'https:' || (pageProtocol === 'http:' && u.protocol === 'http:');
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; cache: 'no-store' },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

// Rede, CORS, status fora de 2xx, JSON inválido e tempo esgotado dão o mesmo erro: o navegador não
// deixa distinguir CORS de rede.
export function fetchJson(http: FetchLike, url: string, auth: string, timeoutMs = ENDPOINT_TIMEOUT_MS): Promise<unknown> {
  const request = Promise.resolve()
    .then(() => http(url, { headers: auth ? { Authorization: auth } : {}, cache: 'no-store' }))
    .then((res) => {
      if (!res.ok) throw new Error('status');
      return res.json();
    });
  return withTimeout(request, timeoutMs);
}

export interface PollerDeps {
  fetchJson(url: string, auth: string): Promise<unknown>;
  hidden(): boolean;
}

// Uma chamada por vez: a próxima é marcada com setTimeout depois de cada resposta (não setInterval),
// para não acumular. Com a página oculta, para; ao voltar, chama na hora.
export class Poller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private busy = false;
  // Descarta a resposta de uma chamada feita antes do stop().
  private gen = 0;

  constructor(
    private cfg: { url: string; auth: string; interval: number },
    private deps: PollerDeps,
    private onData: (data: unknown) => void,
    private onError: () => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    this.busy = false;
    this.gen++;
    this.clear();
  }

  visibilityChanged(): void {
    if (!this.running) return;
    this.clear();
    if (!this.deps.hidden()) this.tick();
  }

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private tick(): void {
    this.timer = null;
    if (!this.running || this.busy || this.deps.hidden()) return;
    this.busy = true;
    const gen = this.gen;
    this.deps.fetchJson(this.cfg.url, this.cfg.auth).then(
      (data) => this.finish(gen, true, data),
      () => this.finish(gen, false, null),
    );
  }

  private finish(gen: number, ok: boolean, data: unknown): void {
    if (gen !== this.gen) return;
    this.busy = false;
    // Marca a próxima antes de mostrar: um erro ao mostrar não interrompe o agendamento.
    if (!this.deps.hidden()) this.timer = setTimeout(() => this.tick(), this.cfg.interval * 1000);
    try {
      if (ok) this.onData(data);
      else this.onError();
    } catch (e) {
      this.onError();
    }
  }
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Cantarell,'Noto Sans','Helvetica Neue',Arial,sans-serif";

// Documento do iframe: fundo transparente, texto branco com a sombra da data, fonte do sistema e
// 16 × --dl-ui px de base (em px, porque o iframe não vê as variáveis do player).
export function frameDoc(body: string, ui: number): string {
  const px = (n: number) => Math.round(n * ui * 100) / 100 + 'px';
  return (
    '<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}' +
    'body{color:#fff;font-family:' +
    FONT +
    ';font-size:' +
    px(16) +
    ';line-height:1.3;word-wrap:break-word;text-shadow:0 ' +
    px(2) +
    ' ' +
    px(10) +
    ' rgba(0,0,0,.8)}</style></head><body>' +
    body +
    '</body></html>'
  );
}

// --- Aplicação no DOM -----------------------------------------------------------------------------

export interface AreaViewDeps {
  orientation(): LayoutOrientation;
  // --dl-ui em px, para a fonte do iframe.
  uiScale(): number;
  pageProtocol: string;
  errorText: string;
  fetch: FetchLike;
  hidden(): boolean;
}

interface Content {
  // Escala nova (janela redimensionada).
  update(): void;
  visibilityChanged(): void;
  destroy(): void;
}

interface Shown {
  el: HTMLDivElement;
  key: string;
  content: Content;
}

function contentKey(a: Area): string {
  return JSON.stringify([a.kind, a.text, a.size, a.imageUrl, a.endpoint]);
}

const NOOP: Content = { update() {}, visibilityChanged() {}, destroy() {} };

function textContent(el: HTMLElement, a: Area): Content {
  const div = document.createElement('div');
  div.className = 'area-text area-' + (a.size || 'm');
  // Quebras de linha do texto valem (white-space no CSS).
  div.textContent = a.text || '';
  el.appendChild(div);
  return NOOP;
}

// Imagem inteira e centrada; só aparece quando carrega, e se falhar a área fica vazia.
function imageContent(el: HTMLElement, a: Area, deps: AreaViewDeps): Content {
  const url = a.imageUrl || '';
  if (!allowedUrl(url, deps.pageProtocol)) return NOOP;
  const img = document.createElement('img');
  img.className = 'area-img';
  img.alt = '';
  img.onload = () => img.classList.add('loaded');
  img.onerror = () => img.classList.remove('loaded');
  img.src = url;
  el.appendChild(img);
  return NOOP;
}

// Recria o iframe só quando o HTML muda; o novo entra quando carregar, por cima do anterior, sem piscar.
const SWAP_FALLBACK_MS = 3000;

class EndpointContent implements Content {
  private poller: Poller | null = null;
  private data: unknown = null;
  private has = false;
  private html = '';
  private frame: HTMLIFrameElement | null = null;
  private loading: HTMLIFrameElement | null = null;
  private msg: HTMLDivElement;

  constructor(
    private el: HTMLElement,
    private cfg: EndpointConfig,
    private deps: AreaViewDeps,
  ) {
    const dot = document.createElement('div');
    dot.className = 'area-dot';
    this.msg = document.createElement('div');
    this.msg.className = 'area-msg';
    this.msg.textContent = deps.errorText;
    el.appendChild(dot);
    el.appendChild(this.msg);
    if (!allowedUrl(cfg.url, deps.pageProtocol)) {
      this.failed();
      return;
    }
    this.poller = new Poller(
      cfg,
      { fetchJson: (url, auth) => fetchJson(deps.fetch, url, auth), hidden: deps.hidden },
      (data) => {
        this.data = data;
        this.has = true;
        this.el.classList.remove('area-error');
        this.el.classList.remove('area-failed');
        this.render();
      },
      () => this.failed(),
    );
    this.poller.start();
  }

  update(): void {
    if (this.has) this.render();
  }

  visibilityChanged(): void {
    if (this.poller) this.poller.visibilityChanged();
  }

  destroy(): void {
    if (this.poller) this.poller.stop();
  }

  // Com conteúdo anterior, ele fica e aparece o ponto âmbar; sem nenhum, a mensagem curta.
  private failed(): void {
    this.el.classList.add(this.has ? 'area-error' : 'area-failed');
  }

  private render(): void {
    const html = frameDoc(renderTemplate(this.cfg.template, this.data), this.deps.uiScale());
    if (html === this.html) return;
    this.html = html;
    if (this.loading && this.loading.parentNode) this.loading.parentNode.removeChild(this.loading);
    const next = document.createElement('iframe');
    // Sem allow-scripts e sem allow-same-origin: o HTML não roda scripts nem lê o player.
    next.setAttribute('sandbox', '');
    next.setAttribute('tabindex', '-1');
    next.setAttribute('aria-hidden', 'true');
    next.className = 'area-frame';
    let done = false;
    const swap = () => {
      if (done || this.loading !== next) return;
      done = true;
      const prev = this.frame;
      this.frame = next;
      this.loading = null;
      next.className = 'area-frame shown';
      if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
    };
    next.onload = swap;
    setTimeout(swap, SWAP_FALLBACK_MS);
    this.loading = next;
    next.srcdoc = html;
    this.el.appendChild(next);
  }
}

export class AreaView {
  // Chamado depois de cada aplicação (o editor redesenha os contornos).
  onApply: (() => void) | null = null;
  private shown: { [id: string]: Shown } = {};

  constructor(
    private root: HTMLElement,
    private store: AreaStore,
    private deps: AreaViewDeps,
  ) {
    store.subscribe(() => this.apply());
  }

  // Sincroniza o DOM com a lista: medidas da orientação atual e conteúdo novo só quando ele muda.
  apply(): void {
    const o = this.deps.orientation();
    const seen: { [id: string]: boolean } = {};
    for (const a of this.store.list()) {
      seen[a.id] = true;
      let s = this.shown[a.id];
      const key = contentKey(a);
      if (!s) {
        const el = document.createElement('div');
        el.className = 'area';
        // Novas por cima das anteriores, na ordem da lista.
        this.root.appendChild(el);
        s = this.shown[a.id] = { el, key: '', content: NOOP };
      }
      if (s.key !== key) {
        // O elemento fica (o iframe não recarrega por mudança de ordem); só o conteúdo é trocado.
        s.content.destroy();
        while (s.el.firstChild) s.el.removeChild(s.el.firstChild);
        s.el.className = 'area is-' + a.kind;
        s.key = key;
        s.content = this.create(s.el, a);
      } else {
        s.content.update();
      }
      const r = areaRect(a, o);
      const st = s.el.style;
      st.left = (r.x - r.w / 2) * 100 + '%';
      st.top = (r.y - r.h / 2) * 100 + '%';
      st.width = r.w * 100 + '%';
      st.height = r.h * 100 + '%';
      // Texto alinhado pelo terço onde o centro fica, como os elementos fixos.
      st.textAlign = ['left', 'center', 'right'][third(r.x)];
    }
    for (const id in this.shown) {
      if (seen[id]) continue;
      this.shown[id].content.destroy();
      this.root.removeChild(this.shown[id].el);
      delete this.shown[id];
    }
    if (this.onApply) this.onApply();
  }

  rect(id: string): Rect {
    const s = this.shown[id];
    const r = s ? s.el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  visibilityChanged(): void {
    for (const id in this.shown) this.shown[id].content.visibilityChanged();
  }

  private create(el: HTMLElement, a: Area): Content {
    if (a.kind === 'image') return imageContent(el, a, this.deps);
    if (a.kind === 'endpoint' && a.endpoint) return new EndpointContent(el, a.endpoint, this.deps);
    return textContent(el, a);
  }
}
