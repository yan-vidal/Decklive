// Mantém a tela acesa enquanto a página está visível, onde houver Wake Lock.

interface Sentinel {
  addEventListener(type: 'release', fn: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<Sentinel>;
}

interface WakeDocument {
  visibilityState?: string;
  hidden?: boolean;
  addEventListener(type: string, fn: () => void): void;
}

// Devolve false quando o navegador não tem a API (nada a fazer).
export function keepScreenOn(nav: { wakeLock?: WakeLockLike }, doc: WakeDocument): boolean {
  const wl = nav.wakeLock;
  if (!wl || typeof wl.request !== 'function') return false;
  let held = false;
  let pending = false;
  const acquire = () => {
    const visible = doc.visibilityState ? doc.visibilityState === 'visible' : !doc.hidden;
    if (!visible || held || pending) return;
    pending = true;
    wl.request('screen').then(
      (s) => {
        pending = false;
        held = true;
        // O navegador solta o pedido quando a página some; volta no próximo visibilitychange.
        s.addEventListener('release', () => {
          held = false;
        });
      },
      () => {
        pending = false;
      },
    );
  };
  doc.addEventListener('visibilitychange', acquire);
  // Alguns navegadores só concedem depois de um gesto do usuário.
  doc.addEventListener('click', acquire);
  doc.addEventListener('keydown', acquire);
  acquire();
  return true;
}
