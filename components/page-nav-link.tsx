'use client';

import { useState, type ReactNode } from 'react';

// A full page load, with visible feedback: the review page can take several
// seconds to open, and a silent click looks like nothing happened.
export function PageNavLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const [loading, setLoading] = useState(false);
  return <a href={href} className={className} aria-busy={loading}
    onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 60_000); }}>
    {loading ? '載入中…請稍候' : children}
  </a>;
}
