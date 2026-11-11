-- B03 reader: an adopted import's generated reason is never read out. Runs
-- after 20261110170000 and before B04.
--
-- * Defect: B03-f gives an imported No or Not applicable the stored reason
--   'Imported from <source label>' (public.knowledge_reconcile, legacy and
--   external paths alike). Adoption copies it to the submission, so the v1
--   reader forwarded it as reason_text and the reader rendered the source
--   label as an internal condition, although the label and excerpt columns
--   are never read out.
-- * public.knowledge_reader_answers_v1 (create or replace, same signature and
--   columns, stable definer, empty search path): the A40 body, with the
--   current contribution's public.knowledge_contribution_sources row (unique
--   by contribution_id) joined once in the same statement. When that row
--   exists the answer is an import: reason_text is null and source_origin is
--   its source_kind. Every other column, ordinary staff reasons, redaction,
--   freshness and the A40 stopped-service rule are unchanged. A row written
--   only by an import decides this, never the reason text.
-- * Not touched: stored reasons, contributions, submissions, source labels
--   and excerpts, which stay on their admin provenance reads.
--
-- Rollback: a forward migration restores the 20261110160000 body.

create or replace function public.knowledge_reader_answers_v1(p_venue_id uuid, p_keys text[])
returns table (
  question_key text,
  status text,
  reason text,
  detail text,
  revision bigint,
  question_version integer,
  value text,
  finding text,
  limitations text,
  reason_text text,
  source_basis text,
  current_contribution_id uuid,
  current_submission_id uuid,
  contribution_kind text,
  confirmation_required boolean,
  confirmation_state text,
  confirmation_basis text,
  confirmation_self boolean,
  confirmation_saved_at timestamptz,
  evidence_photos integer,
  evidence_videos integer,
  redaction_proof text,
  saved_at timestamptz,
  observed_at timestamptz,
  next_check_due timestamptz,
  freshness_state text,
  source_origin text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_keys text[] := coalesce(p_keys, '{}'::text[]);
begin
  if p_venue_id is null
     or not exists (select 1 from public.venues v where v.id = p_venue_id and v.active)
     or not exists (
       select 1 from public.knowledge_working_list w
       where w.venue_id = p_venue_id and w.disabled_at is null
     ) then
    raise exception 'knowledge_venue_not_found' using errcode = 'NLK06';
  end if;
  if cardinality(v_keys) > 50 then
    raise exception 'invalid_key_list' using errcode = '22023';
  end if;
  -- Unavailable answers carry their state and revision only. A40: the
  -- resolver reads a stopped service's stored Yes as No.
  return query
    select s.question_key, s.status, s.reason, s.detail, s.revision, s.question_version,
      s.value,
      case when s.status = 'available' and not x.stopped then s.finding end,
      case when s.status = 'available' and not x.stopped then s.limitations end,
      -- An import's reason is generated from its source label.
      case when s.status = 'available' and ks.source_kind is null then s.reason_text end,
      case when s.status = 'available' then s.source_basis end,
      case when s.status = 'available' then s.current_contribution_id end,
      case when s.status = 'available' then s.current_submission_id end,
      case when s.status = 'available' then s.contribution_kind end,
      s.confirmation_required,
      case when s.status = 'available' then s.confirmation_state end,
      case when s.status = 'available' then s.confirmation_basis end,
      case when s.status = 'available' then s.confirmation_self end,
      case when s.status = 'available' then s.confirmation_saved_at end,
      case when s.status = 'available' then s.evidence_photos end,
      case when s.status = 'available' then s.evidence_videos end,
      case when s.status = 'available' then s.redaction_proof end,
      case when s.status = 'available' then s.saved_at end,
      s.observed_at,
      s.next_check_due,
      case when s.status = 'available' then s.freshness_state end,
      -- WS5 item 2: an adopted import's origin; never its label or excerpt.
      case when s.status = 'available' then ks.source_kind end
    from private.knowledge_slot_state_b03(p_venue_id, v_keys) s
    cross join lateral (
      select coalesce(s.value_schema = 'service' and s.current_answer = 'yes' and s.value = 'no', false) as stopped
    ) x
    left join public.knowledge_contribution_sources ks on ks.contribution_id = s.current_contribution_id
    order by array_position(v_keys, s.question_key);
end;
$$;

revoke all on function public.knowledge_reader_answers_v1(uuid, text[]) from public, anon, authenticated;
grant execute on function public.knowledge_reader_answers_v1(uuid, text[]) to service_role;
