const fs = require('node:fs')
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
