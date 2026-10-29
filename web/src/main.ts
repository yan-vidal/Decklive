// Ponto de entrada do player: liga playlist, palco, relógio, ajustes e controles.
import { PlaylistClient } from './api';
import { Clock } from './clock';
import { Controls } from './controls';
import { fullscreenSupported, isFullscreen, onFullscreenChange, toggleFullscreen } from './fullscreen';
import { STRINGS, detectLang } from './i18n';
import { buildPanel } from './panel';
import { CONTROLS_MIN_SCALE, canonicalBucket, layoutScale, orientationOf, physicalSize } from './screen';
import { SettingsStore, appClasses, defaultSettings, safeStorage, type Settings } from './settings';
import { Stage } from './stage';
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
const timeEl = byId<HTMLSpanElement>('clock-time');
const periodEl = byId<HTMLSpanElement>('clock-period');
const dateEl = byId<HTMLDivElement>('date');
const noticeEl = byId<HTMLDivElement>('notice');
const settingsBtn = byId<HTMLButtonElement>('btn-settings');
const fsBtn = byId<HTMLButtonElement>('btn-fullscreen');
const panelEl = byId<HTMLDivElement>('panel');

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
function applyScale(w: number, h: number): void {
  const u = layoutScale(w, h);
  root.style.setProperty('--dl-u', u + 'px');
  root.style.setProperty('--dl-ui', Math.max(u, CONTROLS_MIN_SCALE) + 'px');
}

function bucket(w: number, h: number) {
  const p = physicalSize(w, h, window.devicePixelRatio || 1);
  return canonicalBucket(p.w, p.h);
}

const storage = safeStorage(window);
// Movimento desligado por padrão quando o aparelho pede menos movimento.
const store = new SettingsStore(storage, defaultSettings(window));
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

// Aviso discreto: sem rede e sem playlist, ou playlist vazia.
let offline = false;
let loaded = false;
function updateNotice(): void {
  const text = offline ? t.offline : loaded && stage.count === 0 ? t.empty : '';
  noticeEl.textContent = text;
  app.classList.toggle('has-notice', text !== '');
}

function applySettings(s: Settings): void {
  // Relógio, data, local e descrição: só classes em #app, valem na hora nas duas camadas.
  const classes = appClasses(s);
  for (const name in classes) app.classList.toggle(name, classes[name]);
  stage.setOptions({ mode: s.fit, skipOther: s.skipOther, interval: s.interval, motion: s.motion });
  clock.refresh();
}

const panel = buildPanel(panelEl, t, store, () => controls.closePanel());
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

const client = new PlaylistClient((url, init) => fetch(url, init), storage, {
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
});
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
    client.setBucket(bucket(v.w, v.h));
  }, RESIZE_DEBOUNCE_MS);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

// Timers dormem em segundo plano: ressincroniza o relógio ao voltar.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) clock.refresh();
});
