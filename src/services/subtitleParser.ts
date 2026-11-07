import type { SubtitleCue, TranscriptDocument } from '../types'

const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})$/
function parseTime(value: string) {
  const match = value.trim().match(TIME)
  if (!match) return null
  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const millis = Number(match[4])
  if (minutes >= 60 || seconds >= 60) return null
  return hours * 3600 + minutes * 60 + seconds + millis / 1000
}

function decodeText(value: string) {
  const decoded = value
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/gi, (entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }[entity.slice(1, -1).toLowerCase()] ?? entity))
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, value: string) => {
      const number = value.toLowerCase().startsWith('x') ? Number.parseInt(value.slice(1), 16) : Number.parseInt(value, 10)
      return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : _
    })
  return decoded
    .replace(/<v(?:\s+[^>]*)?>([\s\S]*?)<\/v>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function makeCue(start: number | null, end: number | null, lines: string[], index: number): SubtitleCue | null {
  const text = decodeText(lines.join(' '))
  if (start === null || end === null || start < 0 || end <= start || !text) return null
  const speaker = lines.join(' ').match(/<v\s+([^>]+)>/i)?.[1]?.trim()
  return { id: `cue_${String(index).padStart(6, '0')}`, start, end, text, ...(speaker ? { speaker } : {}) }
}

function finalizeCues(cues: SubtitleCue[]) {
  return cues.sort((a, b) => a.start - b.start || a.end - b.end).map((cue, index) => ({ ...cue, id: `cue_${String(index + 1).padStart(6, '0')}` }))
}

export function parseVtt(source: string): SubtitleCue[] {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const cues: SubtitleCue[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line || line === 'WEBVTT' || /^(NOTE|STYLE|REGION)(\s|$)/i.test(line)) {
      if (/^(NOTE|STYLE|REGION)(\s|$)/i.test(line)) while (++i < lines.length && lines[i].trim()) { /* skip block */ }
      i += 1; continue
    }
    const timing = line.includes('-->') ? line : lines[i + 1]?.includes('-->') ? lines[++i].trim() : ''
    if (!timing) { i += 1; continue }
    const [left, right] = timing.split('-->').map((part) => part.trim().split(/\s+/)[0])
    const start = parseTime(left); const end = parseTime(right)
    const text: string[] = []
    while (++i < lines.length && lines[i].trim()) text.push(lines[i])
    const cue = makeCue(start, end, text, cues.length + 1)
    if (cue) cues.push(cue)
    i += 1
  }
  return finalizeCues(cues)
}

export function parseSrt(source: string): SubtitleCue[] {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const cues: SubtitleCue[] = []
  let i = 0
  while (i < lines.length) {
    if (!lines[i].includes('-->')) { i += 1; continue }
    const timing = lines[i].split('-->').map((part) => part.trim().split(/\s+/)[0])
    const text: string[] = []
    i += 1
    while (i < lines.length && lines[i].trim() && !lines[i].includes('-->')) { text.push(lines[i]); i += 1 }
    const cue = makeCue(parseTime(timing[0]), parseTime(timing[1]), text, cues.length + 1)
    if (cue) cues.push(cue)
    while (i < lines.length && !lines[i].trim()) i += 1
  }
  return finalizeCues(cues)
}

export async function parseSubtitleFile(file: File): Promise<TranscriptDocument> {
  if (file.size > 10 * 1024 * 1024) throw new Error('字幕檔超過 10 MiB 上限，請先縮小檔案。')
  const source = await file.text()
  const extension = file.name.toLowerCase().endsWith('.srt') ? 'srt' : file.name.toLowerCase().endsWith('.vtt') ? 'vtt' : null
  const firstLine = source.replace(/^\uFEFF/, '').trimStart().split(/\r?\n/, 1)[0]?.trim().toUpperCase()
  const format = extension ?? (firstLine === 'WEBVTT' ? 'vtt' : null)
  if (!format) throw new Error('只支援 .vtt 或 .srt 字幕檔。')
  const cues = format === 'vtt' ? parseVtt(source) : parseSrt(source)
  if (!cues.length) throw new Error('找不到有效字幕段落，請確認時間格式與檔案內容。')
  return { fileName: file.name, format, cues, cueCount: cues.length, earliestStart: cues[0].start, latestEnd: Math.max(...cues.map((cue) => cue.end)) }
}
