-- Leads Training: Supplier Master TIN + attachments (run once in phpMyAdmin > SQL tab, on the EXISTING database).
-- It adds the TIN column and the table for Attachment 2303 / Extra Document/s. It does not change any other data.
-- Running it is optional: the website also adds these two things by itself the first time the Supplier Master is opened.
-- If the column or the table is already there, skip the line that creates it.
USE leads_training;

ALTER TABLE suppliers ADD COLUMN tin VARCHAR(40) NOT NULL DEFAULT '' AFTER email;

CREATE TABLE IF NOT EXISTS supplier_attachments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT UNSIGNED NOT NULL,
  kind ENUM('2303','extra') NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(80) NOT NULL,
  mime VARCHAR(100) NOT NULL DEFAULT '',
  size INT UNSIGNED NOT NULL DEFAULT 0,
  uploaded_by INT UNSIGNED NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
