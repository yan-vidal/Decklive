// Painel de ajustes: uma linha por preferência, com opções em botões (setas + Enter). Aqui também
// ficam o envio de ajustes para outra tela e o sub-painel de conteúdo de uma área (design D4).
import {
  ENDPOINT_INTERVALS,
  KINDS,
  MAX_AUTH,
  MAX_TEMPLATE,
  MAX_TEXT,
  MAX_URL,
  TEXT_SIZES,
  allowedUrl,
  type Area,
  type AreaContent,
  type AreaKind,
  type TextSize,
} from './areas';
import { fieldKeeps, isTextField, moveInGrid, pressedIndex, type KeyAction } from './controls';
import type { Strings } from './i18n';
import type { Settings, SettingsStore } from './settings';
import type { ReceiveResult, SendResult } from './transfer';

interface RowSpec {
  key: keyof Settings;
  label: string;
  values: Settings[keyof Settings][];
  labels: string[];
}

// Ação do painel (Editar tela, Restaurar posições padrão): um botão por linha.
export interface PanelAction {
  label: string;
  run: () => void;
}

// Envio e recebimento de ajustes (transfer.ts); `receive` já aplica o pacote recebido.
export interface TransferHooks {
  send(): Promise<SendResult>;
  receive(code: string): Promise<ReceiveResult>;
}

export interface Panel {
  // Linhas de botões (e o campo do código), na ordem visual; a primeira é o botão de fechar.
  rows: HTMLElement[][];
  close: HTMLButtonElement;
  sync(s: Settings): void;
}

function div(parent: HTMLElement, className: string, text = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  if (text) d.textContent = text;
  parent.appendChild(d);
  return d;
}

function optionButton(parent: HTMLElement, label: string, run: () => void, className = 'option'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', run);
  parent.appendChild(b);
  return b;
}

// Campo de texto: sem correção nem maiúsculas automáticas, e com o teclado da TV ao focar.
function field<K extends 'input' | 'textarea'>(parent: HTMLElement, tag: K, id: string, max: number): HTMLElementTagNameMap[K] {
  const f = document.createElement(tag);
  f.className = 'field';
  f.id = id;
  f.maxLength = max;
  f.setAttribute('autocomplete', 'off');
  f.setAttribute('autocapitalize', 'off');
  f.setAttribute('spellcheck', 'false');
  parent.appendChild(f);
  return f;
}

function pad2(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

export function buildPanel(
  el: HTMLElement,
  t: Strings,
  store: SettingsStore,
  onClose: () => void,
  actions: PanelAction[] = [],
  transfer: TransferHooks | null = null,
): Panel {
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

  const rows: HTMLElement[][] = [[close]];
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

  // Ações sob um rótulo só; cada botão é uma linha para as setas.
  if (actions.length > 0) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('div');
    label.className = 'row-label';
    label.textContent = t.screen;
    row.appendChild(label);
    for (const action of actions) {
      const group = document.createElement('div');
      group.className = 'options';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'option action';
      b.textContent = action.label;
      b.addEventListener('click', action.run);
      group.appendChild(b);
      row.appendChild(group);
      rows.push([b]);
    }
    el.appendChild(row);
  }

  if (transfer) addTransfer(el, t, rows, transfer);

  const sync = (s: Settings) => {
    for (const { spec, buttons } of bound) {
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(spec.values[i] === s[spec.key])));
    }
  };
  sync(store.get());
  store.subscribe(sync);
  return { rows, close, sync };
}

// "Enviar para outra tela" e "Receber ajustes" (spec settings-transfer). O código e o tempo restante
// aparecem no painel e, grandes, no centro da tela enquanto o painel está aberto.
function addTransfer(el: HTMLElement, t: Strings, rows: HTMLElement[][], hooks: TransferHooks): void {
  const row = div(el, 'row');
  div(row, 'row-label', t.otherScreen);
  const sendGroup = div(row, 'options');
  const sendStatus = div(row, 'transfer-status');
  sendStatus.setAttribute('aria-live', 'polite');
  const recvGroup = div(row, 'options transfer-receive');
  const input = field(recvGroup, 'input', 'pair-input', 9);
  input.type = 'text';
  input.placeholder = t.code;
  input.setAttribute('aria-label', t.code);
  input.setAttribute('autocapitalize', 'characters');
  const recvStatus = div(row, 'transfer-status');
  recvStatus.setAttribute('aria-live', 'polite');

  // Abaixo do painel na pintura: no celular, o painel cobre o código grande e mostra o dele.
  const big = document.createElement('div');
  big.id = 'pair-code';
  const bigCode = div(big, 'pair-code-value');
  const bigTime = div(big, 'pair-code-time');
  if (el.parentNode) el.parentNode.insertBefore(big, el);

  let timer: ReturnType<typeof setInterval> | null = null;
  let code = '';
  let end = 0;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    big.className = '';
  };
  const tick = () => {
    const left = Math.ceil((end - Date.now()) / 1000);
    if (left <= 0) {
      stop();
      sendStatus.textContent = t.codeExpired;
      return;
    }
    const time = t.expiresIn + ' ' + Math.floor(left / 60) + ':' + pad2(left % 60);
    sendStatus.textContent = t.code + ' ' + code + ' · ' + time;
    bigCode.textContent = code;
    bigTime.textContent = time;
  };

  const send = optionButton(sendGroup, t.send, () => {
    stop();
    sendStatus.textContent = t.sending;
    hooks.send().then((r) => {
      if ('code' in r) {
        code = r.code;
        end = Date.now() + r.expiresIn * 1000;
        big.className = 'on';
        timer = setInterval(tick, 1000);
        tick();
      } else {
        sendStatus.textContent = r.error === 'too-large' ? t.tooLarge : t.sendError;
      }
    });
  }, 'option action');

  const receive = () => {
    recvStatus.textContent = t.receiving;
    hooks.receive(input.value).then((r) => {
      if ('pkg' in r) {
        input.value = '';
        recvStatus.textContent = t.received;
      } else {
        recvStatus.textContent = r.error === 'invalid' ? t.badCode : t.receiveError;
      }
    });
  };
  const recv = optionButton(recvGroup, t.receive, receive, 'option action');
  // Enter no campo envia o código (no controle, o OK depois de digitar).
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.keyCode === 13) receive();
  });
  rows.push([send]);
  rows.push([input, recv]);
}

// --- Conteúdo de uma área ---------------------------------------------------------------------------

export interface AreaFormHooks {
  pageProtocol: string;
  save(id: string, content: AreaContent): void;
  // Fechou (salvo ou não): o foco volta ao contorno da área.
  closed(id: string): void;
}

export interface AreaForm {
  open(area: Area, title: string): void;
  // Teclas enquanto o formulário está aberto (Controls.setModal); false deixa a tecla com o campo.
  key(action: KeyAction, e: KeyboardEvent): boolean | void;
}

interface FormRow {
  // Tipo cujas opções mostram a linha; null nas de todos os tipos.
  kind: AreaKind | null;
  els: HTMLElement[];
}

// Sub-painel de conteúdo: tipo; texto e tamanho; URL da imagem; ou URL, Authorization, frequência e
// modelo do endpoint. As linhas dos outros tipos ficam escondidas, e o que nelas foi digitado só se
// perde ao salvar.
export function buildAreaForm(el: HTMLElement, t: Strings, hooks: AreaFormHooks): AreaForm {
  let id = '';
  let kind: AreaKind = 'text';
  let size: TextSize = 'm';
  let interval = 30;
  const rows: FormRow[] = [];

  const head = div(el, 'panel-head');
  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.id = 'area-form-title';
  head.appendChild(title);
  const closeBtn = optionButton(head, '×', () => finish(), 'close');
  closeBtn.setAttribute('aria-label', t.cancel);
  closeBtn.title = t.cancel;
  rows.push({ kind: null, els: [closeBtn] });

  const section = (k: AreaKind | null) => div(el, k ? 'af-sec af-' + k : '');
  const label = (parent: HTMLElement, text: string, forId: string) => {
    const l = document.createElement('label');
    l.className = 'row-label';
    l.htmlFor = forId;
    l.textContent = text;
    parent.appendChild(l);
  };
  // Linha de opções em botões, com a escolhida marcada (aria-pressed).
  const options = <T>(parent: HTMLElement, k: AreaKind | null, values: ReadonlyArray<T>, labels: string[], pick: (v: T) => void) => {
    const group = div(parent, 'options');
    group.setAttribute('role', 'group');
    const buttons = values.map((v, i) => optionButton(group, labels[i], () => pick(v)));
    rows.push({ kind: k, els: buttons });
    return buttons;
  };
  const press = (buttons: HTMLButtonElement[], values: ReadonlyArray<unknown>, value: unknown) =>
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(values[i] === value)));
  const fieldRow = <K extends 'input' | 'textarea'>(k: AreaKind, text: string, tag: K, fid: string, max: number) => {
    const row = div(sections[k], 'row');
    label(row, text, fid);
    const f = field(row, tag, fid, max);
    rows.push({ kind: k, els: [f] });
    return f;
  };

  const kindRow = div(section(null), 'row');
  div(kindRow, 'row-label', t.kind);
  const kindButtons = options(kindRow, null, KINDS, t.kindOptions, (k) => setKind(k));
  const sections: Record<AreaKind, HTMLDivElement> = { text: section('text'), image: section('image'), endpoint: section('endpoint') };

  const text = fieldRow('text', t.text, 'textarea', 'af-text', MAX_TEXT);
  text.rows = 3;
  const sizeRow = div(sections.text, 'row');
  div(sizeRow, 'row-label', t.textSize);
  const sizeButtons = options(sizeRow, 'text', TEXT_SIZES, t.sizeOptions, (v) => {
    size = v;
    press(sizeButtons, TEXT_SIZES, size);
  });

  const imageUrl = fieldRow('image', t.imageUrl, 'input', 'af-image-url', MAX_URL);
  imageUrl.type = 'url';
  imageUrl.placeholder = 'https://';

  const url = fieldRow('endpoint', t.endpointUrl, 'input', 'af-url', MAX_URL);
  url.type = 'url';
  url.placeholder = 'https://';
  const auth = fieldRow('endpoint', t.authorization, 'input', 'af-auth', MAX_AUTH);
  auth.type = 'text';
  auth.placeholder = 'Bearer …';
  const freqRow = div(sections.endpoint, 'row');
  div(freqRow, 'row-label', t.frequency);
  // Seis opções em duas linhas de três, para caberem no painel.
  const freqLabels = ['10 s', '30 s', '1 min', '5 min', '15 min', '1 h'];
  const pickInterval = (v: number) => {
    interval = v;
    press(freqButtons, ENDPOINT_INTERVALS, interval);
  };
  const freqButtons = options(freqRow, 'endpoint', ENDPOINT_INTERVALS.slice(0, 3), freqLabels.slice(0, 3), pickInterval).concat(
    options(freqRow, 'endpoint', ENDPOINT_INTERVALS.slice(3), freqLabels.slice(3), pickInterval),
  );
  const template = fieldRow('endpoint', t.template, 'textarea', 'af-template', MAX_TEMPLATE);
  template.rows = 6;
  template.className = 'field code';

  const error = div(el, 'af-error');
  error.setAttribute('role', 'alert');
  const actions = div(el, 'row options af-actions');
  const saveBtn = optionButton(actions, t.save, () => save(), 'option primary');
  const cancelBtn = optionButton(actions, t.cancel, () => finish());
  rows.push({ kind: null, els: [saveBtn, cancelBtn] });

  function setKind(k: AreaKind): void {
    kind = k;
    el.className = 'open kind-' + k;
    press(kindButtons, KINDS, kind);
    error.textContent = '';
  }

  function finish(): void {
    el.className = '';
    hooks.closed(id);
  }

  // URL de imagem e de endpoint: https (http só com a página em http, no desenvolvimento local).
  function checkUrl(f: HTMLInputElement): boolean {
    f.value = f.value.trim();
    if (allowedUrl(f.value, hooks.pageProtocol)) return true;
    error.textContent = t.urlInvalid;
    f.focus();
    return false;
  }

  function save(): void {
    let content: AreaContent;
    if (kind === 'image') {
      if (!checkUrl(imageUrl)) return;
      content = { kind, imageUrl: imageUrl.value };
    } else if (kind === 'endpoint') {
      if (!checkUrl(url)) return;
      content = { kind, endpoint: { url: url.value, auth: auth.value.trim(), interval, template: template.value } };
    } else {
      content = { kind, text: text.value, size };
    }
    hooks.save(id, content);
    finish();
  }

  // Linhas visíveis para as setas: as de todos os tipos e as do tipo escolhido.
  const grid = () => rows.filter((r) => r.kind === null || r.kind === kind).map((r) => r.els);

  return {
    open(area: Area, name: string): void {
      id = area.id;
      title.textContent = name + ' · ' + t.content;
      const e = area.endpoint;
      text.value = area.text || '';
      size = area.size || 'm';
      imageUrl.value = area.imageUrl || '';
      url.value = e ? e.url : '';
      auth.value = e ? e.auth : '';
      template.value = e ? e.template : '';
      interval = e ? e.interval : 30;
      press(sizeButtons, TEXT_SIZES, size);
      press(freqButtons, ENDPOINT_INTERVALS, interval);
      setKind(area.kind);
      kindButtons[KINDS.indexOf(kind)].focus();
    },

    key(action: KeyAction, e: KeyboardEvent): boolean | void {
      const active = document.activeElement as HTMLElement | null;
      if (isTextField(active) && fieldKeeps(active, action, e)) return false;
      if (action === 'back') {
        finish();
        return;
      }
      const g = grid();
      let from: { row: number; col: number } | null = null;
      g.forEach((r, i) => {
        const c = r.indexOf(active as HTMLElement);
        if (c >= 0) from = { row: i, col: c };
      });
      if (!from) {
        kindButtons[KINDS.indexOf(kind)].focus();
        return;
      }
      // Enter num campo de uma linha desce para o próximo; num botão, aperta.
      if (action === 'enter' && !isTextField(active)) {
        (active as HTMLElement).click();
        return;
      }
      const to = moveInGrid(
        g.map((r) => r.length),
        from,
        action === 'enter' ? 'down' : action,
        // Na linha de Salvar e Cancelar, chegar de cima ou de baixo cai em Salvar.
        (r) => (g[r][0] === saveBtn ? 0 : pressedIndex(g[r])),
      );
      g[to.row][to.col].focus();
    },
  };
}
