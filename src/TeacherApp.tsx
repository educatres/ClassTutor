import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { createCoursePackage, downloadCoursePackage } from './services/coursePackage'
import { parseYouTubeVideoId } from './services/youtube'

export default function TeacherApp() {
  const [videoUrl, setVideoUrl] = useState('')
  const [subtitle, setSubtitle] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const chooseFile = (file?: File) => {
    setError(''); setNotice('')
    if (!file) return
    if (!/\.(vtt|srt|sbv)$/i.test(file.name)) { setError('只支援 .vtt、.srt 或 .sbv 字幕檔。'); return }
    setSubtitle(file)
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>) => { chooseFile(event.target.files?.[0]); event.target.value = '' }
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files?.[0]) }

  const generate = async () => {
    setError(''); setNotice('')
    if (!parseYouTubeVideoId(videoUrl)) { setError('請輸入合法的 YouTube 影片網址。'); return }
    if (!subtitle) { setError('請先上傳 VTT、SRT 或 SBV 字幕檔。'); return }
    setWorking(true)
    try {
      const result = await createCoursePackage(videoUrl, subtitle)
      downloadCoursePackage(result.fileName, result.content)
      setNotice(`課程包已產生：${result.fileName}。請將此檔案提供給學生。`)
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : '課程包產生失敗。') }
    finally { setWorking(false) }
  }

  return <div className="teacher-shell app-shell">
    <header className="topbar"><div><p className="eyebrow">VIDEO AI TUTOR · TEACHER</p><h1>老師課程包製作工具</h1></div><a className="teacher-link" href="./">回到學生頁面</a></header>
    <main className="teacher-main">
      <article className="card teacher-hero"><span className="teacher-mark">✦</span><div><h2>把影片與字幕打包給學生</h2><p>貼上 YouTube 網址、上傳與影片時間一致的字幕，系統會在瀏覽器產生單一 `.classtutor` 課程包檔案。</p></div></article>
      <article className="card teacher-form">
        <label htmlFor="teacher-video-url">YouTube 影片網址</label>
        <input id="teacher-video-url" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
        <label>字幕檔案</label>
        <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => fileInput.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInput.current?.click() }}><strong>{subtitle ? subtitle.name : '拖放 VTT / SRT / SBV 到這裡'}</strong><span>{subtitle ? `${(subtitle.size / 1024).toFixed(1)} KiB · 已選取` : '或點擊選擇字幕檔（上限 10 MiB）'}</span><input ref={fileInput} type="file" accept=".vtt,.srt,.sbv,text/vtt,application/x-subrip" onChange={onChange} /></div>
        <button className="teacher-generate" onClick={() => void generate()} disabled={working}>{working ? '正在產生課程包…' : '產生並下載課程包'}</button>
        {error && <p className="error-text" role="alert">{error}</p>}
        {notice && <p className="success-text" role="status">{notice}</p>}
      </article>
      <article className="card teacher-info"><h2>交付給學生的內容</h2><div className="teacher-steps"><div><b>01</b><span>學生匯入 `.classtutor` 課程包</span></div><div><b>02</b><span>影片網址與字幕自動載入</span></div><div><b>03</b><span>學生只需輸入自己的 API Key</span></div></div><p className="privacy-note">課程包使用固定應用程式金鑰做 AES-GCM 基本加密，主要用於避免直接修改內容，不是機密資料保護。請勿將未授權的敏感教材放入公開分享的課程包。</p></article>
      <article className="card teacher-guide"><h2>YouTube 影片與字幕說明</h2><div className="guide-section"><h3>影片權限怎麼設定？</h3><ul><li><strong>不公開（Unlisted）</strong>：通常最適合課程使用；知道網址的人可以觀看，但不會出現在搜尋結果。請提醒學生不要轉發影片網址。</li><li><strong>公開（Public）</strong>：任何人都能搜尋及觀看，適合公開課程或宣傳內容。</li><li><strong>私人（Private）</strong>：只有被邀請且登入正確 Google 帳戶的人能觀看；未被授權的學生會無法播放，嵌入頁面也不會繞過 YouTube 權限。因此除非已逐一授權學生，否則不建議使用私人影片。</li></ul><p>請在 YouTube Studio 的影片詳細設定確認允許嵌入（Allow embedding）。若關閉嵌入，學生仍可透過 YouTube 外部連結觀看，但頁面內播放器可能無法播放。</p><a href="https://support.google.com/youtube/answer/57407" target="_blank" rel="noreferrer">YouTube 官方：上傳影片 ↗</a><a href="https://support.google.com/youtube/answer/157177" target="_blank" rel="noreferrer">YouTube 官方：影片隱私設定 ↗</a></div><div className="guide-section"><h3>如何從 YouTube Studio 下載字幕？</h3><ol><li>登入 <strong>YouTube Studio</strong>，左側選單進入「內容」，選擇要使用的影片。</li><li>進入「字幕」，選擇語言；如果是自動產生字幕，請先校對人名、專有名詞與時間。</li><li>在字幕列的選項選單（⋮）選擇「下載字幕」，依需求下載 `.sbv`、`.srt` 或 `.vtt`。</li><li>回到本頁上方上傳字幕檔，再產生 `.classtutor` 課程包。字幕時間必須與 YouTube 影片時間軸一致，本工具不會自動校正時間。</li></ol><p>如果 YouTube 沒有可下載的字幕，也可以在本機準備符合時間軸的 `.sbv`、`.srt` 或 `.vtt` 檔案後直接上傳。</p><a href="https://support.google.com/youtube/answer/2734796?hl=zh-Hant" target="_blank" rel="noreferrer">YouTube 官方：新增與管理字幕 ↗</a><a href="https://studio.youtube.com/" target="_blank" rel="noreferrer">開啟 YouTube Studio ↗</a></div></article>
    </main>
    <footer><span>Video AI Tutor · 老師工具</span><span>字幕時間直接對應影片時間，不提供校正功能</span></footer>
  </div>
}
