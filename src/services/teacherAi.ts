import type { AIProvider } from './geminiClient'

export type TeacherAiOptions = { apiKey: string; modelId: string; provider: AIProvider; signal?: AbortSignal }
const BASE_URL: Record<AIProvider, string> = { google: 'https://generativelanguage.googleapis.com/v1beta/openai', cgu: 'https://air.cgu.edu.tw/cgullmapi/v1' }

export async function generateTeacherText(options: TeacherAiOptions, prompt: string, system = '') {
  if (!options.apiKey.trim()) throw new Error('請先在「AI 設定」輸入 API Key。')
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 120_000)
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetch(BASE_URL[options.provider] + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + options.apiKey.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: options.modelId, messages: (system ? [{ role: 'system', content: system }] : []).concat([{ role: 'user', content: prompt }]), temperature: 0.15 }),
      signal: controller.signal,
    })
    const text = await response.text()
    let body: any = {}
    try { body = text ? JSON.parse(text) : {} } catch { /* handled below */ }
    if (!response.ok) throw new Error('AI 請求失敗（HTTP ' + response.status + '）: ' + (body?.error?.message || body?.message || text.slice(0, 300) || '請檢查 API Key、模型與網路。'))
    const output = body?.choices?.[0]?.message?.content
    if (typeof output !== 'string' || !output.trim()) throw new Error('AI 回應沒有可讀取的文字。')
    return output.trim()
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error('AI 請求逾時，請稍後重試。')
    if (error instanceof TypeError) throw new Error('無法連線到 AI 服務，請檢查網路或瀏覽器 CORS 設定。')
    throw error
  } finally {
    window.clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}

export function transcriptPrompt(cues: Array<{ start: number; end: number; text: string }>, max = 28_000) {
  return cues.map((cue, index) => String(index) + '|' + cue.start.toFixed(3) + '-' + cue.end.toFixed(3) + '|' + cue.text).join('\n').slice(0, max)
}

export function createTeacherSummaryPrompt(cues: Array<{ start: number; end: number; text: string }>, references: string, kind: 'class' | 'lesson' | 'handout') {
  const template = kind === 'handout' ? '教材重點整理（含關鍵名詞、概念、例子與易錯處）' : kind === 'lesson' ? '教學講義（課程目標、教學流程、重點與課後提醒）' : '課程摘要（主題、學習目標、核心概念、例子、作業或待釐清問題）'
  return '你是教師備課助理。請只根據「字幕」與「教材」整理' + template + '，使用繁體中文。不可補造字幕或教材沒有出現的人名、日期、數字、作業與結論；沒有資料請寫「未提供」。輸出純文字，不要 Markdown 程式碼框、分析過程或原始字幕全文。\n\n【字幕】\n' + transcriptPrompt(cues) + '\n\n【教材】\n' + (references.slice(0, 16_000) || '未提供')
}

export function createSubtitlePolishPrompt(cues: Array<{ start: number; end: number; text: string }>, glossary: string, references: string) {
  return '請校正以下課程字幕，只修正明顯錯字、誤聽、口語贅詞、重複與不自然斷句。可參考教材與確認詞彙，但不得新增字幕或教材沒有提到的事實、人名、數字、時間與結論。保留每一段的 index、start、end 與順序。只輸出 JSON 陣列，格式：[{"index":0,"text":"修正後文字"}]；每一段都要輸出，若不需修改則保留原文。\n\n【確認詞彙】\n' + (glossary || '未提供') + '\n\n【教材】\n' + (references.slice(0, 12_000) || '未提供') + '\n\n【字幕】\n' + transcriptPrompt(cues, 28_000)
}

export function parsePolishedCues(value: string, cues: Array<{ start: number; end: number; text: string }>) {
  const match = value.match(/\[[\s\S]*\]/)
  if (!match) return cues
  try {
    const rows = JSON.parse(match[0]) as unknown
    if (!Array.isArray(rows)) return cues
    const byIndex = new Map<number, string>()
    rows.forEach((row) => {
      if (!row || typeof row !== 'object') return
      const item = row as Record<string, unknown>
      const index = Number(item.index)
      const text = String(item.text ?? '').replace(/\s+/g, ' ').trim()
      if (Number.isInteger(index) && text) byIndex.set(index, text)
    })
    return cues.map((cue, index) => ({ ...cue, text: byIndex.get(index) ?? cue.text }))
  } catch { return cues }
}

export function localSummary(cues: Array<{ text: string }>, references: string) {
  const text = cues.map((cue) => cue.text).join(' ').replace(/\s+/g, ' ').trim()
  const sentences = text.split(/(?<=[。！？.!?])\s*/).filter(Boolean)
  const highlights = sentences.slice(0, 8)
  return '課程摘要\n\n重點\n' + (highlights.length ? highlights.map((item) => '• ' + item).join('\n') : '• 尚未有可整理的字幕內容。') + '\n\n教材／講義\n' + (references.trim() ? '已匯入教材，請搭配上方重點核對名詞與例子。' : '未提供教材或講義。') + '\n\n備註\n這是未連接 AI 時的本機快速摘要；連接 AI 後可產生更完整的教學版本。'
}

export function localPolish(cues: Array<{ start: number; end: number; text: string }>, glossary: Array<{ original: string; suggested: string }>) {
  return cues.map((cue) => {
    let text = cue.text.replace(/\s+/g, ' ').replace(/(嗯|呃|那個|就是)，?/g, '').trim()
    glossary.forEach((term) => { if (term.original && term.suggested) text = text.split(term.original).join(term.suggested) })
    return { ...cue, text }
  })
}
