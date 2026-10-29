// Tela cheia com detecção de recurso e prefixo webkit (Chromium 53–70, Safari 12).

interface FsDocument {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => unknown;
  webkitExitFullscreen?: () => unknown;
  addEventListener(type: string, fn: () => void): void;
}

interface FsElement {
  requestFullscreen?: () => unknown;
  webkitRequestFullscreen?: () => unknown;
}

// iPhone não tem tela cheia para elementos: o botão some.
export function fullscreenSupported(doc: FsDocument, el: FsElement): boolean {
  const enabled = doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
  const request = typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
  return enabled && request;
}

export function isFullscreen(doc: FsDocument): boolean {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

export function toggleFullscreen(doc: FsDocument, el: FsElement): void {
  try {
    const result = isFullscreen(doc)
      ? (doc.exitFullscreen || doc.webkitExitFullscreen)!.call(doc)
      : (el.requestFullscreen || el.webkitRequestFullscreen)!.call(el);
    // Versões novas devolvem Promise; recusa (sem gesto do usuário) não é erro do player.
    if (result && typeof (result as Promise<void>).then === 'function') {
      (result as Promise<void>).then(undefined, () => undefined);
    }
  } catch (e) {
    // Sem suporte de verdade: nada a fazer.
  }
}

export function onFullscreenChange(doc: FsDocument, fn: () => void): void {
  doc.addEventListener('fullscreenchange', fn);
  doc.addEventListener('webkitfullscreenchange', fn);
}
