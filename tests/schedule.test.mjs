import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialLedger,makeShift} from '../lib/payroll.ts';
import {commonFreeByDate,expandStudySchedules,formatMinutes,studyConflictCount,validateStudySchedule} from '../lib/schedule.ts';

test('lịch tuần mở rộng đúng ngày và áp dụng ngoại lệ hủy/đổi giờ',()=>{
  const schedule={
    id:'series',kind:'weekly',startDate:'2026-09-01',endDate:'2026-09-30',weekdays:[1,3],start:'08:00',end:'10:00',
    exceptions:[{date:'2026-09-07',action:'cancel'},{date:'2026-09-09',action:'replace',start:'13:00',end:'15:00'}],
  };
  const occurrences=expandStudySchedules([schedule],'2026-09');
  assert.equal(occurrences.some(x=>x.date==='2026-09-07'),false);
  assert.deepEqual(occurrences.find(x=>x.date==='2026-09-09'),{scheduleId:'series',date:'2026-09-09',start:'13:00',end:'15:00',recurring:true,exception:true});
  assert.equal(occurrences.length,8);
});

test('lịch học qua đêm, khoảng ngày ngược và chuỗi không chọn thứ bị chặn',()=>{
  assert.throws(()=>validateStudySchedule({id:'x',kind:'single',date:'2026-09-01',start:'22:00',end:'02:00'}),/sau giờ bắt đầu/);
  assert.throws(()=>validateStudySchedule({id:'x',kind:'weekly',startDate:'2026-09-30',endDate:'2026-09-01',weekdays:[1],start:'08:00',end:'10:00',exceptions:[]}),/Khoảng ngày/);
  assert.throws(()=>validateStudySchedule({id:'x',kind:'weekly',startDate:'2026-09-01',endDate:'2026-09-30',weekdays:[],start:'08:00',end:'10:00',exceptions:[]}),/ít nhất một thứ/);
});

test('xung đột học với ca làm và lịch học khác chỉ được đếm để cảnh báo',()=>{
  const ledger=initialLedger();
  ledger.shifts.push(makeShift(ledger,{date:'2026-09-07',roleId:'cook',start:'09:00',end:'12:00',note:''}));
  ledger.studySchedules.push({id:'existing',kind:'single',date:'2026-09-14',start:'09:30',end:'11:00'});
  const candidate={id:'candidate',kind:'weekly',startDate:'2026-09-01',endDate:'2026-09-30',weekdays:[1],start:'08:00',end:'10:00',exceptions:[]};
  assert.equal(studyConflictCount(candidate,ledger.studySchedules,ledger.shifts),2);
});

test('cùng rảnh dùng cả lịch làm và học của nhóm trong 07:00–23:00',()=>{
  const first=initialLedger(),second=initialLedger();
  first.shifts.push(makeShift(first,{date:'2026-09-10',roleId:'cook',start:'08:00',end:'10:00',note:''}));
  second.shifts.push(makeShift(second,{date:'2026-09-10',roleId:'cook',start:'09:00',end:'11:00',note:''}));
  first.studySchedules.push({id:'a',kind:'single',date:'2026-09-10',start:'12:00',end:'13:00'});
  second.studySchedules.push({id:'b',kind:'single',date:'2026-09-10',start:'14:00',end:'15:00'});
  const slots=commonFreeByDate([first,second],'2026-09')['2026-09-10'];
  assert.deepEqual(slots.map(x=>`${formatMinutes(x.start)}-${formatMinutes(x.end)}`),['07:00-08:00','11:00-12:00','13:00-14:00','15:00-23:00']);
});

test('khoảng đúng 60 phút được giữ, 59 phút và giờ ngoài biên bị bỏ',()=>{
  const ledger=initialLedger();
  ledger.shifts.push(makeShift(ledger,{date:'2026-09-10',roleId:'cook',start:'08:00',end:'22:01',note:''}));
  const slots=commonFreeByDate([ledger],'2026-09')['2026-09-10'];
  assert.deepEqual(slots,[{start:420,end:480}]);
});
