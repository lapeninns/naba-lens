-- Fail fast instead of queueing behind a long transaction on push.
set lock_timeout = '5s';

-- Full App v1, S3-R2 (S3-E2E-2 D4; FA-32; spec §2, §4.2, §9.2).
--
-- D4  Only 7 of the catalogue's questions had a knowledge_question_rules
--     row. knowledge_set_working_list refuses a key with no rule
--     ('knowledge_rule_missing') and venue_apply_template skips one, so the
--     other questions (pool table, darts, ...) could never join a venue's
--     working list, and coverage (private.coverage_slot_rows reads only
--     working-list checks) never gave them a Facilities slot: a Yes never
--     asked for its reviewed photo.
--
--     Every catalogue question without a rule now gets rule version 1 with
--     the docs/knowledge/access-and-rights.md §6 plan default:
--       - Accessibility questions are sensitive accessibility claims, as
--         step_free_entrance: a venue manager confirms, self-confirmation
--         allowed and recorded, no automatic completion when unassigned.
--       - Every other question is a direct observation, as guest_toilets
--         and onsite_parking: no confirmation, automatic completion.
--     Staff text stays internal and no redaction is needed for any of them.
--     The photo requirement is unchanged: it is the catalogue's evidence
--     rule (FA-32), not part of the knowledge rule.
--
--     Each such question also gets a new registry version that names the
--     rule (change_kind 'rule'), as 20261118104000 did for guest Wi-Fi, so
--     the registry and the rule agree. A question added to the catalogue
--     later needs its own rule in the same migration.
--
-- Rollback: rules and registry versions are append-only and changed only by
-- migration; a later migration adds a new rule version to change one.

create temporary table s3r2_new_rules on commit drop as
select c.key,
  c.category = 'Accessibility' as sensitive
from public.amenity_catalogue c
where not exists (select 1 from public.knowledge_question_rules r where r.question_key = c.key);

insert into public.knowledge_question_rules
  (question_key, rule_version, confirmation, self_confirmation_allowed, unassigned_auto_complete,
   staff_text_internal, redaction_required)
select n.key, 1,
  case when n.sensitive then 'venue_manager' else 'none' end,
  n.sensitive,
  not n.sensitive,
  true,
  false
from s3r2_new_rules n
on conflict (question_key, rule_version) do nothing;

-- One new registry version per such question: its latest version with the
-- rule named.
insert into public.knowledge_question_versions
select (jsonb_populate_record(null::public.knowledge_question_versions,
  to_jsonb(v) || jsonb_build_object(
    'version', v.version + 1,
    'rule_version', 1,
    'confirmation', case when n.sensitive then 'venue_manager' else 'none' end,
    'self_confirmation_allowed', n.sensitive,
    'effective_from', null,
    'created_at', now(),
    'created_by', null,
    'change_kind', 'rule',
    'change_note', case when n.sensitive
      then 'S3-R2: knowledge rule added (access-and-rights §6, accessibility claim: a venue manager confirms) so the question can join a working list (FA-32).'
      else 'S3-R2: knowledge rule added (access-and-rights §6, observation: no confirmation) so the question can join a working list (FA-32).' end
  )
)).*
from public.knowledge_question_versions v
join s3r2_new_rules n on n.key = v.key
where v.version = (select max(x.version) from public.knowledge_question_versions x where x.key = v.key);

select private.knowledge_note_definition_change(n.key, 'rule_version_added')
from s3r2_new_rules n order by n.key;
select private.knowledge_note_definition_change(n.key, 'question_version_changed')
from s3r2_new_rules n order by n.key;
