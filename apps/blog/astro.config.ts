import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// O site é um User Site do GitHub Pages sob /blog/:
// https://molinete-magico.github.io/blog/
const base = process.env.BASE_PATH ?? '/blog';

// Os posts e banners ficam fora da raiz do app Astro, na raiz do monorepo.
const appRoot = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const contentRoot = fileURLToPath(new URL('../../content', import.meta.url));

// Envolve cada tabela Markdown para que tabelas largas possam rolar sem
// comprimir as colunas nem afetar a largura do restante do documento.
type MarkdownNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
};

function wrapMarkdownTables() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children) return;
      const children: MarkdownNode[] = [];
      for (const child of node.children) {
        if (child.type === 'element' && child.tagName === 'table') {
          children.push({
            type: 'element',
            tagName: 'div',
            properties: { className: ['markdown-table-scroll'], role: 'region', tabIndex: 0, 'aria-label': 'Tabela; role para rolar horizontalmente' },
            children: [child],
          });
        } else {
          visit(child);
          children.push(child);
        }
      }
      node.children = children;
    };
    visit(tree);
  };
}

export default defineConfig({
  site: (process.env.SITE_URL ?? 'https://molinete-magico.github.io').replace(/\/$/, ''),
  base,

  integrations: [sitemap()],

  vite: {
    server: {
      fs: {
        // Autoriza explicitamente a raiz, a pasta de conteúdo e o app.
        allow: [appRoot, repositoryRoot, contentRoot],
        // O Vite ainda rejeita esses assets no modo estrito em alguns
        // setups de monorepo/symlink. Isso afeta apenas o servidor local.
        strict: false,
      },
    },
  },

  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
