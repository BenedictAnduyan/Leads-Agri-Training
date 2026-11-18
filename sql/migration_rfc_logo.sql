-- Leads Training: Request for Check header logo (run once in phpMyAdmin > SQL tab, on the EXISTING database).
-- It adds the three logo columns to rfc_requests. It does not change any other data.
-- Running it is optional: the website also adds these columns by itself the first time Request for Check is opened.
-- If the columns are already there, skip this file.
USE leads_training;

ALTER TABLE rfc_requests ADD COLUMN logo_key VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE rfc_requests ADD COLUMN logo_data MEDIUMTEXT NULL;
ALTER TABLE rfc_requests ADD COLUMN logo_mime VARCHAR(30) NOT NULL DEFAULT '';
