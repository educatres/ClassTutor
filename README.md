# Video AI Tutor

課堂影片時間感知 AI 助教：在瀏覽器載入 YouTube 影片與 Teams `.vtt`／YouTube `.srt` 字幕，依目前播放進度檢索字幕，再由使用者自己的 Google AI Studio Key 提問。

## 開發

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

網站是純靜態 React/Vite 應用，不需要後端。部署到 GitHub Pages 時，Vite 使用相對資產路徑，可直接將 `dist` 發佈為 Pages artifact。

## 使用方式

1. 貼入 YouTube 影片網址並按「載入影片」。支援 `youtube.com/watch`、`youtu.be`、`embed`、`shorts`。
2. 匯入與影片時間一致的 `.vtt` 或 `.srt` 字幕。解析完全在瀏覽器本機完成，檔案上限 10 MiB。
3. 貼上自己的 Google AI Studio API Key，按「測試連線」。預設模型為 `gemini-flash-lite-latest`，可在模型欄位手動改用可用模型。
4. 播放影片後，在「跟著進度學習」模式提問。這個模式只會送出 `cue.end <= 送出當下播放時間` 的字幕；「全課複習」才會搜尋整份字幕。
5. AI 回覆下方的時間卡由本機字幕資料產生，點擊可跳轉同頁播放器，也可開啟合法的 YouTube 備援連結。

## API 連線方式

Google API 呼叫沿用參考專案的 OpenAI 相容介面：

- endpoint：`https://generativelanguage.googleapis.com/v1beta/openai`
- `POST /chat/completions` 進行連線測試與問答
- `GET /models` 讀取模型清單
- header：`Authorization: Bearer <使用者提供的 Key>`

不會把 Key 寫入 `localStorage`、Cookie、URL、檔案或 log，也不會送往本專案後端。瀏覽器直連第三方 API 仍不能保證金鑰完全保密，建議使用獨立且受配額限制的 Key。字幕節錄與問題會離開瀏覽器並交由 Google 服務處理，請勿在未確認服務條款前上傳機敏內容。

## 已知限制

- 影片必須允許嵌入；若 YouTube 拒絕嵌入，仍可使用外部開啟連結。
- Gemini API、瀏覽器 CORS、模型權限與免費配額由 Google 服務政策決定；錯誤會顯示在畫面，不會偷偷切換模型或代理服務。
- 字幕時間直接對應影片時間，本專案刻意不提供任何時間偏移、校正、重新對齊或校準功能。
- 重新整理頁面會清除 API Key、字幕與對話。
