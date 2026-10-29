import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

// Alvos do design D9: webOS 4 (Chromium 53), Tizen 4 (Chromium 56) e Safari 12.
const TARGETS = ['chrome53', 'safari12'];

// Chromium < 61 ignora <script type="module">: o bundle sai em IIFE e entra como script clássico.
function classicScript(): Plugin {
  return {
    name: 'decklive-classic-script',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/<script type="module" crossorigin/g, '<script defer');
      },
    },
  };
}

export default defineConfig(async () => {
  // Mock da API só no servidor de desenvolvimento (VITE_MOCK=1); nunca entra no build.
  const mock = process.env.VITE_MOCK === '1';
  const plugins: Plugin[] = [classicScript()];
  if (mock) {
    const { playlistMock } = await import('./mock/playlist.ts');
    plugins.push(playlistMock());
  }
  return {
    plugins,
    build: {
      target: TARGETS,
      cssTarget: TARGETS,
      modulePreload: false,
      // Um .css separado no <head>, em vez de injetado pelo JS do IIFE.
      cssCodeSplit: false,
      rolldownOptions: { output: { format: 'iife' as const } },
    },
    server: {
      proxy: mock ? undefined : { '/api': 'http://localhost:8080' },
    },
    test: {
      include: ['test/**/*.test.ts'],
      environment: 'node',
      // Fuso do cenário "Relógio padrão".
      env: { TZ: 'America/Fortaleza' },
    },
  };
});
