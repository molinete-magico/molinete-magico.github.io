// Tipos compartilhados entre o servidor do Writer e o cliente.

// Frontmatter de um post. O schema é deliberadamente espelhado no
// content.config.ts do blog — se você mudar os campos aqui, atualize
// também a validação do Astro para manter tudo consistente.
export interface PostMeta {
  title: string;
  description: string;
  pubDate: string; // YYYY-MM-DD
  tags: string[];
  draft: boolean;
  updatedDate?: string;
  /** Posição horizontal do enquadramento do banner, em %. */
  bannerPosition?: string;
}

// Representação completa de um post como visto pelo editor.
export interface Post {
  /** Slug (id) que identifica o post: nome da pasta ou do arquivo. */
  id: string;
  /** Caminho relativo à raiz do repositório, ex: content/posts/x/index.md */
  path: string;
  /** Conteúdo Markdown (sem o frontmatter). */
  body: string;
  file: PostMeta;
}

// Forma de um item listado na biblioteca de posts.
export interface PostListItem {
  id: string;
  title: string;
  pubDate: string;
  draft: boolean;
  tags: string[];
  updatedDate?: string;
}

// Status do repositório Git, exibido na interface.
export interface GitStatus {
  branch: string;
  dirty: string[];
  behind: number;
  ahead: number;
  lastCommit: { hash: string; date: string; subject: string } | null;
}