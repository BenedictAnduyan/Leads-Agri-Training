-- Leads Training: Task Management tables (version 2: Daily / Weekly / Personal tasks, due time, subtasks, Missing).
-- Safe to run on the EXISTING database (phpMyAdmin > leads_training > Import). It only creates tables that do not exist yet.
-- It does not touch, reset or delete users, suppliers, training records or any other data. Running it twice does nothing the second time.
-- (You do not have to import it: api/task_lib.php runs this file automatically, and also adds the new columns (frequency, due_time)
--  to an older tasks table, the first time the Task Management tab is opened.)
-- Keep comments on their own lines and do not put a semicolon inside a string: the automatic installer splits this file at each semicolon.

USE leads_training;

-- One row per task (the shared part: title, description, priority, category, type, dates).
-- is_personal = 1: a personal task the employee made for themselves (frequency personal).
-- is_personal = 0: assigned by an administrator or an immediate superior (users.role = 'superior' or 'executive'), frequency daily or weekly.
-- due_date + due_time is the exact deadline. A task with no due_time is due at the end of its due date.
CREATE TABLE IF NOT EXISTS tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  description TEXT NULL,
  priority ENUM('Low','Medium','High') NOT NULL DEFAULT 'Medium',
  category VARCHAR(40) NOT NULL DEFAULT 'General',
  frequency ENUM('personal','daily','weekly') NOT NULL DEFAULT 'personal',
  start_date DATE NULL,
  due_date DATE NULL,
  due_time TIME NULL,
  is_personal TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tasks_created_by (created_by),
  KEY idx_tasks_due (due_date),
  CONSTRAINT fk_tasks_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per employee per task: each assigned employee has their own independent status and completion time.
-- The status saved here is To Do, In Progress or Completed. "Missing" is worked out from the deadlines (it is never saved), so it clears by itself when a date is moved.
-- due_soon_notified / overdue_notified make sure each reminder notification is sent only once.
CREATE TABLE IF NOT EXISTS task_assignments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  status ENUM('To Do','In Progress','Completed') NOT NULL DEFAULT 'To Do',
  completed_at DATETIME NULL,
  due_soon_notified DATE NULL,
  overdue_notified TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY one_per_employee (task_id, user_id),
  KEY idx_ta_user_status (user_id, status),
  CONSTRAINT fk_ta_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The steps (subtasks) of a task, in order. projected_date is the planned date for the step (it must be on or before the due date of the task).
-- dependencies = what the step waits for (one per line), copied to every assigned employee as a starting list.
CREATE TABLE IF NOT EXISTS task_subtasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id INT UNSIGNED NOT NULL,
  position SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  title VARCHAR(160) NOT NULL,
  details TEXT NULL,
  projected_date DATE NOT NULL,
  dependencies TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ts_task (task_id, position),
  CONSTRAINT fk_ts_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per employee per subtask: that employee's own progress on the step.
-- projected_date starts as the planned date and can be moved for this employee only (by the administrator or the immediate superior).
-- is_open = 1: the superior opened this one step to the other people of the same department, claimed_by = the person who took it.
-- reason_status: none, pending (the employee explained a missed date and waits for the decision), valid, rejected.
CREATE TABLE IF NOT EXISTS assignment_subtasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id INT UNSIGNED NOT NULL,
  subtask_id INT UNSIGNED NOT NULL,
  status ENUM('To Do','In Progress','Completed') NOT NULL DEFAULT 'To Do',
  progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  projected_date DATE NOT NULL,
  completed_at DATETIME NULL,
  completed_by INT UNSIGNED NULL,
  is_open TINYINT(1) NOT NULL DEFAULT 0,
  opened_by INT UNSIGNED NULL,
  opened_at DATETIME NULL,
  claimed_by INT UNSIGNED NULL,
  claimed_at DATETIME NULL,
  reason_status ENUM('none','pending','valid','rejected') NOT NULL DEFAULT 'none',
  missed_notified TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY one_per_step (assignment_id, subtask_id),
  KEY idx_as_open (is_open, claimed_by),
  CONSTRAINT fk_as_assignment FOREIGN KEY (assignment_id) REFERENCES task_assignments(id) ON DELETE CASCADE,
  CONSTRAINT fk_as_subtask FOREIGN KEY (subtask_id) REFERENCES task_subtasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- What a step is waiting for (example: Budget issuance). A step cannot be completed while one of its dependencies is not resolved.
CREATE TABLE IF NOT EXISTS subtask_dependencies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  a_subtask_id INT UNSIGNED NOT NULL,
  label VARCHAR(200) NOT NULL,
  resolved TINYINT(1) NOT NULL DEFAULT 0,
  resolved_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sd_step (a_subtask_id),
  CONSTRAINT fk_sd_step FOREIGN KEY (a_subtask_id) REFERENCES assignment_subtasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The history of a step: progress updates, reasons for a missed date, decisions, opening, taking over, date changes.
CREATE TABLE IF NOT EXISTS subtask_updates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  a_subtask_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  kind VARCHAR(20) NOT NULL DEFAULT 'progress',
  note TEXT NULL,
  progress TINYINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_su_step (a_subtask_id, id),
  CONSTRAINT fk_su_step FOREIGN KEY (a_subtask_id) REFERENCES assignment_subtasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Files attached to a step (for example a medical certificate). They are kept in uploads/tasks under a random name and only opened through api/task.php.
CREATE TABLE IF NOT EXISTS subtask_files (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  a_subtask_id INT UNSIGNED NOT NULL,
  update_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  file_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(80) NOT NULL,
  mime VARCHAR(120) NOT NULL DEFAULT '',
  size INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sf_step (a_subtask_id),
  CONSTRAINT fk_sf_step FOREIGN KEY (a_subtask_id) REFERENCES assignment_subtasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
