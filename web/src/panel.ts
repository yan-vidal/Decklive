// Painel de ajustes: uma linha por preferência, com opções em botões (setas + Enter).
import type { Strings } from './i18n';
import type { Settings, SettingsStore } from './settings';

interface RowSpec {
  key: keyof Settings;
  label: string;
  values: Settings[keyof Settings][];
  labels: string[];
}

export interface Panel {
  // Linhas de botões, na ordem visual; a primeira é o botão de fechar.
  rows: HTMLButtonElement[][];
  close: HTMLButtonElement;
  sync(s: Settings): void;
}

export function buildPanel(el: HTMLElement, t: Strings, store: SettingsStore, onClose: () => void): Panel {
  const specs: RowSpec[] = [
    { key: 'clock', label: t.clock, values: [true, false], labels: t.clockOptions },
    { key: 'hour12', label: t.hourFormat, values: [false, true], labels: ['24 h', '12 h'] },
    { key: 'date', label: t.date, values: [true, false], labels: t.dateOptions },
    { key: 'fit', label: t.fit, values: ['auto', 'fill', 'fit'], labels: t.fitOptions },
    { key: 'skipOther', label: t.skipOther, values: [false, true], labels: t.skipOtherOptions },
    { key: 'interval', label: t.interval, values: [10, 30, 60, 300], labels: ['10 s', '30 s', '1 min', '5 min'] },
    { key: 'motion', label: t.motion, values: [true, false], labels: t.motionOptions },
    { key: 'place', label: t.place, values: [true, false], labels: t.infoOptions },
    { key: 'description', label: t.description, values: [true, false], labels: t.infoOptions },
  ];

  const head = document.createElement('div');
  head.className = 'panel-head';
  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.id = 'panel-title';
  title.textContent = t.settings;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.textContent = '×';
  close.setAttribute('aria-label', t.close);
  close.title = t.close;
  close.addEventListener('click', onClose);
  head.appendChild(title);
  head.appendChild(close);
  el.appendChild(head);

  const rows: HTMLButtonElement[][] = [[close]];
  const bound: { spec: RowSpec; buttons: HTMLButtonElement[] }[] = [];

  for (const spec of specs) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('div');
    label.className = 'row-label';
    label.id = 'label-' + spec.key;
    label.textContent = spec.label;
    const group = document.createElement('div');
    group.className = 'options';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', label.id);
    const buttons = spec.values.map((value, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'option';
      b.textContent = spec.labels[i];
      b.addEventListener('click', () => {
        const patch: Partial<Settings> = {};
        (patch as Record<string, unknown>)[spec.key] = value;
        store.set(patch);
      });
      group.appendChild(b);
      return b;
    });
    row.appendChild(label);
    row.appendChild(group);
    el.appendChild(row);
    rows.push(buttons);
    bound.push({ spec, buttons });
  }

  const sync = (s: Settings) => {
    for (const { spec, buttons } of bound) {
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(spec.values[i] === s[spec.key])));
    }
  };
  sync(store.get());
  store.subscribe(sync);
  return { rows, close, sync };
}
