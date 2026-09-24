import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { initialLedger, makeShift } from "../lib/payroll.ts";

const migrations = [
  "202609090001_payroll.sql",
  "202609140001_ca_lam_2_social.sql",
  "202609150001_ca_lam_3_notifications.sql",
  "202609160001_shifttrack_sharing_cleanup.sql",
  "202609240001_study_schedules.sql",
];

async function migration(name) {
  return readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
}

async function setupAuth(db) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
  `);
}

async function asUser(db, id) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}

async function asAnon(db) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec("set role anon");
}

async function coreCounts(db) {
  const row = (await db.query(`
    select count(*)::bigint as ledgers,
      coalesce(sum(jsonb_array_length(payload->'shifts')),0)::bigint as shifts,
      coalesce(sum(jsonb_array_length(payload->'rates')),0)::bigint as rates,
      coalesce(sum(jsonb_array_length(payload->'settlements')),0)::bigint as settlements,
      coalesce(sum(jsonb_array_length(payload->'adjustments')),0)::bigint as adjustments,
      coalesce(sum(jsonb_array_length(payload->'payments')),0)::bigint as payments
    from public.ledgers
  `)).rows[0];
  return Object.fromEntries(Object.entries(row).map(([key,value])=>[key,Number(value)]));
}

test("sharing migration preserves payroll data and enforces read-only grants end-to-end", async () => {
  const db = new PGlite();
  try {
    await setupAuth(db);
    for (const name of migrations.slice(0, 3)) await db.exec(await migration(name));

    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const c = "33333333-3333-4333-8333-333333333333";
    await db.query("insert into auth.users values ($1),($2),($3)", [a,b,c]);

    for (const [id, username, name] of [[a,"owner_a","Người A"],[b,"viewer_b","Người B"],[c,"viewer_c","Người C"]]) {
      await asUser(db,id);
      await db.query("insert into public.profiles(id,username,display_name) values($1,$2,$3)",[id,username,name]);
    }

    const doc = initialLedger();
    doc.shifts.push(makeShift(doc,{date:"2026-09-09",roleId:"cook",start:"17:30",end:"22:00",note:"Lịch sử phải giữ nguyên"}));
    doc.adjustments.push({id:"adj",month:"2026-09",amount:15000,note:"Thưởng"});
    doc.payments.push({id:"pay",month:"2026-09",date:"2026-10-05",amount:120000,note:"Đợt 1"});
    doc.settlements.push({month:"2026-09",start:"2026-09-01",end:"2026-09-30",expected:144750,payDate:"2026-10-05",lockedAt:"2026-09-30T17:00:00.000Z"});
    doc.schemaVersion=1;
    delete doc.studySchedules;
    await asUser(db,a);
    await db.query("select public.save_ledger($1::jsonb,0)",[JSON.stringify(doc)]);
    const before = await coreCounts(db);

    await db.exec("reset role");
    await db.exec(await migration(migrations[3]));
    const after = await coreCounts(db);
    assert.deepEqual(after,before,"migration must preserve ledger/history counts");
    await db.exec(await migration(migrations[4]));

    const removed = (await db.query(`select
      to_regclass('public.friendships') as friendships,
      to_regclass('public.direct_messages') as messages,
      to_regclass('public.journal_posts') as journal,
      to_regclass('public.notification_events') as notifications,
      to_regclass('public.ledger_shares_archived_202609') as legacy_shares`)).rows[0];
    assert.deepEqual(removed,{friendships:null,messages:null,journal:null,notifications:null,legacy_shares:null});

    await asUser(db,a);
    const identityA=(await db.query("select * from public.ensure_share_identity()" )).rows[0];
    assert.match(identityA.share_code,/^ST-(?:[A-F0-9]{4}-){3}[A-F0-9]{4}$/);
    await asUser(db,b);
    const identityB=(await db.query("select * from public.ensure_share_identity()" )).rows[0];
    assert.notEqual(identityB.share_code,identityA.share_code,"each account receives a different code");
    await assert.rejects(db.query("select * from public.redeem_share_code($1)",["ST-0000-0000-0000-0000"]),/INVALID_SHARE_CODE/);

    await asUser(db,a);
    await assert.rejects(db.query("select * from public.redeem_share_code($1)",[identityA.share_code]),/CANNOT_SHARE_WITH_SELF/);

    await asUser(db,b);
    const redeemed=(await db.query("select * from public.redeem_share_code($1)",[identityA.share_code.toLowerCase()])).rows[0];
    assert.deepEqual(redeemed,{owner_id:a,display_name:"Người A"});
    await db.query("select * from public.redeem_share_code($1)",[identityA.share_code]);
    const grants=(await db.query("select owner_id,viewer_id,revoked_at from public.share_grants where owner_id=$1 and viewer_id=$2",[a,b])).rows;
    assert.equal(grants.length,1,"duplicate redeem must not create duplicate grants");
    assert.equal(grants[0].revoked_at,null);

    const sharedLedger=(await db.query("select owner_id,payload from public.ledgers where owner_id=$1",[a])).rows[0];
    assert.equal(sharedLedger.owner_id,a);
    assert.equal(sharedLedger.payload.shifts.length,1);
    assert.equal(sharedLedger.payload.payments.length,1);
    assert.equal(sharedLedger.payload.settlements.length,1);
    await assert.rejects(db.query("update public.ledgers set revision=revision+1 where owner_id=$1",[a]),/permission denied/);
    await assert.rejects(db.query("insert into public.share_grants(owner_id,viewer_id) values($1,$2)",[a,c]),/permission denied/);

    const ownProfileOnly=await db.query("select id from public.profiles order by id");
    assert.deepEqual(ownProfileOnly.rows,[{id:b}],"profiles are not a social/searchable directory");
    const sharedList=(await db.query("select * from public.shared_with_me()" )).rows;
    assert.equal(sharedList.length,1);
    assert.equal(sharedList[0].display_name,"Người A");

    await asUser(db,c);
    assert.equal((await db.query("select * from public.ledgers where owner_id=$1",[a])).rows.length,0,"ungranted user cannot read owner ledger");

    await asAnon(db);
    await assert.rejects(db.query("select * from public.ledgers where owner_id=$1",[a]),/permission denied/);
    await assert.rejects(db.query("select * from public.redeem_share_code($1)",[identityA.share_code]),/permission denied/);

    await asUser(db,a);
    const rotated=(await db.query("select * from public.rotate_share_code()" )).rows[0];
    assert.notEqual(rotated.share_code,identityA.share_code);
    await asUser(db,c);
    await assert.rejects(db.query("select * from public.redeem_share_code($1)",[identityA.share_code]),/INVALID_SHARE_CODE/);
    await db.query("select * from public.redeem_share_code($1)",[rotated.share_code]);
    assert.equal((await db.query("select * from public.ledgers where owner_id=$1",[a])).rows.length,1);

    await asUser(db,b);
    assert.equal((await db.query("select * from public.ledgers where owner_id=$1",[a])).rows.length,1,"rotation keeps existing grants active");
    await asUser(db,a);
    await db.query("select public.revoke_share_grant($1)",[b]);
    await asUser(db,b);
    assert.equal((await db.query("select * from public.ledgers where owner_id=$1",[a])).rows.length,0,"revoke removes direct ledger read immediately");
    assert.equal((await db.query("select * from public.shared_with_me()" )).rows.length,0);
  } finally {
    await db.close();
  }
});

test("ledger save remains owner-scoped with CAS and rejects anonymous writes", async () => {
  const db=new PGlite();
  try {
    await setupAuth(db);
    await db.exec(await migration(migrations[0]));
    await db.exec(await migration(migrations[4]));
    const a="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.query("insert into auth.users values($1)",[a]);
    await asUser(db,a);
    await db.query("insert into public.profiles(id,username,display_name) values($1,'owner','Owner')",[a]);
    const doc=initialLedger();
    const result=await db.query("select public.save_ledger($1::jsonb,0) revision",[JSON.stringify(doc)]);
    assert.equal(Number(result.rows[0].revision),1);
    await assert.rejects(db.query("select public.save_ledger($1::jsonb,0)",[JSON.stringify(doc)]),/REVISION_CONFLICT/);
    await asAnon(db);
    await assert.rejects(db.query("select public.save_ledger($1::jsonb,1)",[JSON.stringify(doc)]),/permission denied/);
  } finally { await db.close(); }
});
