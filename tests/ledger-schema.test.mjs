import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLedger} from '../lib/ledger-schema.ts';
import {initialLedger,makeShift,shiftBonus,shiftAmount} from '../lib/payroll.ts';

test('Sổ v1 hiện có giữ nguyên khi kiểm tra dữ liệu',()=>{
  const d=initialLedger();
  d.shifts.push(makeShift(d,{date:'2026-09-09',roleId:'cook',start:'17:30',end:'22:00',note:''}));
  assert.deepEqual(parseLedger(JSON.parse(JSON.stringify(d))),d);
});
test('Sổ đã lưu trước khi có xác nhận đối soát vẫn đọc được',()=>{
  const legacy=initialLedger();delete legacy.reconciliations;
  const parsed=parseLedger(legacy);
  assert.deepEqual(parsed.reconciliations,[]);
});
test('Sổ thiếu cấu hình hoặc có số tiền sai bị từ chối, không sửa dữ liệu gốc',()=>{
  const d=initialLedger();d.rules=[];const before=JSON.stringify(d);
  assert.throws(()=>parseLedger(d),/Dữ liệu gốc vẫn được giữ nguyên/);
  assert.equal(JSON.stringify(d),before);
  const invalid=initialLedger();invalid.rates[0].amount='25500';
  assert.throws(()=>parseLedger(invalid),/không hợp lệ/);
});
test('Báo cáo phụ cấp chỉ cộng một lần và không gộp sai phần làm tròn',()=>{
  const d=initialLedger();d.rules[0].rounding=1000;
  const s=makeShift(d,{date:'2026-09-09',roleId:'cook',start:'17:30',end:'22:00',note:''});
  assert.equal(shiftBonus(s,[s]),15000);
  assert.equal(shiftAmount(s,[s]),130000);
  const another={...s,id:'other',start:'08:00',end:'13:00',minutes:300};
  assert.equal([s,another].reduce((sum,x)=>sum+shiftBonus(x,[s,another]),0),15000);
});
