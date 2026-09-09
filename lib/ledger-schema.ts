import { z } from 'zod';
import type { Ledger } from './payroll';
const id = z.string().min(1).max(100);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const amount = z.number().finite().min(0).max(1_000_000_000);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const roundMode = z.enum(['nearest','down','up']);
const ledgerSchema = z.object({
 schemaVersion: z.literal(1),
 roles: z.array(z.object({id,name:z.string().min(1).max(80),color,active:z.boolean()})),
 rates: z.array(z.object({id,roleId:id,from:date,amount})),
 rules: z.array(z.object({id,from:date,closingRole:id,closingTime:time,closingAmount:amount,holidayBonus:z.boolean(),cutoff:z.number().int().min(0).max(31),payday:z.number().int().min(1).max(31),rounding:z.number().positive().max(1_000_000),roundMode})).min(1),
 holidays:z.array(z.object({id,date,name:z.string().max(100),multiplier:z.number().min(1).max(10)})),
 shifts:z.array(z.object({id,date,roleId:id,roleName:z.string().max(80),color,start:time,end:time,note:z.string().max(300),minutes:z.number().int().positive().max(1440),rate:amount,rateId:id,ruleId:id,multiplier:z.number().positive().max(10),holiday:z.string().max(100),closing:amount,closingMultiplier:z.number().positive().max(10),rounding:z.number().positive().max(1_000_000),roundMode})),
 adjustments:z.array(z.object({id,month:z.string().regex(/^\d{4}-\d{2}$/),amount:z.number().finite().min(-1_000_000_000).max(1_000_000_000),note:z.string().max(300)})),
 payments:z.array(z.object({id,month:z.string().regex(/^\d{4}-\d{2}$/),date,amount,note:z.string().max(300)})),
 settlements:z.array(z.object({month:z.string().regex(/^\d{4}-\d{2}$/),start:date,end:date,expected:z.number().finite(),payDate:date,lockedAt:z.string()})),
});
export function parseLedger(value:unknown):Ledger {
 const parsed=ledgerSchema.safeParse(value);
 if(!parsed.success)throw new Error('Không đọc được sổ lương vì dữ liệu không hợp lệ. Dữ liệu gốc vẫn được giữ nguyên.');
 return parsed.data;
}
