'use client';

export function TeacherLogout() {
  async function logout() {
    const response = await fetch('/api/teacher/logout', { method: 'POST' });
    if (response.ok) window.location.href = '/';
  }
  return <button type="button" onClick={logout} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-cyan-300 px-5 font-black text-cyan-100 hover:bg-white/10">登出教師工作區</button>;
}
