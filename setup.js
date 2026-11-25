#!/usr/bin/env node
// GramTypo bootstrap. Usage:
//   node setup.js                          — створити й запустити
//   node setup.js --no-launch              — тільки створити
//   node setup.js --repo nick/gramtypo --no-launch  — створити, закомітити, запушити
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const cp = require('node:child_process')

const ROOT = path.join(os.homedir(), 'gramtypo')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error('\nПотрібен Node.js 18+. Постав LTS з https://nodejs.org\n')
  process.exit(1)
}

const FILES = {
  'package.json': String.raw`{
  "name": "gramtypo",
  "productName": "GramTypo",
  "version": "0.1.0",
  "private": true,
  "main": "main.js",
  "scripts": {
    "start": "electron ."
  },
  "devDependencies": {
    "electron": "^33.2.0"
  }
}
`,
  'app.config.json': String.raw`{
  "version": "0.1.0",
  "repo": "",
  "channel": "stable"
}
`,
  '.gitignore': String.raw`node_modules
.DS_Store
*.log
`,
  'README.md': String.raw`# GramTypo

Оверлей-редактор: править орфографію та граматику, за запитом покращує формулювання.

Запуск: npm start
Хоткей: Cmd+P на macOS, Ctrl+P на Windows.

На macOS потрібен дозвіл Accessibility для терміналу або зібраного .app.

## Оновлення

Впиши repo у app.config.json у форматі owner/gramtypo і публікуй релізи з version.json.
`,
  'main.js': String.raw`const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, screen, Tray, Menu, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { exec } = require('node:child_process')
const store = require('./src/store')
const { correct } = require('./src/providers')
const updater = require('./src/updater')

const HOTKEY = 'CommandOrControl+P'
const isMac = process.platform === 'darwin'

let win = null
let tray = null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function sendKey(key) {
  return new Promise((resolve) => {
    const cmd = isMac
      ? 'osascript -e \'tell application "System Events" to keystroke "' + key + '" using {command down}\''
      : 'powershell -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^' + key + '\')"'
    exec(cmd, () => resolve())
  })
}

async function grabSelection() {
  const backup = clipboard.readText()
  clipboard.writeText('')
  await sendKey('c')
  await sleep(150)
  const selected = clipboard.readText()
  clipboard.writeText(backup)
  return selected
}

function positionWindow() {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width, height } = display.workArea
  const [w] = win.getSize()
  win.setPosition(Math.round(x + (width - w) / 2), Math.round(y + height * 0.2))
}

async function toggle() {
  if (!win) return
  if (win.isVisible()) return win.hide()

  positionWindow()
  win.showInactive()
  win.focus()
  win.webContents.send('gt:focus-input')

  if (store.read().captureSelection) {
    const selected = await grabSelection()
    if (selected) win.webContents.send('gt:selection', selected)
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 680,
    height: 500,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#14161b',
    vibrancy: isMac ? 'under-window' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  win.loadFile(path.join(__dirname, 'src', 'index.html'))
  win.on('blur', () => win.hide())
}

function createTray() {
  const file = path.join(__dirname, 'assets', 'tray.png')
  const icon = fs.existsSync(file) ? nativeImage.createFromPath(file).resize({ width: 16, height: 16 }) : nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('GramTypo')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Відкрити (Cmd/Ctrl + P)', click: toggle },
    { type: 'separator' },
    { label: 'Вихід', click: () => app.quit() }
  ]))
  tray.on('click', toggle)
}

ipcMain.handle('gt:correct', (_e, payload) => correct(payload))
ipcMain.handle('gt:settings:get', () => store.read())
ipcMain.handle('gt:settings:set', (_e, patch) => store.write(patch))
ipcMain.handle('gt:update:check', () => updater.check())
ipcMain.handle('gt:update:apply', async (e, manifest) => {
  await updater.apply(manifest, (done, total, file) => e.sender.send('gt:update:progress', { done, total, file }))
  return true
})
ipcMain.handle('gt:update:relaunch', () => { app.relaunch(); app.exit(0) })
ipcMain.on('gt:close', () => win && win.hide())
ipcMain.on('gt:copy', (_e, text) => clipboard.writeText(text))
ipcMain.on('gt:replace', async (_e, text) => {
  clipboard.writeText(text)
  win.hide()
  await sleep(130)
  await sendKey('v')
})

app.whenReady().then(() => {
  store.init(app.getPath('userData'))
  createWindow()
  createTray()
  if (!globalShortcut.register(HOTKEY, toggle)) console.warn('Хоткей зайнятий: ' + HOTKEY)
  if (app.dock) app.dock.hide()
})

app.on('window-all-closed', (e) => e.preventDefault())
app.on('will-quit', () => globalShortcut.unregisterAll())

if (!app.requestSingleInstanceLock()) app.quit()
`,
  'preload.js': String.raw`const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gt', {
  correct: (p) => ipcRenderer.invoke('gt:correct', p),
  getSettings: () => ipcRenderer.invoke('gt:settings:get'),
  saveSettings: (p) => ipcRenderer.invoke('gt:settings:set', p),
  close: () => ipcRenderer.send('gt:close'),
  copy: (t) => ipcRenderer.send('gt:copy', t),
  replace: (t) => ipcRenderer.send('gt:replace', t),
  onSelection: (cb) => ipcRenderer.on('gt:selection', (_e, t) => cb(t)),
  onFocusInput: (cb) => ipcRenderer.on('gt:focus-input', () => cb()),
  checkUpdate: () => ipcRenderer.invoke('gt:update:check'),
  applyUpdate: (m) => ipcRenderer.invoke('gt:update:apply', m),
  relaunch: () => ipcRenderer.invoke('gt:update:relaunch'),
  onUpdateProgress: (cb) => ipcRenderer.on('gt:update:progress', (_e, p) => cb(p))
})
`,
  'src/store.js': String.raw`const fs = require('node:fs')
const path = require('node:path')

let file = null
let cache = null

const DEFAULTS = {
  provider: 'mock',
  model: 'venice-uncensored',
  apiKey: '',
  tone: 'neutral',
  mode: 'correct',
  captureSelection: true
}

exports.init = (dir) => { file = path.join(dir, 'settings.json'); cache = null }

exports.read = () => {
  if (cache) return { ...cache }
  try { cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) } }
  catch { cache = { ...DEFAULTS } }
  return { ...cache }
}

exports.write = (patch) => {
  cache = { ...exports.read(), ...patch }
  fs.writeFileSync(file, JSON.stringify(cache, null, 2))
  return { ...cache }
}
`,
  'src/providers.js': String.raw`const store = require('./store')

const TONE = {
  neutral: 'нейтральний',
  formal: 'формальний',
  friendly: 'дружній',
  concise: 'гранично короткий',
  diplomatic: 'дипломатичний'
}

const SYSTEM = 'Ти — GramTypo, редактор тексту. Відповідай ТІЛЬКИ валідним JSON без markdown: ' +
  '{"corrected":"...","notes":[{"severity":"error|style","text":"..."}],"alternatives":["..."]}. ' +
  'Режим correct — виправляй орфографію, граматику, пунктуацію, порядок слів, не переписуй авторські формулювання. ' +
  'Режим improve — додатково підсилюй формулювання під заданий тон. ' +
  'Зберігай мову оригіналу, абзаци, розмітку. notes — лише реальні правки, максимум 6. ' +
  'alternatives — 2 варіанти лише в режимі improve, інакше порожній масив. ' +
  'Якщо помилок немає, corrected повторює оригінал.'

function body({ text, tone, mode }) {
  return 'Тон: ' + (TONE[tone] || 'нейтральний') + '\nРежим: ' + mode + '\n\nТекст:\n' + text
}

async function openAICompatible({ url, key, model, text, tone, mode }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: body({ text, tone, mode }) }
      ]
    })
  })
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()))
  const data = await res.json()
  return data.choices[0].message.content
}

async function anthropic({ key, model, text, tone, mode }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: 'user', content: body({ text, tone, mode }) }]
    })
  })
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()))
  const data = await res.json()
  return data.content[0].text
}

function mock({ text, mode }) {
  const out = text
    .replace(/\bTheir\b/g, "They're")
    .replace(/\btomorow\b/gi, 'tomorrow')
    .replace(/\brecieved\b/gi, 'received')
    .replace(/\bsuprised\b/gi, 'surprised')
    .replace(/\bMe and my team was\b/g, 'My team and I were')
    .replace(/\bwas\b(?=\s+(?:surprised|happy|ready))/g, 'were')
  return {
    corrected: out,
    notes: out === text ? [] : [{ severity: 'error', text: 'локальні правки (mock)' }],
    alternatives: mode === 'improve' ? [out, out] : []
  }
}

function parse(raw) {
  const a = raw.indexOf('{')
  const b = raw.lastIndexOf('}')
  const p = JSON.parse(raw.slice(a, b + 1))
  return {
    corrected: String(p.corrected || ''),
    notes: Array.isArray(p.notes) ? p.notes.slice(0, 6) : [],
    alternatives: Array.isArray(p.alternatives) ? p.alternatives.slice(0, 2) : []
  }
}

exports.correct = async ({ text, tone, mode }) => {
  if (!text || !text.trim()) return { corrected: '', notes: [], alternatives: [] }
  const s = store.read()
  const p = { text, tone, mode }
  if (s.provider === 'mock' || !s.apiKey) return mock(p)
  try {
    let raw
    if (s.provider === 'venice') raw = await openAICompatible({ url: 'https://api.venice.ai/api/v1/chat/completions', key: s.apiKey, model: s.model || 'venice-uncensored', ...p })
    else if (s.provider === 'openai') raw = await openAICompatible({ url: 'https://api.openai.com/v1/chat/completions', key: s.apiKey, model: s.model || 'gpt-4o-mini', ...p })
    else if (s.provider === 'anthropic') raw = await anthropic({ key: s.apiKey, model: s.model || 'claude-sonnet-4-5', ...p })
    else if (s.provider === 'ollama') raw = await openAICompatible({ url: 'http://127.0.0.1:11434/v1/chat/completions', key: 'ollama', model: s.model || 'llama3.1', ...p })
    return parse(raw)
  } catch (err) {
    return { corrected: '', notes: [{ severity: 'error', text: String(err.message || err) }], alternatives: [] }
  }
}
`,
  'src/updater.js': String.raw`const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const crypto = require('node:crypto')
const { app } = require('electron')

const CONFIG = path.join(app.getAppPath(), 'app.config.json')
const cfg = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'))

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'GramTypo-Updater' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return resolve(get(res.headers.location))
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.setTimeout(20000, () => req.destroy(new Error('таймаут')))
  })
}

function gt(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}

exports.check = async () => {
  const c = cfg()
  if (!c.repo || c.repo.includes('OWNER')) {
    return { available: false, current: c.version, error: 'repo не вказано в app.config.json' }
  }
  try {
    const url = 'https://github.com/' + c.repo + '/releases/latest/download/version.json'
    const manifest = JSON.parse((await get(url)).toString('utf8'))
    return {
      available: gt(manifest.version, c.version),
      current: c.version,
      latest: manifest.version,
      notes: manifest.notes || '',
      manifest
    }
  } catch (err) {
    return { available: false, current: c.version, error: String(err.message || err) }
  }
}

exports.apply = async (manifest, onProgress) => {
  const entries = Object.entries(manifest.files)
  let done = 0
  for (const [rel, url] of entries) {
    const buf = await get(url)
    const want = manifest.sha256 && manifest.sha256[rel]
    if (want) {
      const got = crypto.createHash('sha256').update(buf).digest('hex')
      if (got !== want) throw new Error('невірна контрольна сума: ' + rel)
    }
    const target = path.join(app.getAppPath(), rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, buf)
    onProgress && onProgress(++done, entries.length, rel)
  }
  const c = cfg()
  fs.writeFileSync(CONFIG, JSON.stringify({ ...c, version: manifest.version }, null, 2))
}
`,
  'src/index.html': String.raw`<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'" />
  <link rel="stylesheet" href="styles.css" />
  <title>GramTypo</title>
</head>
<body>
  <header class="hdr">
    <div class="brand">
      <div class="logo">G</div>
      <div class="brandtxt"><span class="name">GramTypo</span><span class="sub">виправлення та покращення тексту</span></div>
    </div>
    <div class="hdractions">
      <button class="icon" id="gear" title="Налаштування">&#9881;</button>
      <button class="icon" id="close" title="Закрити">&#10005;</button>
    </div>
  </header>

  <div class="modes">
    <button class="mode active" data-mode="correct">Тільки виправлення</button>
    <button class="mode" data-mode="improve">Покращити</button>
  </div>

  <div class="tones">
    <span class="tonelabel">Тон</span>
    <button class="chip active" data-tone="neutral">Як є</button>
    <button class="chip" data-tone="formal">Формально</button>
    <button class="chip" data-tone="friendly">Дружньо</button>
    <button class="chip" data-tone="concise">Коротко</button>
    <button class="chip" data-tone="diplomatic">Дипломатично</button>
  </div>

  <main class="panes">
    <section class="pane">
      <div class="panehdr"><span>Оригінал</span><span class="meta" id="srcMeta"></span></div>
      <textarea id="input" placeholder="Виділи текст у будь-якому застосунку й натисни хоткей — або встав сюди"></textarea>
    </section>
    <section class="pane">
      <div class="panehdr"><span>GramTypo</span><span class="meta ok" id="outMeta"></span></div>
      <div id="output" class="paneBody"><span class="ph">результат з'явиться тут</span></div>
    </section>
  </main>

  <div class="notes" id="notes"></div>

  <footer class="ftr">
    <div class="ftractions">
      <button class="primary" id="replace">Замінити в полі</button>
      <button class="ghost" id="copy">Копіювати</button>
      <button class="ghost" id="again">Ще варіанти</button>
    </div>
    <div class="hint"><kbd id="kbd">ctrl</kbd><kbd>P</kbd> виклик &middot; <kbd>esc</kbd> закрити</div>
  </footer>

  <div class="settings" id="settings">
    <div class="srow"><label>Провайдер</label>
      <select id="provider">
        <option value="mock">Mock (без ключа)</option>
        <option value="venice">Venice</option>
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
        <option value="ollama">Ollama (локально)</option>
      </select>
    </div>
    <div class="srow"><label>Модель</label><input id="model" type="text" /></div>
    <div class="srow"><label>API-ключ</label><input id="apiKey" type="password" /></div>
    <div class="srow"><label>Захоплювати виділення</label><input id="captureSelection" type="checkbox" /></div>
    <div class="srow"><label>Версія</label><span id="ver" class="ver">—</span></div>
    <div class="srow"><label>Оновлення</label><button class="ghost" id="checkUpd">Перевірити</button></div>
    <div class="updbar" id="updbar"></div>
  </div>

  <script src="renderer.js"></script>
</body>
</html>
`,
  'src/styles.css': String.raw`:root{--bg:#14161b;--fg:#e8eaf0;--muted:#8b93a7;--line:#262a33;--accent:#5b8cff;--ok:#35c46b;--warn:#f0a638;--err:#f0556b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.5 ui-sans-serif,-apple-system,"Segoe UI",Inter,sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden;user-select:none}
.hdr{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-bottom:1px solid var(--line);-webkit-app-region:drag}
.brand{display:flex;gap:9px;align-items:center}
.logo{width:26px;height:26px;border-radius:7px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:600}
.brandtxt{display:flex;flex-direction:column;line-height:1.15}
.name{font-weight:600}
.sub{color:var(--muted);font-size:11px}
.hdractions{display:flex;gap:4px;-webkit-app-region:no-drag}
.icon{width:26px;height:26px;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer;font-size:13px}
.icon:hover{background:#1e222b;color:var(--fg)}
.modes{display:flex;gap:4px;padding:10px 14px 0}
.mode{border:1px solid var(--line);background:transparent;color:var(--muted);padding:5px 11px;border-radius:999px;font-size:12px;cursor:pointer}
.mode.active{background:var(--accent);border-color:transparent;color:#fff}
.tones{display:flex;align-items:center;gap:5px;padding:9px 14px 11px;flex-wrap:wrap}
.tonelabel{color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.05em}
.chip{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:3px 10px;font-size:11.5px;cursor:pointer}
.chip.active{color:var(--fg);border-color:var(--accent);background:#1c2130}
.panes{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border-top:1px solid var(--line);flex:1;min-height:0}
.pane{background:var(--bg);display:flex;flex-direction:column;min-height:0}
.panehdr{display:flex;justify-content:space-between;padding:8px 12px 4px;font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.meta.ok{color:var(--ok)}
textarea,.paneBody{flex:1;margin:0;padding:0 12px 12px;border:0;background:transparent;color:var(--fg);font:inherit;font-size:13.5px;line-height:1.62;resize:none;outline:none;overflow-y:auto;user-select:text}
.ph{color:#4d5567}
.add{color:var(--ok);background:rgba(53,196,107,.13);border-radius:3px;padding:0 1px}
.del{color:var(--err);text-decoration:line-through;opacity:.65}
.notes{padding:8px 14px;display:none;flex-direction:column;gap:4px;border-top:1px solid var(--line);background:#171a21;max-height:88px;overflow-y:auto}
.notes.on{display:flex}
.note{font-size:11.5px;color:var(--muted);display:flex;gap:7px;align-items:baseline}
.dot{width:5px;height:5px;border-radius:50%;flex:0 0 auto}
.dot.error{background:var(--err)}
.dot.style{background:var(--warn)}
.ftr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid var(--line);gap:10px}
.ftractions{display:flex;gap:6px}
.primary{background:var(--accent);color:#fff;border:0;border-radius:7px;padding:6px 13px;font-size:12.5px;font-weight:600;cursor:pointer}
.primary:disabled{opacity:.45;cursor:default}
.ghost{background:transparent;color:var(--fg);border:1px solid var(--line);border-radius:7px;padding:6px 11px;font-size:12.5px;cursor:pointer}
.ghost:hover{border-color:#3a4150}
.hint{color:var(--muted);font-size:11px}
kbd{border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:10.5px;font-family:inherit}
.settings{display:none;padding:11px 14px 14px;border-top:1px solid var(--line);flex-direction:column;gap:8px}
.settings.on{display:flex}
.srow{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px}
.srow label{color:var(--muted)}
.srow select,.srow input[type=text],.srow input[type=password]{background:#1b1f27;border:1px solid var(--line);color:var(--fg);border-radius:6px;padding:4px 8px;font:inherit;width:210px}
.ver{color:var(--muted);font-variant-numeric:tabular-nums}
.updbar{display:none;font-size:11.5px;color:var(--muted);line-height:1.5}
.updbar.on{display:block}
.updbar b{color:var(--fg);font-weight:600}
`,
  'src/renderer.js': String.raw`const $ = (id) => document.getElementById(id)
const input = $('input')
const output = $('output')
const notes = $('notes')
const replaceBtn = $('replace')

let state = { mode: 'correct', tone: 'neutral', result: null, seq: 0 }
let timer = null

$('kbd').textContent = navigator.platform.toLowerCase().includes('mac') ? '\u2318' : 'ctrl'

function tokens(s) { return s.split(/(\s+)/).filter((t) => t.length) }

function diff(a, b) {
  const A = tokens(a)
  const B = tokens(b)
  const m = A.length
  const n = B.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ t: 'same', s: A[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', s: A[i] }); i++ }
    else { out.push({ t: 'add', s: B[j] }); j++ }
  }
  while (i < m) out.push({ t: 'del', s: A[i++] })
  while (j < n) out.push({ t: 'add', s: B[j++] })
  return out
}

function render(original, result) {
  output.innerHTML = ''
  for (const part of diff(original, result.corrected)) {
    if (part.t === 'same') output.appendChild(document.createTextNode(part.s))
    else {
      const span = document.createElement('span')
      span.className = part.t
      span.textContent = part.s
      output.appendChild(span)
    }
  }
  notes.innerHTML = ''
  if (result.notes.length) {
    notes.classList.add('on')
    for (const note of result.notes) {
      const row = document.createElement('div')
      row.className = 'note'
      const dot = document.createElement('span')
      dot.className = 'dot ' + (note.severity === 'error' ? 'error' : 'style')
      row.appendChild(dot)
      row.appendChild(document.createTextNode(note.text))
      notes.appendChild(row)
    }
  } else notes.classList.remove('on')

  const errors = result.notes.filter((x) => x.severity === 'error').length
  $('outMeta').textContent = errors ? errors + ' правок' : result.notes.length ? 'стиль' : 'чисто'
  $('srcMeta').textContent = input.value.trim().split(/\s+/).filter(Boolean).length + ' слів'
  replaceBtn.disabled = !result.corrected
}

async function run() {
  const text = input.value
  if (!text.trim()) {
    output.innerHTML = '<span class="ph">результат з\u0027явиться тут</span>'
    notes.classList.remove('on')
    $('outMeta').textContent = ''
    replaceBtn.disabled = true
    return
  }
  const seq = ++state.seq
  $('outMeta').textContent = '…'
  const result = await window.gt.correct({ text, tone: state.tone, mode: state.mode })
  if (seq !== state.seq) return
  state.result = result
  render(text, result)
}

input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 800) })

document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.mode').forEach((x) => x.classList.remove('active'))
  b.classList.add('active')
  state.mode = b.dataset.mode
  run()
}))

document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'))
  b.classList.add('active')
  state.tone = b.dataset.tone
  run()
}))

replaceBtn.onclick = () => state.result && window.gt.replace(state.result.corrected)
$('copy').onclick = () => state.result && window.gt.copy(state.result.corrected)
$('again').onclick = run
$('close').onclick = () => window.gt.close()

$('gear').onclick = async () => {
  const panel = $('settings')
  panel.classList.toggle('on')
  if (!panel.classList.contains('on')) return
  const s = await window.gt.getSettings()
  $('provider').value = s.provider
  $('model').value = s.model
  $('apiKey').value = s.apiKey
  $('captureSelection').checked = s.captureSelection
  const info = await window.gt.checkUpdate()
  $('ver').textContent = info.current || '—'
}

for (const el of ['provider', 'model', 'apiKey', 'captureSelection']) {
  $(el).addEventListener('change', async () => {
    await window.gt.saveSettings({
      provider: $('provider').value,
      model: $('model').value,
      apiKey: $('apiKey').value,
      captureSelection: $('captureSelection').checked
    })
    run()
  })
}

$('checkUpd').onclick = async () => {
  const bar = $('updbar')
  bar.classList.add('on')
  bar.textContent = 'Перевіряю…'
  const r = await window.gt.checkUpdate()
  if (r.error) { bar.textContent = 'Не вдалось: ' + r.error; return }
  if (!r.available) { bar.textContent = 'Установлено ' + r.current + ' — це остання версія.'; return }
  bar.innerHTML = ''
  const title = document.createElement('b')
  title.textContent = 'Доступна ' + r.latest
  bar.appendChild(title)
  if (r.notes) bar.appendChild(document.createTextNode(' — ' + r.notes))
  bar.appendChild(document.createElement('br'))
  const btn = document.createElement('button')
  btn.className = 'primary'
  btn.style.marginTop = '6px'
  btn.textContent = 'Оновити зараз'
  btn.onclick = async () => {
    btn.disabled = true
    bar.textContent = 'Завантажую…'
    try {
      await window.gt.applyUpdate(r.manifest)
      bar.textContent = 'Готово, перезапускаю…'
      setTimeout(() => window.gt.relaunch(), 400)
    } catch (err) {
      bar.textContent = 'Помилка: ' + err.message
      btn.disabled = false
    }
  }
  bar.appendChild(btn)
}

window.gt.onUpdateProgress(({ done, total, file }) => {
  const bar = $('updbar')
  bar.classList.add('on')
  bar.textContent = 'Завантажую ' + done + '/' + total + ' — ' + file
})

window.gt.onSelection((text) => { input.value = text; run() })
window.gt.onFocusInput(() => setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length) }, 40))

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.gt.close()
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run()
})
`
}

function write(rel, content) {
  const p = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content, 'utf8')
  console.log('  + ' + rel)
}

console.log('\nGramTypo -> ' + ROOT + '\n')
for (const [rel, content] of Object.entries(FILES)) write(rel, content)
fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true })

console.log('\nnpm install…\n')
cp.execSync(npm + ' install --no-audit --no-fund', { cwd: ROOT, stdio: 'inherit' })

const repoFlag = process.argv.indexOf('--repo')
if (repoFlag !== -1 && process.argv[repoFlag + 1]) {
  const repo = process.argv[repoFlag + 1].replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')
  const cfgPath = path.join(ROOT, 'app.config.json')
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  cfg.repo = repo
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
  console.log('\ngit init + push у ' + repo + '…\n')
  const run = (c) => cp.execSync(c, { cwd: ROOT, stdio: 'inherit' })
  run('git init -b main')
  run('git add -A')
  run('git -c user.email=setup@gramtypo -c user.name=GramTypo commit -m "init"')
  run('git remote add origin https://github.com/' + repo + '.git')
  run('git push -u origin main')
}

if (!process.argv.includes('--no-launch')) {
  console.log('\nЗапускаю GramTypo…\n')
  cp.spawn(npm, ['start'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
}