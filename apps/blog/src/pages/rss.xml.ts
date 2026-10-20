import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

// Endpoint gerado pelo Astro: /rss.xml
// Feed de posts (apenas publicados) para leitores de RSS.
export const GET = async (context: APIContext) => {
  const posts = (await getCollection('posts', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
  );

  // O link de cada item aponta para a página do post
  // (ex.: /blog/posts/<id>/ quando base=/blog/). `BASE_URL` é o
  // subcaminho onde o site vive, injetado pelo Astro no build.
  const BASE = import.meta.env.BASE_URL;
  // O canal do feed e os links dos itens vivem sob o subcaminho do
  // site (ex.: https://molinete-magico.github.io/blog/).
  const siteUrl = context.site ?? 'https://molinete-magico.github.io';
  return rss({
    title: 'arquivo pessoal',
    description:
      'Coisas que estou aprendendo, construindo e tentando entender.',
    site: new URL(BASE, siteUrl).toString(),
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `${BASE}posts/${post.id}/`,
    })),
    customData: '<language>pt-br</language>',
  });
};