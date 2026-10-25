import assert from 'node:assert/strict';
import test from 'node:test';

import { fromSchoolLocal, toSchoolLocal } from '../lib/school-time.ts';
import { parseSchoolClasses, getSchoolSettings } from '../lib/school-settings.ts';

void test('school local time round-trips in the configured time zone', () => {
  const date = fromSchoolLocal('2026-10-25T08:30');
  assert.equal(date?.toISOString(), '2026-10-25T00:30:00.000Z');
  assert.equal(toSchoolLocal(date!), '2026-10-25T08:30');
  assert.equal(fromSchoolLocal('2026-02-30T08:00'), null);
});

void test('SCHOOL_CLASSES and SCHOOL_TIMEZONE override school.config.ts', () => {
  assert.deepEqual(parseSchoolClasses('701:7，702：7, 1001:10').classes,
    [{ code: '701', grade: 7 }, { code: '702', grade: 7 }, { code: '1001', grade: 10 }]);
  assert.match(parseSchoolClasses('801-8').error ?? '', /801-8/);
  assert.match(parseSchoolClasses('801:8,801:8').error ?? '', /重複/);
  const settings = getSchoolSettings({ SCHOOL_NAME: '測試國中', SCHOOL_CLASSES: '701:7', SCHOOL_TIMEZONE: 'Asia/Tokyo' });
  assert.equal(settings.schoolName, '測試國中');
  assert.deepEqual(settings.classes, [{ code: '701', grade: 7 }]);
  assert.equal(settings.timeZone, 'Asia/Tokyo');
  assert.equal(fromSchoolLocal('2026-10-25T09:30', settings.timeZone)?.toISOString(), '2026-10-25T00:30:00.000Z');
  assert.equal(getSchoolSettings({ SCHOOL_TIMEZONE: 'Mars/Base' }).errors.length, 1);
  assert.equal(getSchoolSettings({}).classes.length, 4);
});
