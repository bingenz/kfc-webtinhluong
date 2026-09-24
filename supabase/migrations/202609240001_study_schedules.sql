-- Additive ledger v2 support. Existing v1 payloads remain valid and no rows are rewritten.
begin;

alter table public.ledgers drop constraint if exists ledgers_payload_check;
alter table public.ledgers add constraint ledgers_payload_check check (
  jsonb_typeof(payload) = 'object'
  and payload->>'schemaVersion' in ('1','2')
  and (payload->>'schemaVersion' <> '2' or jsonb_typeof(payload->'studySchedules') = 'array')
);

create or replace function ca_lam_private.save_ledger(document jsonb, expected_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_revision bigint;
begin
 if v_owner is null then raise exception 'AUTH_REQUIRED'; end if;
 if document is null or document->>'schemaVersion' not in ('1','2')
    or jsonb_typeof(document->'shifts') is distinct from 'array'
    or jsonb_typeof(document->'rules') is distinct from 'array'
    or jsonb_typeof(document->'rates') is distinct from 'array'
    or jsonb_typeof(document->'roles') is distinct from 'array'
    or jsonb_typeof(document->'holidays') is distinct from 'array'
    or jsonb_typeof(document->'payments') is distinct from 'array'
    or jsonb_typeof(document->'adjustments') is distinct from 'array'
    or jsonb_typeof(document->'settlements') is distinct from 'array'
    or (document->>'schemaVersion' = '2' and jsonb_typeof(document->'studySchedules') is distinct from 'array')
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

commit;
