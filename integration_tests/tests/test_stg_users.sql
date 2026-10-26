with actual as (
    select
        id,
        normalized_name,
        normalized_email
    from {{ ref("stg_users") }}
),
expected as (
    select
        1 as id,
        'alice smith' as normalized_name,
        'alice@example.com' as normalized_email
    union all
    select
        2 as id,
        'bob' as normalized_name,
        'bob@example.com' as normalized_email
)

select
    actual.id,
    actual.normalized_name as actual_normalized_name,
    expected.normalized_name as expected_normalized_name,
    actual.normalized_email as actual_normalized_email,
    expected.normalized_email as expected_normalized_email
from actual
inner join expected using (id)
where actual.normalized_name <> expected.normalized_name
   or actual.normalized_email <> expected.normalized_email
