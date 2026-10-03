import test from 'node:test';
import assert from 'node:assert/strict';
import {nextLocalMidnight, envelopeClock} from '../src/ui-math.js';

test('countdown uses the next real local midnight, including fractional seconds and rollover', () => {
  const now = new Date(2026,9,4,23,59,59,500);
  const deadline = nextLocalMidnight(now);
  assert.equal(new Date(deadline).getDate(),5);
  assert.equal(envelopeClock(now,deadline).text,'00:00:01');
  assert.equal(envelopeClock(deadline,deadline).seconds,0);
  assert.equal(envelopeClock(deadline+1000,deadline).seconds,0);
  assert.equal(envelopeClock(new Date(2026,9,4,0)).text,'24:00:00');
  assert.equal(envelopeClock(new Date(2026,9,4,10,19,20)).label,'Next envelope in 13 hours 40 minutes');
});

test('local midnight follows DST rather than a fixed 24-hour offset', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ='America/New_York';
    assert.equal(envelopeClock(new Date(2026,2,8,0)).text,'23:00:00');
    assert.equal(envelopeClock(new Date(2026,10,1,0)).text,'25:00:00');
    assert.equal(new Date(nextLocalMidnight(new Date(2026,2,8,1,59,59))).getHours(),0);
    assert.equal(new Date(nextLocalMidnight(new Date(2026,10,1,1,59,59))).getDate(),2);
  } finally { if(previous===undefined) delete process.env.TZ; else process.env.TZ=previous; }
});
