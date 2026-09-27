import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// O site é um User Site do GitHub Pages sob /blog/:
// https://molinete-magico.github.io/blog/
const base = process.env.BASE_PATH ?? '/blog';

export default defineConfig({
  site: (process.env.SITE_URL ?? 'https://molinete-magico.github.io').replace(/\/$/, ''),
  base,

  integrations: [sitemap()],

  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
