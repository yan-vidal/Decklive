import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AREAS_KEY,
  AreaStore,
  ENDPOINT_TIMEOUT_MS,
  MAX_AREAS,
  MIN_SIZE,
  Poller,
  allowedUrl,
  areaLabel,
  areaRect,
  fetchJson,
  fitRect,
  frameDoc,
  moveRect,
  resizeRect,
  validateAreas,
  type FetchLike,
} from '../src/areas';
import type { StorageLike } from '../src/settings';

class MemoryStorage implements StorageLike {
  data: Record<string, string> = {};
  getItem(k: string) {
    return k in this.data ? this.data[k] : null;
  }
  setItem(k: string, v: string) {
    this.data[k] = v;
  }
}

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

function close(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(a[k]).toBeCloseTo(b[k], 9);
}

describe('formato D4 (validação ao ler)', () => {
  it('lista vazia para o que não é lista', () => {
    expect(validateAreas(null)).toEqual([]);
    expect(validateAreas({ id: 'a1' })).toEqual([]);
    expect(validateAreas('[]')).toEqual([]);
  });

  it('as três formas, cada uma só com os campos do seu tipo', () => {
    const raw = [
      { id: 'a1', kind: 'text', text: 'Bem-vindo', size: 'l', imageUrl: 'https://x/y.png', layout: { landscape: R(0.5, 0.5, 0.3, 0.2) } },
      { id: 'a2', kind: 'image', imageUrl: 'https://cdn.example.com/logo.png', text: 'sobra', layout: { portrait: R(0.5, 0.2, 0.4, 0.1) } },
      {
        id: 'a3',
        kind: 'endpoint',
        endpoint: { url: 'https://api.example.com/fila', auth: 'Bearer abc', interval: 60, template: '<h1>{{atual}}</h1>' },
        layout: { landscape: R(0.8, 0.8, 0.2, 0.2), portrait: R(0.5, 0.8, 0.9, 0.2) },
      },
    ];
    expect(validateAreas(raw)).toEqual([
      { id: 'a1', kind: 'text', text: 'Bem-vindo', size: 'l', layout: { landscape: R(0.5, 0.5, 0.3, 0.2) } },
      { id: 'a2', kind: 'image', imageUrl: 'https://cdn.example.com/logo.png', layout: { portrait: R(0.5, 0.2, 0.4, 0.1) } },
      raw[2],
    ]);
  });

  it('campos inválidos voltam ao padrão, um a um: tipo → texto, tamanho → médio, frequência → 30 s', () => {
    const out = validateAreas([
      { id: 'a1', kind: 'video', text: 'x', layout: { landscape: R(0.5, 0.5, 0.3, 0.2) } },
      { id: 'a2', kind: 'text', text: 42, size: 'xl', layout: { landscape: R(0.5, 0.5, 0.3, 0.2) } },
      { id: 'a3', kind: 'endpoint', endpoint: { url: 5, interval: 7 }, layout: { landscape: R(0.5, 0.5, 0.3, 0.2) } },
      { id: 'a4', kind: 'endpoint', layout: { landscape: R(0.5, 0.5, 0.3, 0.2) } },
    ]);
    expect(out.map((a) => [a.kind, a.text, a.size])).toEqual([
      ['text', 'x', 'm'],
      ['text', '', 'm'],
      ['endpoint', undefined, undefined],
      ['endpoint', undefined, undefined],
    ]);
    expect(out[2].endpoint).toEqual({ url: '', auth: '', interval: 30, template: '' });
    expect(out[3].endpoint).toEqual({ url: '', auth: '', interval: 30, template: '' });
  });

  it('id inválido ou repetido descarta a área; no máximo 8', () => {
    const rect = { landscape: R(0.5, 0.5, 0.3, 0.2) };
    const many = [];
    for (let i = 1; i <= 10; i++) many.push({ id: 'a' + i, kind: 'text', text: String(i), layout: rect });
    expect(validateAreas(many).map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']);
    expect(MAX_AREAS).toBe(8);
    const bad = validateAreas([
      { id: '', kind: 'text', layout: rect },
      { id: '<x>', kind: 'text', layout: rect },
      { kind: 'text', layout: rect },
      { id: 'a1', kind: 'text', text: 'um', layout: rect },
      { id: 'a1', kind: 'text', text: 'outro', layout: rect },
      'a2',
    ]);
    expect(bad.map((a) => a.text)).toEqual(['um']);
  });

  it('textos longos são cortados', () => {
    const out = validateAreas([
      { id: 'a1', kind: 'text', text: 'x'.repeat(5000), layout: { landscape: R(0.5, 0.5, 0.3, 0.2) } },
      { id: 'a2', kind: 'endpoint', endpoint: { url: 'https://e/' + 'u'.repeat(5000), auth: 'a'.repeat(5000), template: 't'.repeat(9000) }, layout: {} },
    ]);
    expect(out[0].text!.length).toBe(1000);
    expect(out[1].endpoint!.url.length).toBe(2000);
    expect(out[1].endpoint!.auth.length).toBe(1000);
    expect(out[1].endpoint!.template.length).toBe(4000);
  });

  it('medidas: limitadas a 0..1, tamanho mínimo de 5% e a caixa inteira na janela; sem nenhuma, a padrão (em cima à esquerda)', () => {
    const out = validateAreas([
      { id: 'a1', kind: 'text', layout: { landscape: R(-1, 2, 0.01, 3), portrait: { x: '0.5', y: 0.5, w: 0.2, h: 0.2 } } },
      { id: 'a2', kind: 'text', layout: { portrait: R(0.99, 0.01, 0.5, 0.5) } },
      { id: 'a3', kind: 'text', layout: 'x' },
    ]);
    expect(out[0].layout).toEqual({ landscape: R(MIN_SIZE / 2, 0.5, MIN_SIZE, 1) });
    expect(out[1].layout).toEqual({ portrait: R(0.75, 0.25, 0.5, 0.5) });
    expect(out[2].layout).toEqual({ landscape: R(0.22, 0.25, 0.3, 0.2) });
  });
});

describe('medidas por orientação', () => {
  it('sem medida na orientação atual, a área usa a da outra, limitada para caber', () => {
    const [a] = validateAreas([{ id: 'a1', kind: 'text', layout: { landscape: R(0.8, 0.5, 0.3, 0.2) } }]);
    expect(areaRect(a, 'landscape')).toEqual(R(0.8, 0.5, 0.3, 0.2));
    expect(areaRect(a, 'portrait')).toEqual(R(0.8, 0.5, 0.3, 0.2));
    a.layout.portrait = R(0.2, 0.9, 0.4, 0.2);
    expect(areaRect(a, 'portrait')).toEqual(R(0.2, 0.9, 0.4, 0.2));
  });

  it('fitRect: centro puxado para dentro', () => {
    close(fitRect(R(0, 1, 0.3, 0.2)), R(0.15, 0.9, 0.3, 0.2));
    close(fitRect(R(0.5, 0.5, 2, 0)), R(0.5, 0.5, 1, MIN_SIZE));
  });

  it('mover: o centro novo, sem passar da borda', () => {
    close(moveRect(R(0.5, 0.5, 0.3, 0.2), { x: 0.55, y: 0.4 }), R(0.55, 0.4, 0.3, 0.2));
    close(moveRect(R(0.5, 0.5, 0.3, 0.2), { x: 1.2, y: -0.3 }), R(0.85, 0.1, 0.3, 0.2));
  });

  it('redimensionar: o canto superior esquerdo fica parado; mínimo de 5%; não passa da janela', () => {
    // Caixa de 0.35..0.65 × 0.4..0.6.
    close(resizeRect(R(0.5, 0.5, 0.3, 0.2), 0.31, 0.19), R(0.505, 0.495, 0.31, 0.19));
    close(resizeRect(R(0.5, 0.5, 0.3, 0.2), 0, -1), R(0.35 + MIN_SIZE / 2, 0.4 + MIN_SIZE / 2, MIN_SIZE, MIN_SIZE));
    close(resizeRect(R(0.5, 0.5, 0.3, 0.2), 2, 2), R(0.35 + 0.65 / 2, 0.4 + 0.6 / 2, 0.65, 0.6));
  });
});

describe('AreaStore', () => {
  it('Nova área: criada em cima à esquerda, na orientação atual, salva em decklive.areas.v1 e lida de volta', () => {
    const storage = new MemoryStorage();
    const store = new AreaStore(storage);
    let changes = 0;
    store.subscribe(() => changes++);
    const a = store.add('landscape')!;
    expect(a).toEqual({ id: 'a1', kind: 'text', text: '', size: 'm', layout: { landscape: R(0.22, 0.25, 0.3, 0.2) } });
    expect(changes).toBe(1);
    store.setRect('a1', 'landscape', resizeRect(areaRect(a, 'landscape'), 0.4, 0.25));
    const again = new AreaStore(storage).list();
    expect(again.length).toBe(1);
    close(again[0].layout.landscape!, R(0.27, 0.275, 0.4, 0.25));
    expect(again[0].layout.portrait).toBeUndefined();
    expect(JSON.parse(storage.data[AREAS_KEY])[0].id).toBe('a1');
  });

  it('no máximo 8: a nona não é criada; cada nova desce um pouco para não cobrir a anterior', () => {
    const store = new AreaStore(new MemoryStorage());
    for (let i = 0; i < 8; i++) expect(store.add('portrait')).not.toBeNull();
    expect(store.add('portrait')).toBeNull();
    expect(store.list().map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']);
    expect(store.list()[1].layout.portrait!.y).toBeGreaterThan(store.list()[0].layout.portrait!.y);
  });

  it('excluir libera o número, que a próxima área reaproveita; o nome segue o número', () => {
    const store = new AreaStore(new MemoryStorage());
    store.add('landscape');
    store.add('landscape');
    store.add('landscape');
    store.remove('a2');
    expect(store.list().map((a) => a.id)).toEqual(['a1', 'a3']);
    expect(store.add('landscape')!.id).toBe('a2');
    expect(areaLabel('Área', store.list()[1], 1)).toBe('Área 3');
    expect(areaLabel('Área', { id: 'xyz', kind: 'text', layout: {} }, 4)).toBe('Área 5');
  });

  it('conteúdo novo passa pela validação e mantém id e medidas', () => {
    const store = new AreaStore(new MemoryStorage());
    store.add('landscape');
    store.setContent('a1', { kind: 'image', imageUrl: 'https://cdn.example.com/a.png', text: 'x' });
    expect(store.get('a1')).toEqual({
      id: 'a1',
      kind: 'image',
      imageUrl: 'https://cdn.example.com/a.png',
      layout: { landscape: R(0.22, 0.25, 0.3, 0.2) },
    });
  });

  it('arraste: setRect sem salvar vale na hora e só vai ao navegador no fim', () => {
    const storage = new MemoryStorage();
    const store = new AreaStore(storage);
    store.add('landscape');
    store.setRect('a1', 'landscape', R(0.2, 0.2, 0.3, 0.2), false);
    expect(store.get('a1')!.layout.landscape).toEqual(R(0.2, 0.2, 0.3, 0.2));
    expect(JSON.parse(storage.data[AREAS_KEY])[0].layout.landscape).toEqual(R(0.22, 0.25, 0.3, 0.2));
    store.save();
    expect(JSON.parse(storage.data[AREAS_KEY])[0].layout.landscape).toEqual(R(0.2, 0.2, 0.3, 0.2));
  });

  it('replace troca tudo pela lista validada; armazenamento que lança não derruba', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = new AreaStore(throwing);
    expect(store.list()).toEqual([]);
    store.replace([{ id: 'b1', kind: 'text', text: 'oi', layout: { landscape: R(0.5, 0.5, 0.3, 0.2) } }, 7]);
    expect(store.list().map((a) => a.id)).toEqual(['b1']);
    const bad: StorageLike = { getItem: () => '{nope', setItem: () => {} };
    expect(new AreaStore(bad).list()).toEqual([]);
  });
});

describe('allowedUrl', () => {
  it('exige https; http só vale com a própria página em http (desenvolvimento local)', () => {
    expect(allowedUrl('https://api.example.com/fila', 'https:')).toBe(true);
    expect(allowedUrl('http://api.example.com/fila', 'https:')).toBe(false);
    expect(allowedUrl('http://127.0.0.1:9000/fila', 'http:')).toBe(true);
    expect(allowedUrl('https://api.example.com/fila', 'http:')).toBe(true);
  });

  it('recusa outros esquemas, relativas e lixo', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x/y', '/api/x', 'api.example.com', '', ' ']) {
      expect(allowedUrl(url, 'http:')).toBe(false);
    }
  });
});

describe('frameDoc (iframe da área de endpoint)', () => {
  it('estilo base: fundo transparente, texto branco com a sombra da data e 16 × --dl-ui px', () => {
    const doc = frameDoc('<h1>A12</h1>', 1.5);
    expect(doc).toMatch(/^<!doctype html>/);
    expect(doc).toContain('background:transparent');
    expect(doc).toContain('color:#fff');
    expect(doc).toContain('font-size:24px');
    expect(doc).toContain('text-shadow:0 3px 15px rgba(0,0,0,.8)');
    expect(doc).toMatch(/<body><h1>A12<\/h1><\/body><\/html>$/);
  });
});

function response(ok: boolean, body: unknown | Error): { ok: boolean; json(): Promise<unknown> } {
  return { ok, json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)) };
}

describe('fetchJson', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('manda Authorization só quando informado, sem cache, e devolve o JSON', async () => {
    const calls: { url: string; init: unknown }[] = [];
    const http: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(response(true, { atual: 'A12' }));
    };
    await expect(fetchJson(http, 'https://e/fila', 'Bearer x')).resolves.toEqual({ atual: 'A12' });
    await expect(fetchJson(http, 'https://e/fila', '')).resolves.toEqual({ atual: 'A12' });
    expect(calls).toEqual([
      { url: 'https://e/fila', init: { headers: { Authorization: 'Bearer x' }, cache: 'no-store' } },
      { url: 'https://e/fila', init: { headers: {}, cache: 'no-store' } },
    ]);
  });

  it('status fora de 2xx, JSON inválido, rede (ou CORS) e fetch que lança: todos são erro', async () => {
    await expect(fetchJson(() => Promise.resolve(response(false, {})), 'https://e', '')).rejects.toThrow();
    await expect(fetchJson(() => Promise.resolve(response(true, new SyntaxError('json'))), 'https://e', '')).rejects.toThrow();
    await expect(fetchJson(() => Promise.reject(new TypeError('Failed to fetch')), 'https://e', '')).rejects.toThrow();
    const throws: FetchLike = () => {
      throw new TypeError('Invalid header value');
    };
    await expect(fetchJson(throws, 'https://e', 'ç\n')).rejects.toThrow();
  });

  it('tempo limite de 10 s com Promise.race (sem AbortController)', async () => {
    const never: FetchLike = () => new Promise(() => {});
    const p = fetchJson(never, 'https://e', '');
    let failed = false;
    p.catch(() => (failed = true));
    await vi.advanceTimersByTimeAsync(ENDPOINT_TIMEOUT_MS - 1);
    expect(failed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(failed).toBe(true);
  });
});

describe('Poller (agendamento, relógio falso)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Cada chamada fica pendente até o teste responder.
  function setup(interval = 30) {
    const pending: { resolve(v: unknown): void; reject(e: unknown): void }[] = [];
    let hidden = false;
    const seen: string[] = [];
    const poller = new Poller(
      { url: 'https://e/fila', auth: 'Bearer x', interval },
      {
        fetchJson: () =>
          new Promise((resolve, reject) => {
            pending.push({ resolve, reject });
          }),
        hidden: () => hidden,
      },
      (d) => seen.push('data:' + JSON.stringify(d)),
      () => seen.push('error'),
    );
    return {
      poller,
      pending,
      seen,
      setHidden: (h: boolean) => {
        hidden = h;
        poller.visibilityChanged();
      },
    };
  }

  it('chama na hora e marca a próxima só depois da resposta, na frequência escolhida', async () => {
    const { poller, pending, seen } = setup(30);
    poller.start();
    expect(pending.length).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    pending[0].resolve({ atual: 'A12' });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(['data:{"atual":"A12"}']);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(pending.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pending.length).toBe(2);
  });

  it('resposta lenta não acumula chamadas (setTimeout depois de cada resposta, não setInterval)', async () => {
    const { poller, pending } = setup(10);
    poller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending.length).toBe(1);
    pending[0].resolve({});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending.length).toBe(2);
  });

  it('erro: avisa e tenta de novo na frequência configurada', async () => {
    const { poller, pending, seen } = setup(60);
    poller.start();
    pending[0].reject(new Error('cors'));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(['error']);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(pending.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pending.length).toBe(2);
    pending[1].resolve([1]);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(['error', 'data:[1]']);
  });

  it('página oculta: para; ao voltar, chama na hora', async () => {
    const { poller, pending, setHidden } = setup(30);
    poller.start();
    pending[0].resolve({});
    await vi.advanceTimersByTimeAsync(10_000);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(pending.length).toBe(1);
    setHidden(false);
    expect(pending.length).toBe(2);
    // Voltar de novo com uma chamada em curso não duplica.
    setHidden(true);
    setHidden(false);
    expect(pending.length).toBe(2);
  });

  it('resposta que chega com a página oculta não marca a próxima; a volta chama na hora', async () => {
    const { poller, pending, seen, setHidden } = setup(30);
    poller.start();
    setHidden(true);
    pending[0].resolve({ ok: 1 });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(seen).toEqual(['data:{"ok":1}']);
    expect(pending.length).toBe(1);
    setHidden(false);
    expect(pending.length).toBe(2);
  });

  it('começar com a página oculta só chama quando ela aparece', async () => {
    const { poller, pending, setHidden } = setup(30);
    setHidden(true);
    poller.start();
    expect(pending.length).toBe(0);
    setHidden(false);
    expect(pending.length).toBe(1);
  });

  it('stop: nada mais é chamado e a resposta atrasada é ignorada', async () => {
    const { poller, pending, seen } = setup(10);
    poller.start();
    poller.stop();
    pending[0].resolve({ tarde: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(seen).toEqual([]);
    expect(pending.length).toBe(1);
  });

  it('erro ao mostrar os dados conta como erro e não interrompe o agendamento', async () => {
    const pending: { resolve(v: unknown): void }[] = [];
    let errors = 0;
    const poller = new Poller(
      { url: 'https://e', auth: '', interval: 10 },
      { fetchJson: () => new Promise((resolve) => pending.push({ resolve })), hidden: () => false },
      () => {
        throw new Error('render');
      },
      () => errors++,
    );
    poller.start();
    pending[0].resolve({});
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending.length).toBe(2);
  });
});
