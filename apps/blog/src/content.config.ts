import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// IMPORTANTE: cada coleção é declarada diretamente neste arquivo,
// sem funções auxiliares. O Astro analisa este arquivo de forma
// estática para gerar os tipos de `CollectionEntry` — esconder a
// definição atrás de uma função impede a inferência de tipos.

// O site é focado em posts (gerenciados pelo Writer). Projetos e notas
// não são mais coleções: se ainda existirem arquivos em content/projects
// e content/notes, eles são simplesmente ignorados.

// O loader `glob` aponta para a raiz do monorepo (../../content),
// onde os arquivos Markdown são versionados pelo Git.

const posts = defineCollection({
  loader: glob({
    base: '../../content/posts',
    pattern: '**/*.md',
    // Posts podem ser um arquivo solto (post.md) ou uma pasta
    // (post/index.md + imagens). Em ambos os casos o slug (id)
    // deve ser apenas o nome da pasta/arquivo, sem a extensão.
    generateId: ({ entry }) =>
      entry.replace(/\.md$/, '').replace(/\/index$/, ''),
  }),
  // `draft: true` faz o post desaparecer do site público — é como
  // o Writer mantém rascunhos sem publicá-los.
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    updatedDate: z.coerce.date().optional(),
    bannerPosition: z.string().optional(),
  }),
});

export const collections = { posts };