import type { SubtitleCue, TranscriptDocument } from '../types'
import { parseSubtitleFile } from './subtitleParser'
import { parseYouTubeVideoId, youtubeUrl } from './youtube'

const PACKAGE_PREFIX = 'VAIT1'
// This is intentionally a lightweight obfuscation layer, not a secret. The
// course package is meant to prevent casual editing of the URL/transcript;
// never put confidential teaching material in a public package.
const PACKAGE_SECRET = 'video-ai-tutor-course-package-v1'

type CoursePackagePayload = {
  version: 1
  createdAt: string
  videoId: string
  videoUrl: string
  transcript: TranscriptDocument
  courseIntro?: string
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function packageKey() {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PACKAGE_SECRET))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function createCoursePackage(videoUrlInput: string, subtitleFile: File, courseIntro = '') {
  const videoId = parseYouTubeVideoId(videoUrlInput)
  if (!videoId) throw new Error('請輸入合法的 YouTube 網址。')
  const transcript = await parseSubtitleFile(subtitleFile)
  const payload: CoursePackagePayload = { version: 1, createdAt: new Date().toISOString(), videoId, videoUrl: youtubeUrl(videoId), transcript, courseIntro: courseIntro.trim() }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await packageKey(), new TextEncoder().encode(JSON.stringify(payload)))
  const packageText = `${PACKAGE_PREFIX}.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`
  return { fileName: `classtutor-${videoId}.classtutor`, content: packageText, payload }
}

function isTranscript(value: unknown): value is TranscriptDocument {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<TranscriptDocument>
  return (item.format === 'vtt' || item.format === 'srt' || item.format === 'sbv') && typeof item.fileName === 'string' && Array.isArray(item.cues) && item.cues.length > 0
    && item.cues.every((cue: unknown) => {
      if (!cue || typeof cue !== 'object') return false
      const item = cue as Partial<SubtitleCue>
      return typeof item.id === 'string' && typeof item.start === 'number' && typeof item.end === 'number' && item.end > item.start && typeof item.text === 'string'
    })
}

export async function readCoursePackage(file: File) {
  if (file.size > 12 * 1024 * 1024) throw new Error('課程包超過 12 MiB 上限。')
  const raw = (await file.text()).trim().split('.')
  if (raw.length !== 3 || raw[0] !== PACKAGE_PREFIX) throw new Error('不是有效的 ClassTutor 課程包。')
  let decoded: CoursePackagePayload
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(raw[1]) }, await packageKey(), base64ToBytes(raw[2]))
    decoded = JSON.parse(new TextDecoder().decode(plain)) as CoursePackagePayload
  } catch { throw new Error('課程包解密失敗，檔案可能損壞或不是本系統產生。') }
  if (decoded.version !== 1 || (decoded.courseIntro !== undefined && typeof decoded.courseIntro !== 'string') || !parseYouTubeVideoId(decoded.videoUrl) || decoded.videoId !== parseYouTubeVideoId(decoded.videoUrl) || !isTranscript(decoded.transcript)) throw new Error('課程包內容不完整或格式不受支援。')
  return decoded
}

export function downloadCoursePackage(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
