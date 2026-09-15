-- Ca Lam 2.0. Existing ledger_shares rows are deliberately not migrated: users
-- must create an explicit, two-way friendship before data can be shared again.
begin;

drop policy if exists ledgers_read on public.ledgers;
create policy ledgers_owner_read on public.ledgers for select to authenticated
  using (owner_id = (select auth.uid()));

-- Keep historical rows inaccessible for audit/rollback; no client policy, grant,
-- function, or ledger policy references this archived relation.
alter table if exists public.ledger_shares rename to ledger_shares_archived_202609;
revoke all on table public.ledger_shares_archived_202609 from anon, authenticated;

alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists cover_path text,
  add column if not exists bio text not null default '' check (char_length(bio) <= 300),
  add column if not exists job_title text not null default '' check (char_length(job_title) <= 100),
  add column if not exists workplace text not null default '' check (char_length(workplace) <= 100),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table public.friendships (
 id uuid primary key default gen_random_uuid(),
 requester_id uuid not null references public.profiles(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 user_one uuid generated always as (least(requester_id, recipient_id)) stored,
 user_two uuid generated always as (greatest(requester_id, recipient_id)) stored,
 status text not null default 'pending' check (status in ('pending','accepted','declined')),
 created_at timestamptz not null default now(),
 responded_at timestamptz,
 updated_at timestamptz not null default now(),
 check (requester_id <> recipient_id),
 unique (user_one, user_two)
);
create index friendships_requester_idx on public.friendships(requester_id, status);
create index friendships_recipient_idx on public.friendships(recipient_id, status);

create table public.friend_permissions (
 owner_id uuid not null references public.profiles(id) on delete cascade,
 friend_id uuid not null references public.profiles(id) on delete cascade,
 view_schedule boolean not null default true,
 view_forecast boolean not null default true,
 view_payroll boolean not null default true,
 updated_at timestamptz not null default now(),
 primary key (owner_id, friend_id),
 check (owner_id <> friend_id)
);

create table public.profile_notes (
 owner_id uuid primary key references public.profiles(id) on delete cascade,
 body text not null check (char_length(body) between 1 and 280),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table public.direct_messages (
 id uuid primary key default gen_random_uuid(),
 friendship_id uuid not null references public.friendships(id) on delete cascade,
 sender_id uuid not null references public.profiles(id) on delete cascade,
 body text not null check (char_length(body) between 1 and 2000),
 created_at timestamptz not null default now(),
 deleted_at timestamptz,
 read_at timestamptz
);
create index direct_messages_friendship_idx on public.direct_messages(friendship_id, created_at desc);
create or replace function ca_lam_private.prevent_message_mutation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.id is distinct from old.id or new.friendship_id is distinct from old.friendship_id
    or new.sender_id is distinct from old.sender_id or new.body is distinct from old.body
    or new.created_at is distinct from old.created_at or new.deleted_at is distinct from old.deleted_at then
   raise exception 'MESSAGE_IMMUTABLE';
 end if;
 return new;
end $$;
create trigger direct_messages_immutable before update on public.direct_messages
 for each row execute function ca_lam_private.prevent_message_mutation();

create table public.journal_posts (
 id uuid primary key default gen_random_uuid(),
 friendship_id uuid not null references public.friendships(id) on delete cascade,
 author_id uuid not null references public.profiles(id) on delete cascade,
 caption text not null default '' check (char_length(caption) <= 2000),
 created_at timestamptz not null default now(),
 deleted_at timestamptz
);
create index journal_posts_friendship_idx on public.journal_posts(friendship_id, created_at desc);
create table public.journal_images (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references public.journal_posts(id) on delete cascade,
 storage_path text not null unique check (storage_path like 'journals/%'),
 position smallint not null check (position between 1 and 6),
 created_at timestamptz not null default now(),
 unique(post_id, position)
);
create table public.journal_reactions (
 post_id uuid not null references public.journal_posts(id) on delete cascade,
 author_id uuid not null references public.profiles(id) on delete cascade,
 reaction text not null check (char_length(reaction) between 1 and 16),
 created_at timestamptz not null default now(),
 primary key(post_id, author_id)
);
create table public.journal_comments (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references public.journal_posts(id) on delete cascade,
 author_id uuid not null references public.profiles(id) on delete cascade,
 body text not null check (char_length(body) between 1 and 1000),
 created_at timestamptz not null default now(),
 deleted_at timestamptz
);
create index journal_comments_post_idx on public.journal_comments(post_id, created_at);

create schema if not exists ca_lam_private;
revoke all on schema ca_lam_private from public;
grant usage on schema ca_lam_private to authenticated;

create or replace function ca_lam_private.is_accepted_friendship(friendship uuid, member uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, auth as $$
 select member is not null and exists (
  select 1 from public.friendships f
  where f.id = friendship and f.status = 'accepted'
    and member in (f.requester_id, f.recipient_id)
 );
$$;
create or replace function ca_lam_private.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
 select a is not null and b is not null and exists (
  select 1 from public.friendships f where f.status='accepted'
   and f.user_one=least(a,b) and f.user_two=greatest(a,b)
 );
$$;
revoke all on function ca_lam_private.is_accepted_friendship(uuid,uuid), ca_lam_private.are_friends(uuid,uuid) from public, anon;
grant execute on function ca_lam_private.is_accepted_friendship(uuid,uuid), ca_lam_private.are_friends(uuid,uuid) to authenticated;

alter table public.profiles enable row level security;
drop policy if exists profiles_read on public.profiles;
create policy profiles_owner_or_friend_read on public.profiles for select to authenticated using (
 id=(select auth.uid()) or ca_lam_private.are_friends(id,(select auth.uid()))
);
-- Search has its own intentionally minimal projection and never returns email.
drop function if exists public.search_profiles(text);
create or replace function public.search_profiles(term text)
returns table(id uuid, username text, display_name text, avatar_path text)
language sql stable security definer set search_path=public, auth as $$
 select p.id,p.username,p.display_name,p.avatar_path from public.profiles p
 where auth.uid() is not null and char_length(trim(term)) between 2 and 80
   and (position(lower(trim(term)) in lower(p.username))>0 or position(lower(trim(term)) in lower(p.display_name))>0)
 order by p.username limit 20;
$$;
revoke all on function public.search_profiles(text) from public, anon;
grant execute on function public.search_profiles(text) to authenticated;

alter table public.friendships enable row level security;
alter table public.friend_permissions enable row level security;
alter table public.profile_notes enable row level security;
alter table public.direct_messages enable row level security;
alter table public.journal_posts enable row level security;
alter table public.journal_images enable row level security;
alter table public.journal_reactions enable row level security;
alter table public.journal_comments enable row level security;
revoke all on public.friendships, public.friend_permissions, public.profile_notes, public.direct_messages, public.journal_posts, public.journal_images, public.journal_reactions, public.journal_comments from anon, authenticated;
grant select on public.friendships, public.friend_permissions, public.profile_notes, public.direct_messages, public.journal_posts, public.journal_images, public.journal_reactions, public.journal_comments to authenticated;
grant insert, update, delete on public.profile_notes, public.direct_messages, public.journal_posts, public.journal_images, public.journal_reactions, public.journal_comments to authenticated;

create policy friendships_members_read on public.friendships for select to authenticated using ((select auth.uid()) in (requester_id,recipient_id));
create policy permissions_owner_or_friend_read on public.friend_permissions for select to authenticated using ((select auth.uid()) in (owner_id,friend_id));
create policy notes_friends_read on public.profile_notes for select to authenticated using (owner_id=(select auth.uid()) or ca_lam_private.are_friends(owner_id,(select auth.uid())));
create policy notes_owner_write on public.profile_notes for all to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy messages_members_read on public.direct_messages for select to authenticated using (ca_lam_private.is_accepted_friendship(friendship_id,(select auth.uid())));
create policy messages_member_insert on public.direct_messages for insert to authenticated with check (sender_id=(select auth.uid()) and ca_lam_private.is_accepted_friendship(friendship_id,(select auth.uid())));
create policy messages_sender_delete on public.direct_messages for delete to authenticated using (sender_id=(select auth.uid()));
create policy messages_recipient_read on public.direct_messages for update to authenticated using (ca_lam_private.is_accepted_friendship(friendship_id,(select auth.uid())) and sender_id<>(select auth.uid())) with check (sender_id<>(select auth.uid()));
create policy posts_members_read on public.journal_posts for select to authenticated using (ca_lam_private.is_accepted_friendship(friendship_id,(select auth.uid())));
create policy posts_member_insert on public.journal_posts for insert to authenticated with check (author_id=(select auth.uid()) and ca_lam_private.is_accepted_friendship(friendship_id,(select auth.uid())));
create policy posts_author_delete on public.journal_posts for delete to authenticated using (author_id=(select auth.uid()));
create policy images_members_read on public.journal_images for select to authenticated using (exists(select 1 from public.journal_posts p where p.id=post_id and ca_lam_private.is_accepted_friendship(p.friendship_id,(select auth.uid()))));
create policy images_author_insert on public.journal_images for insert to authenticated with check (exists(select 1 from public.journal_posts p where p.id=post_id and p.author_id=(select auth.uid()) and ca_lam_private.is_accepted_friendship(p.friendship_id,(select auth.uid()))));
create policy images_author_delete on public.journal_images for delete to authenticated using (exists(select 1 from public.journal_posts p where p.id=post_id and p.author_id=(select auth.uid())));
create policy reactions_members_read on public.journal_reactions for select to authenticated using (exists(select 1 from public.journal_posts p where p.id=post_id and ca_lam_private.is_accepted_friendship(p.friendship_id,(select auth.uid()))));
create policy reactions_member_insert on public.journal_reactions for insert to authenticated with check (author_id=(select auth.uid()) and exists(select 1 from public.journal_posts p where p.id=post_id and ca_lam_private.is_accepted_friendship(p.friendship_id,(select auth.uid()))));
create policy reactions_author_update on public.journal_reactions for update to authenticated using (author_id=(select auth.uid())) with check(author_id=(select auth.uid()));
create policy reactions_author_delete on public.journal_reactions for delete to authenticated using (author_id=(select auth.uid()));
create policy comments_members_read on public.journal_comments for select to authenticated using (exists(select 1 from public.journal_posts p where p.id=post_id and ca_lam_private.is_accepted_friendship(p.friendship_id,(select auth.uid()))));
create policy comments_member_insert on public.journal_comments for insert to authenticated with check (author_id=(select auth.uid()) and exists(select 1 from public.journal_posts p where p.id=post_id and ca_lam_private.is_accepted_friendship(p.friendship_id,(select auth.uid()))));
create policy comments_author_delete on public.journal_comments for delete to authenticated using (author_id=(select auth.uid()));

create or replace function public.send_friend_request(target uuid) returns uuid language plpgsql security definer set search_path=public, auth as $$
declare me uuid:=auth.uid(); result uuid;
begin
 if me is null then raise exception 'AUTH_REQUIRED'; end if;
 if target is null or target=me or not exists(select 1 from public.profiles where id=target) then raise exception 'INVALID_FRIEND'; end if;
 insert into public.friendships(requester_id,recipient_id) values(me,target) returning id into result;
 return result;
exception when unique_violation then raise exception 'FRIENDSHIP_EXISTS';
end $$;
create or replace function public.respond_friend_request(friendship uuid, accept boolean) returns void language plpgsql security definer set search_path=public, auth as $$
declare me uuid:=auth.uid(); requester uuid; recipient uuid;
begin
 select requester_id,recipient_id into requester,recipient from public.friendships where id=friendship and status='pending' for update;
 if me is null or recipient is distinct from me then raise exception 'NOT_ALLOWED'; end if;
 if accept then
  update public.friendships set status='accepted',responded_at=now(),updated_at=now() where id=friendship;
  insert into public.friend_permissions(owner_id,friend_id) values(requester,recipient),(recipient,requester);
 else update public.friendships set status='declined',responded_at=now(),updated_at=now() where id=friendship; end if;
end $$;
create or replace function public.cancel_friend_request(friendship uuid) returns void language plpgsql security definer set search_path=public, auth as $$
begin
 delete from public.friendships where id=friendship and requester_id=auth.uid() and status='pending';
 if not found then raise exception 'NOT_ALLOWED'; end if;
end $$;
create or replace function public.remove_friendship(friendship uuid) returns void language plpgsql security definer set search_path=public, auth as $$
begin
 delete from public.friendships where id=friendship and auth.uid() in (requester_id,recipient_id);
 if not found then raise exception 'NOT_ALLOWED'; end if;
end $$;
create or replace function public.update_friend_permissions(friend uuid, schedule boolean, forecast boolean, payroll boolean) returns void language plpgsql security definer set search_path=public, auth as $$
begin
 if auth.uid() is null or not ca_lam_private.are_friends(auth.uid(),friend) then raise exception 'NOT_ALLOWED'; end if;
 update public.friend_permissions set view_schedule=schedule,view_forecast=forecast,view_payroll=payroll,updated_at=now() where owner_id=auth.uid() and friend_id=friend;
 if not found then raise exception 'NOT_ALLOWED'; end if;
end $$;
revoke all on function public.send_friend_request(uuid), public.respond_friend_request(uuid,boolean), public.cancel_friend_request(uuid), public.remove_friendship(uuid), public.update_friend_permissions(uuid,boolean,boolean,boolean) from public, anon;
grant execute on function public.send_friend_request(uuid), public.respond_friend_request(uuid,boolean), public.cancel_friend_request(uuid), public.remove_friendship(uuid), public.update_friend_permissions(uuid,boolean,boolean,boolean) to authenticated;

create or replace function public.my_friendships()
returns table(id uuid, requester_id uuid, recipient_id uuid, status text, created_at timestamptz, responded_at timestamptz, friend_id uuid, username text, display_name text, avatar_path text)
language sql stable security definer set search_path=public, auth as $$
 select f.id,f.requester_id,f.recipient_id,f.status,f.created_at,f.responded_at,
   case when f.requester_id=auth.uid() then f.recipient_id else f.requester_id end,
   p.username,p.display_name,p.avatar_path
 from public.friendships f
 join public.profiles p on p.id=case when f.requester_id=auth.uid() then f.recipient_id else f.requester_id end
 where auth.uid() in(f.requester_id,f.recipient_id)
 order by f.updated_at desc;
$$;
revoke all on function public.my_friendships() from public, anon;
grant execute on function public.my_friendships() to authenticated;

create or replace function ca_lam_private.friend_projection(owner uuid, level text)
returns jsonb language plpgsql stable security definer set search_path=public, auth as $$
declare payload jsonb; allowed boolean;
begin
 if auth.uid() is null or not ca_lam_private.are_friends(owner,auth.uid()) then raise exception 'NOT_ALLOWED'; end if;
 select case level when 'schedule' then view_schedule when 'forecast' then view_forecast when 'payroll' then view_payroll else false end into allowed from public.friend_permissions where owner_id=owner and friend_id=auth.uid();
 if allowed is not true then raise exception 'NOT_ALLOWED'; end if;
 select l.payload into payload from public.ledgers l where l.owner_id=owner;
 if payload is null then return null; end if;
 if level='schedule' then return jsonb_build_object('shifts',(select coalesce(jsonb_agg(jsonb_build_object('id',s->>'id','date',s->>'date','roleId',s->>'roleId','roleName',s->>'roleName','color',s->>'color','start',s->>'start','end',s->>'end','note',s->>'note') order by s->>'date',s->>'start'),'[]'::jsonb) from jsonb_array_elements(payload->'shifts') s)); end if;
 if level='forecast' then return jsonb_build_object('shifts',payload->'shifts','adjustments',payload->'adjustments'); end if;
 return jsonb_build_object('roles',payload->'roles','rates',payload->'rates','rules',payload->'rules','holidays',payload->'holidays','shifts',payload->'shifts','adjustments',payload->'adjustments','payments',payload->'payments','settlements',payload->'settlements');
end $$;
create or replace function public.get_friend_schedule(owner uuid) returns jsonb language sql stable security definer set search_path='' as $$ select ca_lam_private.friend_projection(owner,'schedule'); $$;
create or replace function public.get_friend_forecast(owner uuid) returns jsonb language sql stable security definer set search_path='' as $$ select ca_lam_private.friend_projection(owner,'forecast'); $$;
create or replace function public.get_friend_payroll(owner uuid) returns jsonb language sql stable security definer set search_path='' as $$ select ca_lam_private.friend_projection(owner,'payroll'); $$;
revoke all on function ca_lam_private.friend_projection(uuid,text), public.get_friend_schedule(uuid), public.get_friend_forecast(uuid), public.get_friend_payroll(uuid) from public, anon;
grant execute on function public.get_friend_schedule(uuid), public.get_friend_forecast(uuid), public.get_friend_payroll(uuid) to authenticated;

-- Create the private media bucket and its policies only where Supabase Storage is installed.
do $$ begin
 if exists(select 1 from pg_namespace where nspname='storage') then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('social-media','social-media',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
  execute 'create policy social_media_read on storage.objects for select to authenticated using (bucket_id=''social-media'' and (owner_id::uuid=auth.uid() or (name like ''profiles/%'' and ca_lam_private.are_friends(split_part(name,''/'',2)::uuid,auth.uid())) or (name like ''journals/%'' and ca_lam_private.is_accepted_friendship(split_part(name,''/'',2)::uuid,auth.uid()))))';
  execute 'create policy social_media_upload on storage.objects for insert to authenticated with check (bucket_id=''social-media'' and (name like ''profiles/''||auth.uid()::text||''/%'' or (name like ''journals/%/''||auth.uid()::text||''/%'' and ca_lam_private.is_accepted_friendship(split_part(name,''/'',2)::uuid,auth.uid()))))';
  execute 'create policy social_media_delete on storage.objects for delete to authenticated using (bucket_id=''social-media'' and owner_id::uuid=auth.uid())';
 end if;
end $$;

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.direct_messages;
 end if;
exception when duplicate_object then null; end $$;
commit;
