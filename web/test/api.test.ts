import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLAYLIST_KEY,
  PlaylistClient,
  REFRESH_MS,
  parseItems,
  type HttpFetch,
  type HttpResponse,
  type Playlist,
} from '../src/api';
import type { StorageLike } from '../src/settings';

const ITEM = {
  id: '66d312a4124fa13304b01ea7',
  src: 'https://cdn.yanlucas.com/a.jpeg',
  width: 2944,
  height: 1839,
  crop: { x: 0, y: 0.0005, w: 1, h: 0.999 },
  color: '#c79442',
  orientation: 'landscape',
};

class MemoryStorage implements StorageLike {
  data: Record<string, string> = {};
  getItem(k: string) {
    return k in this.data ? this.data[k] : null;
  }
  setItem(k: string, v: string) {
    this.data[k] = v;
  }
}

function response(status: number, body: unknown = null, etag: string | null = null): HttpResponse {
  return {
    status,
    headers: { get: (n: string) => (n.toLowerCase() === 'etag' ? etag : null) },
    json: () => Promise.resolve(body),
  };
}

function setup(http: HttpFetch, storage: StorageLike | null = new MemoryStorage()) {
  const playlists: { p: Playlist; source: string }[] = [];
  const offline: boolean[] = [];
  const client = new PlaylistClient(http, storage, {
    onPlaylist: (p, source) => playlists.push({ p, source }),
    onOffline: (o) => offline.push(o),
  });
  return { client, playlists, offline };
}

const down: HttpFetch = () => Promise.reject(new TypeError('Failed to fetch'));

describe('PlaylistClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pede a faixa canônica e guarda a resposta', async () => {
    const http = vi.fn<HttpFetch>(() => Promise.resolve(response(200, { items: [ITEM] }, '"r1-1920x1080-mubbs7i8"')));
    const storage = new MemoryStorage();
    const { client, playlists, offline } = setup(http, storage);
    client.start({ w: 1920, h: 1080 });
    await vi.advanceTimersByTimeAsync(0);
    expect(http).toHaveBeenCalledWith('/api/playlist?w=1920&h=1080', { headers: {} });
    expect(playlists).toHaveLength(1);
    expect(playlists[0].source).toBe('network');
    expect(playlists[0].p.items[0].id).toBe(ITEM.id);
    expect(offline).toEqual([false]);
    expect(JSON.parse(storage.data[PLAYLIST_KEY]).etag).toBe('"r1-1920x1080-mubbs7i8"');
  });

  it('atualiza a cada 10 min com If-None-Match; 304 não troca nada', async () => {
    const http = vi.fn<HttpFetch>()
      .mockResolvedValueOnce(response(200, { items: [ITEM] }, '"r1-1920x1080-mubbs7i8"'))
      .mockResolvedValueOnce(response(304))
      .mockResolvedValueOnce(response(200, { items: [ITEM, Object.assign({}, ITEM, { id: 'b' })] }, '"r2-1920x1080"'));
    const { client, playlists } = setup(http);
    client.start({ w: 1920, h: 1080 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(REFRESH_MS - 1);
    expect(http).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(http).toHaveBeenCalledTimes(2);
    expect(http.mock.calls[1][1]).toEqual({ headers: { 'If-None-Match': '"r1-1920x1080-mubbs7i8"' } });
    expect(playlists).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(playlists).toHaveLength(2);
    expect(playlists[1].p.items).toHaveLength(2);
  });

  it('API fora do ar com playlist guardada: abre com as fotos guardadas', async () => {
    const storage = new MemoryStorage();
    storage.setItem(PLAYLIST_KEY, JSON.stringify({ bucket: '1920x1080', etag: '"r1-1920x1080-mubbs7i8"', items: [ITEM] }));
    const { client, playlists, offline } = setup(down, storage);
    client.start({ w: 1920, h: 1080 });
    await vi.advanceTimersByTimeAsync(0);
    expect(playlists).toHaveLength(1);
    expect(playlists[0].source).toBe('stored');
    expect(playlists[0].p.items[0].src).toBe(ITEM.src);
    expect(offline).toEqual([false]);
  });

  it('Playlist guardada de uma versão anterior: itens sem place, title e text abrem sem textos', async () => {
    const storage = new MemoryStorage();
    // ITEM é o formato antigo, sem os campos novos.
    expect('place' in ITEM || 'title' in ITEM || 'text' in ITEM).toBe(false);
    storage.setItem(PLAYLIST_KEY, JSON.stringify({ bucket: '1920x1080', etag: '"r1-1920x1080-mubbs7i8"', items: [ITEM] }));
    const { client, playlists } = setup(down, storage);
    client.start({ w: 1920, h: 1080 });
    await vi.advanceTimersByTimeAsync(0);
    expect(playlists.map((x) => x.source)).toEqual(['stored']);
    const item = playlists[0].p.items[0];
    expect(item.id).toBe(ITEM.id);
    expect([item.place, item.title, item.text]).toEqual([null, null, null]);
  });

  it('playlist guardada de outra faixa também serve quando a API cai', async () => {
    const storage = new MemoryStorage();
    storage.setItem(PLAYLIST_KEY, JSON.stringify({ bucket: '591x1280', etag: '"r1"', items: [ITEM] }));
    const { client, playlists } = setup(down, storage);
    client.start({ w: 1920, h: 1080 });
    await vi.advanceTimersByTimeAsync(0);
    expect(playlists.map((x) => x.source)).toEqual(['stored']);
  });

  it('Primeira visita sem API: avisa e tenta de novo com espera crescente até 5 min', async () => {
    const http = vi.fn<HttpFetch>(down);
    const { client, playlists, offline } = setup(http, new MemoryStorage());
    client.start({ w: 1920, h: 1080 });
    await vi.advanceTimersByTimeAsync(0);
    expect(playlists).toHaveLength(0);
    expect(offline).toEqual([true]);
    const times: number[] = [];
    let elapsed = 0;
    let calls = 1;
    while (elapsed < 30 * 60 * 1000) {
      await vi.advanceTimersByTimeAsync(1000);
      elapsed += 1000;
      if (http.mock.calls.length > calls) {
        calls = http.mock.calls.length;
        times.push(elapsed / 1000);
      }
    }
    const gaps = times.map((t, i) => t - (i ? times[i - 1] : 0));
    expect(gaps.slice(0, 8)).toEqual([5, 10, 20, 40, 80, 160, 300, 300]);
    expect(offline.every((o) => o)).toBe(true);
  });

  it('sem localStorage, a primeira visita sem API também só avisa', async () => {
    const { client, offline } = setup(down, null);
    client.start({ w: 1920, h: 1080 });
    await vi.advanceTimersByTimeAsync(0);
    expect(offline).toEqual([true]);
  });

  it('volta da API depois de falhar: troca o aviso pelas fotos', async () => {
    const http = vi.fn<HttpFetch>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(response(200, { items: [ITEM] }, '"r1"'));
    const { client, playlists, offline } = setup(http);
    client.start({ w: 1920, h: 1080 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(playlists).toHaveLength(1);
    expect(offline).toEqual([true, false]);
  });

  it('API que não responde conta como falha (timeout)', async () => {
    const hang: HttpFetch = () => new Promise(() => {});
    const { client, offline } = setup(hang);
    client.start({ w: 1920, h: 1080 });
    await vi.advanceTimersByTimeAsync(15000);
    expect(offline).toEqual([true]);
  });

  it('nova faixa pede na hora e ignora a resposta atrasada da faixa antiga', async () => {
    let resolveOld: (r: HttpResponse) => void = () => {};
    const http = vi.fn<HttpFetch>()
      .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce(response(200, { items: [Object.assign({}, ITEM, { id: 'new' })] }, '"r1-591x1280-mubbs7i8"'));
    const { client, playlists } = setup(http);
    client.start({ w: 1920, h: 1080 });
    client.setBucket({ w: 591, h: 1280 });
    await vi.advanceTimersByTimeAsync(0);
    resolveOld(response(200, { items: [ITEM] }, '"r1-1920x1080-mubbs7i8"'));
    await vi.advanceTimersByTimeAsync(0);
    expect(http.mock.calls[1][0]).toBe('/api/playlist?w=591&h=1280');
    expect(playlists.map((x) => x.p.items[0].id)).toEqual(['new']);
  });
});

describe('parseItems', () => {
  it('descarta itens malformados e corrige campos opcionais', () => {
    const items = parseItems({
      items: [
        ITEM,
        { id: 'x' },
        Object.assign({}, ITEM, { id: 'c', color: 'red', orientation: '?', crop: { x: -1, y: 0, w: 2, h: 1 } }),
      ],
    });
    expect(items!.map((i) => i.id)).toEqual([ITEM.id, 'c']);
    expect(items![1].color).toBe('#000000');
    expect(items![1].orientation).toBe('landscape');
    expect(items![1].crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('local e descrição: texto fica; vazio, outro tipo ou ausente vira null', () => {
    const items = parseItems({
      items: [
        Object.assign({}, ITEM, {
          id: 'a',
          place: 'Jericoacoara, Ceará, Brazil',
          title: 'Sunset Dune',
          text: 'This natural formation is part of the dynamic dune system along the northeastern coast of Brazil.',
        }),
        Object.assign({}, ITEM, { id: 'b', place: 'Japan', title: null, text: null }),
        Object.assign({}, ITEM, { id: 'c', place: '', title: 42, text: { x: 1 } }),
      ],
    });
    expect(items!.map((i) => [i.place, i.title, i.text])).toEqual([
      ['Jericoacoara, Ceará, Brazil', 'Sunset Dune', 'This natural formation is part of the dynamic dune system along the northeastern coast of Brazil.'],
      ['Japan', null, null],
      [null, null, null],
    ]);
  });

  it('corpo sem items não serve', () => {
    expect(parseItems({})).toBeNull();
    expect(parseItems('x')).toBeNull();
    expect(parseItems({ items: [] })).toEqual([]);
  });
});
