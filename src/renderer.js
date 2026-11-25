const $ = (id) => document.getElementById(id)
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
