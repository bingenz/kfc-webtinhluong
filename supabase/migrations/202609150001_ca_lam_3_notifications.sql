-- Social activity, browser push subscriptions, and notification preferences.
-- Delivery is intentionally outside Postgres: a Database Webhook posts new
-- notification_events rows to the Cloudflare Worker after the transaction commits.
begin;

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  messages boolean not null default true,
  journal boolean not null default true,
  social boolean not null default true,
  preview boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.push_subscriptions (
  endpoint text primary key check (char_length(endpoint) between 20 and 4096),
  user_id uuid not null references public.profiles(id) on delete cascade,
  keys jsonb not null,
  content_encoding text not null default 'aes128gcm' check (content_encoding in ('aes128gcm', 'aesgcm')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (keys ? 'p256dh' and keys ? 'auth')
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('message', 'note', 'friend_request', 'friend_accepted', 'journal_post', 'journal_reaction', 'journal_comment')),
  title text not null check (char_length(title) between 1 and 120),
  preview text not null default '' check (char_length(preview) <= 240),
  friendship_id uuid references public.friendships(id) on delete cascade,
  source_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  delivered_at timestamptz
);
create index notification_events_feed_idx on public.notification_events(recipient_id, created_at desc);

alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_events enable row level security;
revoke all on public.notification_preferences, public.push_subscriptions, public.notification_events from anon, authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, update on public.notification_events to authenticated;

create policy notification_preferences_owner on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_subscriptions_owner on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notification_events_recipient_read on public.notification_events for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy notification_events_recipient_update on public.notification_events for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));

create or replace function ca_lam_private.create_notification(
  recipient uuid,
  actor uuid,
  event_kind text,
  event_title text,
  event_preview text,
  pair uuid,
  source uuid,
  unique_key text
) returns void language plpgsql security definer set search_path=public, auth as $$
begin
  if recipient is null or recipient = actor then return; end if;
  insert into public.notification_events(event_key, recipient_id, actor_id, kind, title, preview, friendship_id, source_id)
  values (unique_key, recipient, actor, event_kind, left(event_title,120), left(coalesce(event_preview,''),240), pair, source)
  on conflict (event_key) do nothing;
end $$;
revoke all on function ca_lam_private.create_notification(uuid,uuid,text,text,text,uuid,uuid,text) from public, anon, authenticated;

create or replace function ca_lam_private.actor_name(actor uuid)
returns text language sql stable security definer set search_path=public, auth as $$
  select coalesce(nullif(trim(display_name),''), username, 'Bạn bè') from public.profiles where id=actor;
$$;
revoke all on function ca_lam_private.actor_name(uuid) from public, anon, authenticated;

create or replace function ca_lam_private.notify_message()
returns trigger language plpgsql security definer set search_path=public, auth as $$
declare recipient uuid; actor_name text;
begin
  select case when requester_id=new.sender_id then recipient_id else requester_id end into recipient
  from public.friendships where id=new.friendship_id and status='accepted';
  actor_name := ca_lam_private.actor_name(new.sender_id);
  perform ca_lam_private.create_notification(recipient,new.sender_id,'message',actor_name || ' đã gửi tin nhắn',new.body,new.friendship_id,new.id,'message:' || new.id::text || ':' || recipient::text);
  return new;
end $$;
drop trigger if exists direct_messages_notification on public.direct_messages;
create trigger direct_messages_notification after insert on public.direct_messages for each row execute function ca_lam_private.notify_message();

create or replace function ca_lam_private.notify_note()
returns trigger language plpgsql security definer set search_path=public, auth as $$
declare row record; actor_name text;
begin
  actor_name := ca_lam_private.actor_name(new.owner_id);
  for row in select case when f.requester_id=new.owner_id then f.recipient_id else f.requester_id end as recipient, f.id as friendship_id
    from public.friendships f where f.status='accepted' and new.owner_id in (f.requester_id,f.recipient_id)
  loop
    perform ca_lam_private.create_notification(row.recipient,new.owner_id,'note',actor_name || ' đã cập nhật ghi chú',new.body,row.friendship_id,null,'note:' || new.owner_id::text || ':' || new.updated_at::text || ':' || row.recipient::text);
  end loop;
  return new;
end $$;
drop trigger if exists profile_notes_notification on public.profile_notes;
create trigger profile_notes_notification after insert or update of body on public.profile_notes for each row execute function ca_lam_private.notify_note();

create or replace function ca_lam_private.notify_friendship()
returns trigger language plpgsql security definer set search_path=public, auth as $$
declare actor_name text;
begin
  if tg_op='INSERT' and new.status='pending' then
    actor_name := ca_lam_private.actor_name(new.requester_id);
    perform ca_lam_private.create_notification(new.recipient_id,new.requester_id,'friend_request',actor_name || ' đã gửi lời mời kết bạn','',new.id,new.id,'friend-request:' || new.id::text);
  elsif tg_op='UPDATE' and old.status='pending' and new.status='accepted' then
    actor_name := ca_lam_private.actor_name(new.recipient_id);
    perform ca_lam_private.create_notification(new.requester_id,new.recipient_id,'friend_accepted',actor_name || ' đã chấp nhận lời mời kết bạn','',new.id,new.id,'friend-accepted:' || new.id::text);
  end if;
  return new;
end $$;
drop trigger if exists friendships_notification on public.friendships;
create trigger friendships_notification after insert or update of status on public.friendships for each row execute function ca_lam_private.notify_friendship();

create or replace function ca_lam_private.notify_journal_post()
returns trigger language plpgsql security definer set search_path=public, auth as $$
declare recipient uuid; actor_name text;
begin
  select case when requester_id=new.author_id then recipient_id else requester_id end into recipient from public.friendships where id=new.friendship_id and status='accepted';
  actor_name := ca_lam_private.actor_name(new.author_id);
  perform ca_lam_private.create_notification(recipient,new.author_id,'journal_post',actor_name || ' đã đăng nhật ký',new.caption,new.friendship_id,new.id,'journal-post:' || new.id::text || ':' || recipient::text);
  return new;
end $$;
drop trigger if exists journal_posts_notification on public.journal_posts;
create trigger journal_posts_notification after insert on public.journal_posts for each row execute function ca_lam_private.notify_journal_post();

create or replace function ca_lam_private.notify_journal_reaction()
returns trigger language plpgsql security definer set search_path=public, auth as $$
declare post_row record; recipient uuid; actor_name text;
begin
  select author_id,friendship_id into post_row from public.journal_posts where id=new.post_id;
  if post_row.author_id is null then return new; end if;
  select case when requester_id=new.author_id then recipient_id else requester_id end into recipient from public.friendships where id=post_row.friendship_id and status='accepted';
  actor_name := ca_lam_private.actor_name(new.author_id);
  perform ca_lam_private.create_notification(recipient,new.author_id,'journal_reaction',actor_name || ' đã thả cảm xúc','',post_row.friendship_id,new.post_id,'journal-reaction:' || new.post_id::text || ':' || new.author_id::text || ':' || recipient::text);
  return new;
end $$;
drop trigger if exists journal_reactions_notification on public.journal_reactions;
create trigger journal_reactions_notification after insert on public.journal_reactions for each row execute function ca_lam_private.notify_journal_reaction();

create or replace function ca_lam_private.notify_journal_comment()
returns trigger language plpgsql security definer set search_path=public, auth as $$
declare post_row record; recipient uuid; actor_name text;
begin
  select author_id,friendship_id into post_row from public.journal_posts where id=new.post_id;
  if post_row.author_id is null then return new; end if;
  select case when requester_id=new.author_id then recipient_id else requester_id end into recipient from public.friendships where id=post_row.friendship_id and status='accepted';
  actor_name := ca_lam_private.actor_name(new.author_id);
  perform ca_lam_private.create_notification(recipient,new.author_id,'journal_comment',actor_name || ' đã bình luận',new.body,post_row.friendship_id,new.id,'journal-comment:' || new.id::text || ':' || recipient::text);
  return new;
end $$;
drop trigger if exists journal_comments_notification on public.journal_comments;
create trigger journal_comments_notification after insert on public.journal_comments for each row execute function ca_lam_private.notify_journal_comment();

create or replace function public.my_conversations()
returns table(id uuid, friend_id uuid, username text, display_name text, avatar_path text, last_body text, last_at timestamptz, unread_count bigint)
language sql stable security definer set search_path=public, auth as $$
  select f.id,
    case when f.requester_id=auth.uid() then f.recipient_id else f.requester_id end,
    p.username,p.display_name,p.avatar_path,
    recent.body,recent.created_at,
    (select count(*) from public.direct_messages d where d.friendship_id=f.id and d.sender_id<>auth.uid() and d.deleted_at is null and d.read_at is null)
  from public.friendships f
  join public.profiles p on p.id=case when f.requester_id=auth.uid() then f.recipient_id else f.requester_id end
  left join lateral (
    select d.body,d.created_at from public.direct_messages d where d.friendship_id=f.id and d.deleted_at is null order by d.created_at desc limit 1
  ) recent on true
  where f.status='accepted' and auth.uid() in (f.requester_id,f.recipient_id)
  order by recent.created_at desc nulls last, p.display_name;
$$;
revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.notification_events;
  end if;
exception when duplicate_object then null; end $$;
commit;
