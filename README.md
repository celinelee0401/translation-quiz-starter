# 句子翻譯線上測驗（教師公版）

給國中／高中英文老師用的「中翻英句子翻譯」線上測驗網站。老師建立題目與評分細則、設定各班開放時段，學生用班級＋座號＋PIN 登入作答；系統用固定規則與（可選的）AI 提出分數建議，**最後成績一定由老師確認**。

全部使用免費方案（GitHub、Supabase、Cloudflare），**不用安裝軟體、不用打指令**。

## 🚀 開始架設

**第一次架設，請照 👉 [新手架設指南](docs/新手架設指南.md) 一步一步做**（約 40–60 分鐘）。指南會先帶你建好資料庫，再按下面這顆按鈕：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/celinelee0401/translation-quiz-starter)

想請 AI 助理陪你一起做？把 [`PROMPT.md`](PROMPT.md) 整份貼給它（ChatGPT、Claude、Gemini 都可以）。

## 固定的核心（不能關）

- **老師最後決定分數**：評分細則 → 規則或 AI 給建議 → 老師確認；每次改分都留下稽核紀錄。
- **不能重複繳交、原始答案不可覆寫**：提交帶唯一序號，重送只會得到同一筆結果。
- **作答時關閉輸入建議**：關掉自動修正、拼字建議、自動大寫；偵測到中文輸入法時提醒學生切回英文鍵盤。
- **時間由伺服器判斷**：未開放、已截止、不是目標班級都不能作答；正式測驗不會提前露出答案。
- **已考完只封存不刪除**；撤銷發布只限還沒有人作答。

## 老師可以自己選（部署時填，之後可在 Cloudflare 修改）

| 變數 | 用途 | 範例 |
|---|---|---|
| `SCHOOL_NAME` | 學校名稱 | `光明國中` |
| `SCHOOL_CLASSES` | 班級與年級（1–12） | `801:8, 802:8, 901:9` |
| `SCHOOL_YEAR` | 學年 | `115` |
| `SCHOOL_TIMEZONE` | 時區 | `Asia/Taipei` |
| `STUDENT_LOGIN_MODE` | `pin`：班級＋座號＋PIN（正式成績用）／`seat`：只要班級＋座號（練習用，可被冒用座號） | `pin` |
| `AI_PROVIDER` | `none`：不用 AI／`openai`：OpenAI 給分數建議（費用由老師自己的帳號支付） | `none` |
| `OPENAI_MODEL` | OpenAI 模型名稱 | `gpt-5.6-terra` |

機密（部署時另外詢問，不會出現在程式裡）：`SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`SETUP_CODE`（自己想的設定碼，用來在 `/setup` 設定教師通行碼）、`OPENAI_API_KEY`（不用 AI 填 `none`）。`TRANSLATION_SESSION_SECRET` 可選；沒填時由 Supabase secret key 衍生。

部署後打開 **`你的網址/setup`**，網站會逐項檢查設定，並告訴你下一步。

## 輸入建議能做到與做不到

- 做得到：英文鍵盤下關掉自動修正、拼字建議、自動大寫；多數情況下 iPad 預測字列也會消失。
- 做不到：學生切到中文輸入法時，選字列是系統畫的，網頁關不掉；部分 iPad 版本不完全遵守設定。系統會提醒學生切回英文鍵盤。
- 要完全鎖住，需要學校的裝置管理（例如 Jamf、Google 管理控制台）。

## 安全設計

- 資料表全部關閉瀏覽器直接存取，只有伺服器用 secret key 讀寫。
- 學生 PIN 只以 bcrypt 雜湊保存；連續輸錯 5 次鎖 10 分鐘。老師可在名冊頁重設 PIN，舊的登入立即失效。
- 只存班級與座號，不存學生姓名。
- 不要用真實學生資料做測試；請先用假座號（例如 90–99）試跑。

## 給會寫程式的人

需要 Node.js 22.13 以上。

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入 Supabase 等設定
npm run dev                      # 本機試跑
npm test                         # 單元與合約測試
npm run check:db                 # 在記憶體 Postgres 跑 supabase/setup.sql 並驗證登入、交卷、改分、權限
npm run build && npm run deploy  # 手動部署（需先 npx wrangler login，機密用 npx wrangler secret put）
```

- 資料庫變更：在 `supabase/migrations/` 新增檔案，再執行 `npm run build:sql` 更新 `supabase/setup.sql`（測試會檢查兩者一致）。
- `app/`：頁面與 API；`components/`：畫面元件；`lib/`：評分規則、學校設定；`lib/server/`：所有資料庫與權限檢查。
- 領域規則見 [`CONTEXT.md`](CONTEXT.md)；給 AI 助理的開發規則見 [`AGENTS.md`](AGENTS.md)。
- `school.config.ts` 只是預設值，部署變數會覆蓋它。

## 授權與內容

示範題為自編內容，不含任何出版社課本文字。老師自行匯入的題目請注意版權，不要把有版權的課本內容放進公開的 repo。
