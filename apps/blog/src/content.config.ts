import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// IMPORTANTE: cada coleção é declarada diretamente neste arquivo,
// sem funções auxiliares. O Astro analisa este arquivo de forma
// estática para gerar os tipos de CollectionEntry.

const posts = defineCollection({
  loader: glob({
    base: '../../content/posts',
    pattern: '**/*.md',
    generateId: ({ entry }) =>
      entry.replace(/\.md$/, '').replace(/\/index$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    updatedDate: z.coerce.date().optional(),
    bannerPosition: z.string().optional(),
    // Slug do projeto ao qual o post pertence.
    project: z.string().optional(),
  }),
});

const projects = defineCollection({
  loader: glob({
    base: '../../content/projects',
    pattern: '**/project.md',
    generateId: ({ entry }) => entry.replace(/\/project\.md$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    type: z.enum(['rpg', 'story']),
    description: z.string().default(''),
    cover: z.string().optional(),
    published: z.boolean().default(false),
    showHomepage: z.boolean().default(true),
    order: z.number().default(0),
  }),
});

// Documento principal do projeto. É a página de entrada do leitor.
// Para histórias, pode ser o prólogo; para RPGs, o corpo principal.
const projectDocs = defineCollection({
  loader: glob({
    base: '../../content/projects',
    pattern: '**/document.md',
    generateId: ({ entry }) => entry.replace(/\/document\.md$/, ''),
  }),
  schema: z.object({
    title: z.string().default('Documento principal'),
    published: z.boolean().default(true),
  }),
});

// Capítulos são unidades publicáveis independentes. Um capítulo com
// published: false permanece no repositório, mas não gera página pública.
const projectChapters = defineCollection({
  loader: glob({
    base: '../../content/projects',
    pattern: '**/chapters/**/*.md',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    order: z.number().default(0),
    published: z.boolean().default(true),
  }),
});

// Complementos também têm URL própria e aparecem no mesmo sumário.
const projectSupplements = defineCollection({
  loader: glob({
    base: '../../content/projects',
    pattern: '**/supplements/**/*.md',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    order: z.number().default(0),
    published: z.boolean().default(true),
  }),
});

export const collections = {
  posts,
  projects,
  projectDocs,
  projectChapters,
  projectSupplements,
};
