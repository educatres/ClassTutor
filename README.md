# Video AI Tutor

課堂影片時間感知 AI 助教：在瀏覽器載入 YouTube 影片與 Teams `.vtt`／YouTube `.srt`／`.sbv` 字幕，依目前播放進度檢索字幕，再由使用者自己的 Google AI Studio Key 提問。

## 開發

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

網站是純靜態 React/Vite 應用，不需要後端。部署到 GitHub Pages 時，Vite 使用相對資產路徑，可直接將 `dist` 發佈為 Pages artifact。

## 使用方式

### 老師端

開啟 [`teacher.html`](https://educatres.github.io/ClassTutor/teacher.html)，貼入支援 `youtube.com/watch`、`youtu.be`、`embed`、`shorts` 的 YouTube 影片網址，再上傳與影片時間一致的 `.vtt`、`.srt` 或 YouTube `.sbv` 字幕。按下「產生並下載課程包」後，將 `.vait` 檔案提供給學生。

課程包在瀏覽器內使用固定應用程式金鑰做 AES-GCM 基本加密，主要用來避免直接修改內容，不是機密資料保護；請勿放入未授權的敏感教材。

### 學生端

1. 開啟學生頁面，匯入老師提供的 `.vait` 課程包；影片網址與字幕會自動載入。
2. 貼上自己的 Google AI Studio API Key，按「測試連線」。預設模型為 `gemini-flash-lite-latest`，可在模型欄位手動改用可用模型。
3. 播放影片後，在「跟著進度學習」模式提問。這個模式只會送出 `cue.end <= 送出當下播放時間` 的字幕；「全課複習」才會搜尋整份字幕。
4. AI 回覆下方的時間卡由本機字幕資料產生，點擊可跳轉同頁播放器，也可開啟合法的 YouTube 備援連結。

## API 連線方式

Google API 呼叫沿用參考專案的 OpenAI 相容介面：

- endpoint：`https://generativelanguage.googleapis.com/v1beta/openai`
- `POST /chat/completions` 進行連線測試與問答
- `GET /models` 讀取模型清單
- header：`Authorization: Bearer <使用者提供的 Key>`

Key 只會依使用者選擇保存在本機瀏覽器 `localStorage`，並在 24 小時後自動過期；不會寫入 Cookie、URL、檔案或 log，也不會送往本專案後端。瀏覽器直連第三方 API 仍不能保證金鑰完全保密，建議使用獨立且受配額限制的 Key。字幕節錄與問題會離開瀏覽器並交由 Google 或 CGU 服務處理，請勿在未確認服務條款前上傳機敏內容。

學生頁面右上角的「模型設定」可切換 Google AI Studio 與 CGU API。CGU 預設 endpoint 為 `https://air.cgu.edu.tw/cgullmapi/v1`，預設模型為 `gpt-oss-120b`；兩者皆使用參考專案採用的 Bearer Token 與 OpenAI-compatible `/models`、`/chat/completions` 介面。模型設定浮層提供讀取模型清單與清除 API Key。

## 已知限制

- 影片必須允許嵌入；若 YouTube 拒絕嵌入，仍可使用外部開啟連結。
- Gemini API、瀏覽器 CORS、模型權限與免費配額由 Google 服務政策決定；錯誤會顯示在畫面，不會偷偷切換模型或代理服務。
- 字幕時間直接對應影片時間，本專案刻意不提供任何時間偏移、校正、重新對齊或校準功能。
- 重新整理頁面會清除 API Key、字幕與對話。
