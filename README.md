# 句子翻譯線上測驗（教師公版）

給國中／高中英文老師用的「中翻英句子翻譯」線上測驗系統。老師建立題目與評分細則、設定各班開放時段，學生用班級＋座號（可加 PIN）登入作答；系統用固定規則與（可選的）AI 提出分數建議，**最後成績一定由老師確認**。

> 不熟程式也沒關係：把 [`PROMPT.md`](PROMPT.md) 整份貼給你的 AI 助理（ChatGPT、Claude、Gemini 等），它會一步一步問你選項、幫你設定與部署。

## 固定的核心（不能關）

- **老師最後決定分數**：評分細則 → 規則或 AI 給建議 → 老師確認；每次改分都留下稽核紀錄。
- **不能重複繳交、原始答案不可覆寫**：提交帶唯一序號，重送只會得到同一筆結果。
- **作答時關閉輸入建議**：關掉自動修正、拼字建議、自動大寫；偵測到中文輸入法時提醒學生切回英文鍵盤。
- **時間由伺服器判斷**：未開放、已截止、不是目標班級都不能作答；正式測驗不會提前露出答案。
- **已考完只封存不刪除**；撤銷發布只限還沒有人作答。

## 老師可以自己選

| 項目 | 選項 | 設定位置 |
|---|---|---|
| 學生登入 | `pin`：班級＋座號＋六位數 PIN（正式成績用）／`seat`：只要班級＋座號（練習用，任何人都能冒用座號） | `STUDENT_LOGIN_MODE` |
| AI 批改建議 | `none`：關閉，只用固定規則＋老師批改／`openai`：OpenAI，金鑰與費用由老師自己的帳號支付 | `AI_PROVIDER`、`OPENAI_API_KEY`、`OPENAI_MODEL` |
| 班級與年級 | 任意班級代碼、1–12 年級 | [`school.config.ts`](school.config.ts) |
| 學年、時區 | 例如 `115`、`Asia/Taipei` | `SCHOOL_YEAR`、`school.config.ts` |
| 資料庫 | Supabase（免費方案即可） | `SUPABASE_URL`、`SUPABASE_SECRET_KEY` |
| 部署 | Cloudflare Workers（免費方案即可） | [`wrangler.jsonc`](wrangler.jsonc) |

## 輸入建議能做到與做不到

- 做得到：英文鍵盤下關掉自動修正、拼字建議、自動大寫；多數情況下 iPad 預測字列也會消失。
- 做不到：學生切到中文輸入法時，選字列是系統畫的，網頁關不掉；部分 iPad 版本不完全遵守設定。系統會提醒學生切回英文鍵盤。
- 要完全鎖住，需要學校的裝置管理（例如 Jamf、Google 管理控制台）。

## 安裝步驟（手動版）

需要：Node.js 22.13 以上、一個 [Supabase](https://supabase.com) 帳號、一個 [Cloudflare](https://cloudflare.com) 帳號。

1. **安裝套件**：`npm install`
2. **建立資料庫**：在 Supabase 建一個新專案，到 SQL Editor 依檔名順序執行 `supabase/migrations/` 裡的每個 `.sql` 檔。
3. **設定教師通行碼**：`npm run teacher-code`，輸入你要的通行碼，把印出的 SQL 貼到 SQL Editor 執行。
4. **改學校設定**：編輯 `school.config.ts`（學校名稱、班級、年級、時區）與 `wrangler.jsonc` 的 `vars`（學年、登入方式、AI）。
5. **本機試跑**：複製 `.dev.vars.example` 成 `.dev.vars` 並填入，執行 `npm run dev`，開啟畫面上顯示的網址。
6. **部署**：
   ```bash
   npx wrangler login
   npx wrangler secret put TRANSLATION_SESSION_SECRET
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_SECRET_KEY
   npx wrangler secret put OPENAI_API_KEY   # 只有使用 AI 時才需要
   npm run deploy
   ```
7. **匯入學生**：以教師通行碼登入首頁 →「學生名冊與 PIN」，每行貼上 `班級,座號[,PIN]`。PIN 留空會自動產生，**只顯示一次**，請當場列印或複製發給學生。
8. **建立第一份測驗**：首頁「新增／匯入測驗」，可直接匯入 `examples/demo-quiz.json` 試一次。設定班級時段並發布後，學生入口是 `/quiz?quiz=<測驗代碼>&version=1`。

## 檢查

- `npm test`：單元與合約測試。
- `npm run check:db`：在記憶體裡的 Postgres 跑一次所有 migration，並驗證登入鎖定、防重複繳交、改分稽核與權限（不連任何外部資料庫）。
- `npm run build`：確認可以建置。

## 安全提醒

- `SUPABASE_SECRET_KEY`、`OPENAI_API_KEY`、`TRANSLATION_SESSION_SECRET` 只能放在伺服器端（Cloudflare secret 或 `.dev.vars`），不要寫進程式或上傳到 GitHub。
- 資料表全部關閉瀏覽器直接存取，只有伺服器用 secret key 讀寫。
- 學生 PIN 只以 bcrypt 雜湊保存；連續輸錯 5 次會鎖 10 分鐘。老師可在名冊頁重設 PIN，舊的登入立即失效。
- 不要用真實學生資料做測試；請先用假的班級與座號試跑。

## 專案結構

- `app/`：頁面與 API；`components/`：畫面元件；`lib/`：評分規則與共用邏輯；`lib/server/`：所有資料庫與權限檢查。
- `supabase/migrations/`：資料庫結構；`tests/`：測試；`scripts/`：教師通行碼與資料庫檢查工具。
- 領域規則見 [`CONTEXT.md`](CONTEXT.md)；給 AI 助理的工作規則見 [`AGENTS.md`](AGENTS.md)。

## 授權與內容

示範題為自編內容，不含任何出版社課本文字。老師自行匯入的題目請注意版權，不要把有版權的課本內容放進公開的 repo。
