const fs = require('node:fs')
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
