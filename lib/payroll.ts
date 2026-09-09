export type Role = { id: string; name: string; color: string; active: boolean };
export type Rate = { id: string; roleId: string; from: string; amount: number };
export type Rule = { id: string; from: string; closingRole: string; closingTime: string; closingAmount: number; holidayBonus: boolean; cutoff: number; payday: number; rounding: number; roundMode: 'nearest'|'down'|'up' };
export type Holiday = { id: string; date: string; name: string; multiplier: number };
export type Shift = { id: string; date: string; roleId: string; roleName: string; color: string; start: string; end: string; note: string; minutes: number; rate: number; rateId: string; ruleId: string; multiplier: number; holiday: string; closing: number; closingMultiplier: number; rounding: number; roundMode: Rule['roundMode'] };
export type Adjustment = { id: string; month: string; amount: number; note: string };
export type Payment = { id: string; month: string; date: string; amount: number; note: string };
export type Settlement = { month: string; start: string; end: string; expected: number; payDate: string; lockedAt: string };
export type Ledger = { schemaVersion: 1; roles: Role[]; rates: Rate[]; rules: Rule[]; holidays: Holiday[]; shifts: Shift[]; adjustments: Adjustment[]; payments: Payment[]; settlements: Settlement[] };
export function uid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
export function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date()); }
export const money = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(n) + ' ₫';
export const hours = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(n / 60);
export const shortDate = (date: string) => date.slice(8,10) + '/' + date.slice(5,7);
export function initialLedger(): Ledger {
  return { schemaVersion:1, roles:[{id:'cook',name:'Cook',color:'#e89728',active:true},{id:'lobby',name:'Lobby',color:'#4e75e8',active:true},{id:'cash',name:'Cash',color:'#a45dc5',active:true}], rates:[{id:'cook-initial',roleId:'cook',from:'2000-01-01',amount:25500},{id:'lobby-initial',roleId:'lobby',from:'2000-01-01',amount:23500}], rules:[{id:'initial',from:'2000-01-01',closingRole:'cook',closingTime:'22:00',closingAmount:15000,holidayBonus:true,cutoff:0,payday:5,rounding:1,roundMode:'nearest'}], holidays:[], shifts:[], adjustments:[], payments:[], settlements:[] };
}
export function applicable<T extends {from:string}>(items:T[], date:string): T|undefined { return items.filter(x=>x.from<=date).sort((a,b)=>b.from.localeCompare(a.from))[0]; }
export function timeMinutes(time:string) { if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Giờ làm không hợp lệ.'); const [h,m]=time.split(':').map(Number); return h*60+m; }
export function validDate(date:string) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date)) && new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date; }
export function rounded(amount:number, step:number, mode:Rule['roundMode']) { const fn = mode==='down'?Math.floor:mode==='up'?Math.ceil:Math.round; return fn((amount + 1e-8)/step)*step; }
export function shiftBase(s:Shift) { return s.minutes*s.rate*Math.round(s.multiplier*1000)/60000; }
export function shiftBonus(s:Shift, all:Shift[]) {
  const eligible=all.filter(x=>x.date===s.date && x.closing>0).sort((a,b)=>a.end.localeCompare(b.end)||a.id.localeCompare(b.id));
  return eligible[0]?.id===s.id?s.closing*s.closingMultiplier:0;
}
export function shiftAmount(s:Shift, all:Shift[]) {
  return rounded(shiftBase(s)+shiftBonus(s,all),s.rounding,s.roundMode);
}
export function lockedDate(d:Ledger,date:string) { return d.settlements.some(x=>date>=x.start&&date<=x.end); }
export function makeShift(d:Ledger, input:{id?:string;date:string;roleId:string;start:string;end:string;note:string}, preserve?:Shift):Shift {
  if(!validDate(input.date)) throw new Error('Ngày làm không hợp lệ.');
  if(lockedDate(d,input.date) || (preserve && lockedDate(d,preserve.date))) throw new Error('Kỳ lương đã chốt. Mở lại kỳ trước khi sửa ca.');
  const start=timeMinutes(input.start),end=timeMinutes(input.end);
  if(end<=start) throw new Error('Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.');
  if(d.shifts.some(x=>x.id!==input.id&&x.date===input.date&&start<timeMinutes(x.end)&&end>timeMinutes(x.start))) throw new Error('Khoảng giờ này trùng với một ca đã nhập.');
  const role=d.roles.find(x=>x.id===input.roleId);
  if(!role) throw new Error('Hãy chọn vị trí làm việc.');
  const rate=applicable(d.rates.filter(x=>x.roleId===role.id),input.date),rule=applicable(d.rules,input.date);
  if(!rate || !rule) throw new Error('Chưa có mức lương hoặc quy tắc áp dụng cho ngày này. Hãy bổ sung ở Cài đặt.');
  const holiday=d.holidays.find(x=>x.date===input.date);
  const keep=preserve && preserve.date===input.date && preserve.roleId===input.roleId && preserve.start===input.start && preserve.end===input.end;
  if(keep) return {...preserve,note:input.note};
  return { ...input,id:input.id||uid(),roleName:role.name,color:role.color,minutes:end-start,rate:rate.amount,rateId:rate.id,ruleId:rule.id,multiplier:holiday?.multiplier||1,holiday:holiday?.name||'',closing:role.id===rule.closingRole&&input.end===rule.closingTime?rule.closingAmount:0,closingMultiplier:rule.holidayBonus?(holiday?.multiplier||1):1,rounding:rule.rounding,roundMode:rule.roundMode };
}
export function periodRange(month:string, cutoff:number) {
  const [y,m]=month.split('-').map(Number);
  const iso=(date:Date)=>date.toISOString().slice(0,10);
  const last=(year:number,mon:number)=>new Date(Date.UTC(year,mon,0)).getUTCDate();
  if(cutoff===0) return {start:month+'-01',end:iso(new Date(Date.UTC(y,m,0)))};
  const end=new Date(Date.UTC(y,m-1,Math.min(cutoff,last(y,m))));
  const prevEnd=new Date(Date.UTC(y,m-2,Math.min(cutoff,last(y,m-1)))); prevEnd.setUTCDate(prevEnd.getUTCDate()+1);
  return {start:iso(prevEnd),end:iso(end)};
}
export function payDate(month:string,day:number) {const [y,m]=month.split('-').map(Number); return new Date(Date.UTC(y,m,Math.min(day,new Date(Date.UTC(y,m+1,0)).getUTCDate()))).toISOString().slice(0,10);}
export function period(d:Ledger,month:string) {
  const rule=applicable(d.rules,month+'-01')||d.rules[0];
  const closed=d.settlements.find(x=>x.month===month);
  const range=closed||periodRange(month,rule.cutoff);
  if(!closed){
    const [y,m]=month.split('-').map(Number);
    const previousMonth=new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7);
    const previousRule=applicable(d.rules,previousMonth+'-01')||d.rules[0];
    const previousClosed=d.settlements.find(x=>x.month===previousMonth);
    const previousEnd=previousClosed?.end||periodRange(previousMonth,previousRule.cutoff).end;
    const start=new Date(previousEnd+'T12:00:00Z');start.setUTCDate(start.getUTCDate()+1);
    range.start=start.toISOString().slice(0,10);
  }
  const shifts=d.shifts.filter(x=>x.date>=range.start&&x.date<=range.end).sort((a,b)=>b.date.localeCompare(a.date)||a.start.localeCompare(b.start));
  const wages=shifts.reduce((s,x)=>s+shiftAmount(x,shifts),0);
  const adjustment=d.adjustments.filter(x=>x.month===month).reduce((s,x)=>s+x.amount,0);
  const expected=closed?.expected??wages+adjustment;
  const payments=d.payments.filter(x=>x.month===month);
  const received=payments.reduce((s,x)=>s+x.amount,0);
  return { ...range,shifts,wages,adjustment,expected,received,payments,difference:received-expected,minutes:shifts.reduce((s,x)=>s+x.minutes,0),days:new Set(shifts.map(x=>x.date)).size,closed,payDate:closed?.payDate||payDate(month,rule.payday),rule };
}
