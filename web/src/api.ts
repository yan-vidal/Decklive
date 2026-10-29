// Playlist da API: faixa canônica, If-None-Match, última resposta guardada e novas tentativas.
import { bucketKey, orientationOf, type Orientation, type Size } from './screen';
import type { StorageLike } from './settings';

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlaylistItem {
  id: string;
  src: string;
  width: number;
  height: number;
  crop: Crop;
  color: string;
  orientation: Orientation;
  // Local, título e resumo prontos para exibir; ausentes nas playlists guardadas por versões anteriores.
  place?: string | null;
  title?: string | null;
  text?: string | null;
}

export interface Playlist {
  bucket: string;
  etag: string | null;
  items: PlaylistItem[];
}

export interface HttpResponse {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type HttpFetch = (url: string, init: { headers: Record<string, string> }) => Promise<HttpResponse>;

export interface PlaylistEvents {
  // `stored`: veio do navegador porque a API falhou.
  onPlaylist(playlist: Playlist, source: 'network' | 'stored'): void;
  // Sem playlist nenhuma e a API fora: aviso discreto.
  onOffline(offline: boolean): void;
}

export const PLAYLIST_KEY = 'decklive.playlist.v1';
export const REFRESH_MS = 10 * 60 * 1000;
export const RETRY_FIRST_MS = 5 * 1000;
export const RETRY_MAX_MS = 5 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 15 * 1000;

export function playlistUrl(bucket: Size): string {
  return '/api/playlist?w=' + bucket.w + '&h=' + bucket.h;
}

const ORIENTATIONS: ReadonlyArray<Orientation> = ['landscape', 'portrait', 'square'];

function isNum(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

function unit(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// Texto para exibir, ou null (ausente, vazio ou de outro tipo).
function displayText(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function parseItem(raw: unknown): PlaylistItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const c = r.crop as Record<string, unknown> | undefined;
  if (typeof r.id !== 'string' || typeof r.src !== 'string' || !r.src) return null;
  if (!isNum(r.width) || !isNum(r.height) || r.width <= 0 || r.height <= 0) return null;
  if (!c || !isNum(c.x) || !isNum(c.y) || !isNum(c.w) || !isNum(c.h) || c.w <= 0 || c.h <= 0) return null;
  const orientation = ORIENTATIONS.indexOf(r.orientation as Orientation) >= 0
    ? (r.orientation as Orientation)
    : orientationOf(r.width, r.height);
  return {
    id: r.id,
    src: r.src,
    width: r.width,
    height: r.height,
    crop: { x: unit(c.x), y: unit(c.y), w: unit(c.w), h: unit(c.h) },
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#000000',
    orientation,
    place: displayText(r.place),
    title: displayText(r.title),
    text: displayText(r.text),
  };
}

// Corpo `{ items: [...] }`; itens malformados são descartados. `null` se o corpo não serve.
export function parseItems(body: unknown): PlaylistItem[] | null {
  if (!body || typeof body !== 'object') return null;
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  const out: PlaylistItem[] = [];
  for (const raw of items) {
    const item = parseItem(raw);
    if (item) out.push(item);
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class PlaylistClient {
  private bucket: Size | null = null;
  private current: Playlist | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_FIRST_MS;
  // Descarta respostas de uma faixa antiga.
  private seq = 0;

  constructor(
    private http: HttpFetch,
    private storage: StorageLike | null,
    private events: PlaylistEvents,
  ) {}

  start(bucket: Size): void {
    this.bucket = bucket;
    this.load();
  }

  // Rotação ou nova janela: pede a playlist da nova faixa na hora.
  setBucket(bucket: Size): void {
    if (this.bucket && bucketKey(this.bucket) === bucketKey(bucket)) return;
    this.bucket = bucket;
    this.retryDelay = RETRY_FIRST_MS;
    this.load();
  }

  stop(): void {
    this.seq++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private stored(): Playlist | null {
    if (!this.storage) return null;
    try {
      const raw = JSON.parse(this.storage.getItem(PLAYLIST_KEY) || 'null');
      const items = parseItems(raw);
      if (!items || typeof raw.bucket !== 'string') return null;
      return { bucket: raw.bucket, etag: typeof raw.etag === 'string' ? raw.etag : null, items };
    } catch (e) {
      return null;
    }
  }

  private save(p: Playlist): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(PLAYLIST_KEY, JSON.stringify(p));
    } catch (e) {
      // Sem espaço: fica só em memória.
    }
  }

  private schedule(ms: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.load();
    }, ms);
  }

  private load(): void {
    if (!this.bucket) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const seq = ++this.seq;
    const key = bucketKey(this.bucket);
    let known: Playlist | null = this.current && this.current.bucket === key ? this.current : null;
    if (!known) {
      const s = this.stored();
      if (s && s.bucket === key) known = s;
    }
    const headers: Record<string, string> = {};
    if (known && known.etag) headers['If-None-Match'] = known.etag;

    withTimeout(this.http(playlistUrl(this.bucket), { headers }), REQUEST_TIMEOUT_MS)
      .then((res) => {
        if (res.status === 304 && known) return known;
        if (res.status !== 200) throw new Error('HTTP ' + res.status);
        return res.json().then((body) => {
          const items = parseItems(body);
          if (!items) throw new Error('playlist inválida');
          const p: Playlist = { bucket: key, etag: res.headers.get('ETag'), items };
          this.save(p);
          return p;
        });
      })
      .then(
        (p) => {
          if (seq !== this.seq) return;
          if (p !== this.current) {
            this.current = p;
            this.events.onPlaylist(p, 'network');
          }
          this.retryDelay = RETRY_FIRST_MS;
          this.events.onOffline(false);
          this.schedule(REFRESH_MS);
        },
        () => {
          if (seq !== this.seq) return;
          this.fail();
        },
      );
  }

  private fail(): void {
    if (!this.current) {
      const s = this.stored();
      if (s) {
        this.current = s;
        this.events.onPlaylist(s, 'stored');
      }
    }
    this.events.onOffline(!this.current);
    this.schedule(this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
  }
}
