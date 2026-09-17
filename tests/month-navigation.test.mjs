import {test} from 'node:test';
import assert from 'node:assert/strict';
import {monthAfterShiftSave,moveMonth} from '../lib/month.ts';

test('month navigation handles previous/next across year boundaries',()=>{
  assert.equal(moveMonth('2026-01',-1),'2025-12');
  assert.equal(moveMonth('2026-12',1),'2027-01');
  assert.equal(moveMonth('2026-09',-1),'2026-08');
  assert.equal(moveMonth('2026-09',1),'2026-10');
});

test('editing a historical shift keeps viewed month while new shift may move month',()=>{
  assert.equal(monthAfterShiftSave('2026-05','2026-04-20',true),'2026-05');
  assert.equal(monthAfterShiftSave('2026-05','2026-04-20',false),'2026-04');
});

test('invalid month is rejected',()=>assert.throws(()=>moveMonth('2026-13',1),/không hợp lệ/));
