import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { initialLedger } from "../lib/payroll.ts";

test("PostgreSQL: own writes, explicit shared reads, revocation, CAS, no anonymous access", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202609090001_payroll.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const a = "11111111-1111-4111-8111-111111111111",
      b = "22222222-2222-4222-8222-222222222222",
      c = "33333333-3333-4333-8333-333333333333";
    await db.query("insert into auth.users values ($1),($2),($3)", [a, b, c]);
    const asUser = async (id) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    };
    await asUser(a);
    await db.query("insert into public.profiles values($1,$2,$3)", [
      a,
      "owner_a",
      "Người A",
    ]);
    const doc = initialLedger();
    let result = await db.query(
      "select public.save_ledger($1::jsonb,0) as revision",
      [JSON.stringify(doc)],
    );
    assert.equal(Number(result.rows[0].revision), 1);
    await assert.rejects(
      db.query("select public.save_ledger($1::jsonb,0)", [JSON.stringify(doc)]),
      /REVISION_CONFLICT/,
    );
    assert.equal(
      (await db.query("select * from public.ledgers")).rows.length,
      1,
    );
    await asUser(b);
    await db.query("insert into public.profiles values($1,$2,$3)", [
      b,
      "viewer_b",
      "Người B",
    ]);
    assert.equal(
      (await db.query("select * from public.ledgers")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.search_profiles('owner')")).rows
        .length,
      1,
    );
    await assert.rejects(
      db.query(
        "insert into public.ledger_shares(owner_id,viewer_id) values($1,$2)",
        [a, b],
      ),
      /row-level security/,
    );
    await assert.rejects(
      db.query(
        "update public.ledgers set payload=$1::jsonb where owner_id=$2",
        [JSON.stringify(doc), a],
      ),
      /permission denied/,
    );
    await asUser(a);
    await db.query(
      "insert into public.ledger_shares(owner_id,viewer_id) values($1,$2)",
      [a, b],
    );
    await asUser(b);
    assert.equal(
      (await db.query("select * from public.ledgers")).rows.length,
      1,
    );
    await db.query("select public.save_ledger($1::jsonb,0)", [
      JSON.stringify(doc),
    ]);
    assert.equal(
      (await db.query("select * from public.ledgers where owner_id=$1", [a]))
        .rows[0].revision,
      1,
    );
    await asUser(c);
    await db.query("insert into public.profiles values($1,$2,$3)", [
      c,
      "third_c",
      "Người C",
    ]);
    assert.equal(
      (await db.query("select * from public.ledgers")).rows.length,
      0,
    );
    await asUser(a);
    await db.query(
      "delete from public.ledger_shares where owner_id=$1 and viewer_id=$2",
      [a, b],
    );
    await asUser(b);
    assert.equal(
      (await db.query("select * from public.ledgers where owner_id=$1", [a]))
        .rows.length,
      0,
    );
    await asUser(a);
    result = await db.query(
      "select public.save_ledger($1::jsonb,1) as revision",
      [JSON.stringify(doc)],
    );
    assert.equal(Number(result.rows[0].revision), 2);
    await assert.rejects(
      db.query("select public.save_ledger($1::jsonb,1)", [JSON.stringify(doc)]),
      /REVISION_CONFLICT/,
    );
    await db.exec(
      "reset role; set role anon; select set_config('request.jwt.claim.sub','',false)",
    );
    await assert.rejects(
      db.query("select * from public.profiles"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from public.ledgers"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.save_ledger($1::jsonb,0)", [JSON.stringify(doc)]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("Ca Lam 2.0: friendship permissions scope projections and revoke immediately", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202609090001_payroll.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202609140001_ca_lam_2_social.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202609150001_ca_lam_3_notifications.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const a = "11111111-1111-4111-8111-111111111111",
      b = "22222222-2222-4222-8222-222222222222";
    const asUser = async (id) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    };
    await db.query("insert into auth.users values ($1),($2)", [a, b]);
    await asUser(a);
    await db.query(
      "insert into public.profiles(id,username,display_name) values($1,$2,$3)",
      [a, "owner_a", "Người A"],
    );
    await db.query("select public.save_ledger($1::jsonb,0)", [
      JSON.stringify(initialLedger()),
    ]);
    await asUser(b);
    await db.query(
      "insert into public.profiles(id,username,display_name) values($1,$2,$3)",
      [b, "viewer_b", "Người B"],
    );
    assert.equal(
      (await db.query("select * from public.direct_messages")).rows.length,
      0,
    );
    await db.query("select public.send_friend_request($1)", [a]);
    await asUser(a);
    const pending = (
      await db.query(
        "select id from public.friendships where requester_id=$1",
        [b],
      )
    ).rows[0];
    await asUser(b);
    await assert.rejects(
      db.query("select public.get_friend_schedule($1)", [a]),
      /NOT_ALLOWED/,
    );
    await asUser(a);
    await db.query("select public.respond_friend_request($1,true)", [
      pending.id,
    ]);
    await asUser(b);
    await db.query(
      "insert into public.direct_messages(friendship_id,sender_id,body) values($1,$2,$3)",
      [pending.id, b, "Tin nhắn riêng"],
    );
    assert.equal(
      (
        await db.query(
          "select * from public.notification_events where kind='message'",
        )
      ).rows.length,
      0,
      "Người gửi không nhận activity của chính mình",
    );
    await asUser(a);
    const messageActivity = await db.query(
      "select recipient_id,preview from public.notification_events where kind='message'",
    );
    assert.deepEqual(messageActivity.rows, [
      { recipient_id: a, preview: "Tin nhắn riêng" },
    ]);
    const perms = (
      await db.query(
        "select view_schedule,view_forecast,view_payroll from public.friend_permissions where owner_id=$1 and friend_id=$2",
        [a, b],
      )
    ).rows[0];
    assert.deepEqual(perms, {
      view_schedule: true,
      view_forecast: true,
      view_payroll: true,
    });
    await asUser(b);
    const projection = (
      await db.query("select public.get_friend_schedule($1) as data", [a])
    ).rows[0].data;
    assert.deepEqual(Object.keys(projection), ["shifts"]);
    await asUser(a);
    await db.query(
      "select public.update_friend_permissions($1,false,true,false)",
      [b],
    );
    await asUser(b);
    await assert.rejects(
      db.query("select public.get_friend_schedule($1)", [a]),
      /NOT_ALLOWED/,
    );
    await asUser(a);
    await db.query("select public.remove_friendship($1)", [pending.id]);
    await asUser(b);
    await assert.rejects(
      db.query("select public.get_friend_forecast($1)", [a]),
      /NOT_ALLOWED/,
    );
  } finally {
    await db.close();
  }
});
