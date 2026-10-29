// Envio de ajustes para outra tela (spec settings-transfer, design D7): o pacote com preferências,
// posições e áreas vai para a memória da API e volta, uma vez, pelo código de 6 caracteres.
import { withTimeout } from './api';
import { validateAreas, type Area } from './areas';
import { validateLayout, type LayoutData } from './layout';
import { validate, type Settings } from './settings';

export const PAIRING_URL = '/api/pairing';
export const TRANSFER_TIMEOUT_MS = 15 * 1000;
// Alfabeto da API, sem 0, O, 1, I nem L.
const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

export interface TransferPackage {
  v: 1;
  settings: Settings;
  layout: LayoutData;
  areas: Area[];
}

export function buildPackage(settings: Settings, layout: LayoutData, areas: Area[]): TransferPackage {
  return { v: 1, settings, layout, areas };
}

// Ao receber: campo a campo, como ao ler do navegador; o que vier inválido volta ao padrão deste
// aparelho. Sem objeto, ou de outra versão: null.
export function parsePackage(raw: unknown, defaults: Readonly<Settings>): TransferPackage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  return { v: 1, settings: validate(r.settings, defaults), layout: validateLayout(r.layout), areas: validateAreas(r.areas) };
}

// Maiúsculas, sem espaços nem hífens; null se não puder ser um código (nem chega a chamar a API).
export function normalizeCode(text: string): string | null {
  const code = text.replace(/[\s-]/g, '').toUpperCase();
  return CODE.test(code) ? code : null;
}

export type TransferFetch = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; cache?: 'no-store' },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export type SendResult = { code: string; expiresIn: number } | { error: 'too-large' | 'failed' };
export type ReceiveResult = { pkg: TransferPackage } | { error: 'invalid' | 'failed' };

function request(http: TransferFetch, url: string, init: Parameters<TransferFetch>[1]) {
  return withTimeout(
    Promise.resolve().then(() => http(url, init)),
    TRANSFER_TIMEOUT_MS,
  );
}

export function sendPackage(http: TransferFetch, pkg: TransferPackage): Promise<SendResult> {
  const failed: SendResult = { error: 'failed' };
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pkg) };
  return request(http, PAIRING_URL, init)
    .then((res): SendResult | Promise<SendResult> => {
      if (res.status === 413) return { error: 'too-large' };
      if (res.status !== 201) return failed;
      return res.json().then((d) => {
        const r = (d || {}) as Record<string, unknown>;
        if (typeof r.code !== 'string' || !r.code) return failed;
        return { code: r.code, expiresIn: typeof r.expires_in === 'number' && r.expires_in > 0 ? r.expires_in : 600 };
      });
    })
    .catch(() => failed);
}

export function receivePackage(http: TransferFetch, text: string, defaults: Readonly<Settings>): Promise<ReceiveResult> {
  const code = normalizeCode(text);
  if (!code) return Promise.resolve({ error: 'invalid' });
  const failed: ReceiveResult = { error: 'failed' };
  return request(http, PAIRING_URL + '/' + code, { cache: 'no-store' })
    .then((res): ReceiveResult | Promise<ReceiveResult> => {
      // Inexistente, vencido ou já usado.
      if (res.status === 404) return { error: 'invalid' };
      if (res.status !== 200) return failed;
      return res.json().then((raw) => {
        const pkg = parsePackage(raw, defaults);
        return pkg ? { pkg } : failed;
      });
    })
    .catch(() => failed);
}
