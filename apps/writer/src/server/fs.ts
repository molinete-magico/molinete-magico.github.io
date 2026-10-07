// Configuração da ferramenta.
//
// A raiz do monorepo é descoberta nesta ordem:
//   1. variável de ambiente WRITER_REPO_ROOT;
//   2. subindo a árvore a partir do diretório atual em busca da pasta
//      `content/` — a "marca" do arquivo.
// Tudo é resolvido por getters para permitir trocar de workspace em
// tempo de execução (POST /api/workspace).

import path from 'node:path';
import { existsSync } from 'node:fs';

let repoRootCache: string | null = null;

export function setRepoRoot(dir: string): string {
  const resolved = path.resolve(dir);
  if (!existsSync(path.join(resolved, 'content'))) {
    throw new Error(`A pasta escolhida não é o seu arquivo (não tem content/): ${resolved}`);
  }
  repoRootCache = resolved;
  return resolved;
}

export function repoRoot(): string {
  if (repoRootCache) return repoRootCache;
  const env = process.env.WRITER_REPO_ROOT;
  if (env) {
    repoRootCache = setRepoRoot(env);
    return repoRootCache;
  }
  repoRootCache = findRepoRoot(process.cwd());
  return repoRootCache;
}

// Sobe a árvore de diretórios desde `start` até achar quem contém
// `content/`. Se não achar, para na raiz do filesystem.
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, 'content'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Não encontrei a pasta content/: rode o Writer dentro do monorepo.');
    }
    dir = parent;
  }
}

// Onde os arquivos Markdown vivem. É nesta pasta que o Writer
// trabalha e é ela que o Git versiona.
export function contentRoot(): string {
  return path.resolve(repoRoot(), 'content');
}

export function postsRoot(): string {
  return path.resolve(contentRoot(), 'posts');
}

// Cliente compilado (esbuild). No desktop empacotado, o Electron
// fornece WRITER_CLIENT_DIR para os assets incluídos no aplicativo.
export function clientDir(): string {
  return process.env.WRITER_CLIENT_DIR
    ? path.resolve(process.env.WRITER_CLIENT_DIR)
    : path.resolve(repoRoot(), 'apps/writer/dist/client');
}

// Porta do servidor local. Pode ser substituída por env var.
export const PORT = Number(process.env.WRITER_PORT ?? 4322);