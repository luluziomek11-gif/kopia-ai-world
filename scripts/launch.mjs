import { config as loadEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, appendFileSync, readdirSync, statSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
loadEnv({ path: join(root, '.env'), quiet: true });
const runtimeDir = join(root, 'data', 'runtime');
mkdirSync(runtimeDir, { recursive: true });
const launcherLog = join(runtimeDir, 'launcher.log');
const log = text => appendFileSync(launcherLog, new Date().toISOString() + ' ' + text + '\n');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = Number(process.env.PORT || 3001);
const url = 'http://127.0.0.1:' + port;
const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const models = [process.env.ULTRON_MODEL || 'gpt-oss:20b', process.env.EDITH_MODEL || 'gemma3:4b'];

async function json(url, timeout = 3000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}
async function worldHealth() {
  let response;
  try {
    response = await fetch(url + '/api/health', { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return null;
    throw new Error('Nie można sprawdzić serwera na porcie ' + port + '. Spróbuj ponownie za chwilę: ' + error.message);
  }
  try {
    if (!response.ok) throw new Error('Nieprawidłowa odpowiedź HTTP.');
    const health = await response.json();
    if (health.app === 'ai-world' && health.protocolVersion === 1 && health.ok) return health;
    const config = await json(url + '/api/config');
    if (health.ok && config.protocolVersion === 1 && Array.isArray(health.agents) && health.agents.some(a => a.id === 'ultron_001')) return health;
  } catch { /* A responding but unrecognized process must never be replaced. */ }
  throw new Error('Port ' + port + ' jest zajęty przez inną lub niegotową aplikację. Sprawdź konfigurację PORT.');
}
function acquireLock() {
  const path = join(runtimeDir, 'launcher.lock');
  if (existsSync(path)) {
    const owner = Number(readFileSync(path, 'utf8'));
    let alive = false;
    if (Number.isInteger(owner) && owner > 0) { try { process.kill(owner, 0); alive = true; } catch {} }
    if (alive) throw new Error('AI World już się uruchamia. Poczekaj na otwarcie okna.');
    unlinkSync(path);
  }
  const handle = openSync(path, 'wx');
  writeFileSync(handle, String(process.pid)); closeSync(handle);
  return () => { try { if (readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path); } catch {} };
}
function detached(command, args, name) {
  const output = openSync(join(runtimeDir, name + '.log'), 'a');
  const child = spawn(command, args, { cwd: root, env: process.env, detached: true, windowsHide: true, stdio: ['ignore', output, output] });
  child.on('error', error => log(name + ': ' + error.message));
  child.unref(); closeSync(output);
  if (child.pid) writeFileSync(join(runtimeDir, name + '.pid'), String(child.pid));
  return child;
}
function runNode(args) {
  return new Promise((resolve, reject) => {
    const output = openSync(join(runtimeDir, 'build.log'), 'a');
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ['ignore', output, output] });
    child.on('error', error => { closeSync(output); reject(error); });
    child.on('exit', code => { closeSync(output); code === 0 ? resolve() : reject(new Error('Budowanie nie powiodło się. Szczegóły: data/runtime/build.log')); });
  });
}
function newest(path) {
  if (!existsSync(path)) return 0;
  const info = statSync(path);
  if (info.isFile()) return info.mtimeMs;
  return Math.max(0, ...readdirSync(path).map(name => newest(join(path, name))));
}
async function ensureBuild() {
  if (!existsSync(join(root, 'node_modules', 'tsx'))) throw new Error('Brak zależności. W katalogu AI World uruchom npm ci, a potem ponownie kliknij skrót.');
  const built = existsSync(join(root, 'dist', 'index.html')) ? statSync(join(root, 'dist', 'index.html')).mtimeMs : 0;
  const changed = Math.max(...['client', 'shared', 'vite.config.ts', 'package-lock.json'].map(path => newest(join(root, path))));
  if (built < changed) {
    log('Budowanie aktualnego widoku domu.');
    await runNode([join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit']);
    await runNode([join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
  }
}
function findOllama() {
  const candidates = [process.env.OLLAMA_EXE, join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'), join(process.env.ProgramFiles || '', 'Ollama', 'ollama.exe')].filter(Boolean);
  return candidates.find(existsSync) || 'ollama.exe';
}
async function ensureOllama() {
  let tags;
  try { tags = await json(ollamaUrl + '/api/tags'); }
  catch {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(ollamaUrl).hostname)) throw new Error('Skonfigurowany serwer Ollama nie odpowiada: ' + ollamaUrl);
    log('Uruchamiam lokalne Ollama.'); detached(findOllama(), ['serve'], 'ollama');
    for (let i = 0; i < 40; i++) { await wait(500); try { tags = await json(ollamaUrl + '/api/tags'); break; } catch {} }
    if (!tags) throw new Error('Ollama nie uruchomiła się. Otwórz Ollama ręcznie i ponownie kliknij skrót.');
  }
  const names = (tags.models || []).map(m => m.name);
  const missing = models.filter(model => !names.includes(model) && !names.includes(model + ':latest'));
  if (missing.length) throw new Error('Brak lokalnego modelu: ' + missing.join(', ') + '. Uruchom w terminalu: ' + missing.map(model => 'ollama pull ' + model).join(' oraz ') + '. Potem ponownie kliknij skrót.');
  log('Ollama gotowa: ' + models.join(', '));
}
function openApp() {
  const browser = [join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')].find(existsSync);
  if (browser) {
    const child = spawn(browser, ['--app=' + url, '--start-maximized'], { detached: true, stdio: 'ignore', windowsHide: false }); child.unref();
  } else {
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true }); child.unref();
  }
}
function showError(message) {
  if (process.argv.includes('--no-browser') || process.argv.includes('--check')) return;
  const command = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($env:AI_WORLD_LAUNCH_ERROR, 'AI World', 'OK', 'Warning') | Out-Null";
  const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', command], { env: { ...process.env, AI_WORLD_LAUNCH_ERROR: message }, windowsHide: true, stdio: 'ignore' }); child.unref();
}

let releaseLock;
try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Nieprawidłowy PORT w .env.');
  const version = process.versions.node.split('.').map(Number);
  if (version[0] < 22 || (version[0] === 22 && version[1] < 13)) throw new Error('Potrzebny jest Node.js co najmniej 22.13.');
  if (process.argv.includes('--check')) {
    const tags = await json(ollamaUrl + '/api/tags');
    console.log(JSON.stringify({ root, node: process.version, built: existsSync(join(root, 'dist', 'index.html')), models: models.map(name => ({ name, installed: tags.models?.some(m => m.name === name || m.name === name + ':latest') })), world: await worldHealth() }, null, 2));
  } else {
    releaseLock = acquireLock();
    await ensureBuild(); await ensureOllama();
    if (!await worldHealth()) {
      log('Uruchamiam silnik świata.');
      detached(process.execPath, ['--import', 'tsx', join(root, 'server', 'index.ts')], 'world');
      let ready = false;
      for (let i = 0; i < 60; i++) { await wait(500); if (await worldHealth()) { ready = true; break; } }
      if (!ready) throw new Error('Silnik świata nie wystartował. Szczegóły: data/runtime/world.log');
    }
    log('Świat gotowy: ' + url);
    if (!process.argv.includes('--no-browser')) openApp();
    console.log(url);
  }
} catch (error) {
  log('Błąd: ' + error.message); console.error(error.message); showError(error.message); process.exitCode = 1;
} finally {
  releaseLock?.();
}
