import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { ChatMessage, Citation, TranscriptDocument, TutorMode } from './types'
import { buildChunks } from './services/chunker'
import { makeCitationCards } from './services/citationValidator'
import { askProvider, CGU_DEFAULT_MODEL, DEFAULT_GEMINI_MODEL, listProviderModels, testProviderConnection, type AIProvider } from './services/geminiClient'
import { buildAnswerPrompt, ANSWER_SYSTEM_PROMPT } from './services/promptBuilder'
import { getEligibleCues, retrieveSources } from './services/retrieval'
import { readCoursePackage } from './services/coursePackage'
import { createYouTubePlayer, type YouTubePlayer, youtubeUrl } from './services/youtube'

const API_KEY_STORAGE = 'video-ai-tutor.api-keys.v1'
const API_KEY_TTL_MS = 24 * 60 * 60 * 1000
const QUICK_PROMPTS = ['幫我整理這一段', '給我一個例子', '這段有哪些重點？', '前一步在做什麼？']
type ColumnRatio = '3:1' | '1:1' | '1:2' | '1:3'
const COLUMN_RATIO_COLUMNS: Record<ColumnRatio, string> = { '3:1': '3fr 1fr', '1:1': '1fr 1fr', '1:2': '1fr 2fr', '1:3': '1fr 3fr' }

type StoredApiKeys = Partial<Record<AIProvider, { apiKey: string; expiresAt: number }>>
function readStoredApiKey(provider: AIProvider) {
  try {
    const raw = localStorage.getItem(API_KEY_STORAGE)
    const saved = raw ? JSON.parse(raw) as StoredApiKeys : {}
    const item = saved[provider]
    if (!item || item.expiresAt <= Date.now()) {
      if (item) { delete saved[provider]; localStorage.setItem(API_KEY_STORAGE, JSON.stringify(saved)) }
      return ''
    }
    return item.apiKey
  } catch { return '' }
}

function saveApiKey(provider: AIProvider, apiKey: string) {
  try {
    const raw = localStorage.getItem(API_KEY_STORAGE)
    const saved = raw ? JSON.parse(raw) as StoredApiKeys : {}
    if (apiKey.trim()) saved[provider] = { apiKey, expiresAt: Date.now() + API_KEY_TTL_MS }
    else delete saved[provider]
    localStorage.setItem(API_KEY_STORAGE, JSON.stringify(saved))
  } catch { /* private browsing or blocked storage: keep the key in memory only */ }
}

function clearStoredApiKey(provider: AIProvider) {
  try {
    const raw = localStorage.getItem(API_KEY_STORAGE)
    const saved = raw ? JSON.parse(raw) as StoredApiKeys : {}
    delete saved[provider]
    localStorage.setItem(API_KEY_STORAGE, JSON.stringify(saved))
  } catch { /* ignore blocked storage */ }
}

function normalizeCitationId(value: string) {
  const match = value.replace(/^\[|\]$/g, '').match(/^chunk_?(\d{4})$/i)
  return match ? `chunk_${match[1]}` : value
}

function renderInlineMarkdown(value: string, citations?: Map<string, Citation>, onCitation?: (start: number) => void): ReactNode[] {
  const pattern = /(\[?chunk_?\d{4}\]?|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_([^_]+)_|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/gi
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) nodes.push(value.slice(last, index))
    const token = match[0]
    const citation = citations?.get(normalizeCitationId(token))
    if (citation && onCitation) nodes.push(<Fragment key={`${index}-citation`}><a href="#video-player" onClick={(event) => { event.preventDefault(); onCitation(citation.start) }}>{fmt(citation.start)}</a>{' '}</Fragment>)
    else if (token.startsWith('`')) nodes.push(<code key={`${index}-code`}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('**') || token.startsWith('__')) nodes.push(<strong key={`${index}-strong`}>{renderInlineMarkdown(token.slice(2, -2), citations, onCitation)}</strong>)
    else if (token.startsWith('*') || token.startsWith('_')) nodes.push(<em key={`${index}-em`}>{renderInlineMarkdown(token.slice(1, -1), citations, onCitation)}</em>)
    else if (token.startsWith('[')) nodes.push(<a key={`${index}-link`} href={match[4]} target="_blank" rel="noreferrer">{match[3]}</a>)
    last = index + token.length
  }
  if (last < value.length) nodes.push(value.slice(last))
  return nodes
}

function renderMarkdown(value: string, citations?: Map<string, Citation>, onCitation?: (start: number) => void): ReactNode {
  if (citations?.size && onCitation) {
    if (![...citations.keys()].some((id) => value.match(new RegExp(`\\[?${id.replace('_', '_?')}\\]?`, 'i')))) value = `${value.trimEnd()} ${[...citations.keys()].join('、')}`
    value = value.replace(/(\[?chunk_?\d{4}\]?)[\s,，、]+(?=\[?chunk_?\d{4}\]?)/gi, '$1、')
  }
  const lines = value.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let ordered = false
  let codeLines: string[] = []
  let inCode = false
  const flushParagraph = () => { if (paragraph.length) { blocks.push(<p key={`p-${blocks.length}`}>{renderInlineMarkdown(paragraph.join(' '), citations, onCitation)}</p>); paragraph = [] } }
  const flushList = () => { if (list.length) { const items = list; blocks.push(ordered ? <ol key={`ol-${blocks.length}`}>{items.map((item, index) => <li key={index}>{renderInlineMarkdown(item, citations, onCitation)}</li>)}</ol> : <ul key={`ul-${blocks.length}`}>{items.map((item, index) => <li key={index}>{renderInlineMarkdown(item, citations, onCitation)}</li>)}</ul>); list = [] } }
  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) { if (inCode) { blocks.push(<pre key={`code-${index}`}><code>{codeLines.join('\n')}</code></pre>); codeLines = []; inCode = false } else { flushParagraph(); flushList(); codeLines = []; inCode = true } return }
    if (inCode) { codeLines.push(line); return }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/)
    const number = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (heading) { flushParagraph(); flushList(); const level = heading[1].length; const Tag = (`h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'); blocks.push(<Tag key={`h-${index}`}>{renderInlineMarkdown(heading[2], citations, onCitation)}</Tag>); return }
    if (bullet || number) { flushParagraph(); if (list.length && ordered !== Boolean(number)) flushList(); ordered = Boolean(number); list.push((bullet ?? number)![1]); return }
    if (!line.trim()) { flushParagraph(); flushList(); return }
    flushList(); paragraph.push(line.trim())
  })
  if (inCode) blocks.push(<pre key="code-final"><code>{codeLines.join('\n')}</code></pre>)
  flushParagraph(); flushList()
  return <>{blocks}</>
}

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
  const [provider, setProvider] = useState<AIProvider>('google')
  const [apiKey, setApiKey] = useState(() => readStoredApiKey('google'))
  const [showKey, setShowKey] = useState(false)
  const [modelId, setModelId] = useState(DEFAULT_GEMINI_MODEL)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [connection, setConnection] = useState<{ kind: 'idle' | 'working' | 'ok' | 'error'; message: string }>({ kind: 'idle', message: '' })
  const [videoId, setVideoId] = useState<string | null>(null)
  const [videoError, setVideoError] = useState('')
  const [playerReady, setPlayerReady] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [transcript, setTranscript] = useState<TranscriptDocument | null>(null)
  const [mode, setMode] = useState<TutorMode>('progress')
  const [question, setQuestion] = useState('')
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [asking, setAsking] = useState(false)
  const [notice, setNotice] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toolbarHidden, setToolbarHidden] = useState(false)
  const [showSubtitles, setShowSubtitles] = useState(false)
  const [columnRatio, setColumnRatio] = useState<ColumnRatio>('3:1')
  const playerHost = useRef<HTMLDivElement>(null)
  const player = useRef<YouTubePlayer | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const chunks = useMemo(() => transcript ? buildChunks(transcript.cues) : [], [transcript])
  const currentSubtitle = useMemo(() => transcript?.cues.filter((cue) => currentTime >= cue.start && currentTime < cue.end).map((cue) => cue.text).join('\n') ?? '', [transcript, currentTime])
  const appStatus = statusLabel(apiKey, videoId, transcript, playerReady, asking)

  useEffect(() => { saveApiKey(provider, apiKey) }, [provider, apiKey])

  useEffect(() => {
    if (!videoId || !playerHost.current) return
    let disposed = false
    const host = playerHost.current
    host.replaceChildren()
    const mount = document.createElement('div')
    host.appendChild(mount)
    createYouTubePlayer(mount, videoId, {
      onReady: (instance) => { if (!disposed) { player.current = instance; setPlayerReady(true); setCurrentTime(instance.getCurrentTime()) } },
      onStateChange: () => { if (!disposed && player.current) setCurrentTime(player.current.getCurrentTime()) },
      onError: (code) => { if (!disposed) setVideoError(`YouTube 播放器錯誤（${code}）。影片可能不允許嵌入，請改用外部開啟。`) },
    }).catch((error: unknown) => { if (!disposed) setVideoError(error instanceof Error ? error.message : 'YouTube 播放器載入失敗。') })
    const timer = window.setInterval(() => { if (!disposed && player.current) setCurrentTime(player.current.getCurrentTime()) }, 500)
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
      setVideoError(''); setVideoId(course.videoId); setTranscript(course.transcript); setChat([]); setPlayerReady(false); setCurrentTime(0); setShowSubtitles(false); setNotice(`已載入課程包：${course.transcript.fileName} · ${course.transcript.cueCount} 段字幕。`)
    } catch (error: unknown) { setNotice(error instanceof Error ? error.message : '課程包匯入失敗。') }
  }

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => { void importCoursePackage(event.target.files?.[0]); event.target.value = '' }
  const changeProvider = (next: AIProvider) => {
    setProvider(next); setApiKey(readStoredApiKey(next)); setModelOptions([]); setConnection({ kind: 'idle', message: '' }); setModelId(next === 'cgu' ? CGU_DEFAULT_MODEL : DEFAULT_GEMINI_MODEL)
  }

  const clearApiKey = () => { clearStoredApiKey(provider); setApiKey(''); setConnection({ kind: 'idle', message: '' }); setNotice(`${provider === 'cgu' ? 'CGU' : 'Google AI Studio'} API Key 已清除。`) }

  const testConnection = async () => {
    setConnection({ kind: 'working', message: '正在測試模型連線…' })
    try { await testProviderConnection(provider, { apiKey, modelId }); setConnection({ kind: 'ok', message: `連線成功：${modelId}` }) }
    catch (error: unknown) { setConnection({ kind: 'error', message: error instanceof Error ? error.message : '連線測試失敗。' }) }
  }

  const loadModels = async () => {
    try { const models = await listProviderModels(provider, apiKey); setModelOptions(models); setNotice(models.length ? `已讀取 ${models.length} 個${provider === 'cgu' ? ' CGU' : ' Gemini'} 模型。` : '模型清單為空，仍可手動輸入模型 ID。') }
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
      if (!sources.length) throw new Error(mode === 'progress' ? '目前播放進度以前尚無足夠的字幕證據，請繼續觀看後再試。' : '目前字幕沒有可供檢索的內容。')
      const answer = await askProvider(provider, { apiKey, modelId, signal: controller.signal }, ANSWER_SYSTEM_PROMPT, buildAnswerPrompt({ mode, cutoffSeconds: cutoff, question: text, sources }), new Set(sources.map((source) => source.id)))
      const citations = makeCitationCards(answer, sources, mode, cutoff)
      const assistant: ChatMessage = { id: assistantId, role: 'assistant', text: answer.answer, createdAt: Date.now(), mode, cutoffSeconds: cutoff, citations, status: 'done' }
      setChat((items) => [...items, assistant])
    } catch (error: unknown) {
      if ((error as Error)?.name === 'AbortError') setNotice('已取消這次提問。')
      else { const message = error instanceof Error ? error.message : 'AI 問答失敗。'; setNotice(message); setChat((items) => [...items, { id: assistantId, role: 'assistant', text: message, createdAt: Date.now(), mode, cutoffSeconds: cutoff, status: 'error' }]) }
    } finally { abortRef.current = null; setAsking(false) }
  }

  return <div className={`app-shell student-shell ${toolbarHidden ? 'toolbar-is-hidden' : ''}`}>
    <input ref={fileInput} className="visually-hidden-input" type="file" accept=".vait,application/octet-stream" onChange={onFileChange} />
    {!toolbarHidden ? <header className="topbar"><div><h1>ClassTutor 課堂影片 AI 助教</h1></div><div className="topbar-actions"><span className={`status-pill ${appStatus.toLowerCase()}`}>{appStatus}</span><button className="header-action" onClick={() => fileInput.current?.click()}>上傳課程包</button>{transcript && <button className="header-action" onClick={() => window.open('./', '_blank', 'noopener,noreferrer')}>上傳其他課程包</button>}<a className="teacher-link" href="./teacher.html">老師課程包工具</a><button className="settings-toggle" onClick={() => setSettingsOpen(true)}>AI模型設定</button><button className="toolbar-toggle" onClick={() => setToolbarHidden(true)}>隱藏工具列</button></div></header> : <button className="toolbar-reveal" onClick={() => setToolbarHidden(false)}>顯示工具列</button>}
    {settingsOpen && <div className="settings-overlay" role="presentation"><section className="card settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="section-heading"><div><h2 id="settings-title">AI模型設定</h2><p>API Key 會保存在本機瀏覽器，保存期限 1 天；重新整理後仍可沿用。</p></div><button className="close-button" onClick={() => setSettingsOpen(false)} aria-label="關閉模型設定">×</button></div><label htmlFor="provider">API Provider</label><select id="provider" value={provider} onChange={(e) => changeProvider(e.target.value as AIProvider)}><option value="google">Google AI Studio</option><option value="cgu">CGU API</option></select><label htmlFor="api-key">{provider === 'cgu' ? 'CGU API Key' : 'Google AI Studio API Key'}</label><div className="key-input"><input id="api-key" type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e) => { setApiKey(e.target.value); setConnection({ kind: 'idle', message: '' }) }} placeholder="貼上你的 API Key" autoComplete="off" /><button className="icon-button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? '隱藏金鑰' : '顯示金鑰'}>{showKey ? '隱藏' : '顯示'}</button></div><div className="model-row"><label htmlFor="model-id">模型 ID</label><input id="model-id" value={modelId} onChange={(e) => setModelId(e.target.value)} list="model-options" /><datalist id="model-options">{modelOptions.map((model) => <option value={model} key={model} />)}</datalist></div><div className="button-row"><button onClick={testConnection} disabled={connection.kind === 'working' || !apiKey.trim()}>{connection.kind === 'working' ? '測試中…' : '測試連線'}</button><button className="secondary-button" onClick={loadModels} disabled={!apiKey.trim()}>讀取模型清單</button><button className="danger-button" onClick={clearApiKey} disabled={!apiKey}>清除 API Key</button></div>{connection.message && <p className={connection.kind === 'error' ? 'error-text' : 'success-text'} role="status">{connection.message}</p>}<p className="privacy-note">目前 provider：{provider === 'cgu' ? 'CGU API（預設 OSS 120B）' : 'Google AI Studio（預設 gemini-flash-lite-latest）'}。API Key 保存期限為 24 小時。</p></section></div>}
    <main className="layout tutor-layout" style={{ gridTemplateColumns: COLUMN_RATIO_COLUMNS[columnRatio] }}>
      <section className="left-column video-column">
        <article className="video-card"><div id="video-player" className="player-wrap">{videoId ? <div ref={playerHost} className="youtube-host" /> : <div className="empty-player"><span>▶</span><p>使用上方「上傳課程包」開始學習</p></div>}{showSubtitles && currentSubtitle && <div className="subtitle-overlay" aria-live="polite">{currentSubtitle}</div>}</div>{videoError && <p className="error-text" role="alert">{videoError} {videoId && <a href={youtubeUrl(videoId)} target="_blank" rel="noreferrer">在 YouTube 開啟</a>}</p>}</article>
      </section>
      <aside className="right-column">
        <article className="card chat-card"><div className="chat-header"><div className="mode-switch" role="group" aria-label="問答控制"><label className="subtitle-toggle"><input type="checkbox" checked={showSubtitles} onChange={(event) => setShowSubtitles(event.target.checked)} /><span>顯示字幕</span></label><label className="ratio-control"><span>影片／Chatbot</span><select value={columnRatio} onChange={(event) => setColumnRatio(event.target.value as ColumnRatio)} aria-label="影片與 Chatbot 欄位比例"><option value="3:1">3:1</option><option value="1:1">1:1</option><option value="1:2">1:2</option><option value="1:3">1:3</option></select></label><a href="#toolbar" className="toolbar-inline-toggle" onClick={(event) => { event.preventDefault(); setToolbarHidden((value) => !value) }}>{toolbarHidden ? '顯示工具列' : '隱藏工具列'}</a></div></div><div className="messages" aria-live="polite">{chat.length === 0 && <div className="chat-empty"><span>✦</span><p>播放影片、匯入字幕後，問我課堂中已經講過的內容。</p></div>}{chat.map((message) => <div className={`message ${message.role} ${message.status === 'error' ? 'message-error' : ''}`} key={message.id}><div className="message-meta">{message.role === 'user' ? '你' : 'AI 助教'} · {message.mode === 'progress' ? '跟著進度' : '全課複習'} · {fmt(message.cutoffSeconds)}</div><div className="markdown-content">{message.role === 'assistant' ? renderMarkdown(message.text, new Map((message.citations ?? []).map((citation) => [citation.chunkId, citation] as const)), jumpTo) : <p>{message.text}</p>}</div>{message.role === 'assistant' && message.status === 'done' && (!message.citations || message.citations.length === 0) && <p className="unverified">回答沒有可驗證的字幕來源。</p>}</div>)}</div><div className="quick-prompts" aria-label="快速提問">{QUICK_PROMPTS.map((prompt) => <button key={prompt} onClick={() => setQuestion(prompt)} disabled={asking}>{prompt}</button>)}</div><div className="ask-form"><textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="" disabled={asking} rows={3} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submitQuestion() } }} /><button onClick={() => void submitQuestion()} disabled={asking || !question.trim()}>{asking ? '回答中…' : '送出'}</button></div>{asking && <button className="cancel-button" onClick={() => abortRef.current?.abort()}>取消這次提問</button>}{notice && <p className="notice" role="status">{notice}</p>}</article>
      </aside>
    </main>
  </div>
}
