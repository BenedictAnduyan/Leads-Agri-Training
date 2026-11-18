-- Leads Training: Supplier Master physical address (run once in phpMyAdmin > SQL tab, on the EXISTING database).
-- It adds the Physical Address column. It does not change any other data.
-- You can also skip this file: the column is added automatically the first time the website needs it.
USE leads_training;

ALTER TABLE suppliers ADD COLUMN address VARCHAR(255) NOT NULL DEFAULT '' AFTER tin;
