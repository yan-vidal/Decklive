import { describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  SETTINGS_KEY,
  SettingsStore,
  appClasses,
  defaultSettings,
  safeStorage,
  validate,
  type StorageLike,
} from '../src/settings';

class MemoryStorage implements StorageLike {
  data: Record<string, string> = {};
  getItem(k: string) {
    return k in this.data ? this.data[k] : null;
  }
  setItem(k: string, v: string) {
    this.data[k] = v;
  }
}

describe('settings', () => {
  it('padrões: relógio 24 h ligado, data desligada, auto, 30 s, movimento, local e descrição ligados', () => {
    const s = new SettingsStore(new MemoryStorage()).get();
    expect(s).toEqual({
      clock: true,
      hour12: false,
      date: false,
      fit: 'auto',
      skipOther: false,
      interval: 30,
      motion: true,
      place: true,
      description: true,
    });
  });

  it('Preferência lembrada: a data ligada volta ligada ao reabrir', () => {
    const storage = new MemoryStorage();
    new SettingsStore(storage).set({ date: true });
    // "fecha o navegador e abre de novo": nova instância sobre o mesmo armazenamento.
    const reopened = new SettingsStore(storage);
    expect(reopened.get().date).toBe(true);
    expect(JSON.parse(storage.data[SETTINGS_KEY]).date).toBe(true);
  });

  it('Armazenamento bloqueado: abre com os padrões e os ajustes valem na visita', () => {
    const blocked = {
      get localStorage(): StorageLike {
        throw new Error('SecurityError');
      },
    };
    const storage = safeStorage(blocked);
    expect(storage).toBeNull();
    const store = new SettingsStore(storage);
    expect(store.get()).toEqual(DEFAULTS);
    store.set({ date: true, interval: 10 });
    expect(store.get().date).toBe(true);
    expect(store.get().interval).toBe(10);
  });

  it('setItem que lança não derruba o ajuste', () => {
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = new SettingsStore(throwing);
    expect(store.set({ clock: false }).clock).toBe(false);
  });

  it('getItem que lança ou JSON quebrado volta aos padrões', () => {
    const bad: StorageLike = { getItem: () => '{nope', setItem: () => {} };
    expect(new SettingsStore(bad).get()).toEqual(DEFAULTS);
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {},
    };
    expect(new SettingsStore(throwing).get()).toEqual(DEFAULTS);
  });

  it('valida campo a campo', () => {
    expect(validate({ fit: 'zoom', interval: 7, clock: 'yes', date: true })).toEqual(Object.assign({}, DEFAULTS, { date: true }));
    expect(validate({ fit: 'fit', interval: 300, hour12: true, skipOther: true })).toEqual(
      Object.assign({}, DEFAULTS, { fit: 'fit', interval: 300, hour12: true, skipOther: true }),
    );
    expect(validate(null)).toEqual(DEFAULTS);
  });

  it('avisa quem assina', () => {
    const store = new SettingsStore(null);
    const seen: boolean[] = [];
    store.subscribe((s) => seen.push(s.date));
    store.set({ date: true });
    expect(seen).toEqual([true]);
  });
});

// matchMedia de um aparelho que pede menos movimento, de um sem preferência e de um que não conhece a consulta.
const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';
const reduce = { matchMedia: (q: string) => ({ matches: q === REDUCE_QUERY }) };
const noPreference = { matchMedia: (_q: string) => ({ matches: false }) };

describe('movimento, local e descrição', () => {
  it('Padrão: movimento ligado num aparelho sem preferência de movimento', () => {
    expect(defaultSettings(noPreference)).toEqual(DEFAULTS);
    // Navegador sem matchMedia: a consulta não casa e o movimento fica ligado.
    expect(defaultSettings({}).motion).toBe(true);
    const store = new SettingsStore(new MemoryStorage(), defaultSettings(noPreference));
    expect(store.get().motion).toBe(true);
  });

  it('Aparelho pede menos movimento: começa desligado até o usuário escolher', () => {
    const defaults = defaultSettings(reduce);
    expect(defaults).toEqual(Object.assign({}, DEFAULTS, { motion: false }));
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage, defaults);
    expect(store.get().motion).toBe(false);
    // A escolha do usuário vale mais que a preferência do aparelho, também ao reabrir.
    store.set({ motion: true });
    expect(new SettingsStore(storage, defaultSettings(reduce)).get().motion).toBe(true);
  });

  it('validate completa com os padrões recebidos', () => {
    const defaults = defaultSettings(reduce);
    expect(validate({}, defaults).motion).toBe(false);
    expect(validate({ motion: true }, defaults).motion).toBe(true);
    expect(validate({ motion: 'no', place: 0, description: null }, DEFAULTS)).toEqual(DEFAULTS);
    expect(validate({ motion: false, place: false, description: false })).toEqual(
      Object.assign({}, DEFAULTS, { motion: false, place: false, description: false }),
    );
  });

  it('ajustes guardados antes desta versão ganham os padrões novos', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ clock: true, hour12: true, date: true, fit: 'fill', skipOther: false, interval: 10 }));
    const s = new SettingsStore(storage, defaultSettings(noPreference)).get();
    expect(s.hour12).toBe(true);
    expect([s.motion, s.place, s.description]).toEqual([true, true, true]);
  });

  it('Só o local: desligar "Descrição" esconde título e resumo, também ao abrir de novo', () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage);
    expect(appClasses(store.get())).toEqual({ 'no-clock': false, 'no-date': true, 'no-place': false, 'no-description': false });
    store.set({ description: false });
    const reopened = new SettingsStore(storage).get();
    expect([reopened.place, reopened.description]).toEqual([true, false]);
    expect(appClasses(reopened)).toEqual({ 'no-clock': false, 'no-date': true, 'no-place': false, 'no-description': true });
  });
});
