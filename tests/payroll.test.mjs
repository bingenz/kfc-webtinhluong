import {test} from 'node:test';
import assert from 'node:assert/strict';
import {closePeriod,defaultPayrollMonth,differenceLabel,initialLedger,makeShift,recalculatePeriod,reconciliationStatus,removeShift,reopenPeriod,shiftAmount,shiftStatus,period,periodBreakdown,periodForecast,periodRange,payDate,parseVnd} from '../lib/payroll.ts';
const input=(overrides={})=>({date:'2026-09-09',roleId:'cook',start:'17:30',end:'22:00',note:'',...overrides});
test('Cook đóng ca thường: 4.5h × 25500 + 15000 = 129750',()=>{const d=initialLedger(),s=makeShift(d,input());assert.equal(s.minutes,270);assert.equal(shiftAmount(s,[s]),129750)});
test('Lobby cùng giờ không được phụ cấp Cook',()=>{const d=initialLedger(),s=makeShift(d,input({roleId:'lobby'}));assert.equal(shiftAmount(s,[s]),105750)});
test('Ngày lễ nhân hệ số cả tiền giờ và 15000',()=>{const d=initialLedger();d.holidays.push({id:'h',date:'2026-09-09',name:'Lễ',multiplier:3});const s=makeShift(d,input());assert.equal(shiftAmount(s,[s]),389250)});
test('Có thể tắt nhân hệ số phụ cấp ngày lễ',()=>{const d=initialLedger();d.rules[0].holidayBonus=false;d.holidays.push({id:'h',date:'2026-09-09',name:'Lễ',multiplier:3});const s=makeShift(d,input());assert.equal(shiftAmount(s,[s]),359250)});
test('Phụ cấp tối đa một lần ngày kể cả đổi quy tắc giữa hai lần nhập',()=>{const d=initialLedger();const first=makeShift(d,input());d.rules.push({...d.rules[0],id:'changed',from:'2026-09-01',closingTime:'13:00'});const second=makeShift(d,input({start:'08:00',end:'13:00'}));assert.equal(shiftAmount(first,[first,second])+shiftAmount(second,[first,second]),257250)});
test('Mỗi ca một vị trí, cộng nhiều ca trong một ngày',()=>{const d=initialLedger();d.shifts.push(makeShift(d,input({start:'08:00',end:'13:00'})));d.shifts.push(makeShift(d,input({roleId:'lobby'})));const p=period(d,'2026-09');assert.equal(p.expected,233250);assert.equal(p.minutes,570);assert.equal(p.days,1)});
test('Đổi lương không thay đổi ca cũ; nhập bù dùng mức ngày làm',()=>{const d=initialLedger();const s=makeShift(d,input());d.shifts.push(s);d.rates.push({id:'new',roleId:'cook',from:'2026-10-01',amount:27000});assert.equal(period(d,'2026-09').expected,129750);assert.equal(makeShift(d,input({date:'2026-09-10'})).rate,25500);assert.equal(makeShift(d,input({date:'2026-10-01'})).rate,27000)});
test('Ca liền nhau được phép, ca trùng và qua đêm bị chặn',()=>{const d=initialLedger();d.shifts.push(makeShift(d,input({start:'08:00',end:'13:00'})));assert.doesNotThrow(()=>makeShift(d,input({start:'13:00',end:'17:00'})));assert.throws(()=>makeShift(d,input({start:'12:59',end:'17:00'})),/trùng/);assert.throws(()=>makeShift(d,input({start:'22:00',end:'02:00'})),/cùng ngày/)});
test('Không mặc định lương vị trí chưa cấu hình',()=>{assert.throws(()=>makeShift(initialLedger(),input({roleId:'cash'})),/Chưa có mức lương/)});
test('Sửa ghi chú giữ snapshot; sửa giờ tính lại',()=>{const d=initialLedger(),s=makeShift(d,input());d.shifts.push(s);d.rates.push({id:'backdated',roleId:'cook',from:'2026-09-01',amount:27000});assert.equal(makeShift(d,{...input(),id:s.id,note:'ghi chú'},s).rate,25500);assert.equal(makeShift(d,{...input(),id:s.id,start:'17:00'},s).rate,27000)});
test('Chốt kỳ khóa ca, cố định dự kiến, nhận tháng sau thuộc kỳ trước',()=>{const d=initialLedger();d.shifts.push(makeShift(d,input()));d.settlements.push({month:'2026-09',start:'2026-09-01',end:'2026-09-30',expected:129750,payDate:'2026-10-05',lockedAt:'now'});assert.throws(()=>makeShift(d,input({date:'2026-09-10'})),/đã chốt/);d.payments.push({id:'p',month:'2026-09',date:'2026-10-05',amount:129000,note:''});const p=period(d,'2026-09');assert.equal(p.difference,-750);assert.equal(p.payDate,'2026-10-05');assert.equal(period(d,'2026-10').received,0)});
test('Kỳ chốt tùy chọn đúng tháng nhuận và giao năm',()=>{assert.deepEqual(periodRange('2028-02',0),{start:'2028-02-01',end:'2028-02-29'});assert.deepEqual(periodRange('2026-01',20),{start:'2025-12-21',end:'2026-01-20'});assert.equal(payDate('2026-12',5),'2027-01-05');assert.equal(payDate('2026-01',31),'2026-02-28')});
test('Thay ngày chốt không lặp/mất ngày giữa hai kỳ',()=>{const d=initialLedger();d.rules.push({...d.rules[0],id:'new',from:'2026-10-01',cutoff:20});assert.equal(period(d,'2026-09').end,'2026-09-30');assert.equal(period(d,'2026-10').start,'2026-10-01');assert.equal(period(d,'2026-10').end,'2026-10-20');assert.equal(period(d,'2026-11').start,'2026-10-21')});
test('Làm tròn mỗi ca theo cấu hình, phút không bị cắt',()=>{const d=initialLedger();d.rules[0].rounding=100;d.rules[0].roundMode='down';const s=makeShift(d,input({start:'08:00',end:'08:01'}));assert.equal(s.minutes,1);assert.equal(shiftAmount(s,[s]),400)});
test('Ca chuyển sang đã tích lũy đúng tại giờ kết thúc theo giờ Việt Nam',()=>{const d=initialLedger();const done=makeShift(d,input({date:'2026-09-09',start:'08:00',end:'10:00'}));const later=makeShift(d,input({date:'2026-09-09',start:'11:00',end:'13:00'}));d.shifts.push(done,later);const before=periodForecast(d,'2026-09',new Date('2026-09-09T02:59:59.000Z'));const exact=periodForecast(d,'2026-09',new Date('2026-09-09T03:00:00.000Z'));assert.equal(before.earnedWages,0);assert.equal(before.earnedMinutes,0);assert.equal(exact.earnedWages,shiftAmount(done,d.shifts));assert.equal(exact.earnedMinutes,120);assert.equal(exact.forecastExpected,period(d,'2026-09').expected)});
test('Parser VND giữ nguyên mọi số nguyên và dấu phân tách',()=>{assert.equal(parseVnd('25500'),25500);assert.equal(parseVnd('23.500'),23500);assert.equal(parseVnd('25,500'),25500);assert.throws(()=>parseVnd('25.50'),/hợp lệ/)});
test('Kỳ lương xác nhận dùng snapshot và yêu cầu đối soát lại khi dữ liệu đổi',()=>{
  const d=initialLedger();d.shifts.push(makeShift(d,input()));
  d.payments.push({id:'p1',month:'2026-09',date:'2026-10-05',amount:129750,note:'Đợt 1'});
  const summary=period(d,'2026-09');
  assert.equal(reconciliationStatus(d,'2026-09'),'reviewing');
  d.reconciliations.push({month:'2026-09',expected:summary.expected,received:summary.received,difference:summary.difference,note:'Khớp',confirmedAt:'2026-10-05T01:00:00.000Z'});
  assert.equal(reconciliationStatus(d,'2026-09'),'matched');
  d.payments.push({id:'p2',month:'2026-09',date:'2026-10-06',amount:1,note:'Điều chỉnh'});
  assert.equal(reconciliationStatus(d,'2026-09'),'needs-review');
});
test('Kỳ lương mặc định chọn kỳ gần nhất đã đến ngày trả lương',()=>{
  const d=initialLedger();
  assert.equal(defaultPayrollMonth(d,new Date('2026-10-03T12:00:00.000Z')),'2026-09');
  assert.equal(defaultPayrollMonth(d,new Date('2026-11-05T12:00:00.000Z')),'2026-10');
});


test('Trạng thái ca phân biệt sắp tới, đang làm và đã xong theo giờ Việt Nam',()=>{
  const d=initialLedger();const s=makeShift(d,input({date:'2026-09-09',start:'08:00',end:'10:00'}));
  assert.equal(shiftStatus(s,new Date('2026-09-09T00:59:59.000Z')),'upcoming');
  assert.equal(shiftStatus(s,new Date('2026-09-09T01:00:00.000Z')),'in_progress');
  assert.equal(shiftStatus(s,new Date('2026-09-09T03:00:00.000Z')),'completed');
});

test('Chốt kỳ, xóa ca bị guard ở business logic và mở lại cho phép sửa',()=>{
  let d=initialLedger();const s=makeShift(d,input());d.shifts.push(s);
  d=closePeriod(d,'2026-09','2026-09-30T17:00:00.000Z');
  assert.ok(d.settlements.some(x=>x.month==='2026-09'));
  assert.throws(()=>removeShift(d,s.id),/chốt/);
  assert.throws(()=>makeShift(d,{...input(),id:s.id,note:'edit'},s),/đã chốt/);
  d=reopenPeriod(d,'2026-09');
  assert.equal(d.settlements.some(x=>x.month==='2026-09'),false);
  assert.doesNotThrow(()=>removeShift(d,s.id));
});

test('Tính lại kỳ chỉ khi mở và không thay snapshot ca lịch sử',()=>{
  let d=initialLedger();const s=makeShift(d,input());d.shifts.push(s);d.rates.push({id:'new',roleId:'cook',from:'2026-09-01',amount:99999});
  const before=d.shifts[0].rate;d=recalculatePeriod(d,'2026-09');assert.equal(d.shifts[0].rate,before);
  d=closePeriod(d,'2026-09');assert.throws(()=>recalculatePeriod(d,'2026-09'),/đã chốt/);
});

test('Đã tích lũy không cộng adjustment chưa có effective date; dự kiến vẫn cộng',()=>{
  const d=initialLedger();const s=makeShift(d,input({date:'2026-09-09',start:'08:00',end:'10:00'}));d.shifts.push(s);d.adjustments.push({id:'a',month:'2026-09',amount:25000,note:'Thưởng kỳ'});
  const f=periodForecast(d,'2026-09',new Date('2026-09-09T03:00:00.000Z'));
  assert.equal(f.earnedExpected,f.earnedWages);assert.equal(f.forecastExpected,period(d,'2026-09').expected);
});

test('Breakdown tiền khớp tổng dự kiến và reconciliation dùng Thiếu/Dư/Khớp',()=>{
  const d=initialLedger();d.shifts.push(makeShift(d,input()));d.adjustments.push({id:'a',month:'2026-09',amount:1000,note:''});
  const b=periodBreakdown(d,'2026-09');assert.equal(b.hourly+b.closing+b.holiday+b.adjustment,b.expected);
  assert.equal(differenceLabel(-25000),'Thiếu 25.000 ₫');assert.equal(differenceLabel(25000),'Dư 25.000 ₫');assert.equal(differenceLabel(0),'Khớp hoàn toàn');
});
