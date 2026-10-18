// Integração com o Git via linha de comando.
//
// O Writer NÃO armazena credenciais GitHub. Ele delega cada operação
// ao Git CLI instalado na máquina, que usa as credenciais já
// configuradas pelo usuário (SSH, gh auth, credential helper...).
// Assim, o Writer nunca vê nem guarda tokens.

import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { repoRoot } from './fs.ts';
import type { GitStatus } from '../shared/types.ts';

const execFileP = promisify(execFile);

function findGitExecutable(): string {
  const configured = process.env.GIT_EXECUTABLE;
  if (configured) return configured;
  if (process.platform !== 'win32') return 'git';

  const candidates = [
    process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, 'Git', 'cmd', 'git.exe')
      : null,
    process.env['ProgramFiles(x86)']
      ? path.join(process.env['ProgramFiles(x86)']!, 'Git', 'cmd', 'git.exe')
      : null,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe')
      : null,
    path.join(
      os.homedir(),
      '.cache',
      'codex-runtimes',
      'codex-primary-runtime',
      'dependencies',
      'native',
      'git',
      'cmd',
      'git.exe',
    ),
  ];

  return candidates.find(
    (candidate): candidate is string => candidate !== null && existsSync(candidate),
  ) ?? 'git';
}

const gitExecutable = findGitExecutable();

// Executa um comando git na raiz do repositório e devolve o stdout
// em texto puro. Erros do Git (autenticação, conflitos...) viram
// exceções com o stderr incluído na mensagem para exibir na interface
// e permitir decisões como "nothing to commit".
function errorWithStderr(err: unknown, cmd: string, stderr: string): Error {
  if (err instanceof Error) {
    const msg = stderr.trim() ? `${err.message}\n${stderr.trim()}` : err.message;
    return new Error(msg);
  }
  return new Error(`Command failed: ${cmd}\n${stderr.trim()}`.trim());
}

async function git(...args: string[]): Promise<string> {
  let result;
  try {
    result = await execFileP(gitExecutable, args, {
      cwd: repoRoot(),
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = ((err as { stderr?: unknown })?.stderr ?? '') as string;
    throw errorWithStderr(err, `git ${args.join(' ')}`, stderr);
  }
  if (result.stderr && !result.stderr.startsWith('warning:')) {
    process.stderr.write(result.stderr);
  }
  return result.stdout.trim();
}

export async function gitStatus(): Promise<GitStatus> {
  // Se o diretório ainda não é um repositório Git (primeira execução),
  // devolvemos um status vazio em vez de quebrar a interface.
  const empty: GitStatus = {
    branch: '?',
    dirty: [],
    ahead: 0,
    behind: 0,
    lastCommit: null,
  };

  try {
    return await doGitStatus();
  } catch (err) {
    const message = (err as Error).message;
    // "not a git repository" → status vazio; outros erros também
    // aparecem de forma útil na interface em vez de derrubar o app.
    console.warn('[git] não foi possível ler status:', message);
    return empty;
  }
}

async function doGitStatus(): Promise<GitStatus> {
  // Arquivos modificados/criados/excluídos (porcelain = formato estável).
  const dirtyRaw = await git('status', '--porcelain');
  const dirty = dirtyRaw
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3))
    .filter((p) => p.includes('content/'));

  // Quantos commits à frente/atrás do remoto de upstream.
  let ahead = 0;
  let behind = 0;
  try {
    const counts = await git('rev-list', '--left-right', '--count', 'HEAD...@{u}');
    const [a, b] = counts.split(/\s+/).map(Number);
    ahead = a;
    behind = b;
  } catch {
    // Sem upstream configurado — ignoramos os contadores.
  }

  let branch = 'main';
  let lastCommit: GitStatus['lastCommit'] = null;
  try {
    branch = await git('rev-parse', '--abbrev-ref', 'HEAD');
    // Separação por "|" evita depender de espaços na mensagem do commit.
    const [hash, date, subject] = (
      await git('log', '-1', '--format=%h|%cI|%s')
    ).split('|');
    if (hash) lastCommit = { hash, date: date ?? '', subject: subject ?? '' };
  } catch {
    // Repositório sem commits ainda.
  }
  void ahead;
  void behind;

  return { branch, dirty, ahead, behind, lastCommit };
}

// Cria um commit com as mudanças atuais do conteúdo.
// Retorna a mensagem efetivamente usada pelo Git. Se não houver o que
// commitar (ex.: o post já estava idêntico), não é um erro grave.
export async function commit(message: string): Promise<string> {
  await git('add', 'content');
  const subject = message.trim() || 'alterações no conteúdo';
  try {
    await git('commit', '-m', subject, '--no-verify');
  } catch (err) {
    const text = (err as Error).message;
    if (!/nothing to commit|no changes added/.test(text)) throw err;
  }
  return subject;
}

// Envia os commits locais para o remoto. Se falhar (ex.: precisa de
// autenticação), o erro do Git é propagado para a interface.
export async function push(): Promise<string> {
  const out = await git('push');
  return out || 'Puxado com sucesso';
}

// Puxa as mudanças do remoto, para trabalhar sempre sobre a versão
// mais recente antes de publicar.
export async function pull(): Promise<string> {
  const out = await git('pull', '--ff-only');
  return out || 'Atualizado';
}

// Verifica se o Git reconhece uma autenticação válida para o remoto.
// `push --dry-run` toca o servidor sem enviar nada.
export async function canPush(): Promise<{ ok: boolean; error?: string }> {
  try {
    await git('push', '--dry-run');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
