export type TutorMode = 'progress' | 'review'

export type SubtitleCue = {
  id: string
  start: number
  end: number
  text: string
  speaker?: string
}

export type TranscriptDocument = {
  fileName: string
  format: 'vtt' | 'srt'
  cues: SubtitleCue[]
  cueCount: number
  earliestStart: number
  latestEnd: number
}

export type TranscriptChunk = {
  id: string
  start: number
  end: number
  cueIds: string[]
  text: string
}

export type Citation = { chunkId: string; start: number; end: number; excerpt: string }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  mode: TutorMode
  cutoffSeconds: number
  citations?: Citation[]
  status?: 'pending' | 'done' | 'error'
}

export type AIAnswer = { status: 'answered' | 'insufficient_evidence'; answer: string; citedChunkIds: string[] }
