-- SQL CHECK treats NULL as unknown; a review must carry both explicit values.
ALTER TABLE volume_remainder_events ADD CONSTRAINT remainder_review_values_required CHECK(action<>'review' OR(presentation_version IS NOT NULL AND accepted_quantity IS NOT NULL));
