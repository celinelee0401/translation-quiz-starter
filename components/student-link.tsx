'use client';

import { useState } from 'react';

/** Shows the student URL for a published quiz with a copy button. */
export function StudentLink({ quizId, version }: { quizId: string; version: number }) {
  const [copied, setCopied] = useState(false);
  const path = `/quiz?quiz=${encodeURIComponent(quizId)}&version=${version}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="font-bold">學生作答連結：</span>
      <a href={path} className="break-all font-mono text-primary underline" target="_blank" rel="noreferrer">{path}</a>
      <button type="button" onClick={() => void copy()} className="min-h-9 rounded-lg border border-border px-3 font-bold">
        {copied ? '已複製' : '複製完整網址'}
      </button>
    </p>
  );
}
