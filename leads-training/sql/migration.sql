-- Leads Training: update the EXISTING database (run once in phpMyAdmin > SQL tab, or Import).
-- Keeps the admin account and its password. Do NOT import schema.sql for this.
-- WARNING: deleting employee accounts also deletes their progress, quiz attempts,
-- notifications, support requests and supplier evaluations.

USE leads_training;

-- 1. Remove all employee accounts (admin stays). Related rows go with them (ON DELETE CASCADE).
DELETE FROM users WHERE role = 'employee';
DELETE FROM supplier_evaluations;
DELETE FROM activity_log;

-- 2. Suppliers go back to "not yet evaluated".
UPDATE suppliers SET status = 'Under Review', current_score = NULL, last_evaluation = NULL, next_evaluation = NULL;

-- 3. Ratings now live in their own table (one row per criterion per evaluation).
ALTER TABLE supplier_evaluations
  DROP COLUMN r_quality, DROP COLUMN r_reliability, DROP COLUMN r_technical, DROP COLUMN r_response,
  DROP COLUMN r_communication, DROP COLUMN r_delivery, DROP COLUMN r_security, DROP COLUMN r_cost;

CREATE TABLE evaluation_ratings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  evaluation_id INT UNSIGNED NOT NULL,
  criterion_id INT UNSIGNED NULL,
  criterion_name VARCHAR(80) NOT NULL,
  weight TINYINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  FOREIGN KEY (evaluation_id) REFERENCES supplier_evaluations(id) ON DELETE CASCADE,
  FOREIGN KEY (criterion_id) REFERENCES criteria_master(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Criteria Master: every criterion is now a form question with an editable name, description and weight.
ALTER TABLE criteria_master
  DROP COLUMN source_keys,
  MODIFY purpose VARCHAR(255) NOT NULL DEFAULT '';

-- 5. Training card text (evaluation material).
UPDATE training_cards SET content = REPLACE(content, 'Rate each of the eight criteria from 1 (poor) to 5 (excellent).', 'Rate each criterion from 1 (poor) to 5 (excellent).') WHERE card_kind = 'evaluation';
UPDATE training_cards SET content = REPLACE(content, 'If corrective action is required, describe the issue, the action, the target date, and the responsible person.', 'If corrective action is required, describe the issue you found. The administrator will record the corrective action, target date, and responsible person.') WHERE card_kind = 'evaluation';
