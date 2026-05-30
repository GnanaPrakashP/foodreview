alter table public.profiles
  alter column trust_score set default 20;

update public.profiles
set
  trust_score = 20,
  trust_level = 'New Reviewer',
  confirmed_recommendations_count = 0,
  positive_confirmations_count = 0,
  negative_confirmations_count = 0,
  total_feedback_points = 0
where not exists (
  select 1
  from public.recommendation_feedback rf
  where rf.reviewer_user_id = profiles.id
);

with feedback_with_weights as (
  select
    reviewer_user_id,
    feedback_value,
    case
      when extract(epoch from (now() - coalesce(updated_at, created_at, now()))) / 86400 <= 60 then 1.0
      when extract(epoch from (now() - coalesce(updated_at, created_at, now()))) / 86400 <= 180 then 0.8
      when extract(epoch from (now() - coalesce(updated_at, created_at, now()))) / 86400 <= 365 then 0.6
      else 0.4
    end::numeric as freshness_weight
  from public.recommendation_feedback
),
aggregates as (
  select
    reviewer_user_id,
    count(*)::numeric as confirmed_count,
    sum(feedback_value)::numeric as total_points,
    sum(feedback_value * freshness_weight)::numeric as weighted_points,
    sum(freshness_weight)::numeric as weighted_confirmed_count,
    count(*) filter (where feedback_value >= 0.7) as positive_count,
    count(*) filter (where feedback_value < 0) as negative_count
  from feedback_with_weights
  group by reviewer_user_id
),
scores as (
  select
    reviewer_user_id,
    confirmed_count,
    positive_count,
    negative_count,
    total_points,
    weighted_points,
    weighted_confirmed_count,
    round(
      greatest(
        0,
        least(
          100,
          20 * (1 - (weighted_confirmed_count / (weighted_confirmed_count + 15)))
            + 100
            * ((greatest(-1, least(1, weighted_points / weighted_confirmed_count)) + 1) / 2)
            * (weighted_confirmed_count / (weighted_confirmed_count + 15))
        )
      ),
      1
    ) as trust_score
  from aggregates
)
update public.profiles p
set
  trust_score = scores.trust_score,
  trust_level = case
    when scores.confirmed_count < 5 then 'New Reviewer'
    when scores.trust_score < 20 then 'Low Trust'
    when scores.trust_score < 35 then 'Mixed Trust'
    when scores.trust_score < 65 then 'Growing Trust'
    when scores.trust_score < 80 then 'Trusted'
    else 'Highly Trusted'
  end,
  confirmed_recommendations_count = scores.confirmed_count::integer,
  positive_confirmations_count = scores.positive_count::integer,
  negative_confirmations_count = scores.negative_count::integer,
  total_feedback_points = round(scores.total_points, 1)
from scores
where p.id = scores.reviewer_user_id;
