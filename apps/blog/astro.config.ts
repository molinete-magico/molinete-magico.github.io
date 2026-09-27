import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs';
import path from 'node:path';

// O site é um User Site do GitHub Pages sob /blog/:
// https://molinete-magico.github.io/blog/
const base = process.env.BASE_PATH ?? '/blog';

/**
 * Detecta automaticamente uma imagem chamada banner.* na pasta do post
 * e a coloca como primeira imagem do conteúdo Markdown.
 *
 * A imagem continua sendo relativa ao index.md, então o Astro processa
 * o asset da mesma forma que as imagens normais inseridas no Markdown.
 */
function automaticPostBanner() {
  return function transformer(tree: any, file: any) {
    const filePath = file.path;
    if (!filePath) return;

    const postDir = path.dirname(filePath);
    const banner = ['banner.webp', 'banner.png', 'banner.jpg', 'banner.jpeg']
      .find((name) => fs.existsSync(path.join(postDir, name)));

    if (!banner) return;

    // Não duplica o banner se ele já tiver sido colocado manualmente no Markdown.
    let alreadyReferenced = false;

    function visit(node: any) {
      if (alreadyReferenced || !node) return;

      if (node.type === 'image' && typeof node.url === 'string') {
        if (path.basename(node.url).toLowerCase() === banner.toLowerCase()) {
          alreadyReferenced = true;
          return;
        }
      }

      if (Array.isArray(node.children)) {
        for (const child of node.children) visit(child);
      }
    }

    visit(tree);
    if (alreadyReferenced) return;

    const bannerParagraph = {
      type: 'paragraph',
      data: {
        hProperties: {
          className: ['post-banner'],
        },
      },
      children: [
        {
          type: 'image',
          url: banner,
          alt: 'Banner do post',
          title: null,
        },
      ],
    };

    tree.children = [bannerParagraph, ...(tree.children ?? [])];
  };
}

export default defineConfig({
  site: (process.env.SITE_URL ?? 'https://molinete-magico.github.io').replace(/\/$/, ''),
  base,

  integrations: [sitemap()],

  markdown: {
    remarkPlugins: [automaticPostBanner],
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
