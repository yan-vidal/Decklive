import { describe, expect, it } from 'vitest';
import type { Crop, PlaylistItem } from '../src/api';
import { canonicalBucket } from '../src/screen';
import {
  FIT_ZOOM,
  MOTION_PAN,
  MOTION_ZOOM,
  fillBox,
  motionAt,
  motionEnds,
  nextPlan,
  originOf,
  pauseMove,
  progressOf,
  resolveMode,
  transformOf,
  visibleItems,
  type Box,
  type Motion,
  type Plan,
} from '../src/stage';

// Maior corte centrado na proporção da faixa (o que a API manda sem enquadramento).
function maxCrop(iw: number, ih: number, W: number, H: number, fx = 0.5, fy = 0.5): Crop {
  const A = W / H;
  const cw = iw / ih > A ? ih * A : iw;
  const ch = iw / ih > A ? ih : iw / A;
  const w = cw / iw;
  const h = ch / ih;
  const x = Math.min(1 - w, Math.max(0, fx - w / 2));
  const y = Math.min(1 - h, Math.max(0, fy - h / 2));
  return { x, y, w, h };
}

// Foto real do acervo: 2944×1839 (3:2, deitada).
const IW = 2944;
const IH = 1839;
const EPS = 1e-6;

function expectCoversWithoutDistortion(box: ReturnType<typeof fillBox>, vw: number, vh: number) {
  // Sem deformação: mesma proporção da foto.
  expect(Math.abs(box.width / box.height - IW / IH)).toBeLessThan(EPS);
  // Cobre a janela inteira, sem borda vazia.
  expect(box.left).toBeLessThanOrEqual(EPS);
  expect(box.top).toBeLessThanOrEqual(EPS);
  expect(box.left + box.width).toBeGreaterThanOrEqual(vw - EPS);
  expect(box.top + box.height).toBeGreaterThanOrEqual(vh - EPS);
}

describe('fillBox', () => {
  it('janela na proporção exata da faixa: mostra exatamente o corte', () => {
    const crop = maxCrop(IW, IH, 1920, 1080);
    const box = fillBox(crop, IW, IH, 1920, 1080);
    expectCoversWithoutDistortion(box, 1920, 1080);
    expect(-box.left / box.width).toBeCloseTo(crop.x, 6);
    expect(-box.top / box.height).toBeCloseTo(crop.y, 6);
    expect(1920 / box.width).toBeCloseTo(crop.w, 6);
    expect(1080 / box.height).toBeCloseTo(crop.h, 6);
  });

  it('1280×1024 (5:4, faixa 4:3): sem deformação e com o centro do corte no centro', () => {
    const b = canonicalBucket(1280, 1024);
    expect(b).toEqual({ w: 1280, h: 960 });
    const crop = maxCrop(IW, IH, b.w, b.h);
    const box = fillBox(crop, IW, IH, 1280, 1024);
    expectCoversWithoutDistortion(box, 1280, 1024);
    expect(box.left + (crop.x + crop.w / 2) * box.width).toBeCloseTo(640, 6);
    expect(box.top + (crop.y + crop.h / 2) * box.height).toBeCloseTo(512, 6);
  });

  it('Janela com proporção diferente da faixa: 1920×970 (faixa 19,5:9)', () => {
    const b = canonicalBucket(1920, 970);
    expect(b).toEqual({ w: 1920, h: 886 });
    const crop = maxCrop(IW, IH, b.w, b.h);
    const box = fillBox(crop, IW, IH, 1920, 970);
    expectCoversWithoutDistortion(box, 1920, 970);
    expect(box.left + (crop.x + crop.w / 2) * box.width).toBeCloseTo(960, 6);
    expect(box.top + (crop.y + crop.h / 2) * box.height).toBeCloseTo(485, 6);
  });

  it('desloca para não mostrar borda vazia quando o corte encosta na borda', () => {
    // Corte em pé encostado na borda direita (ponto de interesse x=0.95).
    const crop = maxCrop(IW, IH, 591, 1280, 0.95);
    expect(crop.x + crop.w).toBeCloseTo(1, 9);
    // Janela um pouco mais larga que a faixa: centrar o corte mostraria borda à direita.
    const box = fillBox(crop, IW, IH, 400, 844);
    expectCoversWithoutDistortion(box, 400, 844);
    expect(box.left + box.width).toBeCloseTo(400, 6);
  });

  it('foto em pé numa janela deitada também cobre sem deformar', () => {
    const crop = maxCrop(IH, IW, 1920, 1080);
    const box = fillBox(crop, IH, IW, 1920, 1080);
    expect(Math.abs(box.width / box.height - IH / IW)).toBeLessThan(EPS);
    expect(box.width).toBeCloseTo(1920, 6);
    expect(box.height).toBeGreaterThan(1080);
  });
});

describe('resolveMode', () => {
  it('auto preenche quando a orientação bate e mostra inteira quando não bate', () => {
    expect(resolveMode('auto', 'landscape', 'landscape')).toBe('fill');
    expect(resolveMode('auto', 'portrait', 'landscape')).toBe('fit');
    expect(resolveMode('auto', 'square', 'landscape')).toBe('fit');
    expect(resolveMode('auto', 'square', 'square')).toBe('fill');
    expect(resolveMode('auto', 'landscape', 'square')).toBe('fit');
  });

  it('fill e fit valem sempre', () => {
    expect(resolveMode('fill', 'portrait', 'landscape')).toBe('fill');
    expect(resolveMode('fit', 'landscape', 'landscape')).toBe('fit');
  });
});

describe('visibleItems', () => {
  const item = (id: string, orientation: PlaylistItem['orientation']): PlaylistItem => ({
    id,
    src: 'https://cdn.yanlucas.com/' + id + '.jpeg',
    width: 100,
    height: 100,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    color: '#000000',
    orientation,
  });
  const all = [item('l', 'landscape'), item('p', 'portrait'), item('s', 'square')];

  it('Opção ligada no celular em pé: só portrait e square', () => {
    expect(visibleItems(all, 'portrait', true).map((i) => i.id)).toEqual(['p', 's']);
  });

  it('desligada mostra todas', () => {
    expect(visibleItems(all, 'portrait', false)).toHaveLength(3);
  });

  it('se nenhuma bater, mostra todas', () => {
    const onlyLandscape = [item('a', 'landscape'), item('b', 'landscape')];
    expect(visibleItems(onlyLandscape, 'portrait', true)).toHaveLength(2);
  });
});

// --- Movimento de câmera (design D4) ---

// Lê de volta o que vai para o CSS: o teste confere as strings, não só as contas.
const TRANSFORM_RE = /^translate\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px\) scale\((\d+(?:\.\d+)?)\)$/;

function parseTransform(css: string): Motion {
  const m = TRANSFORM_RE.exec(css);
  if (!m) throw new Error('transform fora do formato: ' + css);
  return { x: Number(m[1]), y: Number(m[2]), s: Number(m[3]) };
}

function parseOrigin(css: string): [number, number] {
  const m = /^(-?\d+(?:\.\d+)?)px (-?\d+(?:\.\d+)?)px$/.exec(css);
  if (!m) throw new Error('origin fora do formato: ' + css);
  return [Number(m[1]), Number(m[2])];
}

// O que o navegador faz numa transição entre listas de funções iguais: interpola componente a componente.
function interpolate(fromCss: string, toCss: string, q: number): Motion {
  const a = parseTransform(fromCss);
  const b = parseTransform(toCss);
  return { x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, s: a.s + (b.s - a.s) * q };
}

// Caixa do img na janela depois de translate(x, y) scale(s) com a origem dada (em coordenadas do img).
function transformed(box: Box, origin: [number, number], m: Motion): { left: number; top: number; right: number; bottom: number } {
  const [ox, oy] = origin;
  return {
    left: box.left + ox + m.x - m.s * ox,
    top: box.top + oy + m.y - m.s * oy,
    right: box.left + ox + m.x + m.s * (box.width - ox),
    bottom: box.top + oy + m.y + m.s * (box.height - oy),
  };
}

const SAMPLES = 100;
const PLANS: Plan[] = [];
for (const zoomIn of [true, false]) for (let diagonal = 0; diagonal < 4; diagonal++) PLANS.push({ zoomIn, diagonal });

// Fotos reais deitada e em pé, com o ponto de interesse no centro e encostado nas bordas.
const PHOTOS: [number, number][] = [
  [IW, IH],
  [IH, IW],
];
const FOCI: [number, number][] = [
  [0.5, 0.5],
  [0.02, 0.02],
  [0.98, 0.98],
  [0.95, 0.1],
];

function expectCovers(box: Box, vw: number, vh: number, origin: [number, number], m: Motion, what: string) {
  const t = transformed(box, origin, m);
  const tol = 1e-6;
  if (t.left > tol || t.top > tol || t.right < vw - tol || t.bottom < vh - tol) {
    throw new Error(what + ': borda vazia ' + JSON.stringify(t) + ' em ' + vw + '×' + vh);
  }
}

describe('movimento', () => {
  it('Duas fotos seguidas: aproximação e afastamento se alternam e a diagonal gira entre as quatro', () => {
    const seq: Plan[] = [];
    let plan: Plan | null = null;
    for (let i = 0; i < 8; i++) {
      plan = nextPlan(plan);
      seq.push(plan);
    }
    expect(seq.map((p) => p.zoomIn)).toEqual([true, false, true, false, true, false, true, false]);
    expect(seq.map((p) => p.diagonal)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
  });

  it('fill: A parado em 100%, B em 106% deslocado 60% da folga na diagonal', () => {
    const vw = 1920;
    const vh = 970;
    const kx = (MOTION_PAN * (MOTION_ZOOM - 1) * vw) / 2;
    const ky = (MOTION_PAN * (MOTION_ZOOM - 1) * vh) / 2;
    const signs = [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ];
    for (let d = 0; d < 4; d++) {
      const zin = motionEnds(true, { zoomIn: true, diagonal: d }, vw, vh);
      expect(zin.from).toEqual({ x: 0, y: 0, s: 1 });
      expect(zin.to.s).toBe(MOTION_ZOOM);
      expect(zin.to.x).toBeCloseTo(signs[d][0] * kx, 9);
      expect(zin.to.y).toBeCloseTo(signs[d][1] * ky, 9);
      // Afastamento: o mesmo caminho ao contrário.
      const zout = motionEnds(true, { zoomIn: false, diagonal: d }, vw, vh);
      expect(zout.from).toEqual(zin.to);
      expect(zout.to).toEqual(zin.from);
    }
    expect(MOTION_ZOOM).toBe(1.06);
    expect(MOTION_PAN).toBe(0.6);
  });

  it('Foto inteira (fit): de 97% a 100% a partir do centro, sem deslocamento', () => {
    expect(FIT_ZOOM).toBe(0.97);
    const zin = motionEnds(false, { zoomIn: true, diagonal: 1 }, 1920, 1080);
    expect(zin).toEqual({ from: { x: 0, y: 0, s: FIT_ZOOM }, to: { x: 0, y: 0, s: 1 } });
    const zout = motionEnds(false, { zoomIn: false, diagonal: 2 }, 1920, 1080);
    expect(zout).toEqual({ from: { x: 0, y: 0, s: 1 }, to: { x: 0, y: 0, s: FIT_ZOOM } });
    // Em todo p a foto continua inteira: escala entre 97% e 100% e nenhum deslocamento.
    for (let i = 0; i <= SAMPLES; i++) {
      const m = parseTransform(transformOf(motionAt(zin.from, zin.to, i / SAMPLES)));
      expect(m.x).toBe(0);
      expect(m.y).toBe(0);
      expect(m.s).toBeGreaterThanOrEqual(FIT_ZOOM);
      expect(m.s).toBeLessThanOrEqual(1);
    }
  });

  it('estado no progresso p: linear entre as pontas e preso a [0, 1]', () => {
    const { from, to } = motionEnds(true, { zoomIn: true, diagonal: 0 }, 1000, 500);
    const half = motionAt(from, to, 0.5);
    expect(half.s).toBeCloseTo(1.03, 12);
    expect(half.x).toBeCloseTo(to.x / 2, 12);
    expect(half.y).toBeCloseTo(to.y / 2, 12);
    expect(motionAt(from, to, -1)).toEqual(from);
    expect(motionAt(from, to, 2)).toEqual(to);
  });

  it('as duas pontas viram a mesma lista de funções, em px, sem notação científica', () => {
    const { from, to } = motionEnds(true, { zoomIn: true, diagonal: 3 }, 1920, 970);
    expect(transformOf(from)).toBe('translate(0px, 0px) scale(1)');
    expect(transformOf(to)).toMatch(TRANSFORM_RE);
    expect(transformOf({ x: 1e-9, y: -3e-8, s: 1 })).toBe('translate(0px, 0px) scale(1)');
  });

  it('transform-origin no centro da janela, em coordenadas do img', () => {
    const box = { left: -120, top: -40.5, width: 2160, height: 1350 };
    expect(originOf(box, 1920, 970)).toBe('1080px 525.5px');
  });

  for (const [vw, vh] of [
    [1920, 970],
    [1280, 1024],
    [390, 844],
  ]) {
    it('Foto preenchendo a tela em ' + vw + '×' + vh + ': a caixa transformada cobre a janela em todo p', () => {
      const b = canonicalBucket(vw, vh);
      let checks = 0;
      for (const [iw, ih] of PHOTOS) {
        for (const [fx, fy] of FOCI) {
          const box = fillBox(maxCrop(iw, ih, b.w, b.h, fx, fy), iw, ih, vw, vh);
          const origin = parseOrigin(originOf(box, vw, vh));
          for (const plan of PLANS) {
            const { from, to } = motionEnds(true, plan, vw, vh);
            const a = transformOf(from);
            const z = transformOf(to);
            for (let i = 0; i <= SAMPLES; i++) {
              const p = i / SAMPLES;
              // A transição do navegador e o estado que o player calcula no reenquadramento.
              expectCovers(box, vw, vh, origin, interpolate(a, z, p), 'transição p=' + p);
              const at = transformOf(motionAt(from, to, p));
              expectCovers(box, vw, vh, origin, parseTransform(at), 'estado p=' + p);
              // Reenquadramento: do estado em p até o fim, no tempo que falta.
              if (i % 10 === 0) {
                for (let j = 0; j <= 10; j++) expectCovers(box, vw, vh, origin, interpolate(at, z, j / 10), 'resto p=' + p);
              }
              checks++;
            }
          }
        }
      }
      expect(checks).toBe(PHOTOS.length * FOCI.length * PLANS.length * (SAMPLES + 1));
    });
  }

  it('a prova pega um movimento que sairia da região (deslocamento de 110% da folga)', () => {
    // Janela na proporção exata do corte: o img encosta nas bordas e não sobra folga além da ampliação.
    const vw = 1920;
    const vh = 1080;
    const box = fillBox(maxCrop(IW, IH, vw, vh), IW, IH, vw, vh);
    expect(box.left).toBeCloseTo(0, 9);
    const origin = parseOrigin(originOf(box, vw, vh));
    const k = (1.1 * (MOTION_ZOOM - 1)) / 2;
    expect(() => expectCovers(box, vw, vh, origin, { x: k * vw, y: 0, s: MOTION_ZOOM }, 'teste')).toThrow(/borda vazia/);
  });
});

describe('pausa do modo de edição', () => {
  const plan: Plan = { zoomIn: true, diagonal: 0 };

  it('pauseMove guarda o progresso de agora e o tempo que falta', () => {
    const m = { plan, p0: 0, t0: 1000, ms: 30600 };
    const paused = pauseMove(m, 1000 + 10200);
    expect(paused.p0).toBeCloseTo(1 / 3, 9);
    expect(paused.ms).toBe(20400);
    // Parada: o progresso guardado não muda enquanto o t0 não muda.
    expect(paused.plan).toBe(plan);
  });

  it('retomar depois de 1 min continua de onde parou e termina no tempo que faltava', () => {
    const m = { plan, p0: 0, t0: 0, ms: 30600 };
    const paused = pauseMove(m, 10200);
    const resumedAt = 10200 + 60000;
    const resumed = Object.assign({}, paused, { t0: resumedAt });
    expect(progressOf(resumed, resumedAt)).toBeCloseTo(1 / 3, 9);
    expect(progressOf(resumed, resumedAt + 10200)).toBeCloseTo(2 / 3, 9);
    expect(progressOf(resumed, resumedAt + 20400)).toBe(1);
  });

  it('movimento já no fim fica no fim', () => {
    const paused = pauseMove({ plan, p0: 0, t0: 0, ms: 1000 }, 5000);
    expect(paused.p0).toBe(1);
    expect(paused.ms).toBe(0);
  });
});
