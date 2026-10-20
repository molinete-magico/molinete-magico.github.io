import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'apps', 'blog', 'dist');
const basePath = (process.env.BASE_PATH ?? '/blog').replace(/\/$/, '') || '';
const errors = [];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function publicUrlForFile(file) {
  const relative = path.relative(dist, file).split(path.sep).join('/');
  if (relative === 'index.html') return `${basePath}/` || '/';
  if (relative.endsWith('/index.html')) {
    return `${basePath}/${relative.slice(0, -'index.html'.length)}`;
  }
  return `${basePath}/${relative}`;
}

function isExternalOrNonNavigation(value) {
  return !value || value.startsWith('#') ||
    /^(?:https?:|mailto:|tel:|javascript:|data:|blob:|\/\/)/i.test(value);
}

async function checkReference(value, sourceFile, sourceUrl, label) {
  if (isExternalOrNonNavigation(value)) return;
  let url;
  try {
    url = new URL(value, `https://site-check.invalid${sourceUrl}`);
  } catch {
    errors.push(`${path.relative(root, sourceFile)}: URL inválida em ${label}: ${value}`);
    return;
  }
  if (url.origin !== 'https://site-check.invalid') return;

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    errors.push(`${path.relative(root, sourceFile)}: URL com escape inválido em ${label}: ${value}`);
    return;
  }

  let relative;
  if (basePath && pathname === basePath) relative = '';
  else if (!basePath) relative = pathname.replace(/^\//, '');
  else if (pathname.startsWith(`${basePath}/`)) relative = pathname.slice(basePath.length + 1);
  else {
    errors.push(`${path.relative(root, sourceFile)}: link local fora do base path (${basePath}): ${value}`);
    return;
  }

  relative = relative.replace(/^\/+/, '');
  let target;
  if (!relative) {
    target = path.join(dist, 'index.html');
  } else {
    target = path.resolve(dist, relative);
    if (pathname.endsWith('/') || !path.extname(target)) target = path.join(target, 'index.html');
  }
  const relativeTarget = path.relative(dist, target);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    errors.push(`${path.relative(root, sourceFile)}: caminho sai do diretório de build: ${value}`);
    return;
  }
  try {
    await fs.access(target);
  } catch {
    errors.push(`${path.relative(root, sourceFile)}: destino local inexistente em ${label}: ${value}`);
  }
}

try {
  await fs.access(dist);
} catch {
  console.error(`Build não encontrado em ${path.relative(root, dist)}. Execute o build do blog antes da verificação.`);
  process.exit(2);
}

const files = await walk(dist);
for (const file of files) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.html') {
    const html = await fs.readFile(file, 'utf8');
    const sourceUrl = publicUrlForFile(file);
    const pattern = /\b(href|src)\s*=\s*["']([^"']+)["']/gi;
    for (const match of html.matchAll(pattern)) {
      await checkReference(match[2].trim(), file, sourceUrl, match[1].toLowerCase());
    }
  } else if (extension === '.css') {
    const css = await fs.readFile(file, 'utf8');
    const sourceUrl = publicUrlForFile(file);
    const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
    for (const match of css.matchAll(pattern)) {
      await checkReference(match[2].trim(), file, sourceUrl, 'url() CSS');
    }
  }
}

if (errors.length) {
  console.error(`Verificação de integridade encontrou ${errors.length} problema(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Integridade do build verificada: ${files.length} arquivos; nenhum link ou asset local quebrado detectado.`);
