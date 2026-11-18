-- Leads Training: Task Management tables.
-- Safe to run on the EXISTING database (phpMyAdmin > leads_training > Import). It only creates two new tables.
-- It does not touch, reset or delete users, suppliers, training records or any other data. Running it twice does nothing the second time.
-- (If you forget to import it, api/task_lib.php runs this same file automatically the first time the Task Management tab is opened.)
-- Keep comments on their own lines and do not put a semicolon inside a string: the automatic installer splits this file at each semicolon.

USE leads_training;

-- One row per task (the shared part: title, description, priority, category, dates).
-- is_personal = 1: a personal task the employee made for themselves. is_personal = 0: assigned by an administrator or an immediate superior (users.role = 'superior').
CREATE TABLE IF NOT EXISTS tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  description TEXT NULL,
  priority ENUM('Low','Medium','High') NOT NULL DEFAULT 'Medium',
  category VARCHAR(40) NOT NULL DEFAULT 'General',
  start_date DATE NULL,
  due_date DATE NULL,
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
