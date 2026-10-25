import assert from 'node:assert/strict';
import test from 'node:test';

import { startAttempt, submitAttempt } from '../lib/server/attempts.ts';
import type { AuthConfig, DataConfig } from '../lib/server/config.ts';
import { assertSameOrigin, RequestInputError } from '../lib/server/http.ts';
import { parseCredentials } from '../lib/server/auth.ts';
import {
  IdentityClientError,
  validateStudentSessionIdentity,
  verifyStudentLogin,
} from '../lib/server/student-identity.ts';
import {
  createStudentSession,
  SESSION_TTL_SECONDS,
  verifyStudentSession,
} from '../lib/server/session.ts';

const config: AuthConfig = {
  loginMode: 'pin',
  schoolYear: '115',
  sessionSecret: 'session-secret-different-and-thirty-two-chars',
  secureCookies: true,
};

const identity = {
  studentId: 'student-uuid',
  enrollmentId: 'enrollment-uuid',
  schoolYear: '115',
  classCode: '802',
  seatNumber: 30,
  gradeLevel: 8,
  credentialVersion: '2026-09-01T00:00:00.000Z',
};

const dataConfig: DataConfig = {
  ...config,
  supabaseUrl: 'https://database.example',
  supabaseSecretKey: 'sb_secret_server_only',
};

void test('translation session rejects tampering and expires after 45 minutes', async () => {
  const now = new Date('2026-09-04T04:00:00.000Z');
  const { token, session } = await createStudentSession(
    identity,
    config.sessionSecret,
    now,
  );

  assert.equal(session.expiresAt - session.issuedAt, SESSION_TTL_SECONDS);
  assert.equal(
    (await verifyStudentSession(token, config.sessionSecret, now))?.classCode,
    '802',
  );
  assert.equal(
    await verifyStudentSession(`${token}x`, config.sessionSecret, now),
    null,
  );
  assert.equal(
    await verifyStudentSession(
      token,
      config.sessionSecret,
      new Date(now.getTime() + (SESSION_TTL_SECONDS + 1) * 1000),
    ),
    null,
  );
});

function rpcFetcher(body: unknown, capture?: (url: string, body: Record<string, unknown>) => void) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    capture?.(String(input), JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

void test('roster login must match the class and seat requested by the server', async () => {
  await assert.rejects(
    verifyStudentLogin(dataConfig, { classCode: '802', seatNumber: 30, pin: '123456' },
      rpcFetcher({ status: 'ok', identity: { ...identity, classCode: '801' } })),
    (error: unknown) => error instanceof IdentityClientError && error.code === 'IDENTITY_MISMATCH',
  );
  const ok = await verifyStudentLogin(dataConfig, { classCode: '802', seatNumber: 30, pin: '123456' },
    rpcFetcher({ status: 'ok', identity }));
  assert.equal(ok.enrollmentId, identity.enrollmentId);
});

void test('login failures do not reveal which credential was wrong, and lockouts are reported', async () => {
  await assert.rejects(
    verifyStudentLogin(dataConfig, { classCode: '802', seatNumber: 30, pin: '000000' }, rpcFetcher({ status: 'failed' })),
    (error: unknown) => error instanceof IdentityClientError && error.code === 'AUTH_FAILED' &&
      error.message === '班級、座號或 PIN 不正確。',
  );
  await assert.rejects(
    verifyStudentLogin(dataConfig, { classCode: '802', seatNumber: 30, pin: '000000' }, rpcFetcher({ status: 'locked' })),
    (error: unknown) => error instanceof IdentityClientError && error.code === 'AUTH_LOCKED' && error.status === 429,
  );
});

void test('pin mode sends the PIN to the database check; seat mode never does', async () => {
  let sent: Record<string, unknown> = {};
  await verifyStudentLogin(dataConfig, { classCode: '802', seatNumber: 30, pin: '123456' },
    rpcFetcher({ status: 'ok', identity }, (_url, body) => { sent = body; }));
  assert.equal(sent.p_require_pin, true);
  assert.equal(sent.p_pin, '123456');

  const seatConfig: DataConfig = { ...dataConfig, loginMode: 'seat' };
  await verifyStudentLogin(seatConfig, parseCredentials({ classCode: '802', seatNumber: 30, pin: '123456' }, seatConfig),
    rpcFetcher({ status: 'ok', identity }, (_url, body) => { sent = body; }));
  assert.equal(sent.p_require_pin, false);
  assert.equal(sent.p_pin, null);
  assert.throws(() => parseCredentials({ classCode: '802', seatNumber: 30, pin: '12' }, dataConfig), /六位數字/);
  assert.throws(() => parseCredentials({ classCode: '999', seatNumber: 30, pin: '123456' }, dataConfig), /尚未開放/);
});

void test('active translation sessions are revalidated against the roster without a PIN', async () => {
  let sent: Record<string, unknown> = {};
  let url = '';
  const result = await validateStudentSessionIdentity(dataConfig, identity,
    rpcFetcher(identity, (target, body) => { url = target; sent = body; }));
  assert.equal(result.credentialVersion, identity.credentialVersion);
  assert.match(url, /rpc\/resolve_student_session$/);
  assert.equal(sent.p_enrollment_id, identity.enrollmentId);
  assert.equal('p_pin' in sent, false);
  await assert.rejects(validateStudentSessionIdentity(dataConfig, identity, rpcFetcher(null)),
    (error: unknown) => error instanceof IdentityClientError && error.status === 401);
});

void test('attempt start sends only verified session identity to the server RPC', async () => {
  let requestBody = '';
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = typeof init?.body === 'string' ? init.body : '';
    return new Response(
      JSON.stringify({
        attemptId: '11111111-1111-4111-8111-111111111111',
        quizId: 'G8-DEMO-SCHOOL-DAY-01',
        quizVersion: 1,
        serverStartTime: '2026-09-04T05:00:00.000Z',
        status: 'in-progress',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const session = (await createStudentSession(identity, config.sessionSecret))
    .session;
  const result = await startAttempt(
    dataConfig,
    session,
    'G8-DEMO-SCHOOL-DAY-01',
    1,
    fetcher as typeof fetch,
  );

  assert.equal(result.status, 'in-progress');
  assert.equal(JSON.parse(requestBody).p_enrollment_id, identity.enrollmentId);
  assert.equal(requestBody.includes('123456'), false);
  assert.equal(requestBody.includes(dataConfig.supabaseSecretKey), false);
});

void test('attempt submit preserves raw answers and surfaces storage failures safely', async () => {
  let requestBody = '';
  const successfulFetcher = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    requestBody = typeof init?.body === 'string' ? init.body : '';
    return new Response(
      JSON.stringify({
        attemptId: '11111111-1111-4111-8111-111111111111',
        serverSubmitTime: '2026-09-04T05:10:00.000Z',
        status: 'submitted',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const session = (await createStudentSession(identity, config.sessionSecret))
    .session;
  const answers = [
    { questionId: 'Q1', rawAnswer: '  Mia, what time did you get to school this morning?  ' },
  ];
  await submitAttempt(
    dataConfig,
    session,
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    answers,
    successfulFetcher as typeof fetch,
  );

  assert.equal(
    JSON.parse(requestBody).p_answers[0].rawAnswer,
    answers[0].rawAnswer,
  );

  const failingFetcher = async () => new Response('{}', { status: 500 });
  await assert.rejects(
    submitAttempt(
      dataConfig,
      session,
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      answers,
      failingFetcher as typeof fetch,
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('尚未儲存') &&
      !error.message.includes('Supabase'),
  );
});

void test('state-changing browser requests reject a foreign origin', () => {
  assert.throws(
    () =>
      assertSameOrigin(
        new Request('https://quiz.example/api/attempts/start', {
          method: 'POST',
          headers: { origin: 'https://attacker.example' },
        }),
      ),
    (error: unknown) =>
      error instanceof RequestInputError && error.status === 403,
  );
});
