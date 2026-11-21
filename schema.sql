-- =====================================================================
-- Problem Bank: Supabase schema
-- Run this whole file once in Supabase Dashboard -> SQL Editor -> New query.
-- Safe to run again: it uses "if not exists" and "create or replace".
--
-- What it sets up
--   1. submissions       what regular people send in (public can INSERT only)
--   2. clusters          automatic groups of similar problems
--   3. troll filter      scoring trigger, blocked words, banned senders, rate limit, honeypot
--   4. cluster_summary   ranked view the admin dashboard reads
--   5. admin access      only users listed in public.admins can read anything
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- 0. Admin accounts
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

drop policy if exists "admins read own row" on public.admins;
create policy "admins read own row" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 1. Tunable settings (edit from the admin dashboard, Settings tab)
-- ---------------------------------------------------------------------
create table if not exists public.moderation_config (
  id                   boolean primary key default true check (id),
  flag_at              int     not null default 25  check (flag_at   between 1 and 100),
  reject_at            int     not null default 60  check (reject_at between 1 and 100),
  max_per_hour         int     not null default 5   check (max_per_hour >= 1),
  similarity_threshold numeric not null default 0.30 check (similarity_threshold between 0.05 and 0.95),
  hash_salt            text    not null default md5(random()::text || clock_timestamp()::text),
  check (reject_at > flag_at)
);
insert into public.moderation_config (id) values (true) on conflict do nothing;

create table if not exists public.blocked_terms (
  id         bigint generated always as identity primary key,
  term       text   not null unique check (length(term) between 2 and 60),
  weight     int    not null default 35 check (weight between 1 and 100),
  kind       text   not null default 'abuse' check (kind in ('abuse', 'threat', 'spam')),
  created_at timestamptz not null default now()
);

create table if not exists public.banned_senders (
  sender_hash text primary key,
  reason      text,
  created_at  timestamptz not null default now()
);

-- A small starter list. Extend it from the dashboard. For a bigger list, import a maintained
-- open-source one (for example the "List of Dirty, Naughty, Obscene, and Otherwise Bad Words").
-- Weights are points added to a message's risk score. Flag at 25, reject at 60 by default.
insert into public.blocked_terms (term, weight, kind) values
  ('fuck', 35, 'abuse'), ('shit', 30, 'abuse'), ('bitch', 35, 'abuse'), ('asshole', 40, 'abuse'),
  ('bastard', 30, 'abuse'), ('dick', 30, 'abuse'), ('cunt', 45, 'abuse'), ('dumbass', 40, 'abuse'),
  ('scumbag', 30, 'abuse'), ('stfu', 30, 'abuse'), ('shut up', 20, 'abuse'), ('piss off', 30, 'abuse'),
  ('idiot', 25, 'abuse'), ('moron', 25, 'abuse'), ('loser', 25, 'abuse'),
  ('stupid', 10, 'abuse'), ('dumb', 10, 'abuse'),
  ('kill yourself', 100, 'threat'), ('kys', 100, 'threat'), ('go die', 100, 'threat'),
  ('hope you die', 100, 'threat'), ('i will kill', 100, 'threat'), ('i will find you', 80, 'threat'),
  ('viagra', 80, 'spam'), ('casino', 60, 'spam'), ('free money', 60, 'spam'),
  ('crypto giveaway', 80, 'spam'), ('click here', 40, 'spam'), ('buy now', 40, 'spam'),
  ('porn', 50, 'spam'), ('xxx', 50, 'spam'), ('whatsapp me', 50, 'spam'),
  ('telegram', 30, 'spam'), ('bitcoin', 15, 'spam')
on conflict (term) do nothing;

-- ---------------------------------------------------------------------
-- 2. Clusters and submissions
-- ---------------------------------------------------------------------
create table if not exists public.clusters (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  status     text not null default 'idea' check (status in ('idea', 'validating', 'prototyping', 'parked')),
  fit        smallint not null default 3 check (fit between 1 and 5),   -- how well YOUR skills fit
  needs      text[] not null default '{}',                              -- skills this group would need
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  -- written by the public form
  title         text not null check (char_length(title) between 8 and 140),
  description   text not null check (char_length(description) between 20 and 2000),
  category      text not null check (category in (
                  'Money and bills', 'School and learning', 'Work and business', 'Health', 'Getting around',
                  'Government and paperwork', 'Home and family', 'Shopping', 'Online and phones', 'Community', 'Other')),
  pain          smallint not null check (pain between 1 and 5),
  frequency     text not null check (frequency in ('rarely', 'monthly', 'weekly', 'daily')),
  workaround    text check (workaround is null or char_length(workaround) <= 1000),
  would_use     text not null default 'maybe' check (would_use in ('yes', 'maybe', 'no')),
  age_range     text check (age_range is null or age_range in ('18-24', '25-34', '35-49', '50-64', '65+')),
  location      text check (location is null or char_length(location) <= 80),
  contact_email text check (contact_email is null or (char_length(contact_email) <= 120
                  and contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  consent       boolean not null check (consent),
  website       text,                    -- honeypot, always cleared by the trigger
  fill_ms       int check (fill_ms is null or fill_ms >= 0),

  -- written only by triggers and admins
  status        text not null default 'pending' check (status in ('pending', 'approved', 'flagged', 'rejected')),
  toxicity      smallint not null default 0,
  flags         text[] not null default '{}',
  sender_hash   text,
  cluster_id    uuid references public.clusters (id) on delete set null,
  is_sample     boolean not null default false,
  admin_notes   text,
  reviewed_at   timestamptz,
  reviewed_by   uuid,

  search_text   text generated always as (lower(coalesce(title, '') || ' ' || coalesce(description, ''))) stored
);

create index if not exists submissions_status_idx   on public.submissions (status, created_at desc);
create index if not exists submissions_cluster_idx  on public.submissions (cluster_id);
create index if not exists submissions_sender_idx   on public.submissions (sender_hash, created_at desc);
create index if not exists submissions_trgm_idx     on public.submissions using gin (search_text extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 3. Troll filter
-- ---------------------------------------------------------------------

-- Scores a piece of text from 0 (clean) to 100 (obvious abuse or spam) and lists why.
create or replace function public.moderate_text(txt text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  raw   text := coalesce(txt, '');
  norm  text;
  dedup text;
  s     int  := 0;
  fl    text[] := '{}';
  r     record;
  pat   text;
  n     int;
  letters int;
  uppers  int;
  words   text[];
  uniq    int;
begin
  -- lower case, undo common letter swaps (@ -> a, 0 -> o, 1 -> i, 3 -> e, 4 -> a, 5 -> s, $ -> s, 7 -> t), drop punctuation
  norm  := translate(lower(raw), '@01345$7', 'aoieasst');
  norm  := regexp_replace(norm, '[[:punct:]]', ' ', 'g');
  -- "fuuuuck" -> "fuck"
  dedup := regexp_replace(norm, '(.)\1+', '\1', 'g');

  -- 3a. blocked words and phrases, matched on word boundaries so "class" never trips "ass"
  for r in select term, weight, kind from public.blocked_terms loop
    pat := '\m' || regexp_replace(lower(r.term), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M';
    if norm ~ pat
       or (length(r.term) >= 4
           and lower(r.term) = regexp_replace(lower(r.term), '(.)\1+', '\1', 'g')
           and dedup ~ pat) then
      s  := s + r.weight;
      fl := array_append(fl, r.kind || ':' || r.term);
    end if;
  end loop;

  -- 3b. insults aimed at a person ("you are an idiot")
  if norm ~ '\m(you|u|ur|youre|you re|you are)\s+(a\s+|an\s+|so\s+|such\s+|really\s+)?(stupid|dumb|idiot|moron|useless|pathetic|loser|trash|garbage|worthless|clown)\M' then
    s  := s + 45;
    fl := array_append(fl, 'directed_insult');
  end if;

  -- 3c. links (spam), up to three counted
  select count(*) into n
  from regexp_matches(raw, '(https?://|www\.|\m[a-z0-9-]+\.(com|net|org|ru|xyz|top|click|link|info|biz)\M)', 'gi');
  if n > 0 then
    s  := s + least(n, 3) * 15;
    fl := array_append(fl, 'link');
  end if;

  -- 3d. shouting
  letters := length(regexp_replace(raw, '[^A-Za-z]', '', 'g'));
  uppers  := length(regexp_replace(raw, '[^A-Z]', '', 'g'));
  if letters >= 20 and uppers::numeric / letters > 0.7 then
    s  := s + 20;
    fl := array_append(fl, 'shouting');
  end if;

  -- 3e. keyboard mashing and flooding
  if raw ~ '(.)\1{5,}' then s := s + 20; fl := array_append(fl, 'repeated_chars'); end if;
  if raw ~ '[!?]{4,}'  then s := s + 10; fl := array_append(fl, 'punctuation');    end if;

  select count(*) into n from regexp_matches(lower(raw), '\m[bcdfghjklmnpqrstvwxyz]{7,}\M', 'g');
  if n > 0 then s := s + 25; fl := array_append(fl, 'gibberish'); end if;

  words := regexp_split_to_array(btrim(norm), '\s+');
  if coalesce(array_length(words, 1), 0) >= 8 then
    select count(distinct w) into uniq from unnest(words) as w;
    if uniq::numeric / array_length(words, 1) < 0.4 then
      s  := s + 25;
      fl := array_append(fl, 'repetitive');
    end if;
  end if;

  return jsonb_build_object('score', least(s, 100), 'flags', to_jsonb(fl));
end;
$$;

-- Runs on every new submission, before it is stored.
create or replace function public.trg_process_submission()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  cfg      public.moderation_config;
  hdr      json;
  ip       text;
  res      jsonb;
  s        int := 0;
  fl       text[] := '{}';
  recent   int;
  combined text;
begin
  select * into cfg from public.moderation_config where id;

  -- People using the public API can never choose these fields. SQL editor and service role can (used by the seed file).
  if coalesce(auth.jwt() ->> 'role', '') in ('anon', 'authenticated') then
    new.status      := 'pending';
    new.toxicity    := 0;
    new.flags       := '{}';
    new.cluster_id  := null;
    new.is_sample   := false;
    new.admin_notes := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.sender_hash := null;
  end if;

  -- One-way sender code: salted SHA-256 of the connection address, shortened. The address itself is never stored.
  begin
    hdr := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  exception when others then
    hdr := '{}'::json;
  end;
  ip := btrim(split_part(coalesce(hdr ->> 'x-forwarded-for', hdr ->> 'cf-connecting-ip', ''), ',', 1));
  if ip <> '' then
    new.sender_hash := left(encode(sha256(convert_to(ip || cfg.hash_salt, 'utf8')), 'hex'), 24);
  end if;

  -- Rate limit, banned senders, and repeat posts
  if new.sender_hash is not null then
    select count(*) into recent
    from public.submissions
    where sender_hash = new.sender_hash and created_at > now() - interval '1 hour';
    if recent >= cfg.max_per_hour then
      raise exception 'rate_limited';
    end if;

    if exists (select 1 from public.banned_senders where sender_hash = new.sender_hash) then
      s := s + 100; fl := array_append(fl, 'banned_sender');
    end if;

    if exists (select 1 from public.submissions
               where sender_hash = new.sender_hash
                 and lower(btrim(description)) = lower(btrim(new.description))
                 and created_at > now() - interval '24 hours') then
      s := s + 60; fl := array_append(fl, 'duplicate');
    end if;
  end if;

  -- Bot signals: a filled honeypot, or a form completed faster than a person can type
  if coalesce(new.website, '') <> '' then
    s := s + 100; fl := array_append(fl, 'honeypot');
  end if;
  new.website := null;
  if new.fill_ms is not null and new.fill_ms < 4000 then
    s := s + 35; fl := array_append(fl, 'too_fast');
  end if;

  -- Throwaway text such as "test" or "asdf"
  if lower(btrim(new.title)) ~ '^(test(ing)?( test)*|asdf+|qwert+y*|lorem ipsum.*|n/?a|none|nothing)[.! ]*$' then
    s := s + 40; fl := array_append(fl, 'low_effort');
  end if;

  -- Text scoring
  combined := new.title || E'\n' || new.description || E'\n' || coalesce(new.workaround, '') || E'\n' || coalesce(new.location, '');
  res := public.moderate_text(combined);
  s   := s + (res ->> 'score')::int;
  fl  := array_cat(fl, array(select jsonb_array_elements_text(res -> 'flags')));

  new.toxicity := least(s, 100);
  new.flags    := fl;
  new.status   := case
                    when s >= cfg.reject_at then 'rejected'   -- obvious troll or spam: hidden from the research
                    when s >= cfg.flag_at   then 'flagged'    -- borderline: waits in the review queue
                    else 'approved'
                  end;
  return new;
end;
$$;

drop trigger if exists trg_1_process on public.submissions;
create trigger trg_1_process
  before insert on public.submissions
  for each row execute function public.trg_process_submission();

-- ---------------------------------------------------------------------
-- 4. Automatic grouping of similar problems
-- ---------------------------------------------------------------------

-- Share of meaningful words two texts have in common (stop words removed, words stemmed)
create or replace function public.jaccard_terms(a text, b text)
returns numeric
language sql stable
as $$
  with ta as (select unnest(tsvector_to_array(to_tsvector('english', coalesce(a, '')))) as w),
       tb as (select unnest(tsvector_to_array(to_tsvector('english', coalesce(b, '')))) as w),
       i  as (select count(*) as c from ta join tb using (w)),
       u  as (select count(*) as c from (select w from ta union select w from tb) x)
  select case when u.c = 0 then 0::numeric else round(i.c::numeric / u.c, 3) end from i, u;
$$;

-- Best of: spelling-level similarity (pg_trgm) and shared-meaningful-words similarity
create or replace function public.text_similarity(a text, b text)
returns numeric
language sql stable
set search_path = public, extensions
as $$
  select greatest(extensions.similarity(coalesce(a, ''), coalesce(b, ''))::numeric,
                  public.jaccard_terms(a, b));
$$;

-- When a submission becomes approved, put it in the most similar existing group, or start a new one.
-- Cost grows with the number of approved rows. It is tuned for a few thousand responses.
create or replace function public.trg_assign_cluster()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  cfg     public.moderation_config;
  r       record;
  best    uuid;
  best_sc numeric := 0;
  sc      numeric;
  t_text  text;
begin
  if new.status <> 'approved' or new.cluster_id is not null then
    return new;
  end if;

  select * into cfg from public.moderation_config where id;
  t_text := lower(new.title || ' ' || new.description);

  for r in
    select id, cluster_id, title, category, search_text
    from public.submissions
    where status = 'approved' and cluster_id is not null and id <> new.id
    order by created_at desc
    limit 5000
  loop
    sc := greatest(public.text_similarity(new.title, r.title),
                   public.text_similarity(t_text, r.search_text))
          + case when r.category = new.category then 0.10 else 0 end;
    if sc > best_sc then
      best_sc := sc;
      best    := r.cluster_id;
    end if;
  end loop;

  if best is not null and best_sc >= cfg.similarity_threshold then
    new.cluster_id := best;
  else
    insert into public.clusters (label) values (left(new.title, 90)) returning id into new.cluster_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_2_cluster on public.submissions;
create trigger trg_2_cluster
  before insert or update of status on public.submissions
  for each row execute function public.trg_assign_cluster();

-- ---------------------------------------------------------------------
-- 5. Admin tools (called from the dashboard)
-- ---------------------------------------------------------------------
create or replace function public.prune_empty_clusters()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  delete from public.clusters c
  where not exists (select 1 from public.submissions s where s.cluster_id = c.id);
end;
$$;

create or replace function public.merge_clusters(from_id uuid, into_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if from_id = into_id then return; end if;
  update public.submissions set cluster_id = into_id where cluster_id = from_id;
  delete from public.clusters where id = from_id;
end;
$$;

-- Rebuilds every group from scratch. This erases group names, notes, status, fit, and skills.
create or replace function public.recluster_all()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.submissions set cluster_id = null where status = 'approved';
  delete from public.clusters;
  for r in select id from public.submissions where status = 'approved' order by created_at loop
    update public.submissions set cluster_id = null, status = status where id = r.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. The ranked list the dashboard reads
--    priority (0 to 100) = pain x2 + frequency x1.5 + skill fit x2 + reach x1 + demand x1.5, out of 40
--    reach  = 1 for one person, +1 for every doubling, capped at 5
--    demand = how many said they would use a fix (yes = 5, maybe = 3, no = 1)
--    Keep this formula in sync with priority() in js/admin.js
-- ---------------------------------------------------------------------
drop view if exists public.cluster_summary;
create view public.cluster_summary
with (security_invoker = true)
as
with agg as (
  select c.id, c.label, c.status, c.fit, c.needs, c.notes, c.created_at,
         count(s.id)::int as voices,
         round(avg(s.pain)::numeric, 2) as avg_pain,
         round(avg(case s.frequency when 'rarely' then 1 when 'monthly' then 2 when 'weekly' then 4 else 5 end)::numeric, 2) as avg_freq,
         round(avg(case s.would_use when 'yes' then 5 when 'maybe' then 3 else 1 end)::numeric, 2) as demand,
         mode() within group (order by s.category) as top_category,
         count(s.contact_email)::int as contactable,
         max(s.created_at) as last_seen
  from public.clusters c
  join public.submissions s on s.cluster_id = c.id and s.status = 'approved'
  group by c.id
)
select agg.*,
       least(5, 1 + ln(greatest(voices, 1)::numeric) / ln(2::numeric))::numeric(4, 2) as reach,
       round((avg_pain * 2 + avg_freq * 1.5 + fit * 2
              + least(5, 1 + ln(greatest(voices, 1)::numeric) / ln(2::numeric))
              + demand * 1.5) / 40 * 100)::int as priority
from agg;

-- ---------------------------------------------------------------------
-- 7. Researcher profile (your skills, used by the Plan tab)
-- ---------------------------------------------------------------------
create table if not exists public.researcher_skills (
  user_id uuid primary key references auth.users (id) on delete cascade,
  skills  text[] not null default '{}'
);

-- ---------------------------------------------------------------------
-- 8. Row Level Security: the public can only drop a row in the box. Admins can do the rest.
-- ---------------------------------------------------------------------
alter table public.submissions        enable row level security;
alter table public.clusters           enable row level security;
alter table public.moderation_config  enable row level security;
alter table public.blocked_terms      enable row level security;
alter table public.banned_senders     enable row level security;
alter table public.researcher_skills  enable row level security;

-- submissions
drop policy if exists "anyone can submit" on public.submissions;
create policy "anyone can submit" on public.submissions
  for insert to anon, authenticated with check (true);

drop policy if exists "admins read submissions" on public.submissions;
create policy "admins read submissions" on public.submissions
  for select to authenticated using (public.is_admin());

drop policy if exists "admins update submissions" on public.submissions;
create policy "admins update submissions" on public.submissions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete submissions" on public.submissions;
create policy "admins delete submissions" on public.submissions
  for delete to authenticated using (public.is_admin());

-- admin-only tables
do $$
declare t text;
begin
  foreach t in array array['clusters', 'moderation_config', 'blocked_terms', 'banned_senders']
  loop
    execute format('drop policy if exists "admins all" on public.%I', t);
    execute format('create policy "admins all" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

drop policy if exists "own skills" on public.researcher_skills;
create policy "own skills" on public.researcher_skills
  for all to authenticated
  using (public.is_admin() and user_id = auth.uid())
  with check (public.is_admin() and user_id = auth.uid());

-- Table privileges (a second wall behind RLS)
revoke all on public.submissions       from anon, authenticated;
revoke all on public.clusters          from anon, authenticated;
revoke all on public.moderation_config from anon, authenticated;
revoke all on public.blocked_terms     from anon, authenticated;
revoke all on public.banned_senders    from anon, authenticated;
revoke all on public.researcher_skills from anon, authenticated;
revoke all on public.admins            from anon, authenticated;
revoke all on public.cluster_summary   from anon, authenticated;

-- The public may insert only the columns the form fills in. Status, toxicity, cluster and the rest are off limits.
grant insert (title, description, category, pain, frequency, workaround, would_use,
              age_range, location, contact_email, consent, website, fill_ms)
  on public.submissions to anon, authenticated;

grant select, update, delete on public.submissions       to authenticated;
grant select, insert, update, delete on public.clusters          to authenticated;
grant select, update                 on public.moderation_config to authenticated;
grant select, insert, update, delete on public.blocked_terms     to authenticated;
grant select, insert, update, delete on public.banned_senders    to authenticated;
grant select, insert, update, delete on public.researcher_skills to authenticated;
grant select                         on public.admins            to authenticated;
grant select                         on public.cluster_summary   to authenticated;

-- Functions: helpers are internal, admin tools are for signed-in users (and check is_admin() inside)
revoke execute on function public.moderate_text(text)         from public, anon, authenticated;
revoke execute on function public.jaccard_terms(text, text)   from public, anon, authenticated;
revoke execute on function public.text_similarity(text, text) from public, anon, authenticated;

revoke execute on function public.is_admin()                  from public, anon;
revoke execute on function public.prune_empty_clusters()      from public, anon;
revoke execute on function public.merge_clusters(uuid, uuid)  from public, anon;
revoke execute on function public.recluster_all()             from public, anon;
grant  execute on function public.is_admin()                  to authenticated;
grant  execute on function public.prune_empty_clusters()      to authenticated;
grant  execute on function public.merge_clusters(uuid, uuid)  to authenticated;
grant  execute on function public.recluster_all()             to authenticated;

-- =====================================================================
-- LAST STEP (do it by hand): make yourself an admin.
--   1. Dashboard -> Authentication -> Users -> Add user (email + password). Tick "Auto confirm user".
--   2. Replace the email below with that user's email and run it:
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
-- =====================================================================
