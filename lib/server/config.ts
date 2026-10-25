export type StudentLoginMode = 'seat' | 'pin';

export type AuthConfig = {
  loginMode: StudentLoginMode;
  schoolYear: string;
  sessionSecret: string;
  secureCookies: boolean;
};

export type DataConfig = AuthConfig & {
  supabaseUrl: string;
  supabaseSecretKey: string;
};

/**
 * STUDENT_LOGIN_MODE:
 * - `pin`（預設）：班級＋座號＋六位數 PIN，適合正式成績。
 * - `seat`：只要班級＋座號，任何人都能冒用別人座號，只適合練習。
 */
export function getStudentLoginMode(): StudentLoginMode {
  return process.env.STUDENT_LOGIN_MODE?.trim().toLowerCase() === 'seat' ? 'seat' : 'pin';
}

/**
 * TRANSLATION_SESSION_SECRET is optional. Without it, login cookies are signed
 * with a key derived from SUPABASE_SECRET_KEY (still server-only), so a new
 * teacher only has to paste the two Supabase values. Rotating either one signs
 * everybody out.
 */
export function getSessionSecret(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.TRANSLATION_SESSION_SECRET?.trim();
  if (explicit) return explicit.length >= 32 ? explicit : null;
  const supabaseKey = env.SUPABASE_SECRET_KEY?.trim();
  return supabaseKey && supabaseKey.length >= 20 ? `translation-session-from-supabase-v1:${supabaseKey}` : null;
}

export function getAuthConfig(): AuthConfig | null {
  const schoolYear = process.env.SCHOOL_YEAR?.trim();
  const sessionSecret = getSessionSecret();

  if (
    !schoolYear ||
    !/^\d{3,4}$/.test(schoolYear) ||
    !sessionSecret ||
    sessionSecret.length < 32
  ) {
    return null;
  }

  return {
    loginMode: getStudentLoginMode(),
    schoolYear,
    sessionSecret,
    secureCookies: process.env.NODE_ENV === 'production',
  };
}

export function getDataConfig(): DataConfig | null {
  const auth = getAuthConfig();
  const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL?.trim());
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!auth || !supabaseUrl || !supabaseSecretKey) return null;
  return { ...auth, supabaseUrl, supabaseSecretKey };
}

function normalizeUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
