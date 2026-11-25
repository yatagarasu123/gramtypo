const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, screen, Tray, Menu, nativeImage } = require('electron')
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
