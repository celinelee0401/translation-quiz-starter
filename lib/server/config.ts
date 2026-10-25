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
  return process.env.STUDENT_LOGIN_MODE === 'seat' ? 'seat' : 'pin';
}

export function getAuthConfig(): AuthConfig | null {
  const schoolYear = process.env.SCHOOL_YEAR;
  const sessionSecret = process.env.TRANSLATION_SESSION_SECRET;

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
  const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL);
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
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
