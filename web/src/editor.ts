// Modo de edição da tela (design D3): contorno e nome em cada elemento móvel, arraste por mouse e
// toque, navegação por direção pelo controle e a barra com "Nova área", "Restaurar" e "Concluir".
// As áreas próprias ganham ainda a alça de tamanho no canto e um menu (Mover, Redimensionar...).
import type { KeyAction } from './controls';
import type { Point, Rect } from './layout';

export type Direction = 'left' | 'right' | 'up' | 'down';

// Passo das setas no estado de mover: 1% da janela.
export const STEP = 0.01;
// Arraste só começa depois de alguns px, para um toque simples não "mover" o elemento para o mesmo lugar.
const DRAG_SLOP = 4;
// Contorno um pouco maior que o elemento e nunca menor que um alvo de toque.
const FRAME_PAD = 6;
const FRAME_MIN = 44;

// Item móvel do editor. Os fixos (relógio, data, local, descrição) vêm de layout.ts; as áreas
// próprias entram na mesma lista, com `activate` (menu) e `resizeBy` (redimensionar pelas setas).
export interface EditItem {
  id: string;
  label: string;
  // Retângulo na tela, em px.
  rect(): Rect;
  // Novo centro em proporção da janela; o dono limita à janela. `save` false durante o arraste.
  moveTo(p: Point, save: boolean): void;
  // OK no item (ou toque sem arraste): sem isto, OK pega o item para as setas o moverem.
  activate?(): void;
  // Estado "redimensionar": as setas mudam largura e altura em proporção da janela.
  resizeBy?(dw: number, dh: number): void;
  // Alça do canto inferior direito: largura e altura novas em proporção da janela. Com isto, o
  // contorno ganha a alça. `save` false durante o arraste.
  resizeTo?(w: number, h: number, save: boolean): void;
}

// Opção do menu de um item (as áreas: Mover, Redimensionar, Conteúdo, Excluir).
export interface MenuEntry {
  label: string;
  run: () => void;
}

export interface EditorOptions {
  labels: { newArea: string; restore: string; done: string; editHint: string; moveHint: string; resizeHint?: string };
  // Itens visíveis agora, na ordem da navegação.
  items(): EditItem[];
  restore(): void;
  // Gancho das áreas próprias; sem ele (ou com `canAddArea` falso, no limite), "Nova área" fica desabilitado.
  newArea?: () => void;
  canAddArea?: () => boolean;
  onOpen(): void;
  onClose(): void;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

function centerOf(r: Rect): Point {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Próximo alvo na direção apertada, pela distância entre os centros: a distância no eixo da seta mais
// o dobro do desvio lateral. Só valem os que estão no cone de 45° da seta; os quatro cones cobrem a
// tela, então todo item é alcançável por alguma seta. -1 se não houver nenhum: o foco fica.
export function pickInDirection(from: Rect, candidates: Rect[], dir: Direction): number {
  const c = centerOf(from);
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((r, i) => {
    const p = centerOf(r);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const main = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const side = Math.abs(dir === 'left' || dir === 'right' ? dy : dx);
    if (main < 1 || side > main) return;
    const score = main + 2 * side;
    if (score < bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

interface Frame {
  item: EditItem;
  el: HTMLButtonElement;
  label: HTMLSpanElement;
}

interface Drag {
  item: EditItem;
  // Mover (pelo contorno) ou redimensionar (pela alça).
  mode: 'move' | 'resize';
  x0: number;
  y0: number;
  // Centro (mover) ou largura e altura (redimensionar) no começo, em proporção da janela.
  c0: Point;
  last: Point | null;
  // Toque que arrasta; null no mouse.
  touch: number | null;
}

interface Menu {
  id: string;
  el: HTMLDivElement;
  buttons: HTMLButtonElement[];
}

export class Editor {
  private root: HTMLDivElement;
  private barEl: HTMLDivElement;
  private bar: HTMLButtonElement[];
  private hint: HTMLDivElement;
  private frames: Frame[] = [];
  private opened = false;
  private grabbed: { item: EditItem; mode: 'move' | 'resize' } | null = null;
  private drag: Drag | null = null;
  private openMenu: Menu | null = null;
  private onMouseMove = (e: MouseEvent) => this.dragTo(e.clientX, e.clientY);
  private onMouseUp = () => this.endDrag();
  private onTouchMove = (e: TouchEvent) => {
    const t = this.touchOf(e);
    if (!t) return;
    // A página não rola nem dá zoom durante o arraste.
    e.preventDefault();
    this.dragTo(t.clientX, t.clientY);
  };
  private onTouchEnd = (e: TouchEvent) => {
    if (this.touchOf(e)) this.endDrag();
  };

  constructor(
    private app: HTMLElement,
    private opts: EditorOptions,
  ) {
    const root = document.createElement('div');
    root.id = 'editor';
    const bar = document.createElement('div');
    bar.className = 'ed-bar';
    const l = opts.labels;
    const newArea = opts.newArea;
    this.bar = [
      this.button(bar, l.newArea, newArea ? () => this.addArea() : null),
      this.button(bar, l.restore, () => opts.restore()),
      this.button(bar, l.done, () => this.close()),
    ];
    // Clique ou toque fora do menu aberto o fecha.
    const outside = (e: Event) => {
      const m = this.openMenu;
      if (m && !m.el.contains(e.target as Node)) this.closeMenu(false);
    };
    root.addEventListener('mousedown', outside);
    root.addEventListener('touchstart', outside);
    this.hint = document.createElement('div');
    this.hint.className = 'ed-hint';
    this.hint.textContent = l.editHint;
    bar.appendChild(this.hint);
    root.appendChild(bar);
    app.appendChild(root);
    this.root = root;
    this.barEl = bar;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.app.classList.add('editing');
    this.opts.onOpen();
    // Refaz os contornos se a lista mudou (o onOpen pode já ter feito isso) e os põe no lugar.
    this.refresh();
    const first = this.frames.length > 0 ? this.frames[0].el : this.bar[2];
    first.focus();
  }

  // "Concluir", Esc ou Voltar: as posições já estão salvas a cada passo e no fim de cada arraste.
  close(): void {
    if (!this.opened) return;
    this.endDrag(true);
    this.closeMenu(false);
    this.release();
    this.opened = false;
    this.app.classList.remove('editing');
    this.opts.onClose();
  }

  // Pega um item para as setas: mover, ou redimensionar (áreas, pelo menu delas).
  grab(id: string, mode: 'move' | 'resize' = 'move'): void {
    const f = this.frameOf(id);
    if (!f) return;
    this.closeMenu(false);
    this.release();
    this.grabbed = { item: f.item, mode };
    f.el.classList.add('grabbed');
    f.el.focus();
    const l = this.opts.labels;
    this.hint.textContent = mode === 'resize' && l.resizeHint ? l.resizeHint : l.moveHint;
  }

  // Foco no contorno do item; sem ele (excluído), no primeiro alvo.
  focus(id?: string): void {
    const f = id ? this.frameOf(id) : null;
    const targets = this.targets();
    if (f) f.el.focus();
    else if (targets.length > 0) targets[0].focus();
  }

  // Menu junto ao contorno do item, abaixo dele (ou acima, se não couber). As setas andam entre as
  // opções, OK escolhe e Voltar fecha.
  menu(id: string, entries: MenuEntry[]): void {
    const f = this.frameOf(id);
    if (!f || entries.length === 0) return;
    this.closeMenu(false);
    this.release();
    const el = document.createElement('div');
    el.className = 'ed-menu';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', f.item.label);
    const buttons = entries.map((entry) => {
      const b = this.button(el, entry.label, () => {
        this.closeMenu(false);
        entry.run();
      });
      b.setAttribute('role', 'menuitem');
      return b;
    });
    this.root.appendChild(el);
    this.openMenu = { id, el, buttons };
    const vw = this.app.clientWidth;
    const vh = this.app.clientHeight;
    const r = f.el.getBoundingClientRect();
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    const gap = 8;
    let top = r.bottom + gap;
    if (top + mh > vh) top = r.top - gap - mh;
    // Sem espaço em cima nem embaixo (área quase da altura da tela): por dentro, no alto do contorno.
    if (top < 0) top = Math.max(0, Math.min(vh - mh, r.top + gap));
    el.style.left = Math.max(0, Math.min(vw - mw, r.left)) + 'px';
    el.style.top = top + 'px';
    buttons[0].focus();
  }

  // Reposiciona os contornos; refaz a lista se os itens mudaram (área criada ou excluída).
  refresh(): void {
    if (!this.opened) return;
    const canAdd = !!this.opts.newArea && (!this.opts.canAddArea || this.opts.canAddArea());
    this.bar[0].disabled = !canAdd;
    const items = this.opts.items();
    const same = items.length === this.frames.length && items.every((it, i) => it.id === this.frames[i].item.id);
    if (!same) {
      this.rebuild();
      return;
    }
    const vw = this.app.clientWidth;
    const vh = this.app.clientHeight;
    const boxes = this.frames.map((f) => {
      const r = f.item.rect();
      const w = Math.min(vw, Math.max(FRAME_MIN, r.width + 2 * FRAME_PAD));
      const h = Math.min(vh, Math.max(FRAME_MIN, r.height + 2 * FRAME_PAD));
      // Centro no elemento; o contorno não sai da janela.
      const box = {
        left: Math.max(0, Math.min(vw - w, r.left + r.width / 2 - w / 2)),
        top: Math.max(0, Math.min(vh - h, r.top + r.height / 2 - h / 2)),
        width: w,
        height: h,
      };
      const s = f.el.style;
      s.left = box.left + 'px';
      s.top = box.top + 'px';
      s.width = w + 'px';
      s.height = h + 'px';
      return box;
    });
    // Nome em cima do contorno; embaixo quando em cima ele sairia da janela ou cobriria outro item
    // (a data sob o relógio, a descrição sob o local).
    this.frames.forEach((f, i) => {
      const b = boxes[i];
      const lw = f.label.offsetWidth;
      const lh = f.label.offsetHeight;
      const free = (top: number) => {
        const r = { left: b.left, top, width: lw, height: lh };
        return top >= 0 && top + lh <= vh && boxes.every((o, j) => j === i || !overlaps(r, o));
      };
      const above = b.top - lh;
      f.el.classList.toggle('label-below', above < 0 || (!free(above) && free(b.top + b.height)));
    });
  }

  // Teclas do controle enquanto o modo está aberto (Controls.setModal).
  key(action: KeyAction): void {
    const m = this.openMenu;
    if (m) {
      const i = m.buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (action === 'back') this.closeMenu(true);
      else if (action === 'enter') {
        if (i >= 0) m.buttons[i].click();
        else m.buttons[0].focus();
      } else {
        const step = action === 'up' || action === 'left' ? -1 : 1;
        m.buttons[Math.max(0, Math.min(m.buttons.length - 1, i + step))].focus();
      }
      return;
    }
    const g = this.grabbed;
    if (g) {
      if (action === 'enter' || action === 'back') {
        this.release();
        return;
      }
      const dx = action === 'left' ? -STEP : action === 'right' ? STEP : 0;
      const dy = action === 'up' ? -STEP : action === 'down' ? STEP : 0;
      if (g.mode === 'resize' && g.item.resizeBy) {
        g.item.resizeBy(dx, dy);
      } else {
        const c = this.center(g.item);
        g.item.moveTo({ x: c.x + dx, y: c.y + dy }, true);
      }
      return;
    }
    if (action === 'back') {
      this.close();
      return;
    }
    const targets = this.targets();
    const active = document.activeElement;
    let i = -1;
    targets.forEach((el, k) => {
      if (el === active) i = k;
    });
    if (i < 0) {
      // Foco perdido (clique fora): volta ao primeiro.
      if (targets.length > 0) targets[0].focus();
      return;
    }
    if (action === 'enter') {
      const f = this.frameOf(targets[i]);
      if (!f) targets[i].click();
      else if (f.item.activate) f.item.activate();
      else this.grab(f.item.id);
      return;
    }
    const rects = targets.map((el) => el.getBoundingClientRect());
    const j = pickInDirection(rects[i], rects, action);
    if (j >= 0) targets[j].focus();
  }

  private button(parent: HTMLElement, label: string, run: (() => void) | null): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ed-btn';
    b.textContent = label;
    if (run) b.addEventListener('click', run);
    else b.disabled = true;
    parent.appendChild(b);
    return b;
  }

  // "Nova área": o dono cria a área (a lista muda e os contornos são refeitos) e o foco vai para ela.
  private addArea(): void {
    const before = this.opts.items().map((it) => it.id);
    if (this.opts.newArea) this.opts.newArea();
    this.refresh();
    const added = this.opts.items().filter((it) => before.indexOf(it.id) < 0)[0];
    if (added) this.focus(added.id);
  }

  private closeMenu(refocus: boolean): void {
    const m = this.openMenu;
    if (!m) return;
    this.openMenu = null;
    if (m.el.parentNode) m.el.parentNode.removeChild(m.el);
    if (refocus) this.focus(m.id);
  }

  // Contornos e botões habilitados, na ordem da tela.
  private targets(): HTMLButtonElement[] {
    return this.frames.map((f) => f.el).concat(this.bar.filter((b) => !b.disabled));
  }

  private frameOf(key: string | Element): Frame | null {
    for (const f of this.frames) if (f.item.id === key || f.el === key) return f;
    return null;
  }

  private center(item: EditItem): Point {
    const c = centerOf(item.rect());
    return { x: c.x / (this.app.clientWidth || 1), y: c.y / (this.app.clientHeight || 1) };
  }

  private release(): void {
    if (!this.grabbed) return;
    const f = this.frameOf(this.grabbed.item.id);
    if (f) f.el.classList.remove('grabbed');
    this.grabbed = null;
    this.hint.textContent = this.opts.labels.editHint;
  }

  private rebuild(): void {
    const focused = this.frameOf(document.activeElement as Element);
    const grabbedId = this.grabbed ? this.grabbed.item.id : null;
    for (const f of this.frames) this.root.removeChild(f.el);
    this.frames = this.opts.items().map((item) => {
      const el = document.createElement('button');
      el.type = 'button';
      // Áreas (com alça) ficam abaixo dos contornos dos elementos fixos, que são menores.
      el.className = 'ed-frame' + (item.resizeTo ? ' ed-area' : '') + (item.id === grabbedId ? ' grabbed' : '');
      const label = document.createElement('span');
      label.className = 'ed-label';
      label.textContent = item.label;
      el.appendChild(label);
      el.setAttribute('aria-label', item.label);
      this.dragFrom(el, item, 'move');
      if (item.resizeTo) {
        // Alça de tamanho no canto inferior direito. Ela recebe o evento antes do contorno, e o
        // startDrag do contorno vê o arraste já começado e não faz nada.
        const handle = document.createElement('span');
        handle.className = 'ed-handle';
        el.appendChild(handle);
        this.dragFrom(handle, item, 'resize');
      }
      // Contornos abaixo da barra.
      this.root.insertBefore(el, this.barEl);
      return { item, el, label };
    });
    if (grabbedId && !this.frameOf(grabbedId)) this.release();
    if (this.openMenu && !this.frameOf(this.openMenu.id)) this.closeMenu(false);
    this.refresh();
    if (focused) {
      const again = this.frameOf(focused.item.id);
      if (again) again.el.focus();
    }
  }

  // Mouse (botão principal) e toque; sem Pointer Events (Chromium 53, Safari 12).
  private dragFrom(el: HTMLElement, item: EditItem, mode: 'move' | 'resize'): void {
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.startDrag(item, mode, e.clientX, e.clientY, null);
    });
    el.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      // Sem os eventos de mouse emulados depois do toque.
      e.preventDefault();
      if (t) this.startDrag(item, mode, t.clientX, t.clientY, t.identifier);
    });
  }

  private startDrag(item: EditItem, mode: 'move' | 'resize', x: number, y: number, touch: number | null): void {
    if (this.drag) return;
    this.release();
    let c0 = this.center(item);
    if (mode === 'resize') {
      const r = item.rect();
      c0 = { x: r.width / (this.app.clientWidth || 1), y: r.height / (this.app.clientHeight || 1) };
    }
    this.drag = { item, mode, x0: x, y0: y, c0, last: null, touch };
    if (touch === null) {
      document.addEventListener('mousemove', this.onMouseMove);
      document.addEventListener('mouseup', this.onMouseUp);
    } else {
      // passive: false para o preventDefault valer (Chromium 56+ trata document como passivo).
      document.addEventListener('touchmove', this.onTouchMove, { passive: false } as AddEventListenerOptions);
      document.addEventListener('touchend', this.onTouchEnd);
      document.addEventListener('touchcancel', this.onTouchEnd);
    }
  }

  private touchOf(e: TouchEvent): Touch | null {
    const d = this.drag;
    if (!d) return null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === d.touch) return e.changedTouches[i];
    }
    return null;
  }

  private dragTo(x: number, y: number): void {
    const d = this.drag;
    if (!d) return;
    const dx = x - d.x0;
    const dy = y - d.y0;
    if (!d.last && Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
    d.last = { x: d.c0.x + dx / (this.app.clientWidth || 1), y: d.c0.y + dy / (this.app.clientHeight || 1) };
    if (d.mode === 'resize' && d.item.resizeTo) d.item.resizeTo(d.last.x, d.last.y, false);
    else d.item.moveTo(d.last, false);
  }

  // `cancel`: o modo está fechando; o que foi arrastado é salvo, mas nenhum menu abre.
  private endDrag(cancel = false): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('touchmove', this.onTouchMove);
    document.removeEventListener('touchend', this.onTouchEnd);
    document.removeEventListener('touchcancel', this.onTouchEnd);
    // Salva no fim. Toque ou clique sem arraste não muda nada; numa área, abre o menu dela.
    if (!d.last) {
      if (d.mode === 'move' && d.item.activate && !cancel) d.item.activate();
      return;
    }
    if (d.mode === 'resize' && d.item.resizeTo) d.item.resizeTo(d.last.x, d.last.y, true);
    else d.item.moveTo(d.last, true);
  }
}
