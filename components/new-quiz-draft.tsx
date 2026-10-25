'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { NewQuestion } from '@/lib/server/create-quiz-draft';
import { gradeLevels } from '@/lib/public-quiz-data';

const blank = (): NewQuestion => ({ prompt: '', answer: '', hint: '', meaning: 5, grammar: 4 });

function parsePastedQuestions(raw: string): NewQuestion[] {
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(line =>
    Boolean(line) && !/^\|?[\s|:-]+\|?$/.test(line) &&
    !(line.includes('中文題目') && line.includes('英文答案')));
  if (!lines.length || lines.length > 50) throw new Error('請貼入 1～50 行題目。');
  return lines.map((line, index) => {
    let parts = line.includes('\t') ? line.split('\t').map(part => part.trim()) :
      line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(part => part.trim());
    if (/^\d{1,2}$/.test(parts[0]) && parts.length >= 4) parts = parts.slice(1);
    if (parts.length < 3 || parts.length > 5 || !parts[0] || !parts[1] || !parts[2])
      throw new Error(`第 ${index + 1} 行格式不正確；需依序為中文題目、英文答案、提示，配分可選。`);
    const meaning = parts[3] ? Number(parts[3]) : 5;
    const grammar = parts[4] ? Number(parts[4]) : 4;
    if (!Number.isInteger(meaning) || meaning < 1 || !Number.isInteger(grammar) || grammar < 0)
      throw new Error(`第 ${index + 1} 行配分不正確。`);
    return { prompt: parts[0], answer: parts[1], hint: parts[2], meaning, grammar };
  });
}

export function NewQuizDraft() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [unit, setUnit] = useState('');
  const [grade, setGrade] = useState<number>(gradeLevels[0] ?? 8);
  const [scoreMode, setScoreMode] = useState<'formal' | 'practice'>('formal');
  const [questions, setQuestions] = useState<NewQuestion[]>([blank()]);
  const [paste, setPaste] = useState('');
  const [englishOnly, setEnglishOnly] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [message, setMessage] = useState('');
  const total = questions.reduce((sum, q) => sum + Number(q.meaning) + Number(q.grammar) + 1, 0);

  function update(index: number, key: keyof NewQuestion, value: string) {
    setQuestions(current => current.map((question, questionIndex) =>
      questionIndex === index ? { ...question, [key]: key === 'meaning' || key === 'grammar' ? Number(value) : value } : question));
  }
  function importText(raw: string) {
    try { setQuestions(parsePastedQuestions(raw)); setMessage('題目已放入下方預覽；請逐題核對答案、提示與配分，再儲存草稿。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '格式不正確。'); }
  }
  async function generateFromEnglish() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/teacher/generate-questions', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ englishAnswers: englishOnly }) });
      const body = await response.json() as { status?: string; error?: string; questions?: NewQuestion[] };
      if (!response.ok || body.status !== 'ok' || !body.questions?.length)
        throw new Error(body.error || '未取得完整命題建議。');
      setQuestions(body.questions);
      setMessage('已產生中文題目、考後提示與 100 分配分建議。請逐題核對後才儲存；此時學生完全看不到。');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'AI 命題未完成。'); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/teacher/create-draft', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, unit, grade, scoreMode, questions }) });
      const result = await response.json() as { status?: string; error?: string; quizId?: string };
      if (!response.ok || result.status !== 'ok') throw new Error(result.error || '草稿未確認。');
      setMessage(`已建立未發布草稿 ${result.quizId}；請到上方管理清單逐題核對、設定班級與時段。`);
      setCreated(true);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '草稿未確認；請重新整理清單核對。');
    } finally { setBusy(false); }
  }

  return <div className="rounded-xl border border-border p-4">
    <h3 className="text-lg font-black">建立其他單元的測驗草稿</h3>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">支援任一年級與單元。儲存後仍不會發布到學生端；英文答案與評分單位只在教師區／後端顯示。</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-bold">測驗名稱<input value={title} onChange={event => setTitle(event.target.value)}
        className="mt-1 h-11 w-full rounded-lg border border-border px-3" placeholder="例如 G8 Unit 2 Reading p.23" /></label>
      <label className="text-sm font-bold">單元／頁面<input value={unit} onChange={event => setUnit(event.target.value)}
        className="mt-1 h-11 w-full rounded-lg border border-border px-3" placeholder="例如 Unit 2 Reading p.23" /></label>
      <label className="text-sm font-bold">年級<select value={grade} onChange={event => setGrade(Number(event.target.value))}
        className="mt-1 h-11 w-full rounded-lg border border-border px-3">{gradeLevels.map(level => <option key={level} value={level}>G{level}</option>)}</select></label>
      <label className="text-sm font-bold">成績模式<select value={scoreMode} onChange={event => setScoreMode(event.target.value as 'formal' | 'practice')}
        className="mt-1 h-11 w-full rounded-lg border border-border px-3"><option value="formal">正式平時成績</option><option value="practice">練習成績</option></select></label>
    </div>
    <section className="mt-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <h4 className="font-black">只貼英文答案，協助生成題目</h4>
      <p className="mt-1 text-sm leading-6">每行一句，最多 20 句。系統會先擬中文翻譯題、考後學習提示與總分 100 分的配分；短片語不會因題數少就平均分到過高分。所有內容仍由你核對、可修改，按下「儲存未發布草稿」前不會存入題庫。</p>
      <textarea value={englishOnly} onChange={event => setEnglishOnly(event.target.value)} rows={6}
        className="mt-3 w-full rounded-lg border border-border bg-white p-3" placeholder={'What time did you get to school this morning?\nI got to school at seven thirty with my brother.\nThat\'s too bad!'} />
      <button type="button" disabled={busy || !englishOnly.trim()} onClick={() => void generateFromEnglish()}
        className="mt-2 min-h-11 rounded-lg bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50">
        {busy ? '正在產生命題建議…' : '產生中文題目與配分建議'}
      </button>
    </section>
    <details className="mt-4 rounded-lg bg-muted p-3 text-sm">
      <summary className="cursor-pointer font-bold">一次貼入多題（表格／TSV）</summary>
      <p className="mt-2 leading-6">每行依序：中文題目｜英文答案｜學習提示｜語意分｜文法分。最後兩欄可省略，預設 5＋4；每題另加 1 分書寫規約。可貼上以直線分隔的 Markdown 表格內容，或選擇 .txt／.md 文字檔。</p>
      <textarea value={paste} onChange={event => setPaste(event.target.value)} rows={5}
        className="mt-2 w-full rounded-lg border border-border bg-white p-3" placeholder="你今天早上幾點到學校？ | What time did you get / to school / this morning? | 注意過去式 did。 | 5 | 4" />
      <div className="mt-2 flex flex-wrap items-center gap-2"><button type="button" onClick={() => importText(paste)}
        className="min-h-11 rounded-lg border border-primary px-3 font-bold text-primary">匯入並預覽</button>
        <input type="file" accept=".txt,.md,text/plain,text/markdown" aria-label="選擇題目文字檔"
          onChange={async event => { const file = event.target.files?.[0]; if (file) {
            if (file.size > 50_000) { setMessage('檔案過大，請選擇 50 KB 以下的文字檔。'); return; }
            const text = await file.text(); setPaste(text); importText(text);
          } }} /></div>
    </details>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-black">逐題核對：{questions.length} 題，共 {total} 分</h4>
      <button type="button" disabled={questions.length >= 50} onClick={() => setQuestions(current => [...current, blank()])}
        className="min-h-11 rounded-lg border border-primary px-3 text-sm font-bold text-primary disabled:opacity-50">＋ 增加題目</button>
    </div>
    <ol className="mt-3 space-y-4">{questions.map((question, index) => <li key={index} className="rounded-xl border border-border p-3">
      <div className="flex justify-between"><b>第 {index + 1} 題 · {Number(question.meaning) + Number(question.grammar) + 1} 分</b>
        {questions.length > 1 ? <button type="button" onClick={() => setQuestions(current => current.filter((_, i) => i !== index))}
          className="text-sm font-bold text-red-800">移除這題</button> : null}</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-sm font-bold">中文題目<input value={question.prompt} onChange={event => update(index, 'prompt', event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-border px-3" /></label>
        <label className="text-sm font-bold">英文參考答案（可用 / 標分段）<input value={question.answer} onChange={event => update(index, 'answer', event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-border px-3" /></label>
        <label className="text-sm font-bold sm:col-span-2">測驗後學習提示<input value={question.hint} onChange={event => update(index, 'hint', event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-border px-3" /></label>
        <label className="text-sm font-bold">必要語意分<input type="number" min={1} max={99} value={question.meaning} onChange={event => update(index, 'meaning', event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-border px-3" /></label>
        <label className="text-sm font-bold">句型文法分<input type="number" min={0} max={99} value={question.grammar} onChange={event => update(index, 'grammar', event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-border px-3" /></label>
      </div>
    </li>)}</ol>
    <p className="mt-3 text-sm text-muted-foreground">不同英文表達不會只因字面不同就自動判零；正式成績需教師覆核。儲存前請核對參考答案每一句與總分。</p>
    <button type="button" disabled={busy || created} onClick={save} className="mt-3 min-h-11 rounded-lg bg-primary px-5 font-black text-primary-foreground disabled:opacity-50">
      {busy ? '儲存中…' : created ? '草稿已建立' : '儲存未發布草稿'}
    </button>
    {created ? <button type="button" onClick={() => { setTitle(''); setUnit(''); setQuestions([blank()]); setPaste(''); setEnglishOnly(''); setMessage(''); setCreated(false); }}
      className="ml-2 min-h-11 rounded-lg border border-primary px-4 font-bold text-primary">建立另一份</button> : null}
    {message ? <output className="mt-3 block font-bold">{message}</output> : null}
  </div>;
}
