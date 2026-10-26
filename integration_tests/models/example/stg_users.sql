{{ config(materialized="view") }}

select
  id,
  {{ dbt_package_template.normalize_text("raw_name") }} as normalized_name,
  {{ dbt_package_template.normalize_text("raw_email") }} as normalized_email
from {{ ref("raw_users") }}
