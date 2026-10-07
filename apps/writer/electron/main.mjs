import { app, BrowserWindow, dialog } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const PORT = Number(process.env.WRITER_PORT ?? 4322);
const workspaceFile = () => path.join(app.getPath('userData'), 'workspace.json');

function isWorkspace(dir) {
  return Boolean(dir && existsSync(path.join(dir, 'content')));
}

function loadSavedWorkspace() {
  try {
    const data = JSON.parse(readFileSync(workspaceFile(), 'utf8'));
    return typeof data.root === 'string' && isWorkspace(data.root) ? data.root : null;
  } catch {
    return null;
  }
}

function saveWorkspace(root) {
  const file = workspaceFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ root }, null, 2), 'utf8');
}

async function chooseWorkspace() {
  const candidates = [process.env.WRITER_REPO_ROOT, process.cwd(), path.dirname(process.execPath)].filter(Boolean);
  const existing = candidates.find(isWorkspace);
  if (existing) return path.resolve(existing);

  const result = await dialog.showOpenDialog({
    title: 'Escolha a pasta do seu arquivo',
    message: 'Selecione a pasta que contém a pasta content/ dos seus posts.',
    properties: ['openDirectory'],
  });

  if (result.canceled || !result.filePaths[0]) return null;
  const selected = path.resolve(result.filePaths[0]);
  if (!isWorkspace(selected)) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Pasta inválida',
      message: 'A pasta escolhida não contém content/.',
      detail: selected,
    });
    return chooseWorkspace();
  }
  return selected;
}

let mainWindow = null;
let server = null;

async function createWindow() {
  const workspace = loadSavedWorkspace() ?? await chooseWorkspace();
  if (!workspace) {
    app.quit();
    return;
  }

  process.env.WRITER_REPO_ROOT = workspace;
  process.env.WRITER_IN_PROCESS = '1';
  const resourceRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
  process.env.WRITER_CLIENT_DIR = path.join(resourceRoot, 'writer-client');

  const require = createRequire(import.meta.url);
  const writerServer = require(path.join(resourceRoot, 'writer-server', 'writer.cjs'));
  globalThis.__writerWorkspacePersist = saveWorkspace;

  server = await writerServer.startWriterServer({ port: PORT, repoRoot: workspace });
  saveWorkspace(workspace);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 650,
    show: false,
    title: 'Writer',
    backgroundColor: '#111111',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await mainWindow.loadURL('http://127.0.0.1:' + PORT + '/');
}

app.whenReady().then(createWindow).catch(async (error) => {
  console.error(error);
  await dialog.showMessageBox({
    type: 'error',
    title: 'Writer não pôde iniciar',
    message: 'Não foi possível iniciar o Writer.',
    detail: error instanceof Error ? error.message : String(error),
  });
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  try { server?.close(); } catch {}
});
