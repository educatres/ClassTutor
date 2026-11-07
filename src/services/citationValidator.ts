import type { AIAnswer, Citation, TranscriptChunk, TutorMode } from '../types'

export function parseAIAnswer(raw: string, allowed: Set<string>): AIAnswer {
  let value: unknown
  try { value = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '').trim()) } catch { throw new Error('AI 回覆不是有效 JSON，請按重試。') }
  if (!value || typeof value !== 'object') throw new Error('AI 回覆格式無法驗證，請按重試。')
  const item = value as Record<string, unknown>
  const status = item.status === 'answered' || item.status === 'insufficient_evidence' ? item.status : null
  if (!status || typeof item.answer !== 'string' || !Array.isArray(item.citedChunkIds)) throw new Error('AI 回覆缺少必要欄位，請按重試。')
  return { status, answer: item.answer, citedChunkIds: item.citedChunkIds.filter((id): id is string => typeof id === 'string' && allowed.has(id)).slice(0, 5) }
}

export function makeCitationCards(answer: AIAnswer, sources: TranscriptChunk[], mode: TutorMode, cutoffSeconds: number): Citation[] {
  const byId = new Map(sources.map((source) => [source.id, source]))
  return [...new Set(answer.citedChunkIds)].map((id) => byId.get(id)).filter((source): source is TranscriptChunk => Boolean(source)).filter((source) => mode === 'review' || source.end <= cutoffSeconds).sort((a, b) => a.start - b.start).slice(0, 5).map((source) => ({ chunkId: source.id, start: source.start, end: source.end, excerpt: source.text.slice(0, 180) }))
}
