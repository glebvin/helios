ALTER TABLE admission_safety_reviews
  DROP CONSTRAINT admission_safety_reviews_tenant_id_check_id_key,
  ADD UNIQUE (tenant_id, check_id, reviewer_user_id);
