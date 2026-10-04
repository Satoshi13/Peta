import test from 'node:test';
import assert from 'node:assert/strict';
import {bookDateKey,bookMonthKey,newestBookEntries,calendarTilt,calendarMonth} from '../src/ui-math.js';
const date = (year,month,day) => new Date(year,month-1,day,12);
const entry = (id,day,createdAt='2026-10-01T10:00:00Z') => ({id,date:day,createdAt,no:1});

test('calendar groups by the existing local date and puts latest creation on top', () => {
  const day=date(2026,10,2),entries=[entry('a',day),entry('b',day,'2026-10-01T11:00:00Z'),entry('c',date(2026,10,3)),entry('a',day)];
  const month=calendarMonth(entries,bookMonthKey(day),date(2026,10,4));
  assert.deepEqual(month.cells[1].entries.map(e=>e.id),['b','a']);
  assert.equal(month.daysStuck,2);assert.equal(month.petas,3);
  assert.equal(bookDateKey(day),'2026-10-02');
  assert.equal(month.cells[0].state,'past');assert.equal(month.cells[3].state,'today');assert.equal(month.cells[4].state,'future');
  assert.deepEqual(newestBookEntries(entries).map(e=>e.id),['c','b','a','a']);
});

test('weekday offsets respect Sunday or Monday starts, leap February and 31-day months', () => {
  const leap=date(2024,2,1);
  assert.equal(calendarMonth([],bookMonthKey(leap),date(2024,3,1),0).days,29);
  assert.equal(calendarMonth([],bookMonthKey(leap),date(2024,3,1),0).offset,4);
  assert.equal(calendarMonth([],bookMonthKey(leap),date(2024,3,1),1).offset,3);
  assert.equal(calendarMonth([],bookMonthKey(date(2025,2,1)),date(2025,3,1)).days,28);
  assert.equal(calendarMonth([],bookMonthKey(date(2026,10,1)),date(2026,10,4)).days,31);
  assert.equal(calendarMonth([],bookMonthKey(date(2026,11,1)),date(2026,11,4)).offset,0);
});

test('COMPLETE requires every day, and the current month must reach its last day', () => {
  const entries=Array.from({length:30},(_,i)=>entry(String(i),date(2026,9,i+1))),key=bookMonthKey(entries[0].date);
  assert.equal(calendarMonth(entries,key,date(2026,10,4)).complete,true);
  assert.equal(calendarMonth(entries.slice(1),key,date(2026,10,4)).complete,false);
  assert.equal(calendarMonth(entries,key,date(2026,9,29)).complete,false);
  assert.equal(calendarMonth(entries,key,date(2026,9,30)).complete,true);
  assert.equal(calendarMonth(entries,key,date(2026,8,30)).complete,false);
  assert.equal(calendarMonth([],key,date(2026,10,4)).complete,false);
});

test('date-derived tilt is stable, bounded, and does not mutate inputs', () => {
  for(let day=1;day<=31;day++) {
    const d=date(2026,10,day),time=d.getTime(),tilt=calendarTilt(d);
    assert.equal(tilt,calendarTilt(new Date(time)));assert.ok(tilt>=-6&&tilt<=6);assert.equal(d.getTime(),time);
  }
});
