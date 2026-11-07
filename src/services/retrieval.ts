import type { SubtitleCue, TranscriptChunk, TutorMode } from '../types'

const normalize = (value: string) => value.toLocaleLowerCase('zh-Hant').normalize('NFKC').replace(/\s+/g, '')
function tokens(value: string) {
  const normalized = normalize(value)
  const words = normalized.match(/[a-z0-9+#.-]+|[\u3400-\u9fff]/gi) ?? []
  const compact = normalized.replace(/[^\u3400-\u9fff]/g, '')
  const bigrams = Array.from({ length: Math.max(0, compact.length - 1) }, (_, i) => compact.slice(i, i + 2))
  return [...new Set([...words, ...bigrams])]
}

export function getEligibleCues(cues: SubtitleCue[], mode: TutorMode, cutoffSeconds: number) {
  return mode === 'review' ? cues : cues.filter((cue) => cue.end <= cutoffSeconds)
}

export function retrieveSources(question: string, eligibleCues: SubtitleCue[], allChunks: TranscriptChunk[], topK = 5): TranscriptChunk[] {
  if (!eligibleCues.length) return []
  const allowed = new Set(eligibleCues.map((cue) => cue.id))
  const query = tokens(question)
  const scored = allChunks.map((chunk) => {
    const cues = chunk.cueIds.filter((id) => allowed.has(id))
    if (!cues.length) return { chunk, score: 0, cueIds: [] }
    const text = chunk.text
    const matching = query.reduce((sum, token) => sum + (normalize(text).includes(token) ? 1 : 0), 0)
    const score = matching / Math.max(query.length, 1) + (matching ? Math.min(cues.length / 10, 0.2) : 0)
    return { chunk, score, cueIds: cues }
  }).filter((item) => item.score > 0)
  const selected = scored.sort((a, b) => b.score - a.score).slice(0, topK)
  const byId = new Map(eligibleCues.map((cue) => [cue.id, cue]))
  return selected.map(({ chunk, cueIds }) => {
    const included = cueIds.map((id) => byId.get(id)).filter((cue): cue is SubtitleCue => Boolean(cue))
    return {
      ...chunk,
      cueIds,
      start: included[0]?.start ?? chunk.start,
      end: included[included.length - 1]?.end ?? chunk.end,
      text: included.map((cue) => cue.text).join(' ').slice(0, 700),
    }
  })
}

export function chunksFromCues(cues: SubtitleCue[], chunks: TranscriptChunk[]) {
  const byId = new Map(cues.map((cue) => [cue.id, cue]))
  return chunks.map((chunk) => {
    const included = chunk.cueIds.map((id) => byId.get(id)).filter((cue): cue is SubtitleCue => Boolean(cue))
    return included.length ? { ...chunk, start: included[0].start, end: included[included.length - 1].end, text: included.map((cue) => cue.text).join(' ') } : chunk
  })
}
