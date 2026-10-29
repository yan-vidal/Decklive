// Faixas canônicas de tela (design D6). Mesma conta do Rust, provada por fixtures/screen-buckets.json.

export type Orientation = 'landscape' | 'portrait' | 'square';

export interface Size {
  w: number;
  h: number;
}

// Classes de proporção como frações inteiras (19,5:9 = 39:18).
export const RATIO_CLASSES: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [4, 3],
  [16, 10],
  [16, 9],
  [39, 18],
  [21, 9],
];

export const LONG_SIDES: ReadonlyArray<number> = [1280, 1920, 2560, 3840];

// Limites aceitos pela API para w e h.
export const MAX_SIDE = 16384;

// Classe mais próxima em |ln(r) − ln(c)|.
function nearestClass(long: number, short: number): readonly [number, number] {
  const r = Math.log(long / short);
  let best = RATIO_CLASSES[0];
  let bestDiff = Infinity;
  for (const c of RATIO_CLASSES) {
    const diff = Math.abs(r - Math.log(c[0] / c[1]));
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return best;
}

// Orientação de uma tela ou foto; a classe 1:1 é `square`.
export function orientationOf(w: number, h: number): Orientation {
  const c = nearestClass(Math.max(w, h), Math.min(w, h));
  if (c[0] === c[1]) return 'square';
  return w > h ? 'landscape' : 'portrait';
}

export function canonicalBucket(w: number, h: number): Size {
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const [num, den] = nearestClass(long, short);
  let side = LONG_SIDES[LONG_SIDES.length - 1];
  for (const s of LONG_SIDES) {
    if (s >= long) {
      side = s;
      break;
    }
  }
  if (num === den) return { w: side, h: side };
  // round(side / (num/den)) com meio para cima, em inteiros.
  const other = Math.floor((2 * side * den + num) / (2 * num));
  return w >= h ? { w: side, h: other } : { w: other, h: side };
}

// Tamanho físico da janela: pixels CSS × devicePixelRatio, dentro de 1..16384.
export function physicalSize(cssW: number, cssH: number, dpr: number): Size {
  const ratio = dpr > 0 ? dpr : 1;
  const clamp = (v: number) => Math.min(MAX_SIDE, Math.max(1, Math.round(v * ratio)));
  return { w: clamp(cssW), h: clamp(cssH) };
}

export function bucketKey(s: Size): string {
  return s.w + 'x' + s.h;
}

// Piso da escala do relógio e da data (celular em pé ou deitado).
export const LAYOUT_MIN_SCALE = 0.6;

// Escala do layout (design D10): menor fator entre lado longo/1280 e lado curto/800
// (a referência gira com a tela), para cima ou para baixo, nunca abaixo de 0,6.
export function layoutScale(cssW: number, cssH: number): number {
  const long = Math.max(cssW, cssH);
  const short = Math.min(cssW, cssH);
  return Math.max(LAYOUT_MIN_SCALE, Math.min(long / 1280, short / 800));
}

// Piso da escala dos controles e do painel: nunca menores que na tela de referência (toque no celular).
export const CONTROLS_MIN_SCALE = 1;
