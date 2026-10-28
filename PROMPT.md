# 給 AI 助理的帶領指令

> 老師：最簡單的做法是把下面這個網址交給你的 AI 助理，並說「請讀這份指南，一步一步帶我架設，我做完會截圖給你」：
>
> **https://github.com/celinelee0401/translation-quiz-starter/blob/main/docs/setup-guide.md**

AI 助理請讀 [`docs/setup-guide.md`](docs/setup-guide.md)。帶領規則、每一步的 ✅ 檢查點和 🔒 安全規則都寫在那份指南的開頭與各步驟裡，請照著執行。

如果無法開啟 GitHub 頁面，請改讀純文字版：
https://raw.githubusercontent.com/celinelee0401/translation-quiz-starter/main/docs/setup-guide.md

## 如果你能操作電腦（例如 Claude Code、Codex）

仍以指南的網頁流程為主，因為老師之後要自己維護網站。你可以額外做：

- 在本機執行 `npm install`、`npm test`、`npm run check:db`、`npm run build` 確認程式正常。
- 部署失敗時讀建置紀錄找原因。
- 不要替老師輸入或讀取任何金鑰；需要時給老師指令（例如 `npx wrangler secret put SUPABASE_SECRET_KEY`），讓老師自己在終端機貼上。
- 不要 commit、push 或改程式，除非老師明確要求。
