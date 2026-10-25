# 句子翻譯測驗（教師公版）｜Agent 指引

## 開始之前

1. 先讀 `README.md`、`CONTEXT.md`；替老師架設系統時照 `PROMPT.md` 進行。
2. 以繁體中文和老師溝通，一次一步，說明影響學生、成績或開放時段的範圍。

## 不可更動的核心

- 老師最後確認分數、改分留稽核；AI 只給建議。
- 提交冪等、原始答案不可覆寫（`submit_translation_attempt`）。
- 作答輸入框關閉自動修正與建議（`components/student-quiz-preview.tsx`）。
- 時間、班級、年級、發布狀態由伺服器判斷；資料表對瀏覽器角色全部關閉。

## 修改與驗證

- 涉及身分、班級分流、分數或回饋的修改要加測試，並執行 `npm test`、`npm run check:db`、`npm run build`。
- 新增資料庫變更用新的 migration 檔，不改已套用的舊檔。
- 不把金鑰、PIN、教師通行碼、學生名單寫進程式、文件或 Git；不用真實學生資料測試。
- Commit、push、部署、資料庫寫入前先取得老師同意。
