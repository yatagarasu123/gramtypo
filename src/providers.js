const store = require('./store')

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
