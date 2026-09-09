import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {initialLedger} from '../lib/payroll.ts';

test('PostgreSQL: own writes, explicit shared reads, revocation, CAS, no anonymous access',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
 await db.exec(await readFile(new URL('../supabase/migrations/202609090001_payroll.sql',import.meta.url),'utf8'));
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';
 await db.query('insert into auth.users values ($1),($2),($3)',[a,b,c]);
 const asUser=async(id)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated')};
 await asUser(a);await db.query('insert into public.profiles values($1,$2,$3)',[a,'owner_a','Người A']);
 const doc=initialLedger();
 let result=await db.query('select public.save_ledger($1::jsonb,0) as revision',[JSON.stringify(doc)]);assert.equal(Number(result.rows[0].revision),1);
 await assert.rejects(db.query('select public.save_ledger($1::jsonb,0)',[JSON.stringify(doc)]),/REVISION_CONFLICT/);
 assert.equal((await db.query('select * from public.ledgers')).rows.length,1);
 await asUser(b);await db.query('insert into public.profiles values($1,$2,$3)',[b,'viewer_b','Người B']);
 assert.equal((await db.query('select * from public.ledgers')).rows.length,0);
 assert.equal((await db.query("select * from public.search_profiles('owner')")).rows.length,1);
 await assert.rejects(db.query('insert into public.ledger_shares(owner_id,viewer_id) values($1,$2)',[a,b]),/row-level security/);
 await assert.rejects(db.query('update public.ledgers set payload=$1::jsonb where owner_id=$2',[JSON.stringify(doc),a]),/permission denied/);
 await asUser(a);await db.query('insert into public.ledger_shares(owner_id,viewer_id) values($1,$2)',[a,b]);
 await asUser(b);assert.equal((await db.query('select * from public.ledgers')).rows.length,1);
 await db.query('select public.save_ledger($1::jsonb,0)',[JSON.stringify(doc)]);
 assert.equal((await db.query('select * from public.ledgers where owner_id=$1',[a])).rows[0].revision,1);
 await asUser(c);await db.query('insert into public.profiles values($1,$2,$3)',[c,'third_c','Người C']);assert.equal((await db.query('select * from public.ledgers')).rows.length,0);
 await asUser(a);await db.query('delete from public.ledger_shares where owner_id=$1 and viewer_id=$2',[a,b]);
 await asUser(b);assert.equal((await db.query('select * from public.ledgers where owner_id=$1',[a])).rows.length,0);
 await asUser(a);result=await db.query('select public.save_ledger($1::jsonb,1) as revision',[JSON.stringify(doc)]);assert.equal(Number(result.rows[0].revision),2);
 await assert.rejects(db.query('select public.save_ledger($1::jsonb,1)',[JSON.stringify(doc)]),/REVISION_CONFLICT/);
 await db.exec("reset role; set role anon; select set_config('request.jwt.claim.sub','',false)");
 await assert.rejects(db.query('select * from public.profiles'),/permission denied/);
 await assert.rejects(db.query('select * from public.ledgers'),/permission denied/);
 await assert.rejects(db.query('select public.save_ledger($1::jsonb,0)',[JSON.stringify(doc)]),/permission denied/);
 }finally{await db.close()}
});
