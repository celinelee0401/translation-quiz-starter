import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRoster } from '../lib/server/roster.ts';

void test('roster parsing accepts headers, separators and generates missing PINs', () => {
  const rows = parseRoster('班級,座號,PIN\n801,1,135790\n802\t2\n', 'pin');
  assert.deepEqual(rows[0], { classCode: '801', seatNumber: 1, pin: '135790' });
  assert.equal(rows[1].classCode, '802');
  assert.match(rows[1].pin ?? '', /^\d{6}$/);
});

void test('seat mode never stores a PIN, and bad rows name the line', () => {
  assert.deepEqual(parseRoster('801,1,135790', 'seat'), [{ classCode: '801', seatNumber: 1, pin: null }]);
  assert.throws(() => parseRoster('801,1\n999,2', 'pin'), /第 2 行.*SCHOOL_CLASSES/);
  assert.throws(() => parseRoster('801,1\n801,1', 'pin'), /重複/);
  assert.throws(() => parseRoster('801,1,12', 'pin'), /六位數字/);
});
