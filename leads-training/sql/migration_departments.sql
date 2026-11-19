-- Leads Training: OPTIONAL safety update (run once in phpMyAdmin > SQL tab, only if you get a "departments table doesn't exist" error).
-- Safe to run even if the table already exists. It does not change any other data.
USE leads_training;
CREATE TABLE IF NOT EXISTS departments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO departments (name) SELECT DISTINCT department FROM users WHERE department <> '';
