import { describe, expect, it } from 'vitest';
import {
  LAYOUT_KEY,
  LayoutStore,
  anchorBox,
  clampCenter,
  layoutOrientation,
  placeBox,
  third,
  validateLayout,
} from '../src/layout';
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

const PHONE_UP = { w: 390, h: 844 };
const PHONE_SIDE = { w: 844, h: 390 };
const TV = { w: 1920, h: 1080 };

describe('posições por orientação', () => {
  it('orientação da tela: deitada (quadrada inclusive) ou em pé', () => {
    expect(layoutOrientation(PHONE_UP.w, PHONE_UP.h)).toBe('portrait');
    expect(layoutOrientation(PHONE_SIDE.w, PHONE_SIDE.h)).toBe('landscape');
    expect(layoutOrientation(1000, 1000)).toBe('landscape');
  });

  it('Celular girado: o relógio movido em pé fica no padrão deitado e volta ao ficar em pé', () => {
    const storage = new MemoryStorage();
    const store = new LayoutStore(storage);
    store.set(layoutOrientation(PHONE_UP.w, PHONE_UP.h), 'clock', { x: 0.2, y: 0.1 });
    // Gira: deitado, sem entrada → posição padrão (null).
    expect(store.position(layoutOrientation(PHONE_SIDE.w, PHONE_SIDE.h), 'clock')).toBeNull();
    // Em pé de novo, inclusive depois de recarregar.
    const reopened = new LayoutStore(storage);
    expect(reopened.position(layoutOrientation(PHONE_UP.w, PHONE_UP.h), 'clock')).toEqual({ x: 0.2, y: 0.1 });
    expect(reopened.position('landscape', 'clock')).toBeNull();
    expect(JSON.parse(storage.data[LAYOUT_KEY])).toEqual({ landscape: {}, portrait: { clock: { x: 0.2, y: 0.1 } } });
  });

  it('Restaurar: relógio e local voltam ao padrão nas duas orientações; as áreas (outra chave) ficam', () => {
    const storage = new MemoryStorage();
    storage.setItem('decklive.areas.v1', '[{"id":"a1"}]');
    const store = new LayoutStore(storage);
    store.set('landscape', 'clock', { x: 0.1, y: 0.1 });
    store.set('landscape', 'place', { x: 0.8, y: 0.2 });
    store.set('portrait', 'clock', { x: 0.5, y: 0.9 });
    let seen = 0;
    store.subscribe(() => seen++);
    store.restore();
    expect(seen).toBe(1);
    for (const o of ['landscape', 'portrait'] as const) {
      for (const id of ['clock', 'date', 'place', 'description']) expect(store.position(o, id)).toBeNull();
    }
    expect(new LayoutStore(storage).get()).toEqual({ landscape: {}, portrait: {} });
    expect(storage.data['decklive.areas.v1']).toBe('[{"id":"a1"}]');
  });

  it('arraste: set sem salvar vale na hora e só vai ao navegador no save', () => {
    const storage = new MemoryStorage();
    const store = new LayoutStore(storage);
    store.set('landscape', 'date', { x: 0.3, y: 0.3 }, false);
    expect(store.position('landscape', 'date')).toEqual({ x: 0.3, y: 0.3 });
    expect(storage.data[LAYOUT_KEY]).toBeUndefined();
    store.save();
    expect(new LayoutStore(storage).position('landscape', 'date')).toEqual({ x: 0.3, y: 0.3 });
  });

  it('valida ao ler: ids desconhecidos, tipos errados e JSON quebrado somem; fora de 0..1 é limitado', () => {
    expect(validateLayout(null)).toEqual({ landscape: {}, portrait: {} });
    expect(
      validateLayout({
        landscape: { clock: { x: 1.5, y: -2 }, date: { x: '0.5', y: 0.5 }, foo: { x: 0.1, y: 0.1 } },
        portrait: [1, 2],
      }),
    ).toEqual({ landscape: { clock: { x: 1, y: 0 } }, portrait: {} });
    const bad: StorageLike = { getItem: () => '{nope', setItem: () => {} };
    expect(new LayoutStore(bad).get()).toEqual({ landscape: {}, portrait: {} });
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = new LayoutStore(throwing);
    store.set('landscape', 'clock', { x: 0.1, y: 0.1 });
    expect(store.position('landscape', 'clock')).toEqual({ x: 0.1, y: 0.1 });
  });
});

describe('posição limitada à janela', () => {
  const clock = { w: 340, h: 149 };

  it('canto superior esquerdo: o relógio encosta na borda, inteiro dentro da janela', () => {
    expect(placeBox({ x: 0, y: 0 }, clock, TV)).toEqual({ left: 0, top: 0 });
    expect(placeBox({ x: 1, y: 1 }, clock, TV)).toEqual({ left: 1920 - 340, top: 1080 - 149 });
  });

  it('centro em proporção: o mesmo ponto em telas de tamanhos diferentes', () => {
    expect(placeBox({ x: 0.5, y: 0.5 }, clock, TV)).toEqual({ left: 790, top: 465.5 });
    const phone = placeBox({ x: 0.5, y: 0.5 }, { w: 151, h: 66 }, PHONE_UP);
    expect(phone.left + 151 / 2).toBeCloseTo(195, 9);
    expect(phone.top + 66 / 2).toBeCloseTo(422, 9);
  });

  it('elemento maior que a janela fica no canto, sem posição negativa', () => {
    expect(placeBox({ x: 0.9, y: 0.9 }, { w: 500, h: 500 }, { w: 400, h: 300 })).toEqual({ left: 0, top: 0 });
  });

  it('o centro guardado é o que aparece: seta na borda não acumula', () => {
    const c = clampCenter({ x: 1, y: 0 }, clock, TV);
    expect(c.x).toBeCloseTo((1920 - 170) / 1920, 9);
    expect(c.y).toBeCloseTo(74.5 / 1080, 9);
    // Um passo de 1% para a esquerda já aparece.
    const back = placeBox({ x: c.x - 0.01, y: c.y }, clock, TV);
    expect(back.left).toBeCloseTo(1920 - 340 - 19.2, 9);
  });

  it('Mover pelo controle: 5 passos de 1% andam 5% da largura', () => {
    const date = { w: 360, h: 36 };
    const a = placeBox({ x: 0.5, y: 0.6 }, date, TV);
    const b = placeBox({ x: 0.55, y: 0.6 }, date, TV);
    expect(b.left - a.left).toBeCloseTo(0.05 * 1920, 9);
  });
});

describe('alinhamento pelo terço', () => {
  it('terços da janela', () => {
    expect([0, 0.33, 0.34, 0.66, 0.67, 1].map(third)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('esquerda em cima: presa pelo canto superior esquerdo, texto à esquerda', () => {
    expect(anchorBox({ x: 0, y: 0 }, { w: 340, h: 149 }, TV)).toEqual({
      left: '0px',
      right: 'auto',
      top: '0px',
      bottom: 'auto',
      transform: 'translate(0, 0)',
      align: 'left',
    });
  });

  it('direita embaixo: presa pela borda direita e pela de baixo, texto cresce para a esquerda', () => {
    expect(anchorBox({ x: 0.9, y: 0.95 }, { w: 756, h: 120 }, TV)).toEqual({
      left: 'auto',
      right: '0px',
      top: 'auto',
      bottom: '0px',
      transform: 'translate(0, 0)',
      align: 'right',
    });
  });

  it('meio: preso pelo centro, que fica no lugar quando o texto muda', () => {
    expect(anchorBox({ x: 0.55, y: 0.5 }, { w: 360, h: 36 }, TV)).toEqual({
      left: '1056px',
      right: 'auto',
      top: '540px',
      bottom: 'auto',
      transform: 'translate(-50%, -50%)',
      align: 'center',
    });
  });
});
