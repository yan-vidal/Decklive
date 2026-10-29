// Mock de /api/playlist só para o servidor de desenvolvimento (VITE_MOCK=1).
// Fotos reais da API pública do yanlucas.com (somente leitura), com corte central simples.
// Chaves de teste: GET /__mock?fail=1 (API fora do ar), ?broken=1 (fotos com erro), ?slow=1 (playlist lenta),
// ?pick=0,4 (só esses itens, na ordem da lista; ?pick= volta a todos).
import type { Connect, Plugin } from 'vite';
import { canonicalBucket, orientationOf, MAX_SIDE } from '../src/screen.ts';

const SOURCE = 'https://api.yanlucas.com/images?limit=40';

interface Variant {
  url: string;
  width: number;
  height: number;
}

// Local e descrição prontos para exibir, como a API manda (spec `playlist`).
interface Info {
  place: string | null;
  title: string | null;
  text: string | null;
}

interface Photo extends Info {
  id: string;
  color: string;
  variants: Variant[];
}

interface SourceVersion {
  thumbnailUrl: string;
  optimizedUrl: string;
  fullSizeUrl: string;
  colorPalette?: { red: number; green: number; blue: number; score: number }[];
}

interface SourceImage {
  _id: string;
  images?: SourceVersion[];
  original: SourceVersion;
  metadata: Record<string, number>;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  description?: string | null;
}

// Os primeiros itens têm textos fixos, para conferir os cenários da spec e o pior caso de tamanho;
// os outros vêm da fonte, com uma versão simples da regra da API.
const SAMPLES: Info[] = [
  {
    place: 'Jericoacoara, Ceará, Brazil',
    title: 'Sunset Dune',
    text: 'This natural formation is part of the dynamic dune system along the northeastern coast of Brazil.',
  },
  {
    place: 'São Paulo, Brazil',
    title: 'São Paulo Museum of Art (MASP)',
    text:
      'Renowned for its bold modernist design, with its main building suspended on concrete beams 74 meters apart, ' +
      'creating a vast open space underneath that hosts fairs, concerts and protests.',
  },
  // Só o local.
  { place: 'Japan', title: null, text: null },
  // Nada.
  { place: null, title: null, text: null },
  // Maior primeira frase da fonte (217 caracteres).
  {
    place: 'Manaus, Amazonas, Brazil',
    title: 'Meeting of the Waters',
    text:
      'A remarkable natural phenomenon that occurs near Manaus, where the dark waters of the Negro River and the ' +
      'light, muddy waters of the Solimões River converge but flow side by side for several kilometers without mixing.',
  },
  // Maior título da fonte (57 caracteres).
  {
    place: 'Morretes, Paraná, Brazil',
    title: 'Serra Verde Express, Train Ride from Curitiba to Morretes',
    text:
      'One of Brazil’s most scenic train journeys, traversing the lush Atlantic Forest as it winds from Curitiba ' +
      'to the historic town of Morretes.',
  },
  // Descrição sem título.
  {
    place: 'Mateiros, Tocantins, Brazil',
    title: null,
    text: 'Formiga Waterfall is a hidden gem located in the Jalapão region, near Mateiros, Tocantins.',
  },
];

// Cidade, estado e país sem as partes vazias e sem repetir a anterior.
function placeOf(img: SourceImage): string | null {
  const parts: string[] = [];
  for (const v of [img.city, img.state, img.country]) {
    const t = (v || '').trim();
    if (t && t !== parts[parts.length - 1]) parts.push(t);
  }
  return parts.length ? parts.join(', ') : null;
}

// "Título: texto" e a primeira frase do texto, com a primeira letra maiúscula.
function infoOf(img: SourceImage): Info {
  const d = (img.description || '').trim();
  const k = d.indexOf(': ');
  const title = k > 0 && k < 80 ? d.slice(0, k) : null;
  const rest = title ? d.slice(k + 2) : d;
  const m = /^[\s\S]*?[.!?]["”’)]?(?=\s|$)/.exec(rest);
  let text = m ? m[0] : rest;
  if (text.length > 240) text = text.slice(0, text.lastIndexOf(' ', 240)) + '…';
  return { place: placeOf(img), title, text: text ? text.charAt(0).toUpperCase() + text.slice(1) : null };
}

let photos: Promise<Photo[]> | null = null;
const flags = { fail: false, broken: false, slow: false };
let pick: number[] | null = null;
let revision = 1;

function hex(n: number): string {
  return ('0' + Math.round(n).toString(16)).slice(-2);
}

function toPhoto(img: SourceImage, info: Info): Photo {
  // Mesma regra da galeria: primeira versão editada, senão o original.
  const v = img.images && img.images.length > 0 ? img.images[0] : img.original;
  const m = img.metadata;
  const palette = (v.colorPalette || []).slice().sort((a, b) => b.score - a.score);
  const top = palette[0] || { red: 0, green: 0, blue: 0 };
  return {
    id: img._id,
    place: info.place,
    title: info.title,
    text: info.text,
    color: '#' + hex(top.red) + hex(top.green) + hex(top.blue),
    variants: [
      { url: v.thumbnailUrl, width: m.thumbnailWidth, height: m.thumbnailHeight },
      { url: v.optimizedUrl, width: m.optimizedWidth, height: m.optimizedHeight },
      { url: v.fullSizeUrl, width: m.fullSizeWidth, height: m.fullSizeHeight },
    ],
  };
}

// 12 fotos misturando orientações: 6 deitadas, 4 em pé e 2 quadradas.
async function loadPhotos(): Promise<Photo[]> {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error('fonte respondeu ' + res.status);
  const body = (await res.json()) as { images: SourceImage[] };
  const quota: Record<string, number> = { landscape: 6, portrait: 4, square: 2 };
  const picked: Photo[] = [];
  for (const img of body.images) {
    const full = img.metadata;
    const o = orientationOf(full.fullSizeWidth, full.fullSizeHeight);
    if (quota[o] > 0) {
      quota[o]--;
      picked.push(toPhoto(img, picked.length < SAMPLES.length ? SAMPLES[picked.length] : infoOf(img)));
    }
  }
  return picked;
}

function itemFor(p: Photo, W: number, H: number) {
  const full = p.variants[p.variants.length - 1];
  const A = W / H;
  const iw = full.width;
  const ih = full.height;
  // Maior corte na proporção da tela, centralizado.
  const cw = iw / ih > A ? ih * A : iw;
  const ch = iw / ih > A ? ih : iw / A;
  const crop = { w: cw / iw, h: ch / ih, x: 0, y: 0 };
  crop.x = (1 - crop.w) / 2;
  crop.y = (1 - crop.h) / 2;
  // Menor arquivo com 90% dos pixels da tela no corte; senão o maior.
  let chosen = full;
  for (const v of p.variants) {
    if (crop.w * v.width >= 0.9 * W && crop.h * v.height >= 0.9 * H) {
      chosen = v;
      break;
    }
  }
  return {
    id: p.id,
    src: chosen.url,
    width: chosen.width,
    height: chosen.height,
    crop,
    color: p.color,
    orientation: orientationOf(iw, ih),
    place: p.place,
    title: p.title,
    text: p.text,
  };
}

function parseSide(v: string | null): number | null {
  if (v === null || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= MAX_SIDE ? n : null;
}

// Também no `vite preview`, para conferir o build de produção; o dist não muda.
export function playlistMock(): Plugin {
  return {
    name: 'decklive-playlist-mock',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.info('  DeckLive: mock de /api/playlist ligado (VITE_MOCK=1)');
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.config.logger.info('  DeckLive: mock de /api/playlist ligado (VITE_MOCK=1)');
      server.middlewares.use(middleware);
    },
  };
}

const middleware: Connect.NextHandleFunction = (req, res, next) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/__mock') {
    for (const k of Object.keys(flags) as (keyof typeof flags)[]) {
      const v = url.searchParams.get(k);
      if (v !== null) flags[k] = v === '1';
    }
    const p = url.searchParams.get('pick');
    if (p !== null) pick = p ? p.split(',').map(Number) : null;
    revision++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(Object.assign({ pick }, flags)));
    return;
  }
  if (url.pathname !== '/api/playlist') return next();
  const w = parseSide(url.searchParams.get('w'));
  const h = parseSide(url.searchParams.get('h'));
  if (w === null || h === null) {
    res.statusCode = 400;
    res.end('w e h devem ser inteiros entre 1 e 16384');
    return;
  }
  const c = canonicalBucket(w, h);
  if (c.w !== w || c.h !== h) {
    res.statusCode = 308;
    res.setHeader('Location', '/api/playlist?w=' + c.w + '&h=' + c.h);
    res.end();
    return;
  }
  if (flags.fail) {
    res.statusCode = 503;
    res.end('mock: API fora do ar');
    return;
  }
  const reply = () => {
    if (!photos) photos = loadPhotos();
    photos
      .then((list) => {
        const etag = '"r' + revision + '-' + w + 'x' + h + '-mock"';
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400');
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.headers['if-none-match'] === etag) {
          res.statusCode = 304;
          res.end();
          return;
        }
        const chosen = pick ? pick.map((i) => list[i]).filter((p) => p) : list;
        const items = chosen.map((p) => itemFor(p, w, h));
        if (flags.broken) {
          // Fotos que não existem no CDN, para conferir "Foto com erro".
          for (const i of [1, 3]) {
            items.splice(i, 0, Object.assign({}, items[0], {
              id: 'broken' + i,
              src: 'https://cdn.yanlucas.com/decklive-mock-missing-' + i + '.jpeg',
            }));
          }
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ items }));
      })
      .catch((err: Error) => {
        photos = null;
        res.statusCode = 502;
        res.end('mock: fonte indisponível: ' + err.message);
      });
  };
  if (flags.slow) setTimeout(reply, 5000);
  else reply();
};
