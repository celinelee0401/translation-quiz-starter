import type { DataConfig } from './config.ts';
import { getDataConfig } from './config.ts';

const COOKIE = 'translation_teacher_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const ACTOR = 'teacher:translation-studio';
const encoder = new TextEncoder();

export class TeacherAccessError extends Error {
  readonly status = 401;
  constructor(message = '請先輸入教師通行碼。') { super(message); }
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decode(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
  } catch { return null; }
}

function equal(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`translation-teacher-v1:${value}`))));
}

async function teacherSetting(config: DataConfig): Promise<{ access_code_hash: string; updated_at: string } | null> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/teacher_access_settings?select=access_code_hash,updated_at&id=eq.true&limit=1`, {
    headers: { apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}` },
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Teacher credential unavailable');
  const rows = await response.json() as Array<{ access_code_hash: string; updated_at: string }>;
  return rows[0] ?? null;
}

async function verifyCode(code: string, hash: string): Promise<boolean> {
  const [version, salt, expected] = hash.split('.');
  if (version !== 'v2' || !salt || !expected) return false;
  const saltBytes = decode(salt);
  if (!saltBytes) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes.buffer as ArrayBuffer, iterations: 100_000 }, key, 256);
  return equal(base64url(new Uint8Array(bits)), expected);
}

function cookieValue(request: Request): string | null {
  const entry = (request.headers.get('cookie') ?? '').split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`));
  if (!entry) return null;
  try { return decodeURIComponent(entry.slice(COOKIE.length + 1)); } catch { return null; }
}

function sessionCookie(request: Request, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly;${secure} SameSite=Strict`;
}

export async function loginTeacher(request: Request, code: unknown): Promise<string> {
  const config = getDataConfig();
  if (!config) throw new Error('Teacher authentication not configured');
  if (typeof code !== 'string' || code.length > 64 || code.length < 8) throw new TeacherAccessError('教師通行碼不正確。');
  const setting = await teacherSetting(config);
  // The code's hash is stored by scripts/teacher-code-sql.ts (see README).
  if (!setting || !await verifyCode(code.trim(), setting.access_code_hash)) throw new TeacherAccessError('教師通行碼不正確。');
  const issuedAt = Date.now();
  const payload = base64url(encoder.encode(JSON.stringify({ kind: 'translation-teacher-v1', issuedAt, expiresAt: issuedAt + SESSION_MS })));
  return sessionCookie(request, `${payload}.${await hmac(payload, config.sessionSecret)}`, SESSION_MS / 1000);
}

export async function isTeacherAuthenticated(request: Request): Promise<boolean> {
  const config = getDataConfig();
  if (!config) return false;
  const token = cookieValue(request);
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !equal(await hmac(payload, config.sessionSecret), signature)) return false;
  const bytes = decode(payload);
  if (!bytes) return false;
  try {
    const session = JSON.parse(new TextDecoder().decode(bytes)) as { kind: string; issuedAt: number; expiresAt: number };
    if (session.kind !== 'translation-teacher-v1' || !Number.isFinite(session.issuedAt) ||
      !Number.isFinite(session.expiresAt) || session.issuedAt > Date.now() + 60_000 ||
      session.expiresAt - session.issuedAt !== SESSION_MS || session.expiresAt <= Date.now()) return false;
    const setting = await teacherSetting(config);
    return Boolean(setting && session.issuedAt >= Date.parse(setting.updated_at));
  } catch { return false; }
}

export async function requireTeacher(request: Request): Promise<{ email: string }> {
  if (!await isTeacherAuthenticated(request)) throw new TeacherAccessError();
  return { email: ACTOR };
}

export function logoutTeacher(request: Request): string { return sessionCookie(request, '', 0); }
