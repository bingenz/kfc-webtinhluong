-- Ca Làm: private ledgers, searchable profiles, explicit read-only sharing.
-- Apply to a fresh Supabase project using SQL Editor or supabase db push.
begin;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
 display_name text not null check (char_length(display_name) between 1 and 80)
);
create table public.ledger_shares (
 owner_id uuid not null references public.profiles(id) on delete cascade,
 viewer_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key (owner_id, viewer_id), check(owner_id<>viewer_id)
);
create index ledger_shares_viewer_idx on public.ledger_shares(viewer_id);
create table public.ledgers (
 owner_id uuid primary key references public.profiles(id) on delete cascade,
 payload jsonb not null check (jsonb_typeof(payload)='object' and payload->>'schemaVersion'='1'),
 revision bigint not null default 1,
 updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.ledger_shares enable row level security;
alter table public.ledgers enable row level security;
revoke all on public.profiles, public.ledger_shares, public.ledgers from anon, authenticated;
grant select,insert,update on public.profiles to authenticated;
grant select,insert,delete on public.ledger_shares to authenticated;
grant select on public.ledgers to authenticated;
create policy profiles_read on public.profiles for select to authenticated using(true);
create policy profiles_insert on public.profiles for insert to authenticated with check(id=(select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy shares_read on public.ledger_shares for select to authenticated using(owner_id=(select auth.uid()) or viewer_id=(select auth.uid()));
create policy shares_insert on public.ledger_shares for insert to authenticated with check(owner_id=(select auth.uid()));
create policy shares_delete on public.ledger_shares for delete to authenticated using(owner_id=(select auth.uid()));
create policy ledgers_read on public.ledgers for select to authenticated using(owner_id=(select auth.uid()) or exists(select 1 from public.ledger_shares s where s.owner_id=ledgers.owner_id and s.viewer_id=(select auth.uid())));
-- All writes are scoped to auth.uid(). Compare-and-swap prevents lost updates.
create schema if not exists ca_lam_private;
revoke all on schema ca_lam_private from public;
grant usage on schema ca_lam_private to authenticated;
create function ca_lam_private.save_ledger(document jsonb, expected_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_revision bigint;
begin
 if v_owner is null then raise exception 'AUTH_REQUIRED'; end if;
 if document is null or document->>'schemaVersion' is distinct from '1'
    or jsonb_typeof(document->'shifts') is distinct from 'array'
    or jsonb_typeof(document->'rules') is distinct from 'array'
    or jsonb_typeof(document->'rates') is distinct from 'array'
    or jsonb_typeof(document->'roles') is distinct from 'array'
    or jsonb_typeof(document->'holidays') is distinct from 'array'
    or jsonb_typeof(document->'payments') is distinct from 'array'
    or jsonb_typeof(document->'adjustments') is distinct from 'array'
    or jsonb_typeof(document->'settlements') is distinct from 'array'
    or pg_column_size(document) > 5000000 then raise exception 'INVALID_DOCUMENT'; end if;
 if expected_revision = 0 then
  insert into public.ledgers(owner_id,payload,revision) values(v_owner,document,1)
  on conflict(owner_id) do nothing returning revision into v_revision;
 else
  update public.ledgers set payload=document,revision=revision+1,updated_at=now()
  where owner_id=v_owner and revision=expected_revision returning revision into v_revision;
 end if;
 if v_revision is null then raise exception 'REVISION_CONFLICT'; end if;
 return v_revision;
end $$;
revoke all on function ca_lam_private.save_ledger(jsonb,bigint) from public,anon;
grant execute on function ca_lam_private.save_ledger(jsonb,bigint) to authenticated;
create function public.save_ledger(document jsonb, expected_revision bigint)
returns bigint language sql security invoker set search_path='' as $$
 select ca_lam_private.save_ledger(document, expected_revision);
$$;
revoke all on function public.save_ledger(jsonb,bigint) from public,anon;
grant execute on function public.save_ledger(jsonb,bigint) to authenticated;
create function public.search_profiles(term text)
returns setof public.profiles language sql stable security invoker set search_path='' as $$
 select id,username,display_name from public.profiles
 where char_length(trim(term)) between 2 and 80
 and (position(lower(trim(term)) in lower(username))>0 or position(lower(trim(term)) in lower(display_name))>0)
 order by username limit 20;
$$;
revoke all on function public.search_profiles(text) from public,anon;
grant execute on function public.search_profiles(text) to authenticated;
commit;
