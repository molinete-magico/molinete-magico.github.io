import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// O site é um User Site do GitHub Pages sob /blog/:
// https://molinete-magico.github.io/blog/
const base = process.env.BASE_PATH ?? '/blog';

// O conteúdo Markdown e seus banners ficam na raiz do monorepo,
// fora da raiz do app Astro. Autorize explicitamente ambos os diretórios
// para o Vite conseguir servir os assets durante o desenvolvimento.
const appRoot = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  site: (process.env.SITE_URL ?? 'https://molinete-magico.github.io').replace(/\/$/, ''),
  base,

  integrations: [sitemap()],

  vite: {
    server: {
      fs: {
        allow: [appRoot, repositoryRoot],
      },
    },
  },

  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
