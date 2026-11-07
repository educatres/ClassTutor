import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import type { ChatMessage, TranscriptDocument, TutorMode } from './types'
import { buildChunks } from './services/chunker'
import { makeCitationCards } from './services/citationValidator'
import { askGemini, DEFAULT_GEMINI_MODEL, listGeminiModels, testGeminiConnection } from './services/geminiClient'
import { buildAnswerPrompt, ANSWER_SYSTEM_PROMPT } from './services/promptBuilder'
import { getEligibleCues, retrieveSources } from './services/retrieval'
import { readCoursePackage } from './services/coursePackage'
import { createYouTubePlayer, type YouTubePlayer, youtubeUrl } from './services/youtube'

const fmt = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  const s = String(total % 60).padStart(2, '0')
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`
}

function statusLabel(key: string, videoId: string | null, transcript: TranscriptDocument | null, playerReady: boolean, asking: boolean) {
  if (asking) return 'ASKING'
  if (!key.trim()) return 'NO_KEY'
  if (!videoId || !playerReady) return 'NO_VIDEO'
  if (!transcript) return 'NO_TRANSCRIPT'
  return 'READY'
}

export default function App() {
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [modelId, setModelId] = useState(DEFAULT_GEMINI_MODEL)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [connection, setConnection] = useState<{ kind: 'idle' | 'working' | 'ok' | 'error'; message: string }>({ kind: 'idle', message: '' })
  const [videoId, setVideoId] = useState<string | null>(null)
  const [videoError, setVideoError] = useState('')
  const [playerReady, setPlayerReady] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [transcript, setTranscript] = useState<TranscriptDocument | null>(null)
  const [mode, setMode] = useState<TutorMode>('progress')
  const [question, setQuestion] = useState('')
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [asking, setAsking] = useState(false)
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState(false)
  const playerHost = useRef<HTMLDivElement>(null)
  const player = useRef<YouTubePlayer | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const chunks = useMemo(() => transcript ? buildChunks(transcript.cues) : [], [transcript])
  const appStatus = statusLabel(apiKey, videoId, transcript, playerReady, asking)

  useEffect(() => {
    if (!videoId || !playerHost.current) return
    let disposed = false
    const host = playerHost.current
    host.replaceChildren()
    const mount = document.createElement('div')
    host.appendChild(mount)
    createYouTubePlayer(mount, videoId, {
      onReady: (instance) => { if (!disposed) { player.current = instance; setPlayerReady(true); setDuration((instance as YouTubePlayer & { getDuration?: () => number }).getDuration?.() ?? 0) } },
      onStateChange: () => { if (!disposed) setCurrentTime(player.current?.getCurrentTime() ?? 0) },
      onError: (code) => { if (!disposed) setVideoError(`YouTube 播放器錯誤（${code}）。影片可能不允許嵌入，請改用外部開啟。`) },
    }).catch((error: unknown) => { if (!disposed) setVideoError(error instanceof Error ? error.message : 'YouTube 播放器載入失敗。') })
    const timer = window.setInterval(() => {
      if (disposed || !player.current) return
      const time = player.current.getCurrentTime()
      if (Number.isFinite(time)) setCurrentTime(time)
    }, 500)
    return () => { disposed = true; window.clearInterval(timer); player.current?.destroy?.(); player.current = null; setPlayerReady(false) }
  }, [videoId])

  const jumpTo = useCallback((seconds: number) => {
    if (!playerReady || !player.current) { setNotice('播放器尚未準備完成，暫時無法跳轉。'); return }
    player.current.seekTo(seconds, true); setCurrentTime(seconds)
  }, [playerReady])

  const importCoursePackage = async (file?: File) => {
    if (!file) return
    if ((videoId || transcript || chat.length) && !window.confirm('匯入新課程包會清除目前影片與對話，是否繼續？')) return
    try {
      const course = await readCoursePackage(file)
      setVideoError(''); setVideoId(course.videoId); setTranscript(course.transcript); setChat([]); setPlayerReady(false); setCurrentTime(0); setDuration(0); setNotice(`已載入課程包：${course.transcript.fileName} · ${course.transcript.cueCount} 段字幕。`)
    } catch (error: unknown) { setNotice(error instanceof Error ? error.message : '課程包匯入失敗。') }
  }

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => { void importCoursePackage(event.target.files?.[0]); event.target.value = '' }
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); void importCoursePackage(event.dataTransfer.files?.[0]) }

  const testConnection = async () => {
    setConnection({ kind: 'working', message: '正在測試模型連線…' })
    try { await testGeminiConnection({ apiKey, modelId }); setConnection({ kind: 'ok', message: `連線成功：${modelId}` }) }
    catch (error: unknown) { setConnection({ kind: 'error', message: error instanceof Error ? error.message : '連線測試失敗。' }) }
  }

  const loadModels = async () => {
    try { const models = await listGeminiModels(apiKey); setModelOptions(models); setNotice(models.length ? `已讀取 ${models.length} 個 Gemini 模型。` : '模型清單為空，仍可手動輸入模型 ID。') }
    catch (error: unknown) { setNotice(error instanceof Error ? error.message : '無法讀取模型清單。') }
  }

  const submitQuestion = async () => {
    const text = question.trim()
    if (!text || asking) return
    if (!apiKey.trim()) { setNotice('請先輸入 API Key 並測試連線。'); return }
    if (!videoId || !playerReady || !player.current) { setNotice('請先載入影片並等待播放器準備完成。'); return }
    if (!transcript) { setNotice('請先匯入 VTT 或 SRT 字幕。'); return }
    const cutoff = player.current.getCurrentTime()
    if (!Number.isFinite(cutoff)) { setNotice('無法取得目前播放時間，請稍後再試。'); return }
    const eligible = getEligibleCues(transcript.cues, mode, cutoff)
    const sources = retrieveSources(text, eligible, chunks)
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', text, createdAt: Date.now(), mode, cutoffSeconds: cutoff, status: 'done' }
    setChat((items) => [...items, userMessage]); setQuestion(''); setAsking(true); setNotice('')
    const assistantId = crypto.randomUUID()
    const controller = new AbortController(); abortRef.current = controller
    try {
      if (!sources.length) throw new Error(mode === 'progress' ? '目前播放進度以前尚無足夠的字幕證據。請繼續觀看或切換全課複習。' : '目前字幕沒有可供檢索的內容。')
      const answer = await askGemini({ apiKey, modelId, signal: controller.signal }, ANSWER_SYSTEM_PROMPT, buildAnswerPrompt({ mode, cutoffSeconds: cutoff, question: text, sources }), new Set(sources.map((source) => source.id)))
      const citations = makeCitationCards(answer, sources, mode, cutoff)
      const assistant: ChatMessage = { id: assistantId, role: 'assistant', text: answer.answer, createdAt: Date.now(), mode, cutoffSeconds: cutoff, citations, status: 'done' }
      setChat((items) => [...items, assistant])
    } catch (error: unknown) {
      if ((error as Error)?.name === 'AbortError') setNotice('已取消這次提問。')
      else { const message = error instanceof Error ? error.message : 'AI 問答失敗。'; setNotice(message); setChat((items) => [...items, { id: assistantId, role: 'assistant', text: message, createdAt: Date.now(), mode, cutoffSeconds: cutoff, status: 'error' }]) }
    } finally { abortRef.current = null; setAsking(false) }
  }

  return <div className="app-shell">
    <header className="topbar"><div><p className="eyebrow">VIDEO AI TUTOR</p><h1>課堂影片時間感知 AI 助教</h1></div><span className={`status-pill ${appStatus.toLowerCase()}`}>{appStatus}</span></header>
    <main className="layout">
      <section className="left-column">
        <article className="card setup-card course-package-card">
          <div className="section-heading"><div><h2>上傳課程包</h2><p>請向老師取得 `.vait` 課程包；影片網址與字幕會自動載入，不需要在學生端貼上 YouTube 網址。</p></div></div>
          <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => fileInput.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click() }}><strong>拖放課程包到這裡</strong><span>或點擊選擇 `.vait` 檔案</span><input ref={fileInput} type="file" accept=".vait,application/octet-stream" onChange={onFileChange} /></div>
          {transcript && <p className="package-loaded" role="status">已載入：{transcript.fileName} · {transcript.cueCount} 段字幕{videoId ? ' · YouTube 影片已就緒' : ''}</p>}
          {videoError && <p className="error-text" role="alert">{videoError} {videoId && <a href={youtubeUrl(videoId)} target="_blank" rel="noreferrer">在 YouTube 開啟</a>}</p>}
        </article>
        <article className="card video-card"><div className="player-wrap">{videoId ? <div ref={playerHost} className="youtube-host" /> : <div className="empty-player"><span>▶</span><p>匯入課程包後，影片會顯示在這裡</p></div>}</div><div className="time-row"><strong>{fmt(currentTime)}</strong><span>/ {fmt(duration)}</span><span className="time-hint">字幕時間直接對應影片時間</span></div></article>
      </section>
      <aside className="right-column">
        <article className="card key-card"><div className="section-heading"><div><h2>模型設定</h2><p>BYOK：金鑰只保存在本次頁面記憶體，重新整理後需重新輸入。</p></div></div><label htmlFor="api-key">Google AI Studio API Key</label><div className="key-input"><input id="api-key" type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e) => { setApiKey(e.target.value); setConnection({ kind: 'idle', message: '' }) }} placeholder="貼上你的 API Key" autoComplete="off" /><button className="icon-button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? '隱藏金鑰' : '顯示金鑰'}>{showKey ? '隱藏' : '顯示'}</button></div><div className="model-row"><label htmlFor="model-id">模型 ID</label><input id="model-id" value={modelId} onChange={(e) => setModelId(e.target.value)} list="model-options" /><datalist id="model-options">{modelOptions.map((model) => <option value={model} key={model} />)}</datalist></div><div className="button-row"><button onClick={testConnection} disabled={connection.kind === 'working' || !apiKey.trim()}>{connection.kind === 'working' ? '測試中…' : '測試連線'}</button><button className="secondary-button" onClick={loadModels} disabled={!apiKey.trim()}>讀取模型</button></div>{connection.message && <p className={connection.kind === 'error' ? 'error-text' : 'success-text'} role="status">{connection.message}</p>}<p className="privacy-note">請勿將含敏感資訊的字幕直接送往第三方服務；此為瀏覽器直連 API 的原型。</p></article>
        <article className="card chat-card"><div className="chat-header"><div><h2>AI 課堂助教</h2><p>每次提問都會鎖定送出當下的播放時間。</p></div><div className="mode-switch" role="group" aria-label="問答模式"><button className={mode === 'progress' ? 'selected' : ''} onClick={() => setMode('progress')}>跟著進度學習</button><button className={mode === 'review' ? 'selected' : ''} onClick={() => setMode('review')}>全課複習</button></div></div><div className="mode-note">{mode === 'progress' ? '只使用已完整播出的字幕（cue.end ≤ 目前時間）' : '使用整份已匯入字幕，適合課後複習'}</div><div className="messages" aria-live="polite">{chat.length === 0 && <div className="chat-empty"><span>✦</span><p>播放影片、匯入字幕後，問我課堂中已經講過的內容。</p></div>}{chat.map((message) => <div className={`message ${message.role} ${message.status === 'error' ? 'message-error' : ''}`} key={message.id}><div className="message-meta">{message.role === 'user' ? '你' : 'AI 助教'} · {message.mode === 'progress' ? '跟著進度' : '全課複習'} · {fmt(message.cutoffSeconds)}</div><p>{message.text}</p>{message.citations && message.citations.length > 0 && <div className="citations">{message.citations.map((citation) => <div className="citation" key={citation.chunkId}><button onClick={() => jumpTo(citation.start)}>▶ {fmt(citation.start)}</button><span>{citation.excerpt}</span><a href={videoId ? youtubeUrl(videoId, citation.start) : '#'} target="_blank" rel="noreferrer">YouTube ↗</a></div>)}</div>}{message.role === 'assistant' && message.status === 'done' && (!message.citations || message.citations.length === 0) && <p className="unverified">回答沒有可驗證的字幕來源。</p>}</div>)}</div><div className="ask-form"><textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={appStatus === 'READY' ? '例如：老師如何解釋這個概念？' : '完成左側設定後即可提問'} disabled={asking} rows={3} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submitQuestion() } }} /><button onClick={() => void submitQuestion()} disabled={asking || !question.trim()}>{asking ? '回答中…' : '送出'}</button></div>{asking && <button className="cancel-button" onClick={() => abortRef.current?.abort()}>取消這次提問</button>}{notice && <p className="notice" role="status">{notice}</p>}</article>
      </aside>
    </main>
    <footer><span>Video AI Tutor · 靜態 GitHub Pages 原型</span><span><a href="./teacher.html">老師課程包工具</a> · 不提供字幕時間校正或偏移功能</span></footer>
  </div>
}
