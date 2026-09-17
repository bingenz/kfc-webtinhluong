import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backupKey,hasUserData,mergeLedgers,readDeviceRaw} from '../lib/data-lifecycle.ts';
import {initialLedger,makeShift} from '../lib/payroll.ts';

test('corrupted localStorage is reported without destroying raw data',()=>{
  const raw='{not valid json';
  const result=readDeviceRaw(raw);
  assert.equal(result.ok,false);
  assert.equal(result.raw,raw);
  assert.match(result.error,/đọc|JSON|dữ liệu/i);
});

test('empty device resolves to initial ledger and real shifts count as user data',()=>{
  const empty=readDeviceRaw(null);
  assert.equal(empty.ok,true);
  assert.equal(hasUserData(empty.ledger),false);
  empty.ledger.shifts.push(makeShift(empty.ledger,{date:'2026-09-09',roleId:'cook',start:'08:00',end:'13:00',note:''}));
  assert.equal(hasUserData(empty.ledger),true);
});

test('merge adds distinct local/cloud records and detects same-id conflict',()=>{
  const device=initialLedger(), cloud=initialLedger();
  device.shifts.push(makeShift(device,{id:'local-shift',date:'2026-09-09',roleId:'cook',start:'08:00',end:'13:00',note:'local'}));
  cloud.shifts.push(makeShift(cloud,{id:'cloud-shift',date:'2026-09-10',roleId:'cook',start:'08:00',end:'13:00',note:'cloud'}));
  const merged=mergeLedgers(device,cloud);
  assert.deepEqual(merged.shifts.map(x=>x.id).sort(),['cloud-shift','local-shift']);
  const conflict=structuredClone(device);
  conflict.shifts[0]={...conflict.shifts[0],note:'different'};
  assert.throws(()=>mergeLedgers(device,conflict),/cùng mã.*nội dung khác/);
});

test('backup keys are namespaced and timestamp-safe',()=>{
  assert.equal(backupKey('2026-09-16T12:34:56.000Z'),'ca-lam-backup-v1:2026-09-16T12-34-56.000Z');
});
