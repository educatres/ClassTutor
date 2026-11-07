import type { AIAnswer } from '../types'
import { parseAIAnswer } from './citationValidator'

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-lite-latest'
export const GOOGLE_AI_STUDIO_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'

type RequestOptions = { apiKey: string; modelId: string; signal?: AbortSignal }
async function request(path: string, options: RequestOptions, body: unknown) {
  if (!options.apiKey.trim()) throw new Error('請先輸入 Google AI Studio API Key。')
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 45_000)
  const abortExternal = () => controller.abort()
  options.signal?.addEventListener('abort', abortExternal, { once: true })
  let response: Response
  try {
    response = await fetch(`${GOOGLE_AI_STUDIO_BASE_URL}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error('Google API 請求逾時（45 秒），請稍後重試。')
    if (error instanceof TypeError) throw new Error('無法連線到 Google API，可能是網路或瀏覽器 CORS 限制，請檢查連線後重試。')
    throw error
  } finally {
    window.clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortExternal)
  }
  const text = await response.text()
  let data: any = {}
  try { data = text ? JSON.parse(text) : {} } catch { /* sanitized below */ }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('API Key 無效或沒有模型權限，請確認 Google AI Studio 設定。')
    if (response.status === 404) throw new Error(`找不到模型「${options.modelId}」，請檢查模型 ID。`)
    if (response.status === 429) throw new Error('API 配額或速率限制已達上限，請稍後再試。')
    if (response.status >= 500) throw new Error('Google API 暫時無法服務，請稍後重試。')
    throw new Error(data?.error?.message || `API 請求失敗（HTTP ${response.status}）。`)
  }
  return data
}

export async function testGeminiConnection(options: RequestOptions) {
  const body = await request('/chat/completions', options, { model: options.modelId, messages: [{ role: 'user', content: '請只回覆 OK' }], temperature: 0 })
  const text = body.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new Error('模型已回應，但沒有可讀取的文字。')
}

export async function listGeminiModels(apiKey: string) {
  if (!apiKey.trim()) throw new Error('請先輸入 API Key。')
  let response: Response
  try { response = await fetch(`${GOOGLE_AI_STUDIO_BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } }) }
  catch (error) { if (error instanceof TypeError) throw new Error('無法讀取模型清單，可能是網路或瀏覽器 CORS 限制。'); throw error }
  if (!response.ok) throw new Error('無法讀取模型清單，請先測試 API Key。')
  const body = await response.json() as any
  return (Array.isArray(body) ? body : body.data ?? body.models ?? []).map((model: any) => String(model.id ?? model.name ?? '').replace(/^models\//, '')).filter((id: string) => /gemini/i.test(id)) as string[]
}

export async function askGemini(options: RequestOptions, systemPrompt: string, prompt: string, allowedIds: Set<string>): Promise<AIAnswer> {
  const body = await request('/chat/completions', options, { model: options.modelId, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }], temperature: 0.2 })
  const text = body.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new Error('模型已回應，但沒有可讀取的答案。')
  return parseAIAnswer(text, allowedIds)
}
