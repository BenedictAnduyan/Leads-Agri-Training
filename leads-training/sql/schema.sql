-- Leads Training database (MySQL / MariaDB).
-- Import this file in phpMyAdmin: open the Import tab, choose this file, click Import.
-- WARNING: importing it again resets everything, including the admin account (email and password) saved in your database.
-- To clean an existing database without losing the admin account, use migration.sql instead.
CREATE DATABASE IF NOT EXISTS leads_training CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE leads_training;
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS itp_signatures, itp_items, itp_requests, rfc_signatures, rfc_items, rfc_requests, departments, kpi_reviews, kpi_sla, kpi_scale, kpi_results, kpi_items, kpi_kras, kpi_positions, reeval_requests, evaluation_ratings, supplier_evaluations, criteria_master, supplier_attachments, suppliers, question_answers, quiz_attempts, card_progress, course_assignments, quiz_questions, training_cards, courses, notifications, support_requests, activity_log, users;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  department VARCHAR(80) NOT NULL DEFAULT '',
  job_title VARCHAR(80) NOT NULL DEFAULT '',
  role ENUM('admin','employee','superior') NOT NULL DEFAULT 'employee',   -- superior = Immediate Superior
  status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  joined DATE NOT NULL,
  pref_email TINYINT(1) NOT NULL DEFAULT 1,
  pref_deadline TINYINT(1) NOT NULL DEFAULT 1,
  supervisor_id INT UNSIGNED NULL,           -- the immediate head / supervisor of this employee, chosen by the admin
  esignature MEDIUMTEXT NULL,                -- e-signature picture (PNG, base64) saved in the Profile
  esignature_at DATETIME NULL,
  FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE courses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT '',
  duration VARCHAR(40) NOT NULL DEFAULT '',
  deadline DATE NULL,
  status ENUM('Draft','Published','Archived') NOT NULL DEFAULT 'Draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE training_cards (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id INT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  document_type VARCHAR(20) NOT NULL,
  card_kind ENUM('quiz','evaluation') NOT NULL DEFAULT 'quiz',   -- 'evaluation' = the supplier evaluation form
  content MEDIUMTEXT NOT NULL,          -- learning material, saved as JSON blocks
  sort_order INT NOT NULL DEFAULT 1,     -- order inside the course
  passing_score TINYINT UNSIGNED NOT NULL DEFAULT 100,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE quiz_questions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  card_id INT UNSIGNED NOT NULL,
  question TEXT NOT NULL,
  type ENUM('multiple_choice','true_false') NOT NULL DEFAULT 'multiple_choice',
  options_json TEXT NOT NULL,            -- list of answer options, saved as JSON
  correct_answer TINYINT UNSIGNED NOT NULL,  -- position of the correct option, starting at 0
  explanation TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  FOREIGN KEY (card_id) REFERENCES training_cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE course_assignments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deadline DATE NULL,
  UNIQUE KEY one_assignment (course_id, employee_id),   -- no duplicate assignments
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE card_progress (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  card_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  reading_progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  overall_progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  quiz_started TINYINT(1) NOT NULL DEFAULT 0,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  failed TINYINT(1) NOT NULL DEFAULT 0,
  current_attempt INT NOT NULL DEFAULT 0,
  best_score TINYINT UNSIGNED NULL,
  completed_at DATETIME NULL,
  UNIQUE KEY one_progress (card_id, employee_id),
  FOREIGN KEY (card_id) REFERENCES training_cards(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE quiz_attempts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  card_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  attempt_number INT NOT NULL,
  score INT NOT NULL DEFAULT 0,
  total_questions INT NOT NULL,
  percentage TINYINT UNSIGNED NOT NULL DEFAULT 0,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  KEY by_card_employee (card_id, employee_id),
  FOREIGN KEY (card_id) REFERENCES training_cards(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE question_answers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attempt_id INT UNSIGNED NOT NULL,
  question_id INT UNSIGNED NOT NULL,
  selected_answer TINYINT UNSIGNED NOT NULL,
  correct TINYINT(1) NOT NULL,
  answered_at DATETIME NOT NULL,
  UNIQUE KEY one_answer (attempt_id, question_id),
  FOREIGN KEY (attempt_id) REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE notifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  message VARCHAR(255) NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE support_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE activity_log (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  text VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE departments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== Supplier evaluation (Supplier Master, Criteria Master and the evaluation form answers) =====
CREATE TABLE suppliers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  supplier_code VARCHAR(12) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL UNIQUE,
  category VARCHAR(80) NOT NULL DEFAULT '',
  contact_person VARCHAR(120) NOT NULL DEFAULT '',
  contact_no VARCHAR(40) NOT NULL DEFAULT '',
  email VARCHAR(160) NOT NULL DEFAULT '',
  tin VARCHAR(40) NOT NULL DEFAULT '',          -- Tax Identification Number of the supplier
  address VARCHAR(255) NOT NULL DEFAULT '',     -- physical address of the supplier
  department VARCHAR(80) NOT NULL DEFAULT '',   -- which department uses this supplier (empty = all departments)
  status ENUM('Under Review','Preferred','Approved','Conditional','Not Recommended') NOT NULL DEFAULT 'Under Review',
  current_score DECIMAL(4,1) NULL,
  last_evaluation DATE NULL,
  next_evaluation DATE NULL        -- start of the next fixed quarter after the last evaluation (Jan 1, Apr 1, Jul 1 or Oct 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Attachment 2303 (kind '2303', one file per supplier) and Extra Document/s (kind 'extra', as many as needed). The files are kept in the folder uploads/suppliers.
CREATE TABLE supplier_attachments (
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

CREATE TABLE criteria_master (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  weight TINYINT UNSIGNED NOT NULL,       -- percent, all weights add up to 100. Every criterion is one rating question in the form
  purpose VARCHAR(255) NOT NULL DEFAULT '',   -- the description shown under the question in the evaluation form
  sort_order INT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE supplier_evaluations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT UNSIGNED NOT NULL,
  evaluator_id INT UNSIGNED NOT NULL,
  service VARCHAR(160) NOT NULL,
  criticality ENUM('Critical','High','Medium','Low') NOT NULL,
  evaluation_date DATE NOT NULL,
  meets_requirements ENUM('Yes','Partially','No') NOT NULL,
  significant_issues ENUM('Yes','No') NOT NULL,
  corrective_required ENUM('Yes','No') NOT NULL,
  recommendation VARCHAR(120) NOT NULL,
  comments TEXT NOT NULL,
  issue_identified TEXT NULL, required_action TEXT NULL, supplier_response TEXT NULL,
  target_date DATE NULL, responsible_person VARCHAR(120) NULL, follow_up ENUM('Yes','No') NULL,
  supervisor_id INT UNSIGNED NULL,         -- immediate head / supervisor who is notified when corrective action is required
  corrective_status ENUM('Open','Resolved') NOT NULL DEFAULT 'Open',   -- Resolved actions are not counted in the dashboard's Action Required Alerts
  overall_score DECIMAL(4,1) NOT NULL,
  rating VARCHAR(20) NOT NULL,
  decision VARCHAR(30) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (evaluator_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- the 1 to 5 rating of every criterion in one evaluation (name and weight are saved as they were on the day of the evaluation)
CREATE TABLE evaluation_ratings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  evaluation_id INT UNSIGNED NOT NULL,
  criterion_id INT UNSIGNED NULL,          -- becomes empty if the criterion is removed from the Criteria Master later
  criterion_name VARCHAR(80) NOT NULL,
  weight TINYINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  FOREIGN KEY (evaluation_id) REFERENCES supplier_evaluations(id) ON DELETE CASCADE,
  FOREIGN KEY (criterion_id) REFERENCES criteria_master(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- one request per employee, supplier and quarter when an employee asks to evaluate a supplier again
CREATE TABLE reeval_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  supplier_id INT UNSIGNED NOT NULL,
  quarter_start DATE NOT NULL,
  supervisor_id INT UNSIGNED NULL,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  status ENUM('Pending','Approved','Declined','Used') NOT NULL DEFAULT 'Pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  decided_by INT UNSIGNED NULL,
  FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ================= IT KPI MATRIX =================
CREATE TABLE kpi_positions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE kpi_kras (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  position_id INT UNSIGNED NOT NULL,
  kra_no INT UNSIGNED NOT NULL DEFAULT 1,
  name VARCHAR(160) NOT NULL,
  weight DECIMAL(5,2) NOT NULL,
  FOREIGN KEY (position_id) REFERENCES kpi_positions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE kpi_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kra_id INT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  unit VARCHAR(30) NOT NULL DEFAULT '',
  target DECIMAL(14,2) NOT NULL,
  direction ENUM('higher','lower') NOT NULL DEFAULT 'higher',   -- higher = result must reach the target, lower = result must stay at or under it
  custom_weight DECIMAL(5,2) NULL,                              -- NULL = shared equally inside the KRA (the Management Guide default)
  evidence VARCHAR(255) NOT NULL DEFAULT '',
  sla_priority VARCHAR(40) NULL,
  sla_type ENUM('first_response','resolution') NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (kra_id) REFERENCES kpi_kras(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE kpi_results (
  kpi_id INT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  actual DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (kpi_id, year),
  FOREIGN KEY (kpi_id) REFERENCES kpi_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optional partial-credit scale of a position: a result that reaches at least min_pct % of the target earns credit_pct % of the KPI weight.
CREATE TABLE kpi_scale (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  position_id INT UNSIGNED NOT NULL,
  min_pct DECIMAL(5,2) NOT NULL,
  credit_pct DECIMAL(5,2) NOT NULL,
  FOREIGN KEY (position_id) REFERENCES kpi_positions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE kpi_sla (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  priority VARCHAR(40) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL DEFAULT '',
  examples VARCHAR(255) NOT NULL DEFAULT '',
  first_response VARCHAR(40) NOT NULL DEFAULT '',
  resolution VARCHAR(40) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per year: created the first time anyone loads the site in that year (this is what sends the yearly reminder).
CREATE TABLE kpi_reviews (
  year SMALLINT UNSIGNED PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  done_by INT UNSIGNED NULL,
  done_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- SLA criteria (from the SLA PDF)
INSERT INTO kpi_sla (priority, description, examples, first_response, resolution, sort_order) VALUES
('Critical', 'Complete or major disruption to critical business operations.', 'Server Down, SAP/ERP Unavailable, Core Network Failure, Firewall Failure, Major Internet Outage', '5 minutes', '2 hours', 1),
('High', 'Significant disruption affecting a branch, department, or multiple users.', 'Branch Network Issue, Department Outage, Major Hardware Failure, Multiple Users Unable to Work', '5 minutes', '4 hours', 2),
('Medium', 'Limited disruption affecting an individual user or small number of users.', 'PC Issue, Printer Offline, Email Issue', '15 minutes', '1 business day', 3),
('Low', 'Minor issue or standard technical request with limited business impact.', 'Password Reset, Printer Configuration, Basic Technical Concern', '30 minutes', '2 business days', 4);

-- ================= STARTING DATA =================
-- Only the admin account is created. Replace the email and password_hash below with your own admin login.
-- A password hash can be made with:  php -r "echo password_hash('YourStrongPassword', PASSWORD_DEFAULT);"
-- Employee accounts are created by the admin in Admin > Employees > Add employee.

INSERT INTO users (id, employee_id, name, email, password_hash, department, job_title, role, status, phone, joined) VALUES
(1, 'EMP-001', 'Alex Admin', 'admin@leads.com', '$2y$10$SX/qtD2qTBs49sRnkAqr0.nYYM7RiJSREonx.uNqiKZxnT2XlmXl.', 'Human Resources', 'Training Administrator', 'admin', 'Active', '', '2024-03-01');

INSERT INTO courses (id, title, description, category, duration, deadline, status) VALUES
(1, 'Company Workplace Standards', 'Required employee training covering workplace policies, procedures, safety standards and company guidelines.', 'Required Training', '2 hours', '2026-10-30', 'Published'),
(2, 'Information Security Awareness', 'How to spot phishing and protect company information at your desk.', 'Security', '45 minutes', '2026-11-15', 'Published');

INSERT INTO training_cards (id, course_id, title, document_type, content, sort_order, passing_score) VALUES
(1, 1, 'Employee Attendance Policy', 'Policy', '[["h","Working hours"],["p","Standard shifts start at 8:00 AM. Employees are expected to be at their workstation and ready to work at the start of the shift."],["h","Late arrival"],["p","A grace period of 10 minutes applies. Arrivals after the grace period are recorded as late."],["ul",["Three late arrivals within 30 days result in a written warning.","Repeated lateness may lead to further disciplinary action."]],["h","Absence"],["p","Employees who cannot attend must notify their direct supervisor at least 1 hour before the shift starts."],["warn","Absence for three consecutive days without notice is treated as job abandonment."],["h","Records"],["p","Attendance is recorded daily in the HR system. Employees may request a copy of their attendance record once a month."]]', 1, 100),
(2, 1, 'Workplace Safety Procedure', 'SOP', '[["h","Start of shift"],["p","Inspect your work area before starting. Check floors, equipment and exits for hazards."],["h","Personal protective equipment"],["p","Protective equipment must be worn in all marked zones. Zones are marked with yellow floor lines and signs."],["h","Spills"],["ol",["Place a wet floor sign at the spill.","Notify the area supervisor.","Clean the spill using the spill kit.","Dispose of used materials in the hazardous waste bin."]],["warn","Never remove or bypass a machine guard, even for a short time."],["h","Hazard reporting"],["p","Every hazard must be reported to a supervisor immediately, even if it has been fixed."]]', 2, 100),
(3, 1, 'Emergency Evacuation', 'Instruction', '[["h","When the alarm sounds"],["ol",["Stop work immediately.","Leave by the nearest safe exit.","Help visitors and colleagues who need assistance.","Go to your assembly point."]],["warn","Do not use elevators during an evacuation."],["h","Assembly point"],["p","The assembly point is Assembly Point A in the north parking lot. Fire wardens wear orange vests and will take a headcount."],["h","Re-entry"],["p","Do not re-enter the building until the Emergency Coordinator announces the all-clear."]]', 3, 100),
(4, 1, 'Data Privacy Rules', 'Policy', '[["h","Collection and use"],["p","Collect only the personal data needed for the task. Use it only for the purpose it was collected for."],["h","Access"],["p","Customer data may be accessed only when there is a business need. Access is logged and reviewed every quarter."],["h","Devices and messaging"],["ul",["Do not store personal data on personal devices.","Do not share customer data through personal messaging apps."]],["warn","Suspected data breaches must be reported to the Data Protection Officer within 24 hours."],["h","Retention"],["p","Customer records are kept for 5 years and then securely deleted."]]', 4, 100),
(5, 1, 'Password Security', 'Guideline', '[["h","Creating passwords"],["p","Passwords must contain at least 12 characters and include upper case, lower case, numbers and symbols."],["h","Keeping passwords safe"],["ul",["Change passwords every 90 days.","Use multi-factor authentication wherever it is offered.","Use the approved password manager."]],["warn","Never share your password, not even with IT staff or a manager."]]', 5, 100),
(6, 1, 'Incident Reporting', 'SOP', '[["h","Step 1: Safety first"],["p","Make sure everyone is safe and give first aid where needed before doing anything else."],["h","Step 2: Notify"],["p","Tell your supervisor immediately, by phone if they are not on site."],["h","Step 3: Document"],["p","Complete the Incident Report Form within 24 hours. Describe what happened, when, where and who was involved."],["ul",["Keep any evidence in place.","Do not speak to the media. Refer all questions to Corporate Communications."]],["warn","Near misses must also be reported."]]', 6, 100),
(7, 2, 'Phishing Awareness', 'Guideline', '[["h","Recognizing phishing"],["ul",["Unexpected urgency or threats.","Sender address that does not match the company name.","Links that lead to unfamiliar websites."]],["h","What to do"],["p","Do not click links or open attachments. Use the Report Phishing button in your mail client."],["warn","IT will never ask for your password by email."]]', 1, 100),
(8, 2, 'Clean Desk Standard', 'Standard', '[["h","Requirements"],["ul",["Lock your computer screen whenever you leave your desk.","Store confidential papers in a locked drawer at the end of the day.","Shred documents marked Confidential instead of binning them."]],["p","Visitors must be escorted at all times in work areas."]]', 2, 100);

INSERT INTO quiz_questions (id, card_id, question, type, options_json, correct_answer, explanation, sort_order) VALUES
(1, 1, 'How long before the shift must you notify your supervisor of an absence?', 'multiple_choice', '["15 minutes","1 hour","4 hours","The next day"]', 1, 'The policy requires notice at least 1 hour before the shift starts.', 1),
(2, 1, 'How long is the late arrival grace period?', 'multiple_choice', '["5 minutes","10 minutes","15 minutes","30 minutes"]', 1, 'A grace period of 10 minutes applies.', 2),
(3, 1, 'What happens after three late arrivals within 30 days?', 'multiple_choice', '["Verbal reminder","Written warning","Dismissal","Nothing"]', 1, 'Three late arrivals in 30 days result in a written warning.', 3),
(4, 2, 'When must protective equipment be worn?', 'multiple_choice', '["Only during inspections","In all marked zones","Only when a supervisor is present","Only for heavy machinery"]', 1, 'PPE is required in all marked zones.', 1),
(5, 2, 'What is the first step when you find a spill?', 'multiple_choice', '["Clean it with a towel","Place a wet floor sign","Leave it for the cleaner","Call the manager"]', 1, 'The first step is to place a wet floor sign at the spill.', 2),
(6, 2, 'You may briefly remove a machine guard if you are in a hurry.', 'true_false', '["True","False"]', 1, 'Machine guards must never be removed or bypassed.', 3),
(7, 3, 'You may use the elevator if it is closer than the stairs.', 'true_false', '["True","False"]', 1, 'Elevators must not be used during an evacuation.', 1),
(8, 3, 'Where is the assembly point?', 'multiple_choice', '["Main lobby","South gate","Assembly Point A in the north parking lot","Your own car"]', 2, 'Everyone gathers at Assembly Point A in the north parking lot.', 2),
(9, 3, 'Who announces that you may re-enter the building?', 'multiple_choice', '["Any colleague","The Emergency Coordinator","The security guard at the gate","Your supervisor by phone"]', 1, 'Only the Emergency Coordinator announces the all-clear.', 3),
(10, 4, 'Within what time must a suspected breach be reported?', 'multiple_choice', '["1 hour","24 hours","72 hours","One week"]', 1, 'Report suspected breaches to the Data Protection Officer within 24 hours.', 1),
(11, 4, 'Customer data may be shared through personal messaging apps.', 'true_false', '["True","False"]', 1, 'Personal messaging apps must not be used for customer data.', 2),
(12, 4, 'Customer data access must be based on what?', 'multiple_choice', '["Seniority","Curiosity","Business need","Department size"]', 2, 'Access is allowed only when there is a business need.', 3),
(13, 5, 'What is the minimum password length?', 'multiple_choice', '["6 characters","8 characters","12 characters","16 characters"]', 2, 'Passwords must have at least 12 characters.', 1),
(14, 5, 'You may share your password with a colleague for convenience.', 'true_false', '["True","False"]', 1, 'Passwords must never be shared.', 2),
(15, 5, 'How often must passwords be changed?', 'multiple_choice', '["Every 30 days","Every 90 days","Every year","Never"]', 1, 'Passwords are changed every 90 days.', 3),
(16, 6, 'What is the first step when an incident happens?', 'multiple_choice', '["Fill in the report form","Make sure everyone is safe and give first aid","Call the media","Tidy the area"]', 1, 'Safety comes first.', 1),
(17, 6, 'Within what time must the Incident Report Form be completed?', 'multiple_choice', '["1 hour","24 hours","3 days","1 week"]', 1, 'The form is due within 24 hours.', 2),
(18, 6, 'Near misses do not need to be reported.', 'true_false', '["True","False"]', 1, 'Near misses must also be reported.', 3),
(19, 7, 'What should you do with a suspicious email?', 'multiple_choice', '["Reply to the sender","Report it with the Report Phishing button","Forward it to colleagues","Open the attachment to check"]', 1, 'Use the Report Phishing button and do not interact with the message.', 1),
(20, 7, 'IT may ask for your password by email.', 'true_false', '["True","False"]', 1, 'IT will never ask for your password by email.', 2),
(21, 7, 'Which is a sign of phishing?', 'multiple_choice', '["A known sender","Unexpected urgency","A company signature","A calendar invite"]', 1, 'Urgency and threats are common phishing signs.', 3),
(22, 8, 'What should you do when you leave your desk?', 'multiple_choice', '["Leave the screen on","Lock the screen","Turn off the monitor only","Ask a colleague to watch it"]', 1, 'Always lock your screen.', 1),
(23, 8, 'Confidential documents can be thrown in the normal bin.', 'true_false', '["True","False"]', 1, 'They must be shredded.', 2),
(24, 8, 'How must visitors move in work areas?', 'multiple_choice', '["Freely","Escorted at all times","Only after 5 PM","With a visitor sticker only"]', 1, 'Visitors must be escorted.', 3);

INSERT INTO courses (id, title, description, category, duration, deadline, status) VALUES
(3, 'Supplier Management', 'How Leads evaluates its IT suppliers and third-party providers every quarter, and how to submit an evaluation.', 'Compliance', '20 minutes', '2026-11-30', 'Published');
INSERT INTO training_cards (id, course_id, title, document_type, card_kind, content, sort_order, passing_score) VALUES
(9, 3, 'IT Supplier & Third-Party Evaluation', 'Procedure', 'evaluation', '[["h","Purpose"],["p","Every IT supplier and third-party provider is evaluated each quarter by the employees who work with them. The evaluation shows whether a supplier should be kept, watched, corrected, reviewed by management, or replaced."],["h","Who evaluates"],["p","Only Leads employees fill in this form. Suppliers never answer it. Choose the supplier from the supplier list and its category and contact details appear automatically."],["h","How to rate"],["ol",["Rate each criterion from 1 (poor) to 5 (excellent).","Answer the three questions about requirements, issues, and corrective action.","Choose a recommendation and write your comments.","If corrective action is required, describe the issue you found. The administrator will record the corrective action, target date, and responsible person."]],["h","How the score is calculated"],["p","The overall score is determined by Performance Criteria, each assigned a specific weight based on organizational priority. The total weight of all criteria must equal 100%."],["h","Step 1: Multiply Score by Weight (As Decimals)"],["p","Convert the percentage weights into decimals (e.g., 15% = 0.15 and 10% = 0.10) and multiply them by the supplier’s raw 1–5 score:"],["h","Step 2: Sum the Weighted Points"],["p","Add all the calculated points from Step 1 together to find the Total Earned Points"],["h","Step 3: Convert to Final Percentage"],["p","Divide the Total Earned Points by the Maximum Possible Rating (5), then multiply by 100 to get the final percentage:"],["ul",["90% and above is Excellent and the supplier becomes a Preferred Supplier.","80% to 89.9% is Good and the supplier is Approved.","70% to 79.9% is Acceptable and the supplier is Conditional, with a performance improvement plan.","Below 70% is Poor and the supplier is Not Recommended."]],["warn","Evaluations follow fixed quarters: Jan 1 to Mar 31, Apr 1 to Jun 30, Jul 1 to Sep 30, and Oct 1 to Dec 31. The next evaluation of a supplier is due in the following quarter. If you select that corrective action is required, also choose your immediate head or supervisor, who is notified on the site."]]', 1, 100);

INSERT INTO criteria_master (name, weight, purpose, sort_order) VALUES
('Quality of Products/Services', 15, 'Measures reliability and quality', 1),
('Delivery Performance', 15, 'Measures whether commitments are delivered on time', 2),
('Technical Capability', 15, 'Measures technical competency and solution capability', 3),
('Issue Resolution', 15, 'Measures how effectively supplier resolves problems', 4),
('Cost / Value', 10, 'Measures price competitiveness and overall value', 5),
('Customer Support / Responsiveness', 10, 'Measures communication and support', 6),
('Security / Compliance', 10, 'Measures compliance with company/security requirements', 7),
('Reliability / Business Continuity', 10, 'Measures supplier stability and ability to continuously provide service', 8);

INSERT INTO suppliers (id, supplier_code, name, category, contact_person, contact_no, email) VALUES
(1, 'SUP-0001', 'ABC Technology', 'IT Hardware', 'Juan Dela Cruz', '0917-555-0101', 'abc@email.com'),
(2, 'SUP-0002', 'XYZ Solutions', 'Software / SaaS', 'Maria Santos', '0918-555-0102', 'msantos@xyz.com'),
(3, 'SUP-0003', 'Apex Cloud Systems', 'Cloud Infrastructure', 'Carlo Reyes', '0919-555-0103', 'creyes@apexcloud.com'),
(4, 'SUP-0004', 'DEF Services Corp', 'Managed Services', 'Antonio Garcia', '0920-555-0104', 'agarcia@defcorp.com'),
(5, 'SUP-0005', 'GHI Network Tech', 'IT Infrastructure', 'Elena Rivera', '0921-555-0105', 'erivera@ghinet.com'),
(6, 'SUP-0006', 'PLDT', 'Internet Services', 'Jonalyn', '0908-850-0019', 'jsbayani@pldt.com.ph');

-- Course: Phishing Awareness (10 video demonstrations + 20-question quiz). Videos are in the folder videos/phishing, the poster in img/.
INSERT INTO courses (title, description, category, duration, status) VALUES ('Phishing Awareness: Preventing Phishing Attacks', 'Learn what phishing is, how to spot its five common red flags, how to protect yourself, and what to do when you suspect a phishing attempt. Every red flag and every protection tip has a short video demonstration, and a final 20-question quiz covers the whole course.', 'Security', '20 minutes', 'Published');
SET @phish_course = LAST_INSERT_ID();
INSERT INTO training_cards (course_id, title, document_type, content, sort_order, passing_score) VALUES
(@phish_course, 'Beware of Phishing Attacks!', 'Guideline', '[["h", "Stay Alert. Stay Safe. Report Cybercrime."], ["image", "img/phishing-infographic.jpg", ""], ["h", "What is phishing?"], ["p", "Phishing is a cyber-attack where scammers trick you into revealing sensitive information like passwords, credit card numbers, or login credentials by pretending to be a trustworthy source."], ["p", "It usually arrives as an email, but it can also come as a text message, a chat message or a phone call."], ["h", "Common red flags"], ["p", "There are five common red flags. Watch the short video under each one: it shows exactly what to look for."], ["h", "Red flag 1: Suspicious links or attachments"], ["video", "videos/phishing/redflag-1-suspicious-links.mp4", "Video: how to spot a suspicious link or attachment."], ["p", "The text of a link can hide a different, fake address, and an attachment with a name like \\".pdf.exe\\" is a program, not a document. Both can install malware or lead to a fake login page."], ["h", "Red flag 2: Urgent language like \\"Your account will be closed!\\""], ["video", "videos/phishing/redflag-2-urgent-language.mp4", "Video: how scammers use pressure and countdowns."], ["p", "Scammers rush you with threats and deadlines so you click before you think. Stop and verify first."], ["h", "Red flag 3: Unfamiliar sender email addresses"], ["video", "videos/phishing/redflag-3-unfamiliar-sender.mp4", "Video: checking the full sender address and domain."], ["p", "A familiar display name is not enough. Check the full email address. Our real company domains are leadsagri.com and malvedaholdings.com."], ["h", "Red flag 4: Requests for personal or financial information"], ["video", "videos/phishing/redflag-4-personal-financial-info.mp4", "Video: requests for passwords, card numbers and PINs."], ["p", "Real IT, banks and HR do not ask for your password, credit card number or PIN by email. Never reply with this information."], ["h", "Red flag 5: Generic greetings like \\"Dear User\\""], ["video", "videos/phishing/redflag-5-generic-greeting.mp4", "Video: generic greetings versus a personal message."], ["p", "Scammers send the same message to thousands of people, so they use greetings like \\"Dear User\\". A personal greeting alone is not proof that an email is safe, so always check the sender and the links too."], ["h", "How to protect yourself"], ["p", "Five habits keep you and the company safe. Watch the short video under each one."], ["h", "Protection 1: Verify the sender before clicking"], ["video", "videos/phishing/protect-1-verify-sender.mp4", "Video: verifying a sender before you click."], ["p", "Check the full email address and compare it with the company directory. If in doubt, contact the sender through a phone number or channel you already know."], ["h", "Protection 2: Hover over links to check the destination"], ["video", "videos/phishing/protect-2-hover-links.mp4", "Video: hovering over a link to read its real destination."], ["p", "Move your mouse over a link without clicking. The real address appears in a tooltip or the status bar. If it does not match what you expect, do not click."], ["h", "Protection 3: Never share passwords or PINs"], ["video", "videos/phishing/protect-3-never-share-passwords.mp4", "Video: refusing a request for your password."], ["p", "Your password and PIN are for you only. Do not share them with IT, a manager or a colleague."], ["warn", "IT will never ask for your password by email."], ["h", "Protection 4: Enable 2-Factor Authentication"], ["video", "videos/phishing/protect-4-two-factor.mp4", "Video: how 2-Factor Authentication stops a scammer."], ["p", "With 2-Factor Authentication, a stolen password is not enough to sign in, because the scammer also needs your second step, such as a code on your phone."], ["h", "Protection 5: Report suspicious emails to the IT Team"], ["video", "videos/phishing/protect-5-report-to-it.mp4", "Video: reporting a suspicious email to the IT Team."], ["p", "Forward the email to it@leadsagri.com or it@malvedaholdings.com, or contact the IT Department through LeadsDeskMetamorph. Delete the email after you have reported it."], ["h", "If you suspect a phishing attempt"], ["p", "Contact our IT Department immediately at LeadsDeskMetamorph, or email it@malvedaholdings.com / it@leadsagri.com."], ["ol", ["Do not click any link, open any attachment or reply.", "Contact the IT Department immediately.", "Delete the email after you have reported it."]], ["warn", "One wrong click can cost you your money, data - even your identity."]]', 1, 80);
SET @phish_card = LAST_INSERT_ID();
INSERT INTO quiz_questions (card_id, question, type, options_json, correct_answer, explanation, sort_order) VALUES
(@phish_card, 'What is phishing?', 'multiple_choice', '["A cyber-attack where scammers trick you into revealing sensitive information by pretending to be trustworthy", "A software update sent by the IT Department", "A type of computer hardware", "A tool that filters spam"]', 0, 'Phishing tricks people into giving up passwords, card numbers or login details by pretending to be a trustworthy source.', 1),
(@phish_card, 'Which of these is a common red flag of phishing?', 'multiple_choice', '["A message that greets you by name and talks about real work", "Urgent language like \\"Your account will be closed!\\"", "An email from a colleague you were just speaking to", "A calendar invite from your manager"]', 1, 'Urgent language and threats push you to act before you think.', 2),
(@phish_card, 'The text of a link always shows where the link really goes.', 'true_false', '["True", "False"]', 1, 'Link text can hide a fake address. Hover over the link to see the real destination.', 3),
(@phish_card, 'What is an attachment named "Invoice_88213.pdf.exe"?', 'multiple_choice', '["A normal PDF document", "A safe image", "A program that could install malware", "A spreadsheet"]', 2, 'A ".exe" ending means it is a program, even if the name starts with ".pdf". Do not open it.', 4),
(@phish_card, 'A sender is shown as "Leads IT Support" but the address ends with @leads-agri-helpdesk.co. What should you do?', 'multiple_choice', '["Reply to confirm your login", "Trust it because of the display name", "Forward it to all your colleagues", "Treat it as suspicious because the domain does not match our company domains"]', 3, 'Always check the full address. Our real domains are leadsagri.com and malvedaholdings.com.', 5),
(@phish_card, 'An email that starts with "Dear User" may have been sent to many people at once.', 'true_false', '["True", "False"]', 0, 'Scammers do not know your name, so they use generic greetings. Still check the sender and links, because a personal greeting alone is not proof of safety.', 6),
(@phish_card, 'How can you check where a link really goes?', 'multiple_choice', '["Hover over it without clicking and read the address", "Click it quickly and look at the page", "Forward it to a friend", "Print the email"]', 0, 'Hovering shows the real destination in a tooltip or the status bar.', 7),
(@phish_card, 'In the link http://leadsagri.com.login-check.xyz/verify, which is the real website?', 'multiple_choice', '["leadsagri.com", "login-check.xyz", "verify", "http"]', 1, 'The real site is the domain just before the first "/", which is login-check.xyz.', 8),
(@phish_card, 'You may share your password with IT if they ask you by email.', 'true_false', '["True", "False"]', 1, 'IT will never ask for your password by email. Never share passwords or PINs.', 9),
(@phish_card, 'Why does 2-Factor Authentication help?', 'multiple_choice', '["It makes passwords unnecessary", "It blocks all emails", "Even if a scammer steals your password, they still need your second step to sign in", "It deletes phishing emails automatically"]', 2, 'The second step, such as a code on your phone, stops a scammer who only has your password.', 10),
(@phish_card, 'Situation: An email from "Finance Department" asks you to use new bank details for a payment. The sender address does not match the company directory. What do you do?', 'multiple_choice', '["Make the payment because it is from Finance", "Reply and ask them to confirm the new details", "Forward it to your team so they can decide", "Do not click. Contact Finance on a number you already know, and report the email to the IT Team"]', 3, 'Verify the sender before clicking, using a channel you already trust, and report the email.', 11),
(@phish_card, 'Situation: Someone in a chat says they are from IT and asks you to send your password so they can fix your account. What do you do?', 'multiple_choice', '["Refuse, never share your password, and report the message to the IT Team", "Send it, because IT needs it", "Send only half of the password", "Ask them to send an email instead and then reply with it"]', 0, 'Passwords and PINs are never shared, not even with IT. Report the request.', 12),
(@phish_card, 'Situation: You get an email saying "Your account will be closed in 24 hours! Verify now." with a countdown timer. What is the best action?', 'multiple_choice', '["Click Verify now before the time runs out", "Stop, do not click, and report it to the IT Team", "Reply with your account details", "Forward it to a friend"]', 1, 'Urgent threats are a red flag. Scammers rush you so you do not think.', 13),
(@phish_card, 'Situation: You clicked a link in a suspicious email and typed your password on the page that opened. What should you do?', 'multiple_choice', '["Do nothing and hope for the best", "Wait a few days to see if anything happens", "Contact the IT Department immediately and tell them what happened", "Delete the email and tell nobody"]', 2, 'If you suspect a phishing attempt, contact the IT Department immediately. Quick action limits the damage.', 14),
(@phish_card, 'Situation: An email says "Dear User" and asks you to open the attachment "Salary_Update.pdf.exe" to see your new salary. What should you do?', 'multiple_choice', '["Open it because it is about your salary", "Open it on your phone instead", "Save it and open it later", "Do not open it. The generic greeting and the .exe attachment are red flags, so report it to the IT Team"]', 3, 'A generic greeting and a ".exe" attachment are two red flags in one email.', 15),
(@phish_card, 'Situation: An email from your manager greets you by name, but when you hover over the link it shows a website you do not recognise. What should you do?', 'multiple_choice', '["Do not click. Check with your manager another way and report it to the IT Team", "Click it because it is from your manager", "Reply with your password so they can open it", "Forward it to your team"]', 0, 'A personal greeting is not proof. Hover over links, and verify with the sender through another channel.', 16),
(@phish_card, 'Situation: An email says you won a gift and asks you to reply with your credit card number and PIN to claim it. What should you do?', 'multiple_choice', '["Reply with the details to claim the gift", "Do not reply. Real organisations never ask for these by email, so report it to the IT Team", "Send only the card number", "Send only the PIN"]', 1, 'Requests for personal or financial information are a red flag. Never reply with them.', 17),
(@phish_card, 'Situation: You have turned on 2-Factor Authentication. A scammer who stole your password tries to sign in. What happens?', 'multiple_choice', '["They get in, because they have the password", "Your password is changed automatically", "They are blocked, because they do not have your second step", "Nothing, because 2-Factor Authentication only works on phones"]', 2, 'The scammer cannot pass the second step, such as the code on your phone.', 18),
(@phish_card, 'Situation: You are not sure if an email is phishing. What is the best thing to do?', 'multiple_choice', '["Click the link carefully to test it", "Forward it to everyone to ask what they think", "Delete it and tell nobody", "Do not click, reply or open attachments, and report it to the IT Team"]', 3, 'When in doubt, do not interact with it. Report it to the IT Team, who can check it safely.', 19),
(@phish_card, 'Where should you report a suspicious email?', 'multiple_choice', '["To the IT Team at it@leadsagri.com / it@malvedaholdings.com, or through LeadsDeskMetamorph", "In a group chat with colleagues", "To the sender, by replying", "Nowhere, just ignore it"]', 0, 'Report it to the IT Team so they can protect you and your colleagues.', 20);

-- Request for Check (all roles)

CREATE TABLE rfc_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  owner_name VARCHAR(120) NOT NULL DEFAULT '',
  employee_name VARCHAR(160) NOT NULL DEFAULT '',
  account_number VARCHAR(60) NOT NULL DEFAULT '',
  vendor_name VARCHAR(200) NOT NULL,
  vendor_address VARCHAR(300) NOT NULL DEFAULT '',
  vendor_tin VARCHAR(40) NOT NULL DEFAULT '',
  date_needed DATE NULL,
  date_of_check DATE NULL,
  reason ENUM('Reimbursement','Incentive','Sponsorship','Payment','Others') NOT NULL DEFAULT 'Payment',
  purpose TEXT NULL,
  note VARCHAR(300) NOT NULL DEFAULT '',
  instructions TEXT NULL,
  requested_by VARCHAR(120) NOT NULL DEFAULT '',
  recommended_by VARCHAR(240) NOT NULL DEFAULT '',
  approved_by VARCHAR(120) NOT NULL DEFAULT '',
  requested_date DATE NULL,
  recommended_date DATE NULL,
  approved_date DATE NULL,
  total DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE rfc_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rfc_id INT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  name VARCHAR(200) NOT NULL,
  units INT UNSIGNED NOT NULL DEFAULT 1,
  amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  users_json TEXT NULL,            -- the users matched with the item: [{"name": "...", "detail": "..."}]; empty = an item without a user
  FOREIGN KEY (rfc_id) REFERENCES rfc_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Request for Check e-signatures (Jel, Sherwin, Joel, Catherine)

CREATE TABLE rfc_signatures (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rfc_id INT UNSIGNED NOT NULL,
  signer_key VARCHAR(30) NOT NULL,                                  -- jel, sherwin, joel or catherine
  slot ENUM('requested','recommended','approved') NOT NULL,         -- the line of the form that was signed
  user_id INT UNSIGNED NULL,
  signer_name VARCHAR(120) NOT NULL DEFAULT '',
  image MEDIUMTEXT NULL,                                            -- copy of the e-signature picture at the time of signing
  signed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY one_signature (rfc_id, signer_key, slot),
  FOREIGN KEY (rfc_id) REFERENCES rfc_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- IT Procurement Requisition

CREATE TABLE itp_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  owner_name VARCHAR(120) NOT NULL DEFAULT '',
  date_of_request DATE NULL,
  date_required DATE NULL,
  department VARCHAR(100) NOT NULL DEFAULT '',
  requested_by VARCHAR(120) NOT NULL DEFAULT '',
  noted_by VARCHAR(120) NOT NULL DEFAULT '',
  subsidiary VARCHAR(160) NOT NULL DEFAULT '',
  chargeable ENUM('Yes','No') NOT NULL DEFAULT 'No',
  chargeable_to VARCHAR(160) NOT NULL DEFAULT '',
  budget ENUM('Yes','No') NOT NULL DEFAULT 'No',
  budget_amount DECIMAL(14,2) NULL,
  nature ENUM('Equipment','License','Repair','Maintenance','Software','Others') NOT NULL DEFAULT 'Equipment',
  nature_other VARCHAR(100) NOT NULL DEFAULT '',
  special_instructions TEXT NULL,
  purpose TEXT NULL,
  assignee VARCHAR(160) NOT NULL DEFAULT '',
  requestor_name VARCHAR(120) NOT NULL DEFAULT '',
  line_manager_name VARCHAR(120) NOT NULL DEFAULT '',
  it_staff_name VARCHAR(120) NOT NULL DEFAULT '',
  stage VARCHAR(20) NOT NULL DEFAULT 'draft',   -- draft, assessment, approval, approved, received, closed
  line_manager_id INT UNSIGNED NULL,
  assessment_url VARCHAR(500) NOT NULL DEFAULT '',
  assessed_by INT UNSIGNED NULL,
  submitted_at DATETIME NULL,
  received_at DATETIME NULL,
  closed_at DATETIME NULL,
  total DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE itp_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  itp_id INT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  qty INT UNSIGNED NOT NULL DEFAULT 1,
  unit VARCHAR(30) NOT NULL DEFAULT '',
  description VARCHAR(200) NOT NULL,
  budgeted_price DECIMAL(14,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (itp_id) REFERENCES itp_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- IT Procurement Requisition e-signatures (requestor, linemanager, itstaff, itmanager)
CREATE TABLE itp_signatures (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  itp_id INT UNSIGNED NOT NULL,
  role VARCHAR(20) NOT NULL,
  user_id INT UNSIGNED NULL,
  signer_name VARCHAR(120) NOT NULL DEFAULT '',
  image MEDIUMTEXT NULL,
  auto_applied TINYINT(1) NOT NULL DEFAULT 0,
  signed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY one_signature (itp_id, role),
  FOREIGN KEY (itp_id) REFERENCES itp_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
