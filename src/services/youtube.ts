const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export function parseYouTubeVideoId(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? ''
    return VIDEO_ID.test(id) ? id : null
  }
  if (!['youtube.com', 'm.youtube.com'].includes(host)) return null
  let id = ''
  if (url.pathname === '/watch') id = url.searchParams.get('v') ?? ''
  else if (/^\/(embed|shorts)\//.test(url.pathname)) id = url.pathname.split('/')[2] ?? ''
  return VIDEO_ID.test(id) ? id : null
}

export function youtubeUrl(videoId: string, seconds?: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds ?? 0))
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${safeSeconds}s`
}

export type YouTubePlayer = {
  getCurrentTime: () => number
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  destroy?: () => void
}

type PlayerEvent = { target: YouTubePlayer }
type PlayerConstructor = new (element: HTMLElement, options: { videoId: string; playerVars?: Record<string, number>; events: { onReady: (event: PlayerEvent) => void; onStateChange?: () => void; onError?: (event: { data: number }) => void } }) => YouTubePlayer
declare global { interface Window { YT?: { Player: PlayerConstructor; PlayerState?: Record<string, number> }; onYouTubeIframeAPIReady?: () => void } }

let apiPromise: Promise<void> | null = null
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve()
  if (apiPromise) return apiPromise
  apiPromise = new Promise<void>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve() }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => reject(new Error('YouTube 播放器 API 載入失敗，請檢查網路或瀏覽器擴充功能。'))
    document.head.appendChild(script)
  })
  return apiPromise
}

export async function createYouTubePlayer(element: HTMLElement, videoId: string, handlers: { onReady: (player: YouTubePlayer) => void; onStateChange?: () => void; onError?: (code: number) => void }) {
  await loadYouTubeApi()
  if (!window.YT?.Player) throw new Error('YouTube 播放器尚未準備完成。')
  return new window.YT.Player(element, { videoId, playerVars: { playsinline: 1, rel: 0 }, events: {
    onReady: (event) => handlers.onReady(event.target as YouTubePlayer),
    onStateChange: handlers.onStateChange,
    onError: (event) => handlers.onError?.(event.data),
  } })
}
