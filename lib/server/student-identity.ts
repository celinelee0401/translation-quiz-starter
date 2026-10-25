import { classCodePattern, gradeLevelForClass } from '../public-quiz-data.ts';
import type { DataConfig } from './config.ts';
import { supabaseRpc, SupabaseRequestError } from './supabase.ts';

export type StudentCredentials = {
  classCode: string;
  seatNumber: number;
  pin: string | null;
};

export type VerifiedStudentIdentity = {
  studentId: string;
  enrollmentId: string;
  schoolYear: string;
  classCode: string;
  seatNumber: number;
  gradeLevel: number;
  credentialVersion: string;
};

type LoginResult =
  | { status: 'ok'; identity: unknown }
  | { status: 'failed' }
  | { status: 'locked'; lockedUntil?: string };

export class IdentityClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// The roster lives in this app's own Supabase project (students/enrollments).
// In `pin` mode the database compares the PIN with its bcrypt hash and locks a
// seat for 10 minutes after 5 wrong tries; the PIN never leaves the server.
export async function verifyStudentLogin(
  config: DataConfig,
  credentials: StudentCredentials,
  fetcher: typeof fetch = fetch,
): Promise<VerifiedStudentIdentity> {
  const requirePin = config.loginMode === 'pin';
  let result: LoginResult;
  try {
    result = await supabaseRpc<LoginResult>(config, 'verify_student_login', {
      p_school_year: config.schoolYear,
      p_class_code: credentials.classCode,
      p_seat_number: credentials.seatNumber,
      p_pin: requirePin ? credentials.pin : null,
      p_require_pin: requirePin,
    }, fetcher);
  } catch (error) {
    throw unavailable(error);
  }

  if (result?.status === 'locked') {
    throw new IdentityClientError('AUTH_LOCKED', '輸入錯誤太多次，請 10 分鐘後再試，或請老師重設 PIN。', 429);
  }
  if (result?.status !== 'ok') {
    throw new IdentityClientError(
      'AUTH_FAILED',
      requirePin ? '班級、座號或 PIN 不正確。' : '名冊中找不到這個班級與座號，請找老師確認。',
      401,
    );
  }
  const identity = result.identity;
  if (
    !isVerifiedIdentity(identity) ||
    identity.schoolYear !== config.schoolYear ||
    identity.classCode !== credentials.classCode ||
    identity.seatNumber !== credentials.seatNumber ||
    identity.gradeLevel !== gradeLevelForClass(identity.classCode)
  ) {
    throw new IdentityClientError('IDENTITY_MISMATCH', '名冊資料與學校設定不一致，請老師確認班級年級。', 502);
  }
  return identity;
}

export async function validateStudentSessionIdentity(
  config: DataConfig,
  identity: VerifiedStudentIdentity,
  fetcher: typeof fetch = fetch,
): Promise<VerifiedStudentIdentity> {
  let current: unknown;
  try {
    current = await supabaseRpc<unknown>(config, 'resolve_student_session', {
      p_enrollment_id: identity.enrollmentId,
      p_credential_version: identity.credentialVersion,
    }, fetcher);
  } catch (error) {
    throw unavailable(error);
  }
  if (!isVerifiedIdentity(current) ||
      current.studentId !== identity.studentId ||
      current.enrollmentId !== identity.enrollmentId ||
      current.schoolYear !== identity.schoolYear ||
      current.classCode !== identity.classCode ||
      current.seatNumber !== identity.seatNumber ||
      current.gradeLevel !== identity.gradeLevel ||
      Date.parse(current.credentialVersion) !== Date.parse(identity.credentialVersion)) {
    throw new IdentityClientError('IDENTITY_MISMATCH', '登入狀態已失效，請重新驗證。', 401);
  }
  return identity;
}

function unavailable(error: unknown): IdentityClientError {
  return new IdentityClientError(
    'IDENTITY_UNAVAILABLE',
    error instanceof SupabaseRequestError && error.status === 404
      ? '學生名冊尚未建立，請老師完成資料庫設定。'
      : '身分驗證暫時無法完成，請稍後再試。',
    503,
  );
}

export function isVerifiedIdentity(value: unknown): value is VerifiedStudentIdentity {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<VerifiedStudentIdentity>;
  return Boolean(
    typeof item.studentId === 'string' &&
    item.studentId &&
    typeof item.enrollmentId === 'string' &&
    item.enrollmentId &&
    typeof item.schoolYear === 'string' &&
    /^\d{3,4}$/.test(item.schoolYear) &&
    typeof item.classCode === 'string' &&
    classCodePattern.test(item.classCode) &&
    Number.isInteger(item.seatNumber) &&
    Number(item.seatNumber) >= 1 &&
    Number.isInteger(item.gradeLevel) &&
    Number(item.gradeLevel) >= 1 &&
    Number(item.gradeLevel) <= 12 &&
    typeof item.credentialVersion === 'string' &&
    Number.isFinite(Date.parse(item.credentialVersion))
  );
}
