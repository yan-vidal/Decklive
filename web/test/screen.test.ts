import { describe, expect, it } from 'vitest';
import table from '../../fixtures/screen-buckets.json';
import { CONTROLS_MIN_SCALE, LONG_SIDES, RATIO_CLASSES, canonicalBucket, layoutScale, orientationOf, physicalSize } from '../src/screen';

describe('faixas canônicas (fixtures/screen-buckets.json)', () => {
  it('usa as mesmas classes e lados longos da tabela', () => {
    expect(RATIO_CLASSES.map((c) => [c[0], c[1]])).toEqual(table.ratio_classes);
    expect(LONG_SIDES.slice()).toEqual(table.long_sides);
  });

  for (const s of table.screens) {
    it(`${s.w}×${s.h} → ${s.canonical.w}×${s.canonical.h}`, () => {
      expect(canonicalBucket(s.w, s.h)).toEqual(s.canonical);
    });
  }

  it('faixa canônica é ponto fixo', () => {
    for (const s of table.screens) {
      const c = canonicalBucket(s.w, s.h);
      expect(canonicalBucket(c.w, c.h)).toEqual(c);
    }
  });

  for (const p of table.photos) {
    it(`foto ${p.w}×${p.h} é ${p.orientation}`, () => {
      expect(orientationOf(p.w, p.h)).toBe(p.orientation);
    });
  }
});

describe('physicalSize', () => {
  it('multiplica pelo devicePixelRatio e arredonda', () => {
    expect(physicalSize(390, 844, 3)).toEqual({ w: 1170, h: 2532 });
    expect(physicalSize(1280, 800, 1.5)).toEqual({ w: 1920, h: 1200 });
  });

  it('fica dentro de 1..16384', () => {
    expect(physicalSize(0, 20000, 1)).toEqual({ w: 1, h: 16384 });
    expect(physicalSize(100, 100, 0)).toEqual({ w: 100, h: 100 });
  });
});

describe('layoutScale', () => {
  it('é 1 na tela de referência e 2,7 numa 4K (relógio de 259 px)', () => {
    expect(layoutScale(1280, 800)).toBe(1);
    expect(layoutScale(3840, 2160)).toBe(2.7);
    expect(Math.round(96 * layoutScale(3840, 2160))).toBe(259);
  });

  it('TV Full HD: 1,35', () => {
    expect(layoutScale(1920, 1080)).toBe(1.35);
  });

  it('Celular em pé e deitado: piso de 0,6 (relógio de 57,6 px, data de 13,2 px)', () => {
    expect(layoutScale(390, 844)).toBe(0.6);
    expect(layoutScale(844, 390)).toBe(0.6);
    expect(96 * layoutScale(390, 844)).toBeCloseTo(57.6, 9);
    expect(22 * layoutScale(390, 844)).toBeCloseTo(13.2, 9);
  });

  it('a referência gira com a tela', () => {
    expect(layoutScale(800, 1280)).toBe(1);
    expect(layoutScale(2160, 3840)).toBe(2.7);
  });

  it('botões e painel nunca abaixo da referência', () => {
    expect(Math.max(CONTROLS_MIN_SCALE, layoutScale(390, 844))).toBe(1);
    expect(Math.max(CONTROLS_MIN_SCALE, layoutScale(1920, 1080))).toBe(1.35);
  });
});
