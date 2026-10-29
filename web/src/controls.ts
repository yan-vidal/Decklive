// Controles discretos: mostrar/esconder botões e cursor, foco por setas e as teclas Voltar.
import type { Panel } from './panel';

export type KeyAction = 'left' | 'right' | 'up' | 'down' | 'enter' | 'back';

export const HIDE_AFTER_MS = 4000;
// Toque que revelou os botões não aciona o botão que estava escondido embaixo dele.
const TAP_GUARD_MS = 400;

// keyCode: setas, Enter/OK, Esc, Backspace, 461 (Voltar do webOS) e 10009 (Voltar do Tizen).
const BY_CODE: { [code: number]: KeyAction } = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  13: 'enter',
  27: 'back',
  8: 'back',
  461: 'back',
  10009: 'back',
};

const BY_KEY: { [key: string]: KeyAction } = {
  ArrowLeft: 'left',
  Left: 'left',
  ArrowUp: 'up',
  Up: 'up',
  ArrowRight: 'right',
  Right: 'right',
  ArrowDown: 'down',
  Down: 'down',
  Enter: 'enter',
  Escape: 'back',
  Esc: 'back',
  Backspace: 'back',
  GoBack: 'back',
};

const has = Object.prototype.hasOwnProperty;

export function keyAction(e: { key?: string; keyCode?: number }): KeyAction | null {
  if (e.key && has.call(BY_KEY, e.key)) return BY_KEY[e.key];
  if (typeof e.keyCode === 'number' && has.call(BY_CODE, e.keyCode)) return BY_CODE[e.keyCode];
  return null;
}

export interface Cell {
  row: number;
  col: number;
}

// Foco numa grade de linhas de botões; subir ou descer vai para a opção escolhida da linha, se houver.
export function moveInGrid(
  lengths: number[],
  from: Cell,
  action: 'left' | 'right' | 'up' | 'down',
  preferred: (row: number) => number,
): Cell {
  const { row, col } = from;
  if (action === 'left') return { row, col: Math.max(0, col - 1) };
  if (action === 'right') return { row, col: Math.min(lengths[row] - 1, col + 1) };
  const next = Math.min(lengths.length - 1, Math.max(0, row + (action === 'up' ? -1 : 1)));
  if (next === row) return from;
  const p = preferred(next);
  return { row: next, col: p >= 0 ? p : Math.min(col, lengths[next] - 1) };
}

function pressedIndex(buttons: HTMLButtonElement[]): number {
  for (let i = 0; i < buttons.length; i++) if (buttons[i].getAttribute('aria-pressed') === 'true') return i;
  return -1;
}

export class Controls {
  private visible = false;
  private panelOpen = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private shownAt = 0;
  private lastX = -1;
  private lastY = -1;

  constructor(
    private app: HTMLElement,
    private settingsBtn: HTMLButtonElement,
    private bar: HTMLButtonElement[],
    private panel: Panel,
    panelEl: HTMLElement,
  ) {
    document.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('mousemove', (e) => {
      // Alguns navegadores disparam mousemove sem o ponteiro mexer.
      if (e.screenX === this.lastX && e.screenY === this.lastY) return;
      this.lastX = e.screenX;
      this.lastY = e.screenY;
      this.show();
    });
    const pointer = () => {
      app.classList.remove('keyboard');
      this.show();
    };
    document.addEventListener('mousedown', pointer);
    document.addEventListener('touchstart', pointer);
    document.addEventListener('click', (e) => {
      const target = e.target as Node;
      if (this.panelOpen && !panelEl.contains(target) && !settingsBtn.contains(target)) this.closePanel();
    });
    settingsBtn.addEventListener('click', (e) => {
      if (this.guarded(e)) return;
      if (this.panelOpen) this.closePanel();
      else this.openPanel();
    });
  }

  // Clique real logo depois de revelar os botões é ignorado; .click() do teclado passa.
  guarded(e: MouseEvent): boolean {
    return e.detail > 0 && Date.now() - this.shownAt < TAP_GUARD_MS;
  }

  show(): void {
    if (!this.visible) {
      this.visible = true;
      this.shownAt = Date.now();
      this.app.classList.add('show-controls');
      this.app.classList.remove('idle');
    }
    this.armHide();
  }

  hide(): void {
    if (this.panelOpen) return;
    this.visible = false;
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.app.classList.remove('show-controls');
    this.app.classList.add('idle');
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && this.app.contains(active)) active.blur();
  }

  openPanel(): void {
    this.panelOpen = true;
    this.app.classList.add('panel-open');
    this.show();
    // Foco na opção escolhida da primeira preferência.
    const first = this.panel.rows[1];
    first[Math.max(0, pressedIndex(first))].focus();
  }

  closePanel(): void {
    this.panelOpen = false;
    this.app.classList.remove('panel-open');
    this.settingsBtn.focus();
    this.show();
  }

  private armHide(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (this.panelOpen) return;
    this.hideTimer = setTimeout(() => this.hide(), HIDE_AFTER_MS);
  }

  private grid(): HTMLButtonElement[][] {
    if (this.panelOpen) return this.panel.rows;
    return [this.bar.filter((b) => b.offsetParent !== null)];
  }

  private onKey(e: KeyboardEvent): void {
    const action = keyAction(e);
    this.app.classList.add('keyboard');
    if (!action) {
      this.show();
      return;
    }
    if (!this.visible) {
      // Nada aberto: Voltar fica com o navegador (sair do player continua possível).
      if (action === 'back') return;
      e.preventDefault();
      this.show();
      this.settingsBtn.focus();
      return;
    }
    e.preventDefault();
    this.show();
    if (action === 'back') {
      if (this.panelOpen) this.closePanel();
      else this.hide();
      return;
    }
    const grid = this.grid();
    const active = document.activeElement;
    let from: Cell | null = null;
    grid.forEach((row, r) => {
      const c = row.indexOf(active as HTMLButtonElement);
      if (c >= 0) from = { row: r, col: c };
    });
    if (!from) {
      // Foco perdido (clique fora, por exemplo): volta ao ponto de partida.
      if (this.panelOpen) this.openPanel();
      else this.settingsBtn.focus();
      return;
    }
    if (action === 'enter') {
      (active as HTMLButtonElement).click();
      return;
    }
    const to = moveInGrid(
      grid.map((row) => row.length),
      from,
      action,
      (r) => pressedIndex(grid[r]),
    );
    grid[to.row][to.col].focus();
  }
}
