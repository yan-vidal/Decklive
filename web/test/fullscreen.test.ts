import { describe, expect, it, vi } from 'vitest';
import { fullscreenSupported, isFullscreen, toggleFullscreen } from '../src/fullscreen';
import { keepScreenOn } from '../src/wake';

const listen = () => {};

describe('tela cheia', () => {
  it('iPhone: sem a API para elementos, não há suporte (botão some)', () => {
    expect(fullscreenSupported({ addEventListener: listen }, {})).toBe(false);
    // Safari no iPhone expõe o método no elemento, mas desabilitado.
    expect(fullscreenSupported({ webkitFullscreenEnabled: false, addEventListener: listen }, { webkitRequestFullscreen: () => {} })).toBe(false);
  });

  it('Chromium antigo com prefixo webkit tem suporte', () => {
    expect(fullscreenSupported({ webkitFullscreenEnabled: true, addEventListener: listen }, { webkitRequestFullscreen: () => {} })).toBe(true);
    expect(fullscreenSupported({ fullscreenEnabled: true, addEventListener: listen }, { requestFullscreen: () => {} })).toBe(true);
  });

  it('alterna entre entrar e sair, engolindo a recusa da Promise', async () => {
    const request = vi.fn(() => Promise.reject(new Error('sem gesto')));
    const exit = vi.fn();
    const doc = { fullscreenEnabled: true, fullscreenElement: null as Element | null, exitFullscreen: exit, addEventListener: listen };
    const el = { requestFullscreen: request };
    toggleFullscreen(doc, el);
    expect(request).toHaveBeenCalledTimes(1);
    doc.fullscreenElement = {} as Element;
    expect(isFullscreen(doc)).toBe(true);
    toggleFullscreen(doc, el);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe('tela acesa', () => {
  it('sem Wake Lock não faz nada', () => {
    expect(keepScreenOn({}, { addEventListener: listen })).toBe(false);
  });

  it('pede de novo ao voltar a ficar visível depois de soltar', async () => {
    const handlers: Record<string, () => void> = {};
    const releases: (() => void)[] = [];
    const request = vi.fn(() =>
      Promise.resolve({ addEventListener: (_: 'release', fn: () => void) => releases.push(fn) }),
    );
    const doc = { visibilityState: 'visible', addEventListener: (t: string, fn: () => void) => (handlers[t] = fn) };
    expect(keepScreenOn({ wakeLock: { request } }, doc)).toBe(true);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    handlers.visibilitychange();
    expect(request).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'hidden';
    releases[0]();
    handlers.visibilitychange();
    expect(request).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'visible';
    handlers.visibilitychange();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
