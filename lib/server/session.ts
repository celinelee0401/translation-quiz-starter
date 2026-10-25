import type { AuthConfig } from './config.ts';
import { isVerifiedIdentity, type VerifiedStudentIdentity } from './student-identity.ts';
import { constantTimeEqual, hmac } from './security.ts';

export const SESSION_TTL_SECONDS = 45 * 60;
export const SESSION_COOKIE_NAME = 'translation_quiz_session';

export type StudentSession = VerifiedStudentIdentity & {
  issuedAt: number;
  expiresAt: number;
};

export type PublicStudentSession = Pick<
  StudentSession,
  'schoolYear' | 'classCode' | 'seatNumber' | 'gradeLevel' | 'expiresAt'
>;

export async function createStudentSession(
  identity: VerifiedStudentIdentity,
  secret: string,
  now = new Date(),
): Promise<{ session: StudentSession; token: string }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const session: StudentSession = {
    ...identity,
    issuedAt,
    expiresAt: issuedAt + SESSION_TTL_SECONDS,
  };
  const payload = encodeBase64Url(JSON.stringify(session));
  const signature = await hmac(payload, secret);
  return { session, token: `${payload}.${signature}` };
}

export async function verifyStudentSession(
  token: string,
  secret: string,
  now = new Date(),
): Promise<StudentSession | null> {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  const providedSignature = token.slice(separator + 1);
  if (!constantTimeEqual(await hmac(payload, secret), providedSignature)) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(decodeBase64Url(payload));
  } catch {
    return null;
  }
  if (!isStudentSession(value)) return null;

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    value.issuedAt > nowSeconds + 60 ||
    value.expiresAt <= nowSeconds ||
    value.expiresAt - value.issuedAt !== SESSION_TTL_SECONDS
  ) {
    return null;
  }
  return value;
}

export function publicStudentSession(
  session: StudentSession,
): PublicStudentSession {
  return {
    schoolYear: session.schoolYear,
    classCode: session.classCode,
    seatNumber: session.seatNumber,
    gradeLevel: session.gradeLevel,
    expiresAt: session.expiresAt,
  };
}

export function studentSessionCookie(
  config: Pick<AuthConfig, 'secureCookies'>,
  token: string,
): string {
  return serializeCookie(token, SESSION_TTL_SECONDS, config.secureCookies);
}

export function clearStudentSessionCookie(secureCookies: boolean): string {
  return serializeCookie('', 0, secureCookies);
}

export function readStudentSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(';')) {
    const [name, ...parts] = item.trim().split('=');
    if (name === SESSION_COOKIE_NAME) return parts.join('=') || null;
  }
  return null;
}

function serializeCookie(
  token: string,
  maxAge: number,
  secureCookies: boolean,
): string {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
    ...(secureCookies ? ['Secure'] : []),
  ].join('; ');
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    '',
  );
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (character) =>
    character.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}

function isStudentSession(value: unknown): value is StudentSession {
  if (!isVerifiedIdentity(value)) return false;
  const item = value as Partial<StudentSession>;
  return Number.isInteger(item.issuedAt) && Number.isInteger(item.expiresAt);
}
