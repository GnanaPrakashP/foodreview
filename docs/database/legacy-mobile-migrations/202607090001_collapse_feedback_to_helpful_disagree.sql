-- Collapse all legacy Taste Trust feedback into the current two-reaction model.
--
-- Forward-only migration:
-- - positive legacy reactions become Helpful
-- - negative legacy reactions become Disagree
-- - neutral / quote-only rows are removed because they no longer exist in the product
-- - constraints are narrowed so old labels and values cannot be written again

alter table public.recommendation_feedback
  drop constraint if exists recommendation_feedback_label_check;

alter table public.recommendation_feedback
  drop constraint if exists recommendation_feedback_value_check;

delete from public.recommendation_feedback
where lower(coalesce(feedback_label, '')) in ('neutral', 'quote', 'it was okay', 'okay')
   or feedback_value = 0.3;

update public.recommendation_feedback
set
  feedback_label = 'Helpful',
  feedback_value = 1.0,
  updated_at = now()
where lower(coalesce(feedback_label, '')) in ('helpful', 'must try', 'craving', 'agree', 'strongly agree', 'mostly yes', 'totally worth it')
   or feedback_value in (1.0, 0.7);

update public.recommendation_feedback
set
  feedback_label = 'Disagree',
  feedback_value = -0.5,
  updated_at = now()
where lower(coalesce(feedback_label, '')) in ('disagree', 'not worth it', 'strongly disagree', 'not really')
   or feedback_value in (-0.5, -1.0);

delete from public.recommendation_feedback
where feedback_label not in ('Helpful', 'Disagree')
   or feedback_value not in (1.0, -0.5);

alter table public.recommendation_feedback
  add constraint recommendation_feedback_value_check
  check (feedback_value in (1.0, -0.5));

alter table public.recommendation_feedback
  add constraint recommendation_feedback_label_check
  check (feedback_label in ('Helpful', 'Disagree'));
