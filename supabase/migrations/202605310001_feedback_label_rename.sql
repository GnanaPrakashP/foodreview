-- Rename feedback labels from "worth it" framing to "agree/disagree" framing.
-- Numeric values (1.0, 0.7, 0.3, -0.5, -1.0) are unchanged — all scoring
-- algorithms use the value column, so no Trust Score or Reputation data changes.

-- 1. Drop the old constraint first so the UPDATE is not blocked by it
alter table public.recommendation_feedback
  drop constraint if exists recommendation_feedback_label_check;

-- 2. Migrate existing rows
update public.recommendation_feedback
set feedback_label = case feedback_value
  when  1.0 then 'Strongly agree'
  when  0.7 then 'Agree'
  when  0.3 then 'Neutral'
  when -0.5 then 'Disagree'
  when -1.0 then 'Strongly disagree'
  else feedback_label
end;

-- 3. Add the new constraint
alter table public.recommendation_feedback
  add constraint recommendation_feedback_label_check
  check (feedback_label in ('Strongly agree', 'Agree', 'Neutral', 'Disagree', 'Strongly disagree'));
