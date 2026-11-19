<?php
// Task Management: shared code (tables, who may do what, the data sent to the browser, notifications and reminders).
// Everything here is decided on the server. The browser only shows buttons; api/task.php checks every action again with the same functions.
//
// Model:  tasks (the shared part of a task)  1 --- n  task_assignments (one row per employee, each with its OWN status)
//         tasks 1 --- n task_subtasks (the ordered steps)  1 --- n assignment_subtasks (each employee's own progress on each step)
//         A task assigned to 5 people is 5 assignments, so each person has independent progress.
// Types (tasks.frequency): personal (own task of the employee), daily and weekly (assigned by an administrator or an immediate superior).
// Statuses shown: To Do, In Progress, Completed and Missing. Missing is WORKED OUT (deadline passed, or a step passed its projected date, and the task is not completed);
//   it is never saved, so it disappears by itself when a date is moved or the work is completed.
// Roles (users.role):
//   admin     creates / assigns to any employee, sees every task, edits, updates and deletes any task.
//   superior  (Immediate Superior = Supervisor / Manager; an executive has the same access) assigns tasks ONLY to the people under them in the hierarchy
//             (the people who report to them, directly or through others, and the lower-ranked people of their own department).
//             They never see or pick people above them (their own superior, an executive above them, the admin).
//   employee  creates personal tasks (edit / delete own), sees tasks assigned to them and works on them.
// Tables are created from sql/migration_tasks.sql (automatically the first time, if it was not imported by hand).
require_once __DIR__ . '/helpers.php';

const TASK_TZ = 'Asia/Manila'; // deadlines (date + time) are compared with this clock
date_default_timezone_set(TASK_TZ);

const TASK_STATUSES = ['To Do', 'In Progress', 'Completed']; // the statuses that are saved
const TASK_SHOWN = ['To Do', 'In Progress', 'Completed', 'Missing']; // the statuses that are shown (Missing is worked out)
const TASK_FREQS = ['personal', 'daily', 'weekly'];
const TASK_PRIORITIES = ['Low', 'Medium', 'High'];
const TASK_CATEGORIES = ['General', 'Training', 'Supplier', 'Reports', 'Meeting', 'Follow-up', 'Urgent', 'Personal']; // suggestions only; any text up to 40 characters is accepted
// An immediate superior may also assign to the lower-ranked people of their own department who do not report to them (true), or only to their reporting line (false).
const TASK_SUP_SAME_DEPT = true;
// A task is shown as Missing when one of its steps passed its projected date and is not completed (true), or only when the whole task passed its deadline (false).
const TASK_SUBTASK_MISS_FLAGS_TASK = true;
const TASK_DUE_SOON_DAYS = 2; // "due soon" notification this many days before the due date (and on the due date itself)
const TASK_MAX_SUBTASKS = 30;
const TASK_FILE_MAX = 10 * 1024 * 1024; // 10 MB for each attachment
const TASK_FILE_TYPES = ['pdf' => 'application/pdf', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'doc' => 'application/msword', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls' => 'application/vnd.ms-excel', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

/* ---------- tables ---------- */
function task_ready() {
    static $ok = null;
    if ($ok !== null) return $ok;
    try {
        $t = (int) q("SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tasks', 'task_assignments', 'task_subtasks', 'assignment_subtasks', 'subtask_dependencies', 'subtask_updates', 'subtask_files')")[0]['c'];
        $c = (int) q("SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME IN ('frequency', 'due_time')")[0]['c'];
        if ($t < 7 || $c < 2) task_install();
        $ok = true;
    } catch (Throwable $e) { $ok = false; }
    return $ok;
}
function task_install() { // run sql/migration_tasks.sql (CREATE TABLE IF NOT EXISTS only, so existing data is never touched), then add the new columns to an older tasks table
    $file = dirname(__DIR__) . '/sql/migration_tasks.sql';
    if (!is_readable($file)) throw new RuntimeException('sql/migration_tasks.sql is missing.');
    $sql = preg_replace('/^\s*--.*$/m', '', file_get_contents($file));
    foreach (explode(';', $sql) as $stmt) {
        $stmt = trim($stmt);
        if ($stmt === '' || stripos($stmt, 'USE ') === 0) continue; // the database is already chosen by config.php
        db()->exec($stmt);
    }
    $have = array_column(q("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks'"), 'c');
    try { if (!in_array('due_time', $have, true)) db()->exec('ALTER TABLE tasks ADD COLUMN due_time TIME NULL AFTER due_date'); } catch (Throwable $e) { /* another request added it */ }
    try {
        if (!in_array('frequency', $have, true)) {
            db()->exec("ALTER TABLE tasks ADD COLUMN frequency ENUM('personal','daily','weekly') NOT NULL DEFAULT 'personal' AFTER category");
            // tasks that were assigned before this update become Daily (due within a day of being created) or Weekly
            db()->exec("UPDATE tasks SET frequency = IF(DATEDIFF(COALESCE(due_date, CURDATE()), DATE(created_at)) <= 1, 'daily', 'weekly') WHERE is_personal = 0");
        }
    } catch (Throwable $e) { /* another request added it */ }
}
function task_upload_dir() {
    $d = dirname(__DIR__) . '/uploads/tasks'; if (!is_dir($d)) @mkdir($d, 0755, true);
    $h = $d . '/.htaccess';
    if (!is_file($h)) @copy(dirname(__DIR__) . '/uploads/suppliers/.htaccess', $h);
    return $d;
}

/* ---------- small helpers ---------- */
function task_str($v) { return is_scalar($v) ? trim((string) $v) : ''; }
function task_date($v, $label) { // '' = no date. Otherwise it must be a real calendar date yyyy-mm-dd
    $v = task_str($v);
    if ($v === '') return null;
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) fail(400, 'Enter a valid ' . $label . '.');
    return $v;
}
function task_time($v, $label) { // '' = no time. Otherwise hh:mm (24 hours)
    $v = task_str($v);
    if ($v === '') return null;
    if (!preg_match('/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/', $v, $m)) fail(400, 'Enter a valid ' . $label . '.');
    return $m[1] . ':' . $m[2] . ':00';
}
function task_d($d) { return $d ? date('M j, Y', strtotime($d)) : ''; }
function task_t($t) { return $t ? date('g:i A', strtotime('2000-01-01 ' . $t)) : ''; }
function task_dt($d, $t) { return $d ? task_d($d) . ($t ? ' ' . task_t($t) : '') : ''; }
function task_note($uid, $title, $msg) { add_note((int) $uid, mb_substr($title, 0, 160), mb_substr($msg, 0, 255)); } // the existing notification bell; titles start with "Task " so the bell links to this tab
function task_cut($s, $n = 60) { return mb_strlen($s) > $n ? mb_substr($s, 0, $n - 1) . '…' : $s; }
function task_due_ts($d, $t) { return $d ? strtotime($d . ' ' . ($t ? $t : '23:59:59')) : null; } // no time = the end of the due date

/* ---------- the hierarchy (who is under whom) ---------- */
function task_rank($role) { $r = ['employee' => 1, 'superior' => 2, 'executive' => 3, 'admin' => 4]; return isset($r[$role]) ? $r[$role] : 0; }
function task_people() { // every account, read once per request: [id => row]
    static $c = null;
    if ($c === null) { $c = []; foreach (q('SELECT id, name, department, job_title, role, supervisor_id, status FROM users') as $r) $c[(int) $r['id']] = $r; }
    return $c;
}
function task_downline($uid) { // everybody who reports to this person, directly or through other people
    $P = task_people(); $seen = []; $todo = [(int) $uid];
    while ($todo) {
        $cur = array_pop($todo);
        foreach ($P as $p) if ($p['supervisor_id'] !== null && (int) $p['supervisor_id'] === $cur && !isset($seen[(int) $p['id']]) && (int) $p['id'] !== (int) $uid) { $seen[(int) $p['id']] = true; $todo[] = (int) $p['id']; }
    }
    return array_keys($seen);
}
function task_ancestors($uid) { // the superior, the superior's superior, and so on
    $P = task_people(); $o = []; $cur = (int) $uid;
    for ($i = 0; $i < 20; $i++) {
        if (!isset($P[$cur]) || $P[$cur]['supervisor_id'] === null) break;
        $cur = (int) $P[$cur]['supervisor_id'];
        if (in_array($cur, $o, true) || $cur === (int) $uid) break;
        $o[] = $cur;
    }
    return $o;
}
function task_same_dept($a, $b) { return trim((string) $a) !== '' && strcasecmp(trim((string) $a), trim((string) $b)) === 0; }

/* ---------- who may do what ---------- */
function task_can_assign($u) { return $u['role'] === 'admin' || is_superior_role($u); } // admin, immediate superior or executive
// The employees this person may assign tasks to (never admins, never inactive accounts, never anybody above them in the hierarchy).
function task_pool($u) {
    $uid = (int) $u['id']; $P = task_people(); $ids = [];
    if ($u['role'] === 'admin') { foreach ($P as $p) $ids[] = (int) $p['id']; }
    elseif (is_superior_role($u)) {
        $ids = task_downline($uid);
        if (TASK_SUP_SAME_DEPT) {
            $rank = task_rank($u['role']);
            foreach ($P as $p) if ((int) $p['id'] !== $uid && task_same_dept($u['department'], $p['department']) && task_rank($p['role']) < $rank) $ids[] = (int) $p['id'];
        }
        $ids = array_diff($ids, task_ancestors($uid), [$uid]); // nobody above this person can ever be in the list
    }
    $o = [];
    foreach (array_unique($ids) as $id) {
        $p = isset($P[$id]) ? $P[$id] : null;
        if (!$p || $p['status'] !== 'Active' || !in_array($p['role'], ['employee', 'superior', 'executive'], true)) continue;
        $o[] = $p;
    }
    usort($o, function ($a, $b) { return strcasecmp($a['name'], $b['name']); });
    return $o;
}
// SQL condition for the assignments (rows) a person is allowed to SEE. $a = task_assignments, $t = tasks, $au = the assigned user.
//   admin: all.  superior: own + tasks they assigned + assigned tasks of the people under them (never the personal tasks of others).  employee: own only.
function task_scope($u) {
    $id = (int) $u['id'];
    if ($u['role'] === 'admin') return ['1 = 1', []];
    $w = ['a.user_id = ?']; $p = [$id];
    if (is_superior_role($u)) {
        $w[] = '(t.is_personal = 0 AND t.created_by = ?)'; $p[] = $id;
        $down = task_downline($id);
        if ($down) $w[] = '(t.is_personal = 0 AND a.user_id IN (' . implode(',', array_map('intval', $down)) . '))';
    }
    return ['(' . implode(' OR ', $w) . ')', $p];
}
// Who may review, move dates and open steps of ONE assignment: the admin, the person who assigned the task, and the assignee's superiors. $c needs user_id, created_by, is_personal.
function task_is_boss($u, $c) {
    if ($u['role'] === 'admin') return true;
    if ((int) $c['is_personal'] === 1 || !task_can_assign($u)) return false;
    $uid = (int) $u['id'];
    return ($c['created_by'] !== null && (int) $c['created_by'] === $uid) || in_array($uid, task_ancestors((int) $c['user_id']), true);
}
// What the person may do with ONE assignment row (a row of TASK_SQL).
function task_perm($u, $r) {
    $uid = (int) $u['id'];
    $admin = $u['role'] === 'admin';
    $personal = (int) $r['is_personal'] === 1;
    $owner = (int) $r['user_id'] === $uid;
    $creator = $r['created_by'] !== null && (int) $r['created_by'] === $uid;
    $manage = $admin || ($personal ? $owner : (task_can_assign($u) && $creator)); // edit / delete the task itself
    return ['edit' => $manage, 'delete' => $manage, 'status' => $admin || $owner || (!$personal && task_can_assign($u) && $creator)];
}
// The same checks for a whole task (used by save and delete). $assigns = its assignment rows.
function task_can_see($u, $t, $assigns) {
    if ($u['role'] === 'admin') return true;
    $uid = (int) $u['id'];
    foreach ($assigns as $a) if ((int) $a['user_id'] === $uid) return true;
    if (!is_superior_role($u) || (int) $t['is_personal'] === 1) return false;
    if ($t['created_by'] !== null && (int) $t['created_by'] === $uid) return true;
    $down = task_downline($uid);
    foreach ($assigns as $a) if (in_array((int) $a['user_id'], $down, true)) return true;
    return false;
}
function task_can_manage($u, $t, $assigns) {
    if ($u['role'] === 'admin') return true;
    $uid = (int) $u['id'];
    if ((int) $t['is_personal'] === 1) { foreach ($assigns as $a) if ((int) $a['user_id'] === $uid) return true; return false; }
    return task_can_assign($u) && $t['created_by'] !== null && (int) $t['created_by'] === $uid;
}
// Loads a task the person may act on. 404 when they may not even see it (so ids of other people's personal tasks are not revealed), 403 when they may see it but not change it.
function task_load($u, $id, $needManage) {
    $t = q1('SELECT * FROM tasks WHERE id = ?', [(int) $id]);
    if (!$t) fail(404, 'Task not found.');
    $assigns = q('SELECT a.*, u.name FROM task_assignments a JOIN users u ON u.id = a.user_id WHERE a.task_id = ?', [(int) $id]);
    if (!task_can_see($u, $t, $assigns)) fail(404, 'Task not found.');
    if ($needManage && !task_can_manage($u, $t, $assigns)) fail(403, (int) $t['is_personal'] === 1 ? 'This personal task belongs to someone else.' : 'You can edit or delete only the tasks you assigned. You can still update the status of tasks assigned to you.');
    return [$t, $assigns];
}

/* ---------- reading ---------- */
const TASK_SQL = "SELECT a.id AS aid, a.task_id, a.user_id, a.status, a.completed_at, a.updated_at AS a_updated,
        t.title, t.description, t.priority, t.category, t.frequency, t.start_date, t.due_date, t.due_time, t.is_personal, t.created_by, t.created_at, t.updated_at,
        au.name AS assignee_name, au.supervisor_id AS assignee_sup, cu.name AS creator_name,
        (SELECT COUNT(*) FROM task_assignments x WHERE x.task_id = t.id) AS n_total,
        (SELECT COUNT(*) FROM task_assignments x WHERE x.task_id = t.id AND x.status = 'Completed') AS n_done
    FROM task_assignments a JOIN tasks t ON t.id = a.task_id JOIN users au ON au.id = a.user_id LEFT JOIN users cu ON cu.id = t.created_by";

// The steps of many assignments in one query: [assignment id => counts, progress, next step]. A step is "missing" when its projected date has passed and it is not completed.
function task_sub_summary($aids) {
    $o = [];
    if (!$aids) return $o;
    $today = date('Y-m-d');
    $rows = q('SELECT s.assignment_id AS aid, s.status, s.progress, s.projected_date AS d, s.is_open, s.reason_status, st.title FROM assignment_subtasks s JOIN task_subtasks st ON st.id = s.subtask_id WHERE s.assignment_id IN (' . implode(',', array_map('intval', $aids)) . ') ORDER BY st.position, s.id');
    foreach ($rows as $r) {
        $k = (int) $r['aid'];
        if (!isset($o[$k])) $o[$k] = ['total' => 0, 'done' => 0, 'missing' => 0, 'open' => 0, 'pending' => 0, 'sum' => 0, 'nextTitle' => null, 'nextDate' => null];
        $x = &$o[$k]; $x['total']++;
        $done = $r['status'] === 'Completed';
        $x['sum'] += $done ? 100 : (int) $r['progress'];
        if ($done) $x['done']++;
        else {
            if ($r['d'] < $today) $x['missing']++;
            if ($r['is_open']) $x['open']++;
            if ($x['nextTitle'] === null) { $x['nextTitle'] = $r['title']; $x['nextDate'] = $r['d']; }
        }
        if ($r['reason_status'] === 'pending' && !$done) $x['pending']++; // only a step that is still open can wait for a decision
        unset($x);
    }
    return $o;
}
// The status to SHOW for one assignment row ($r = a row of TASK_SQL, $sum = its step summary or null).
function task_state($r, $sum) {
    $raw = $r['status'];
    $dueTs = task_due_ts($r['due_date'], $r['due_time']);
    $pastDue = $dueTs !== null && $dueTs < time();
    $stepMiss = $sum && $sum['missing'] > 0;
    $missing = $raw !== 'Completed' && ($pastDue || (TASK_SUBTASK_MISS_FLAGS_TASK && $stepMiss));
    $lateDone = $raw === 'Completed' && $dueTs !== null && $r['completed_at'] && strtotime($r['completed_at']) > $dueTs;
    return ['shown' => $raw === 'Completed' ? 'Completed' : ($missing ? 'Missing' : $raw), 'missing' => $missing, 'pastDue' => $raw !== 'Completed' && $pastDue, 'lateDone' => $lateDone];
}

function task_row_out($u, $r, $sum) {
    $perm = task_perm($u, $r);
    $personal = (int) $r['is_personal'] === 1;
    $st = task_state($r, $sum);
    $hasSubs = $sum && $sum['total'] > 0;
    if ($hasSubs) $perm['status'] = false; // the status of a task with steps follows its steps
    $pct = $hasSubs ? (int) round($sum['sum'] / $sum['total']) : ($r['status'] === 'Completed' ? 100 : 0);
    return [
        'id' => s($r['aid']), 'taskId' => s($r['task_id']), 'title' => $r['title'], 'description' => (string) $r['description'], 'priority' => $r['priority'], 'category' => $r['category'], 'frequency' => $r['frequency'],
        'startDate' => $r['start_date'], 'dueDate' => $r['due_date'], 'dueTime' => $r['due_time'] ? substr($r['due_time'], 0, 5) : '', 'status' => $st['shown'], 'rawStatus' => $r['status'], 'missing' => $st['missing'], 'pastDue' => $st['pastDue'], 'lateDone' => $st['lateDone'],
        'personal' => $personal,
        'assigneeId' => s($r['user_id']), 'assignee' => $r['assignee_name'], 'creatorId' => $r['created_by'] === null ? '' : s($r['created_by']), 'creator' => $r['creator_name'] === null ? 'a removed account' : $r['creator_name'],
        'createdAt' => iso($r['created_at']), 'updatedAt' => iso($r['updated_at']), 'completedAt' => iso($r['completed_at']), 'touched' => iso($r['a_updated']),
        'team' => ($perm['edit'] && !$personal) ? ['total' => (int) $r['n_total'], 'done' => (int) $r['n_done']] : null, // progress of everyone on the task: only for the person who assigned it and the admin
        'subs' => $hasSubs ? ['total' => $sum['total'], 'done' => $sum['done'], 'missing' => $sum['missing'], 'open' => $sum['open'], 'pending' => $sum['pending'], 'next' => $sum['nextTitle'], 'nextDate' => $sum['nextDate']] : null,
        'pct' => $pct,
        'can' => $perm,
    ];
}
function task_out($u) {
    if (!task_ready()) throw new RuntimeException('The Task Management tables are not installed.');
    list($w, $p) = task_scope($u);
    $src = q(TASK_SQL . ' WHERE ' . $w . ' ORDER BY t.id DESC, a.id DESC', $p);
    $sums = task_sub_summary(array_column($src, 'aid'));
    $rows = array_map(function ($r) use ($u, $sums) { return task_row_out($u, $r, isset($sums[(int) $r['aid']]) ? $sums[(int) $r['aid']] : null); }, $src);
    $today = date('Y-m-d'); $late = 0;
    foreach ($rows as $r) if ($r['assigneeId'] === s($u['id']) && $r['missing']) $late++;
    $pool = array_map(function ($x) { return ['id' => s($x['id']), 'name' => $x['name'], 'department' => $x['department'], 'position' => $x['job_title'], 'role' => $x['role']]; }, task_pool($u));
    $help = task_help($u);
    return ['rows' => $rows, 'help' => $help, 'canAssign' => task_can_assign($u), 'monitor' => task_can_assign($u), 'assignable' => $pool, 'categories' => TASK_CATEGORIES,
        'today' => $today, 'now' => date('Y-m-d H:i'), 'badge' => $late, 'rev' => md5(json_encode($rows) . json_encode($help) . $today)]; // rev changes whenever anything visible to this person changes (the page polls it)
}
// Steps that a superior opened to the people of the department: the ones this person can take over, and the ones they already took.
function task_help($u) {
    $uid = (int) $u['id'];
    $dept = trim((string) $u['department']);
    $rows = q("SELECT s.id AS sid, s.assignment_id AS aid, s.status, s.progress, s.projected_date AS d, s.claimed_by, st.title AS sub_title, st.position, t.title AS task_title, t.due_date, t.due_time, au.name AS assignee_name, cb.name AS claimer
        FROM assignment_subtasks s JOIN task_subtasks st ON st.id = s.subtask_id JOIN task_assignments a ON a.id = s.assignment_id JOIN tasks t ON t.id = a.task_id JOIN users au ON au.id = a.user_id LEFT JOIN users cb ON cb.id = s.claimed_by
        WHERE s.is_open = 1 AND s.status <> 'Completed' AND a.user_id <> ? AND (s.claimed_by = ? OR (s.claimed_by IS NULL AND ? <> '' AND LOWER(TRIM(au.department)) = LOWER(?)))
        ORDER BY s.projected_date, s.id", [$uid, $uid, $dept, $dept]);
    $today = date('Y-m-d');
    return array_map(function ($r) use ($uid, $today) {
        return ['id' => s($r['sid']), 'assignmentId' => s($r['aid']), 'task' => $r['task_title'], 'sub' => $r['sub_title'], 'n' => (int) $r['position'], 'assignee' => $r['assignee_name'], 'date' => $r['d'], 'missing' => $r['d'] < $today,
            'status' => $r['status'], 'progress' => (int) $r['progress'], 'mine' => $r['claimed_by'] !== null && (int) $r['claimed_by'] === $uid, 'claimer' => $r['claimer'] === null ? '' : $r['claimer'], 'dueDate' => $r['due_date'], 'dueTime' => $r['due_time'] ? substr($r['due_time'], 0, 5) : ''];
    }, $rows);
}

/* ---------- reminders (due soon / overdue), sent once each ---------- */
// Runs at most every 5 minutes per login session; it handles everybody's tasks, so the notifications are there even if the person is not logged in.
function task_sweep_throttled() {
    if (!empty($_SESSION['task_sweep']) && time() - (int) $_SESSION['task_sweep'] < 300) return;
    if (!task_ready()) return;
    task_sweep();
    $_SESSION['task_sweep'] = time();
}
function task_sweep() {
    $today = date('Y-m-d'); $nowT = date('H:i:s'); $soon = date('Y-m-d', strtotime('+' . TASK_DUE_SOON_DAYS . ' days'));
    // 1. due soon: tell the assignee (assigned tasks only; personal tasks are the person's own)
    $rows = q("SELECT a.id, a.user_id, t.title, t.due_date, t.due_time FROM task_assignments a JOIN tasks t ON t.id = a.task_id JOIN users u ON u.id = a.user_id
        WHERE t.is_personal = 0 AND a.status <> 'Completed' AND u.status = 'Active' AND a.due_soon_notified IS NULL AND t.due_date BETWEEN ? AND ? AND NOT (t.due_date = ? AND t.due_time IS NOT NULL AND t.due_time < ?)", [$today, $soon, $today, $nowT]);
    foreach ($rows as $r) {
        if (run('UPDATE task_assignments SET due_soon_notified = ? WHERE id = ? AND due_soon_notified IS NULL', [$today, $r['id']])->rowCount() !== 1) continue; // another request already sent it
        $days = (int) round((strtotime($r['due_date']) - strtotime($today)) / 86400);
        task_note($r['user_id'], 'Task due soon', '"' . task_cut($r['title'], 110) . '" is due ' . ($days <= 0 ? 'today' : ($days === 1 ? 'tomorrow' : 'on ' . task_d($r['due_date']))) . ($r['due_time'] ? ' at ' . task_t($r['due_time']) : '') . '.');
    }
    // 2. missing (past the deadline): tell the assignee, and the person who assigned it and the assignee's own supervisor (one note per task, listing the people)
    $rows = q("SELECT a.id, a.user_id, a.task_id, t.title, t.due_date, t.due_time, t.created_by, au.name AS assignee_name, au.supervisor_id FROM task_assignments a JOIN tasks t ON t.id = a.task_id JOIN users au ON au.id = a.user_id
        WHERE t.is_personal = 0 AND a.status <> 'Completed' AND au.status = 'Active' AND a.overdue_notified = 0 AND (t.due_date < ? OR (t.due_date = ? AND t.due_time IS NOT NULL AND t.due_time < ?))", [$today, $today, $nowT]);
    $mgr = [];
    foreach ($rows as $r) {
        if (run('UPDATE task_assignments SET overdue_notified = 1 WHERE id = ? AND overdue_notified = 0', [$r['id']])->rowCount() !== 1) continue;
        task_note($r['user_id'], 'Task missing', 'Your task "' . task_cut($r['title'], 110) . '" was due on ' . task_dt($r['due_date'], $r['due_time']) . ' and is not completed yet.');
        foreach (array_unique(array_filter([(int) $r['created_by'], (int) $r['supervisor_id']])) as $m) {
            if ($m === (int) $r['user_id']) continue;
            if (!isset($mgr[$m][$r['task_id']])) $mgr[$m][$r['task_id']] = ['title' => $r['title'], 'due' => $r['due_date'], 'time' => $r['due_time'], 'names' => []];
            $mgr[$m][$r['task_id']]['names'][] = $r['assignee_name'];
        }
    }
    if ($mgr) {
        $active = array_map('intval', array_column(q("SELECT id FROM users WHERE status = 'Active' AND id IN (" . implode(',', array_map('intval', array_keys($mgr))) . ')'), 'id'));
        foreach ($mgr as $m => $tasks) {
            if (!in_array((int) $m, $active, true)) continue;
            foreach ($tasks as $t) {
                $n = count($t['names']);
                $who = $n === 1 ? $t['names'][0] . ' has' : implode(', ', array_slice($t['names'], 0, 3)) . ($n > 3 ? ' and ' . ($n - 3) . ' more have' : ' have');
                task_note($m, 'Task missing', $who . ' not completed "' . task_cut($t['title'], 80) . '" (due ' . task_dt($t['due'], $t['time']) . ').');
            }
        }
    }
    // 3. a step passed its projected date: tell the assignee and the people who can review it (once for each date; moving the date resets it)
    $rows = q("SELECT s.id, a.user_id, t.title AS task_title, t.created_by, au.name AS assignee_name, au.supervisor_id, st.title AS sub_title, s.projected_date
        FROM assignment_subtasks s JOIN task_subtasks st ON st.id = s.subtask_id JOIN task_assignments a ON a.id = s.assignment_id JOIN tasks t ON t.id = a.task_id JOIN users au ON au.id = a.user_id
        WHERE t.is_personal = 0 AND s.status <> 'Completed' AND au.status = 'Active' AND s.missed_notified = 0 AND s.projected_date < ?", [$today]);
    foreach ($rows as $r) {
        if (run('UPDATE assignment_subtasks SET missed_notified = 1 WHERE id = ? AND missed_notified = 0', [$r['id']])->rowCount() !== 1) continue;
        task_note($r['user_id'], 'Task step missed', 'The step "' . task_cut($r['sub_title'], 70) . '" of "' . task_cut($r['task_title'], 70) . '" passed its projected date (' . task_d($r['projected_date']) . '). Open it to explain why.');
        foreach (array_unique(array_filter([(int) $r['created_by'], (int) $r['supervisor_id']])) as $m) {
            if ($m === (int) $r['user_id']) continue;
            $act = q1("SELECT id FROM users WHERE id = ? AND status = 'Active'", [$m]);
            if ($act) task_note($m, 'Task step missed', $r['assignee_name'] . ' missed the step "' . task_cut($r['sub_title'], 60) . '" of "' . task_cut($r['task_title'], 60) . '" (planned ' . task_d($r['projected_date']) . ').');
        }
    }
}
