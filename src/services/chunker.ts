import type { SubtitleCue, TranscriptChunk } from '../types'

export function buildChunks(cues: SubtitleCue[], maxSeconds = 75, maxChars = 420): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = []
  let current: SubtitleCue[] = []
  const flush = () => {
    if (!current.length) return
    chunks.push({ id: `chunk_${String(chunks.length + 1).padStart(4, '0')}`, start: current[0].start, end: current[current.length - 1].end, cueIds: current.map((cue) => cue.id), text: current.map((cue) => cue.text).join(' ') })
    current = []
  }
  for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
    const nextChars = current.reduce((sum, item) => sum + item.text.length, 0) + cue.text.length
    const nextSeconds = current.length ? cue.end - current[0].start : 0
    if (current.length && (nextSeconds > maxSeconds || nextChars > maxChars)) flush()
    current.push(cue)
  }
  flush()
  return chunks
}
