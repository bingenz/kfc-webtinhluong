-- ShiftTrack: remove Ca Lam 2.0 social features and replace them with minimal
-- authenticated, read-only sharing. This migration never rewrites public.ledgers.
-- Apply only after taking a normal Supabase database backup/snapshot.
begin;

create temporary table migration_core_counts as
select
  count(*)::bigint as ledgers,
  count(distinct owner_id)::bigint as owners,
  coalesce(sum(revision),0)::bigint as revision_sum,
  coalesce(sum(jsonb_array_length(payload->'roles')),0)::bigint as roles,
  coalesce(sum(jsonb_array_length(payload->'rates')),0)::bigint as rates,
  coalesce(sum(jsonb_array_length(payload->'rules')),0)::bigint as rules,
  coalesce(sum(jsonb_array_length(payload->'holidays')),0)::bigint as holidays,
  coalesce(sum(jsonb_array_length(payload->'shifts')),0)::bigint as shifts,
  coalesce(sum(jsonb_array_length(payload->'settlements')),0)::bigint as settlements,
  coalesce(sum(jsonb_array_length(coalesce(payload->'reconciliations','[]'::jsonb))),0)::bigint as reconciliations,
  coalesce(sum(jsonb_array_length(payload->'adjustments')),0)::bigint as adjustments,
  coalesce(sum(jsonb_array_length(payload->'payments')),0)::bigint as payments
from public.ledgers;

-- Remove social/push entry points first so no stale function keeps semantics alive.
drop function if exists public.my_conversations() cascade;
drop function if exists public.get_friend_schedule(uuid) cascade;
drop function if exists public.get_friend_forecast(uuid) cascade;
drop function if exists public.get_friend_payroll(uuid) cascade;
drop function if exists public.my_friendships() cascade;
drop function if exists public.update_friend_permissions(uuid,boolean,boolean,boolean) cascade;
drop function if exists public.remove_friendship(uuid) cascade;
drop function if exists public.cancel_friend_request(uuid) cascade;
drop function if exists public.respond_friend_request(uuid,boolean) cascade;
drop function if exists public.send_friend_request(uuid) cascade;
drop function if exists public.search_profiles(text) cascade;

drop function if exists ca_lam_private.notify_journal_comment() cascade;
drop function if exists ca_lam_private.notify_journal_reaction() cascade;
drop function if exists ca_lam_private.notify_journal_post() cascade;
drop function if exists ca_lam_private.notify_friendship() cascade;
drop function if exists ca_lam_private.notify_note() cascade;
drop function if exists ca_lam_private.notify_message() cascade;
drop function if exists ca_lam_private.create_notification(uuid,uuid,text,text,text,uuid,uuid,text) cascade;
drop function if exists ca_lam_private.actor_name(uuid) cascade;
drop function if exists ca_lam_private.friend_projection(uuid,text) cascade;
drop function if exists ca_lam_private.are_friends(uuid,uuid) cascade;
drop function if exists ca_lam_private.is_accepted_friendship(uuid,uuid) cascade;
drop function if exists ca_lam_private.prevent_message_mutation() cascade;

-- Remove social-only relations. Payroll/history lives inside public.ledgers and is untouched.
drop table if exists public.notification_events cascade;
drop table if exists public.push_subscriptions cascade;
drop table if exists public.notification_preferences cascade;
drop table if exists public.journal_comments cascade;
drop table if exists public.journal_reactions cascade;
drop table if exists public.journal_images cascade;
drop table if exists public.journal_posts cascade;
drop table if exists public.direct_messages cascade;
drop table if exists public.profile_notes cascade;
drop table if exists public.friend_permissions cascade;
drop table if exists public.friendships cascade;
drop table if exists public.ledger_shares_archived_202609 cascade;

-- Social media storage is no longer part of the product. Remove policies.
-- Bucket deletion is skipped here due to Supabase triggers; delete bucket 'social-media' manually via UI if desired.
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name='storage') then
    drop policy if exists social_media_read on storage.objects;
    drop policy if exists social_media_upload on storage.objects;
    drop policy if exists social_media_delete on storage.objects;
  end if;
exception when undefined_table then null; end $$;

-- Keep only the identity fields required by auth/ownership/sharing.
alter table public.profiles
  drop column if exists avatar_path,
  drop column if exists cover_path,
  drop column if exists bio,
  drop column if exists job_title,
  drop column if exists workplace;

-- Profiles are no longer searchable/social. A user may only read/update their own row.
drop policy if exists profiles_owner_or_friend_read on public.profiles;
drop policy if exists profiles_read on public.profiles;
drop policy if exists profiles_owner_read on public.profiles;
create policy profiles_owner_read on public.profiles for select to authenticated
  using (id=(select auth.uid()));

create table public.share_identities (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  share_code text not null unique check (share_code ~ '^ST-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$'),
  share_code_hash text not null unique,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create table public.share_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (owner_id<>viewer_id),
  constraint share_grants_pair_key unique(owner_id,viewer_id)
);
create index share_grants_viewer_owner_idx on public.share_grants(viewer_id,owner_id);
create index share_grants_owner_viewer_idx on public.share_grants(owner_id,viewer_id);
create index share_identities_hash_idx on public.share_identities(share_code_hash);

-- Simple per-account redeem throttling. No plaintext code is stored in this log.
create table public.share_redeem_attempts (
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index share_redeem_attempts_viewer_time_idx on public.share_redeem_attempts(viewer_id,attempted_at desc);

alter table public.share_identities enable row level security;
alter table public.share_grants enable row level security;
alter table public.share_redeem_attempts enable row level security;
revoke all on public.share_identities,public.share_grants,public.share_redeem_attempts from anon,authenticated;
grant select on public.share_grants to authenticated;
create policy share_grants_participant_read on public.share_grants for select to authenticated
  using (revoked_at is null and (select auth.uid()) in (owner_id,viewer_id));

create or replace function ca_lam_private.normalize_share_code(code text)
returns text language sql immutable set search_path='' as $$
  select upper(regexp_replace(trim(coalesce(code,'')),'\\s+','','g'));
$$;
revoke all on function ca_lam_private.normalize_share_code(text) from public,anon,authenticated;

create or replace function ca_lam_private.share_code_hash(code text)
returns text language sql immutable set search_path='' as $$
  select md5(ca_lam_private.normalize_share_code(code));
$$;
revoke all on function ca_lam_private.share_code_hash(text) from public,anon,authenticated;

create or replace function ca_lam_private.new_share_code()
returns text language sql volatile set search_path='' as $$
  select upper('ST-' || substr(x,1,4) || '-' || substr(x,5,4) || '-' || substr(x,9,4) || '-' || substr(x,13,4))
  from (select replace(gen_random_uuid()::text,'-','') x) q;
$$;
revoke all on function ca_lam_private.new_share_code() from public,anon,authenticated;

create or replace function public.ensure_share_identity()
returns table(share_code text, created_at timestamptz, rotated_at timestamptz)
language plpgsql security definer set search_path=public,auth,ca_lam_private as $$
declare actor uuid := auth.uid(); generated text;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=actor) then raise exception 'PROFILE_REQUIRED'; end if;
  if not exists(select 1 from public.share_identities where owner_id=actor) then
    loop
      generated := ca_lam_private.new_share_code();
      begin
        insert into public.share_identities(owner_id,share_code,share_code_hash)
        values(actor,generated,ca_lam_private.share_code_hash(generated));
        exit;
      exception when unique_violation then null;
      end;
    end loop;
  end if;
  return query select s.share_code,s.created_at,s.rotated_at from public.share_identities s where s.owner_id=actor;
end $$;
revoke all on function public.ensure_share_identity() from public,anon;
grant execute on function public.ensure_share_identity() to authenticated;

create or replace function public.rotate_share_code()
returns table(share_code text, created_at timestamptz, rotated_at timestamptz)
language plpgsql security definer set search_path=public,auth,ca_lam_private as $$
declare actor uuid := auth.uid(); generated text;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.ensure_share_identity();
  loop
    generated := ca_lam_private.new_share_code();
    begin
      update public.share_identities
      set share_code=generated,share_code_hash=ca_lam_private.share_code_hash(generated),rotated_at=now()
      where owner_id=actor;
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  return query select s.share_code,s.created_at,s.rotated_at from public.share_identities s where s.owner_id=actor;
end $$;
revoke all on function public.rotate_share_code() from public,anon;
grant execute on function public.rotate_share_code() to authenticated;

create or replace function public.redeem_share_code(code text)
returns table(owner_id uuid, display_name text)
language plpgsql security definer set search_path=public,auth,ca_lam_private as $$
declare actor uuid := auth.uid(); owner uuid;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  delete from public.share_redeem_attempts where attempted_at < now()-interval '1 day';
  if (select count(*) from public.share_redeem_attempts where viewer_id=actor and attempted_at > now()-interval '10 minutes') >= 10 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;
  insert into public.share_redeem_attempts(viewer_id) values(actor);
  select s.owner_id into owner from public.share_identities s
    where s.share_code_hash=ca_lam_private.share_code_hash(code)
      and s.share_code=ca_lam_private.normalize_share_code(code);
  if owner is null then raise exception 'INVALID_SHARE_CODE'; end if;
  if owner=actor then raise exception 'CANNOT_SHARE_WITH_SELF'; end if;
  insert into public.share_grants(owner_id,viewer_id,revoked_at)
    values(owner,actor,null)
    on conflict on constraint share_grants_pair_key do update set revoked_at=null,created_at=case when public.share_grants.revoked_at is null then public.share_grants.created_at else now() end;
  return query select p.id,p.display_name from public.profiles p where p.id=owner;
end $$;
revoke all on function public.redeem_share_code(text) from public,anon;
grant execute on function public.redeem_share_code(text) to authenticated;

create or replace function public.my_share_viewers()
returns table(owner_id uuid,viewer_id uuid,display_name text,created_at timestamptz)
language sql stable security definer set search_path=public,auth as $$
  select g.owner_id,g.viewer_id,p.display_name,g.created_at
  from public.share_grants g join public.profiles p on p.id=g.viewer_id
  where g.owner_id=auth.uid() and g.revoked_at is null order by g.created_at desc;
$$;
revoke all on function public.my_share_viewers() from public,anon;
grant execute on function public.my_share_viewers() to authenticated;

create or replace function public.shared_with_me()
returns table(owner_id uuid,viewer_id uuid,display_name text,created_at timestamptz)
language sql stable security definer set search_path=public,auth as $$
  select g.owner_id,g.viewer_id,p.display_name,g.created_at
  from public.share_grants g join public.profiles p on p.id=g.owner_id
  where g.viewer_id=auth.uid() and g.revoked_at is null order by g.created_at desc;
$$;
revoke all on function public.shared_with_me() from public,anon;
grant execute on function public.shared_with_me() to authenticated;

create or replace function public.revoke_share_grant(viewer uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.share_grants set revoked_at=now()
    where owner_id=auth.uid() and viewer_id=viewer and revoked_at is null;
end $$;
revoke all on function public.revoke_share_grant(uuid) from public,anon;
grant execute on function public.revoke_share_grant(uuid) to authenticated;

-- Restore ledger visibility: owner CRUD remains through save_ledger; viewers only receive SELECT.
drop policy if exists ledgers_owner_read on public.ledgers;
drop policy if exists ledgers_read on public.ledgers;
drop policy if exists ledgers_owner_or_shared_read on public.ledgers;
create policy ledgers_owner_or_shared_read on public.ledgers for select to authenticated using (
  owner_id=(select auth.uid()) or exists(
    select 1 from public.share_grants g
    where g.owner_id=ledgers.owner_id and g.viewer_id=(select auth.uid()) and g.revoked_at is null
  )
);

-- Abort the whole migration if core ledger/history counts changed unexpectedly.
do $$
declare before_row record; after_row record;
begin
  select * into before_row from migration_core_counts;
  select count(*)::bigint as ledgers,
    count(distinct owner_id)::bigint as owners,
    coalesce(sum(revision),0)::bigint as revision_sum,
    coalesce(sum(jsonb_array_length(payload->'roles')),0)::bigint as roles,
    coalesce(sum(jsonb_array_length(payload->'rates')),0)::bigint as rates,
    coalesce(sum(jsonb_array_length(payload->'rules')),0)::bigint as rules,
    coalesce(sum(jsonb_array_length(payload->'holidays')),0)::bigint as holidays,
    coalesce(sum(jsonb_array_length(payload->'shifts')),0)::bigint as shifts,
    coalesce(sum(jsonb_array_length(payload->'settlements')),0)::bigint as settlements,
    coalesce(sum(jsonb_array_length(coalesce(payload->'reconciliations','[]'::jsonb))),0)::bigint as reconciliations,
    coalesce(sum(jsonb_array_length(payload->'adjustments')),0)::bigint as adjustments,
    coalesce(sum(jsonb_array_length(payload->'payments')),0)::bigint as payments
  into after_row from public.ledgers;
  if row(before_row.ledgers,before_row.owners,before_row.revision_sum,before_row.roles,before_row.rates,before_row.rules,before_row.holidays,before_row.shifts,before_row.settlements,before_row.reconciliations,before_row.adjustments,before_row.payments)
     is distinct from row(after_row.ledgers,after_row.owners,after_row.revision_sum,after_row.roles,after_row.rates,after_row.rules,after_row.holidays,after_row.shifts,after_row.settlements,after_row.reconciliations,after_row.adjustments,after_row.payments) then
    raise exception 'CORE_DATA_COUNT_CHANGED';
  end if;
end $$;

commit;
