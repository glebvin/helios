ALTER TABLE customer_submission_remarks ADD COLUMN attempt_number integer;
UPDATE customer_submission_remarks r SET attempt_number=(
  SELECT COALESCE(MAX(a.attempt_number) FILTER (WHERE a.created_at <= r.created_at), MIN(a.attempt_number))
  FROM customer_submission_attempts a
  WHERE a.tenant_id=r.tenant_id AND a.accepted_part_id=r.accepted_part_id
);
ALTER TABLE customer_submission_remarks
  ALTER COLUMN attempt_number SET NOT NULL,
  ADD FOREIGN KEY (tenant_id, accepted_part_id, attempt_number)
    REFERENCES customer_submission_attempts (tenant_id, accepted_part_id, attempt_number);
