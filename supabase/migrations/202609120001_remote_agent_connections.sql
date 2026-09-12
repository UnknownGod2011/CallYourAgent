-- Remote MCP connections are tenant-scoped. CALL-E credentials remain only in
-- the application runtime; agents receive a revocable opaque connection token.
create table if not exists public.agent_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  token_hash text not null unique,
  token_prefix text not null,
  host text not null default 'generic',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, agent_id)
);

create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists agent_connections_agent_id_idx on public.agent_connections(agent_id);
create index if not exists agent_messages_agent_id_created_at_idx on public.agent_messages(agent_id, created_at desc);

alter table public.agent_connections enable row level security;
alter table public.agent_messages enable row level security;

create policy agent_connections_select_own on public.agent_connections for select using ((select auth.uid()) = user_id);
create policy agent_connections_delete_own on public.agent_connections for delete using ((select auth.uid()) = user_id);
create policy agent_messages_select_own on public.agent_messages for select using ((select auth.uid()) = user_id);
create policy agent_messages_insert_own on public.agent_messages for insert with check ((select auth.uid()) = user_id);
create policy agent_messages_update_own on public.agent_messages for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy agent_messages_delete_own on public.agent_messages for delete using ((select auth.uid()) = user_id);

create or replace function public.cya_create_agent_connection(p_agent_id uuid, p_host text default 'generic')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := auth.uid();
  v_token text := 'cya_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if v_user is null or not exists (select 1 from public.agents where id = p_agent_id and user_id = v_user and status <> 'archived') then
    raise exception 'Agent not found';
  end if;
  insert into public.agent_connections(user_id, agent_id, token_hash, token_prefix, host, revoked_at)
  values (v_user, p_agent_id, encode(digest(v_token, 'sha256'), 'hex'), left(v_token, 12), left(coalesce(nullif(trim(p_host), ''), 'generic'), 60), null)
  on conflict (user_id, agent_id) do update set token_hash = excluded.token_hash, token_prefix = excluded.token_prefix, host = excluded.host, created_at = now(), last_used_at = null, revoked_at = null;
  return jsonb_build_object('token', v_token, 'tokenPrefix', left(v_token, 12));
end;
$$;

create or replace function public.cya_revoke_agent_connection(p_agent_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.agent_connections set revoked_at = now() where agent_id = p_agent_id and user_id = auth.uid();
end;
$$;

create or replace function public.cya_agent_authorize(p_token text)
returns table(agent_id uuid, user_id uuid, agent_name text, description text, system_prompt text, status text)
language plpgsql security definer set search_path = public, extensions as $$
begin
  return query
  select a.id, a.user_id, a.name, a.description, a.system_prompt, a.status
  from public.agent_connections c join public.agents a on a.id = c.agent_id
  where c.token_hash = encode(digest(p_token, 'sha256'), 'hex') and c.revoked_at is null and a.status = 'active';
  update public.agent_connections set last_used_at = now() where token_hash = encode(digest(p_token, 'sha256'), 'hex') and revoked_at is null;
end;
$$;

create or replace function public.cya_agent_create_call(p_token text, p_phone_number text, p_contact_name text, p_context text)
returns table(call_id uuid, agent_id uuid, user_id uuid, agent_name text, description text, system_prompt text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_agent record; v_call_id uuid;
begin
  select * into v_agent from public.cya_agent_authorize(p_token) limit 1;
  if not found then raise exception 'Invalid or inactive agent connection'; end if;
  if p_phone_number !~ '^\\+[1-9][0-9]{7,14}$' then raise exception 'Invalid phone number'; end if;
  if char_length(trim(p_context)) not between 1 and 4000 then raise exception 'Invalid call context'; end if;
  insert into public.calls(user_id, agent_id, phone_number, contact_name, status)
  values (v_agent.user_id, v_agent.agent_id, p_phone_number, nullif(trim(p_contact_name), ''), 'queued') returning id into v_call_id;
  return query select v_call_id, v_agent.agent_id, v_agent.user_id, v_agent.agent_name, v_agent.description, v_agent.system_prompt;
end;
$$;

create or replace function public.cya_agent_update_call(p_token text, p_call_id uuid, p_calle_call_id text, p_status text, p_started_at timestamptz default null, p_ended_at timestamptz default null, p_duration_seconds integer default null, p_outcome text default null, p_summary text default null, p_structured_result jsonb default null, p_transcript text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_agent record;
begin
  select * into v_agent from public.cya_agent_authorize(p_token) limit 1;
  if not found then raise exception 'Invalid or inactive agent connection'; end if;
  if p_status not in ('queued','ringing','in_progress','completed','failed','cancelled') then raise exception 'Invalid call status'; end if;
  update public.calls set calle_call_id = coalesce(p_calle_call_id, calle_call_id), status = p_status, started_at = coalesce(p_started_at, started_at), ended_at = coalesce(p_ended_at, ended_at), duration_seconds = coalesce(p_duration_seconds, duration_seconds)
  where id = p_call_id and user_id = v_agent.user_id and agent_id = v_agent.agent_id;
  if not found then raise exception 'Call not found'; end if;
  if p_status = 'completed' then
    insert into public.call_results(call_id, outcome, summary, structured_result, transcript) values (p_call_id, p_outcome, p_summary, p_structured_result, p_transcript)
    on conflict (call_id) do update set outcome = excluded.outcome, summary = excluded.summary, structured_result = excluded.structured_result, transcript = excluded.transcript;
  end if;
end;
$$;

create or replace function public.cya_agent_get_call(p_token text, p_call_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_agent record; v_result jsonb;
begin
  select * into v_agent from public.cya_agent_authorize(p_token) limit 1;
  if not found then raise exception 'Invalid or inactive agent connection'; end if;
  select jsonb_build_object('id', c.id, 'calleCallId', c.calle_call_id, 'status', c.status, 'contactName', c.contact_name, 'phoneNumber', c.phone_number, 'startedAt', c.started_at, 'endedAt', c.ended_at, 'durationSeconds', c.duration_seconds, 'result', case when r.id is null then null else jsonb_build_object('outcome',r.outcome,'summary',r.summary,'structuredResult',r.structured_result,'transcript',r.transcript) end)
  into v_result from public.calls c left join public.call_results r on r.call_id = c.id
  where c.id = p_call_id and c.user_id = v_agent.user_id and c.agent_id = v_agent.agent_id;
  if v_result is null then raise exception 'Call not found'; end if;
  return v_result;
end;
$$;

create or replace function public.cya_agent_pull_messages(p_token text)
returns table(id uuid, body text, created_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare v_agent record;
begin
  select * into v_agent from public.cya_agent_authorize(p_token) limit 1;
  if not found then raise exception 'Invalid or inactive agent connection'; end if;
  return query
  with picked as (select m.id from public.agent_messages m where m.agent_id = v_agent.agent_id and m.user_id = v_agent.user_id and m.consumed_at is null order by m.created_at asc for update skip locked), marked as (update public.agent_messages m set consumed_at = now() from picked p where m.id = p.id returning m.id,m.body,m.created_at)
  select marked.id,marked.body,marked.created_at from marked order by marked.created_at asc;
end;
$$;

revoke all on function public.cya_create_agent_connection(uuid, text) from public, anon;
revoke all on function public.cya_revoke_agent_connection(uuid) from public, anon;
grant execute on function public.cya_create_agent_connection(uuid, text) to authenticated;
grant execute on function public.cya_revoke_agent_connection(uuid) to authenticated;
grant execute on function public.cya_agent_authorize(text) to anon, authenticated;
grant execute on function public.cya_agent_create_call(text, text, text, text) to anon, authenticated;
grant execute on function public.cya_agent_update_call(text, uuid, text, text, timestamptz, timestamptz, integer, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.cya_agent_get_call(text, uuid) to anon, authenticated;
grant execute on function public.cya_agent_pull_messages(text) to anon, authenticated;
