import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock, formatDate, formatTime, type ClockText } from '../src/clock';
import { detectLang } from '../src/i18n';

// vite.config.ts põe TZ=America/Fortaleza (UTC−3, sem horário de verão).
describe('relógio', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('roda no fuso do cenário', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Fortaleza');
  });

  it('Relógio padrão: 18:05 em America/Fortaleza', () => {
    vi.setSystemTime(new Date('2026-10-28T21:05:00Z'));
    const seen: ClockText[] = [];
    const clock = new Clock('pt', () => false, (t) => seen.push(t));
    clock.refresh();
    expect(seen[0].time).toBe('18:05');
    expect(seen[0].period).toBe('');
    clock.stop();
  });

  it('a troca de minuto aparece em até 1 s depois da virada', () => {
    vi.setSystemTime(new Date('2026-10-28T21:05:42.300Z'));
    const seen: string[] = [];
    const clock = new Clock('pt', () => false, (t) => seen.push(t.time));
    clock.refresh();
    expect(seen).toEqual(['18:05']);
    // Até a virada (18:06:00.000), nada muda.
    vi.advanceTimersByTime(17699);
    expect(seen).toEqual(['18:05']);
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(['18:05', '18:06']);
    // E segue virando a cada minuto.
    vi.advanceTimersByTime(60000);
    expect(seen[seen.length - 1]).toBe('18:07');
    clock.stop();
  });

  it('formato 12 h', () => {
    expect(formatTime(new Date(2026, 9, 28, 18, 5), true)).toEqual({ time: '6:05', period: 'PM' });
    expect(formatTime(new Date(2026, 9, 28, 0, 7), true)).toEqual({ time: '12:07', period: 'AM' });
    expect(formatTime(new Date(2026, 9, 28, 12, 0), true)).toEqual({ time: '12:00', period: 'PM' });
    expect(formatTime(new Date(2026, 9, 28, 7, 9), false)).toEqual({ time: '07:09', period: '' });
  });
});

describe('data', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Data ligada em português: "Quarta-feira, 28 de outubro"', () => {
    vi.setSystemTime(new Date('2026-10-28T21:05:00Z'));
    const seen: ClockText[] = [];
    const clock = new Clock(detectLang('pt-BR'), () => false, (t) => seen.push(t));
    clock.refresh();
    expect(seen[0].date).toBe('Quarta-feira, 28 de outubro');
    clock.stop();
  });

  it('outros idiomas: inglês', () => {
    const d = new Date(2026, 9, 28, 18, 5);
    expect(formatDate(d, detectLang('en-US'))).toBe('Wednesday, October 28');
    expect(formatDate(d, detectLang('es-ES'))).toBe('Wednesday, October 28');
    expect(formatDate(new Date(2026, 10, 5), 'pt')).toBe('Quinta-feira, 5 de novembro');
  });

  it('vira à meia-noite local', () => {
    vi.setSystemTime(new Date(2026, 9, 28, 23, 59, 59, 500));
    const seen: ClockText[] = [];
    const clock = new Clock('pt', () => false, (t) => seen.push(t));
    clock.refresh();
    expect(seen[0]).toEqual({ time: '23:59', period: '', date: 'Quarta-feira, 28 de outubro' });
    vi.advanceTimersByTime(1000);
    expect(seen[1]).toEqual({ time: '00:00', period: '', date: 'Quinta-feira, 29 de outubro' });
    clock.stop();
  });
});

describe('detectLang', () => {
  it('pt-BR e pt usam português; o resto, inglês', () => {
    expect(detectLang('pt-BR')).toBe('pt');
    expect(detectLang('pt')).toBe('pt');
    expect(detectLang('PT_br')).toBe('pt');
    expect(detectLang('en-GB')).toBe('en');
    expect(detectLang('ptx')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
});

describe('data sem os dados do idioma no Intl (TV)', () => {
  it('cai na tabela própria com o mesmo formato', async () => {
    vi.resetModules();
    const spy = vi.spyOn(Intl.DateTimeFormat, 'supportedLocalesOf').mockReturnValue([]);
    const fresh = await import('../src/clock');
    const d = new Date(2026, 9, 28, 18, 5);
    expect(fresh.formatDate(d, 'pt')).toBe('Quarta-feira, 28 de outubro');
    expect(fresh.formatDate(d, 'en')).toBe('Wednesday, October 28');
    spy.mockRestore();
  });
});
