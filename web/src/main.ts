// Ponto de entrada do player: liga playlist, palco, relógio, ajustes e controles.
import { PlaylistClient, browserLang } from './api';
import { AreaStore, AreaView, MAX_AREAS, areaLabel, areaRect, moveRect, resizeRect, type AreaRect } from './areas';
import { Clock } from './clock';
import { Controls, type KeyAction } from './controls';
import { Editor, type EditItem } from './editor';
import { fullscreenSupported, isFullscreen, onFullscreenChange, toggleFullscreen } from './fullscreen';
import { STRINGS, detectLang } from './i18n';
import { FIXED_IDS, LayoutStore, LayoutView, type FixedId } from './layout';
import { buildAreaForm, buildPanel } from './panel';
import { CONTROLS_MIN_SCALE, canonicalBucket, layoutScale, orientationOf, physicalSize } from './screen';
import { SettingsStore, appClasses, defaultSettings, safeStorage, type Settings } from './settings';
import { Stage } from './stage';
import { buildPackage, receivePackage, sendPackage } from './transfer';
import { keepScreenOn } from './wake';

const RESIZE_DEBOUNCE_MS = 150;

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const lang = detectLang(navigator.language);
const t = STRINGS[lang];
const root = document.documentElement;
root.lang = lang === 'pt' ? 'pt-BR' : 'en';

const app = byId<HTMLDivElement>('app');
const clockBox = byId<HTMLDivElement>('clock-box');
const clockBlock = byId<HTMLDivElement>('clock-block');
const timeEl = byId<HTMLSpanElement>('clock-time');
const periodEl = byId<HTMLSpanElement>('clock-period');
const dateEl = byId<HTMLDivElement>('date');
const noticeEl = byId<HTMLDivElement>('notice');
const settingsBtn = byId<HTMLButtonElement>('btn-settings');
const fsBtn = byId<HTMLButtonElement>('btn-fullscreen');
const panelEl = byId<HTMLDivElement>('panel');
const areasEl = byId<HTMLDivElement>('areas');
const areaFormEl = byId<HTMLDivElement>('area-form');

settingsBtn.title = t.settings;
settingsBtn.setAttribute('aria-label', t.settings);
fsBtn.title = t.fullscreen;
fsBtn.setAttribute('aria-label', t.fullscreen);

function viewport(): { w: number; h: number } {
  return {
    w: window.innerWidth || root.clientWidth,
    h: window.innerHeight || root.clientHeight,
  };
}

// --dl-u e --dl-ui (design D10); sem min() no CSS por causa das TVs antigas.
let uiScale = 1;
function applyScale(w: number, h: number): void {
  const u = layoutScale(w, h);
  uiScale = Math.max(u, CONTROLS_MIN_SCALE);
  root.style.setProperty('--dl-u', u + 'px');
  root.style.setProperty('--dl-ui', uiScale + 'px');
}

function bucket(w: number, h: number) {
  const p = physicalSize(w, h, window.devicePixelRatio || 1);
  return canonicalBucket(p.w, p.h);
}

const storage = safeStorage(window);
// Movimento desligado por padrão quando o aparelho pede menos movimento.
const deviceDefaults = defaultSettings(window);
const store = new SettingsStore(storage, deviceDefaults);
const initial = store.get();
const vp = viewport();
applyScale(vp.w, vp.h);

const stage = new Stage(
  byId('stage'),
  { mode: initial.fit, skipOther: initial.skipOther, interval: initial.interval, motion: initial.motion },
  vp.w,
  vp.h,
);

const clock = new Clock(
  lang,
  () => store.get().hour12,
  (text) => {
    timeEl.textContent = text.time;
    periodEl.textContent = text.period;
    dateEl.textContent = text.date;
  },
);

// Posições dos elementos movidos (design D1/D2); sem nenhuma, o layout é o padrão do DeckLock.
const layoutStore = new LayoutStore(storage);
const layoutView = new LayoutView(app, layoutStore, {
  column: clockBox,
  clock: clockBlock,
  date: dateEl,
  notice: noticeEl,
  layers: () => stage.infoBlocks(),
  front: () => stage.frontInfo(),
});
stage.onInfo = (blocks) => layoutView.applyLayer(blocks);

// Áreas próprias (design D4/D5): acima do véu e abaixo do relógio e dos controles.
const areaStore = new AreaStore(storage);
const areaView = new AreaView(areasEl, areaStore, {
  orientation: () => layoutView.orientation(),
  uiScale: () => uiScale,
  // http só vale para imagem e endpoint com a página em http (desenvolvimento local).
  pageProtocol: location.protocol,
  errorText: t.endpointError,
  fetch: (url, init) => fetch(url, init),
  hidden: () => !!document.hidden,
});

// Medida da área na orientação atual, trocada por `next` (mover ou redimensionar).
function changeArea(id: string, next: (r: AreaRect) => AreaRect, save: boolean): void {
  const a = areaStore.get(id);
  if (!a) return;
  const o = layoutView.orientation();
  areaStore.setRect(id, o, next(areaRect(a, o)), save);
}

// Aviso discreto: sem rede e sem playlist, ou playlist vazia.
let offline = false;
let loaded = false;
function updateNotice(): void {
  const text = offline ? t.offline : loaded && stage.count === 0 ? t.empty : '';
  if (noticeEl.textContent === text) return;
  noticeEl.textContent = text;
  app.classList.toggle('has-notice', text !== '');
  // O aviso muda o tamanho do relógio movido, que o leva junto.
  layoutView.apply();
}

function applySettings(s: Settings): void {
  // Relógio, data, local e descrição: só classes em #app, valem na hora nas duas camadas.
  const classes = appClasses(s);
  for (const name in classes) app.classList.toggle(name, classes[name]);
  stage.setOptions({ mode: s.fit, skipOther: s.skipOther, interval: s.interval, motion: s.motion });
  clock.refresh();
  layoutView.apply();
}

// Itens do modo de edição: os elementos fixos visíveis agora. As áreas próprias entram aqui
// com outro provedor (lista extensível).
const LABELS: Record<FixedId, string> = { clock: t.clock, date: t.date, place: t.place, description: t.description };
const editProviders: (() => EditItem[])[] = [
  () =>
    FIXED_IDS.filter((id) => layoutView.shown(id)).map((id) => ({
      id,
      label: LABELS[id],
      rect: () => layoutView.rect(id),
      moveTo: (p, save) => layoutView.moveTo(id, p, save),
    })),
  // Áreas: OK (ou toque sem arraste) abre o menu; a alça e as setas mudam o tamanho.
  () =>
    areaStore.list().map((a, i): EditItem => {
      const id = a.id;
      return {
        id,
        label: areaLabel(t.area, a, i),
        rect: () => areaView.rect(id),
        moveTo: (p, save) => changeArea(id, (r) => moveRect(r, p), save),
        resizeBy: (dw, dh) => changeArea(id, (r) => resizeRect(r, r.w + dw, r.h + dh), true),
        resizeTo: (w, h, save) => changeArea(id, (r) => resizeRect(r, w, h), save),
        activate: () =>
          editor.menu(id, [
            { label: t.areaMenu[0], run: () => editor.grab(id) },
            { label: t.areaMenu[1], run: () => editor.grab(id, 'resize') },
            { label: t.areaMenu[2], run: () => openAreaForm(id) },
            {
              label: t.areaMenu[3],
              run: () => {
                areaStore.remove(id);
                editor.focus();
              },
            },
          ]),
      };
    }),
];

const editor = new Editor(app, {
  labels: {
    newArea: t.newArea,
    restore: t.restoreLayout,
    done: t.done,
    editHint: t.editHint,
    moveHint: t.moveHint,
    resizeHint: t.resizeHint,
  },
  items: () => editProviders.reduce((all: EditItem[], f) => all.concat(f()), []),
  restore: () => layoutStore.restore(),
  // Nova área no centro, na orientação atual; com 8, o botão fica desabilitado.
  newArea: () => {
    areaStore.add(layoutView.orientation());
  },
  canAddArea: () => areaStore.list().length < MAX_AREAS,
  onOpen: () => {
    // A troca de fotos e o movimento param; as setas e o Voltar passam ao editor.
    stage.pause();
    controls.setModal(editorKeys);
    layoutView.apply();
  },
  onClose: () => {
    layoutStore.save();
    // Sem os blocos vazios que o modo de edição mostra.
    layoutView.apply();
    stage.resume();
    controls.setModal(null);
    settingsBtn.focus();
  },
});
layoutView.onApply = () => editor.refresh();
areaView.onApply = () => editor.refresh();
areaView.apply();

// Sub-painel de conteúdo de uma área, por cima do modo de edição; as teclas passam a ele.
const editorKeys = (action: KeyAction) => editor.key(action);
const areaForm = buildAreaForm(areaFormEl, t, {
  pageProtocol: location.protocol,
  save: (id, content) => areaStore.setContent(id, content),
  closed: (id) => {
    app.classList.remove('area-form-open');
    controls.setModal(editorKeys);
    editor.focus(id);
  },
});

function openAreaForm(id: string): void {
  const a = areaStore.get(id);
  if (!a) return;
  app.classList.add('area-form-open');
  controls.setModal((action, e) => areaForm.key(action, e));
  areaForm.open(a, areaLabel(t.area, a, areaStore.list().indexOf(a)));
}

// Envio de ajustes: preferências, posições e áreas, num pacote só; ao receber, troca tudo e salva.
const http = (url: string, init: RequestInit) => fetch(url, init);
const transfer = {
  send: () => sendPackage(http, buildPackage(store.get(), layoutStore.get(), areaStore.list())),
  receive: (code: string) =>
    receivePackage(http, code, deviceDefaults).then((r) => {
      if ('pkg' in r) {
        store.set(r.pkg.settings);
        layoutStore.replace(r.pkg.layout);
        areaStore.replace(r.pkg.areas);
      }
      return r;
    }),
};

const panel = buildPanel(panelEl, t, store, () => controls.closePanel(), [
  {
    label: t.editScreen,
    run: () => {
      controls.closePanel();
      editor.open();
    },
  },
  { label: t.restoreLayout, run: () => layoutStore.restore() },
], transfer);
store.subscribe(applySettings);
applySettings(initial);

const controls = new Controls(app, settingsBtn, [settingsBtn, fsBtn], panel, panelEl);

if (fullscreenSupported(document, root)) {
  fsBtn.addEventListener('click', (e) => {
    if (!controls.guarded(e)) toggleFullscreen(document, root);
  });
  onFullscreenChange(document, () => app.classList.toggle('is-fullscreen', isFullscreen(document)));
} else {
  app.classList.add('no-fullscreen');
}

keepScreenOn(navigator, document);

// Local e descrição no idioma do navegador; a interface continua em pt-BR ou inglês (i18n.ts).
const client = new PlaylistClient(
  (url, init) => fetch(url, init),
  storage,
  {
    onPlaylist: (p) => {
      loaded = true;
      const [w, h] = p.bucket.split('x').map(Number);
      stage.setItems(p.items, orientationOf(w, h));
      updateNotice();
    },
    onOffline: (o) => {
      offline = o;
      updateNotice();
    },
  },
  browserLang(navigator),
);
client.start(bucket(vp.w, vp.h));

// Rotação ou janela nova: reenquadra já e pede a playlist da nova faixa.
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
function onResize(): void {
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    const v = viewport();
    applyScale(v.w, v.h);
    stage.resize(v.w, v.h);
    // Outra orientação usa as posições dela; a mesma é recalculada no tamanho novo.
    layoutView.apply();
    areaView.apply();
    client.setBucket(bucket(v.w, v.h));
  }, RESIZE_DEBOUNCE_MS);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

// Timers dormem em segundo plano: ressincroniza o relógio ao voltar.
// As áreas de endpoint param com a página oculta e chamam na hora ao voltar.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) clock.refresh();
  areaView.visibilityChanged();
});
