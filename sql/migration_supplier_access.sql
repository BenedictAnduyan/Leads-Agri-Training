-- Leads Training: Supplier Evaluation access (run once in phpMyAdmin > SQL tab, on the EXISTING database).
-- Adds the "Supplier Evaluation access" permission to accounts. It does not change any other data.
-- If you already ran the earlier version of this file, do NOT run it again: the column is already there and nothing else is needed.
USE leads_training;

ALTER TABLE users ADD COLUMN can_add_suppliers TINYINT(1) NOT NULL DEFAULT 0 AFTER pref_deadline;

-- Give the access to jelmabato (matches the email or the name; the SELECT below shows who got it).
UPDATE users SET can_add_suppliers = 1
WHERE role = 'employee' AND (LOWER(email) LIKE '%jelmabato%' OR LOWER(name) LIKE '%jelmabato%');

SELECT id, name, email, can_add_suppliers FROM users WHERE can_add_suppliers = 1;
