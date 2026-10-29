import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../src/settings';
import {
  PAIRING_URL,
  buildPackage,
  normalizeCode,
  parsePackage,
  receivePackage,
  sendPackage,
  type TransferFetch,
} from '../src/transfer';

const AREA = {
  id: 'a1',
  kind: 'endpoint',
  endpoint: { url: 'https://api.example.com/fila', auth: 'Bearer abc', interval: 60, template: '<h1>{{atual}}</h1>' },
  layout: { landscape: { x: 0.8, y: 0.2, w: 0.3, h: 0.2 } },
};

function reply(status: number, body: unknown = null) {
  return Promise.resolve({ status, json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)) });
}

describe('pacote de envio (design D7)', () => {
  it('{v: 1, settings, layout, areas}, e o mesmo pacote volta igual do outro lado', () => {
    const settings = Object.assign({}, DEFAULTS, { date: true, interval: 60 });
    const layout = { landscape: { clock: { x: 0.2, y: 0.1 } }, portrait: {} };
    const pkg = buildPackage(settings, layout, [AREA as never]);
    expect(pkg).toEqual({ v: 1, settings, layout, areas: [AREA] });
    expect(parsePackage(JSON.parse(JSON.stringify(pkg)), DEFAULTS)).toEqual(pkg);
  });

  it('valida campo a campo: o que vier inválido volta ao padrão deste aparelho', () => {
    const local = Object.assign({}, DEFAULTS, { motion: false });
    const raw = {
      v: 1,
      settings: { date: true, interval: 7, fit: 'zoom', clock: 'sim' },
      layout: { landscape: { clock: { x: 2, y: 0.5 }, foo: { x: 0.1, y: 0.1 } }, portrait: 'x' },
      areas: [AREA, { id: 'a1', kind: 'text' }, { id: '!!', kind: 'text' }, 5],
    };
    expect(parsePackage(raw, local)).toEqual({
      v: 1,
      settings: Object.assign({}, local, { date: true }),
      layout: { landscape: { clock: { x: 1, y: 0.5 } }, portrait: {} },
      areas: [AREA],
    });
    expect(parsePackage({ v: 1 }, local)).toEqual({ v: 1, settings: local, layout: { landscape: {}, portrait: {} }, areas: [] });
  });

  it('sem objeto, ou de outra versão: null', () => {
    for (const raw of [null, 'x', [1], { v: 2, settings: {} }, { settings: {} }]) expect(parsePackage(raw, DEFAULTS)).toBeNull();
  });
});

describe('código', () => {
  it('maiúsculas, sem espaços nem hífens; só o alfabeto sem ambíguos, com 6 caracteres', () => {
    expect(normalizeCode('gb7wx5')).toBe('GB7WX5');
    expect(normalizeCode(' GB7-WX5 ')).toBe('GB7WX5');
    for (const bad of ['', 'GB7WX', 'GB7WX55', 'GB7WX0', 'OB7WX5', 'IB7WX5', 'LB7WX5', 'GB7WX1', 'GB7W/5']) {
      expect(normalizeCode(bad)).toBeNull();
    }
  });
});

describe('envio e recebimento', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const pkg = buildPackage(DEFAULTS, { landscape: {}, portrait: {} }, []);

  it('POST /api/pairing com o pacote em JSON: 201 dá o código e o tempo', async () => {
    const calls: { url: string; init: unknown }[] = [];
    const http: TransferFetch = (url, init) => {
      calls.push({ url, init });
      return reply(201, { code: 'GB7WX5', expires_in: 600 });
    };
    await expect(sendPackage(http, pkg)).resolves.toEqual({ code: 'GB7WX5', expiresIn: 600 });
    expect(calls).toEqual([
      { url: PAIRING_URL, init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pkg) } },
    ]);
  });

  it('413 é "grande demais"; 503, outros status, resposta sem código, rede e tempo esgotado são falha', async () => {
    await expect(sendPackage(() => reply(413), pkg)).resolves.toEqual({ error: 'too-large' });
    await expect(sendPackage(() => reply(503), pkg)).resolves.toEqual({ error: 'failed' });
    await expect(sendPackage(() => reply(201, { nope: 1 }), pkg)).resolves.toEqual({ error: 'failed' });
    await expect(sendPackage(() => Promise.reject(new TypeError('x')), pkg)).resolves.toEqual({ error: 'failed' });
    const slow = sendPackage(() => new Promise(() => {}), pkg);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(slow).resolves.toEqual({ error: 'failed' });
  });

  it('Do computador para a TV: GET /api/pairing/{código} sem cache devolve o pacote validado', async () => {
    const calls: { url: string; init: unknown }[] = [];
    const http: TransferFetch = (url, init) => {
      calls.push({ url, init });
      return reply(200, JSON.parse(JSON.stringify(pkg)));
    };
    await expect(receivePackage(http, 'gb7 wx5', DEFAULTS)).resolves.toEqual({ pkg });
    expect(calls).toEqual([{ url: PAIRING_URL + '/GB7WX5', init: { cache: 'no-store' } }]);
  });

  it('Código errado: 404 ou código impossível (sem chamar a API) dão "inválido"', async () => {
    let called = 0;
    const http: TransferFetch = () => {
      called++;
      return reply(404, { error: 'not_found' });
    };
    await expect(receivePackage(http, 'ZZZZZZ', DEFAULTS)).resolves.toEqual({ error: 'invalid' });
    expect(called).toBe(1);
    await expect(receivePackage(http, 'abc', DEFAULTS)).resolves.toEqual({ error: 'invalid' });
    expect(called).toBe(1);
  });

  it('rede, outros status, JSON quebrado ou pacote inválido: falha', async () => {
    await expect(receivePackage(() => reply(500), 'GB7WX5', DEFAULTS)).resolves.toEqual({ error: 'failed' });
    await expect(receivePackage(() => reply(200, new SyntaxError('x')), 'GB7WX5', DEFAULTS)).resolves.toEqual({ error: 'failed' });
    await expect(receivePackage(() => reply(200, [1, 2]), 'GB7WX5', DEFAULTS)).resolves.toEqual({ error: 'failed' });
    await expect(receivePackage(() => Promise.reject(new TypeError('x')), 'GB7WX5', DEFAULTS)).resolves.toEqual({ error: 'failed' });
  });
});
