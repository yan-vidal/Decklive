// Preferências do player, guardadas só neste navegador.

export type FitMode = 'auto' | 'fill' | 'fit';

export interface Settings {
  clock: boolean;
  hour12: boolean;
  date: boolean;
  fit: FitMode;
  skipOther: boolean;
  // Segundos por foto.
  interval: number;
  // Movimento de câmera em cada foto.
  motion: boolean;
  // Local da foto e, separado, título e resumo.
  place: boolean;
  description: boolean;
}

export const SETTINGS_KEY = 'decklive.settings.v1';
export const FIT_MODES: ReadonlyArray<FitMode> = ['auto', 'fill', 'fit'];
export const INTERVALS: ReadonlyArray<number> = [10, 30, 60, 300];

export const DEFAULTS: Readonly<Settings> = {
  clock: true,
  hour12: false,
  date: false,
  fit: 'auto',
  skipOther: false,
  interval: 30,
  motion: true,
  place: true,
  description: true,
};

// Padrões deste aparelho: sem movimento quando ele pede menos movimento (design D7).
// Navegador que não conhece a consulta simplesmente não casa.
export function defaultSettings(win: { matchMedia?: (query: string) => { matches: boolean } }): Settings {
  const reduce = !!win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return Object.assign({}, DEFAULTS, { motion: !reduce });
}

// Classes de #app que mostram ou escondem relógio, data, local e descrição.
export function appClasses(s: Settings): { [name: string]: boolean } {
  return { 'no-clock': !s.clock, 'no-date': !s.date, 'no-place': !s.place, 'no-description': !s.description };
}

// Subconjunto do Storage usado aqui (facilita os testes).
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

// localStorage pode não existir ou lançar (modo privado, cookies bloqueados).
export function safeStorage(win: { localStorage?: StorageLike }): StorageLike | null {
  try {
    const s = win.localStorage;
    if (!s) return null;
    const probe = 'decklive.probe';
    s.setItem(probe, '1');
    if (s.removeItem) s.removeItem(probe);
    return s;
  } catch (e) {
    return null;
  }
}

// Campo a campo: o que vier inválido ou faltar volta ao padrão.
export function validate(raw: unknown, defaults: Readonly<Settings> = DEFAULTS): Settings {
  const out: Settings = Object.assign({}, defaults);
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.clock === 'boolean') out.clock = r.clock;
  if (typeof r.hour12 === 'boolean') out.hour12 = r.hour12;
  if (typeof r.date === 'boolean') out.date = r.date;
  if (typeof r.skipOther === 'boolean') out.skipOther = r.skipOther;
  if (typeof r.motion === 'boolean') out.motion = r.motion;
  if (typeof r.place === 'boolean') out.place = r.place;
  if (typeof r.description === 'boolean') out.description = r.description;
  if (FIT_MODES.indexOf(r.fit as FitMode) >= 0) out.fit = r.fit as FitMode;
  if (INTERVALS.indexOf(r.interval as number) >= 0) out.interval = r.interval as number;
  return out;
}

export class SettingsStore {
  private value: Settings;
  private listeners: ((s: Settings) => void)[] = [];

  constructor(
    private storage: StorageLike | null,
    private defaults: Readonly<Settings> = DEFAULTS,
  ) {
    this.value = validate(read(storage), defaults);
  }

  get(): Settings {
    return this.value;
  }

  // Vale na hora; salvar é melhor esforço.
  set(patch: Partial<Settings>): Settings {
    this.value = validate(Object.assign({}, this.value, patch), this.defaults);
    if (this.storage) {
      try {
        this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.value));
      } catch (e) {
        // Cota cheia ou bloqueio: segue só em memória.
      }
    }
    for (const fn of this.listeners) fn(this.value);
    return this.value;
  }

  subscribe(fn: (s: Settings) => void): void {
    this.listeners.push(fn);
  }
}

function read(storage: StorageLike | null): unknown {
  if (!storage) return null;
  try {
    const text = storage.getItem(SETTINGS_KEY);
    return text ? JSON.parse(text) : null;
  } catch (e) {
    return null;
  }
}
