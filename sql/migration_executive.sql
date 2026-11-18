-- Executive role: has everything an employee and an Immediate Superior have, plus approving Requests for Check and IT Procurement Requisitions.
-- The website runs this by itself the first time any page is loaded, so importing this file is optional (an existing database keeps all its data).
-- Import it in phpMyAdmin (database leads_training > Import) only if you prefer to do it by hand. Safe to run more than once.

ALTER TABLE users MODIFY COLUMN role ENUM('admin','employee','superior','executive') NOT NULL DEFAULT 'employee';

-- Joel Caburnay becomes an Executive ...
UPDATE users SET role = 'executive'
 WHERE LOWER(name) LIKE '%joel%' AND LOWER(name) LIKE '%caburnay%';

-- ... and the immediate superior of Sherwin Greso.
UPDATE users s JOIN users j ON LOWER(j.name) LIKE '%joel%' AND LOWER(j.name) LIKE '%caburnay%'
   SET s.supervisor_id = j.id
 WHERE LOWER(s.name) LIKE '%sherwin%' AND LOWER(s.name) LIKE '%greso%' AND s.id <> j.id;
