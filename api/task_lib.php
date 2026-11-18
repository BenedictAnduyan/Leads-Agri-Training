<?php
// Task Management: shared code (tables, who may do what, the data sent to the browser, notifications and reminders).
// Everything here is decided on the server. The browser only shows buttons; api/task.php checks every action again with the same functions.
//
// Model:  tasks (the shared part of a task)  1 --- n  task_assignments (one row per employee, each with its OWN status).
//         A task assigned to 5 people is 5 assignments, so each person has independent progress.
// Roles (users.role):
//   admin     creates / assigns to any employee, sees every task, edits, updates and deletes any task.
//   superior  (Immediate Superior = Supervisor / Manager; an executive has the same access) creates / assigns to employees, sees the progress of their team and of the tasks
//             they assigned, edits and deletes only the tasks they assigned. Also keeps personal tasks like an employee.
//   employee  creates personal tasks (edit / delete own), sees tasks assigned to them and changes only the STATUS of those.
// Tables are created from sql/migration_tasks.sql (automatically the first time, if it was not imported by hand).
require_once __DIR__ . '/helpers.php';

const TASK_STATUSES = ['To Do', 'In Progress', 'Completed'];
const TASK_PRIORITIES = ['Low', 'Medium', 'High'];
const TASK_CATEGORIES = ['General', 'Training', 'Supplier', 'Reports', 'Meeting', 'Follow-up', 'Urgent', 'Personal']; // suggestions only; any text up to 40 characters is accepted
// Who an immediate superior may assign tasks to: 'team' = the employees whose supervisor (Admin > Employees) is that superior, 'all' = every active employee.
const TASK_SUP_SCOPE = 'team';
const TASK_DUE_SOON_DAYS = 2; // "due soon" notification this many days before the due date (and on the due date itself)

/* ---------- tables ---------- */
function task_ready() {
    static $ok = null;
    if ($ok !== null) return $ok;
    try {
        $have = array_column(q("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tasks', 'task_assignments')"), 't');
        if (count($have) < 2) { // run sql/migration_tasks.sql (CREATE TABLE IF NOT EXISTS only, so existing data is never touched)
            $file = dirname(__DIR__) . '/sql/migration_tasks.sql';
            if (!is_readable($file)) throw new RuntimeException('sql/migration_tasks.sql is missing.');
            $sql = preg_replace('/^\s*--.*$/m', '', file_get_contents($file));
            foreach (explode(';', $sql) as $stmt) {
                $stmt = trim($stmt);
                if ($stmt === '' || stripos($stmt, 'USE ') === 0) continue; // the database is already chosen by config.php
                db()->exec($stmt);
            }
        }
        $ok = true;
    } catch (Throwable $e) { $ok = false; }
    return $ok;
}

/* ---------- small helpers ---------- */
function task_str($v) { return is_scalar($v) ? trim((string) $v) : ''; }
function task_date($v, $label) { // '' = no date. Otherwise it must be a real calendar date yyyy-mm-dd
    $v = task_str($v);
    if ($v === '') return null;
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) fail(400, 'Enter a valid ' . $label . '.');
    return $v;
}
function task_d($d) { return $d ? date('M j, Y', strtotime($d)) : ''; }
function task_note($uid, $title, $msg) { add_note((int) $uid, mb_substr($title, 0, 160), mb_substr($msg, 0, 255)); } // the existing notification bell; titles start with "Task " so the bell links to this tab
function task_cut($s, $n = 60) { return mb_strlen($s) > $n ? mb_substr($s, 0, $n - 1) . '…' : $s; }

/* ---------- who may do what ---------- */
function task_can_assign($u) { return $u['role'] === 'admin' || is_superior_role($u); } // admin, immediate superior or executive
// The employees this person may assign tasks to (never admins, never inactive accounts).
function task_pool($u) {
    $cols = "SELECT id, name, department, job_title, role, supervisor_id FROM users WHERE status = 'Active' AND role IN ('employee', 'superior', 'executive')";
    if ($u['role'] === 'admin') return q($cols . ' ORDER BY name');
    if (is_superior_role($u)) return TASK_SUP_SCOPE === 'all' ? q($cols . ' AND id <> ? ORDER BY name', [(int) $u['id']]) : q($cols . ' AND supervisor_id = ? ORDER BY name', [(int) $u['id']]);
    return [];
}
// SQL condition for the assignments (rows) a person is allowed to SEE. $a = task_assignments, $t = tasks, $au = the assigned user.
//   admin: all.  superior: own + tasks they assigned + assigned tasks of their team (never the personal tasks of others).  employee: own only.
function task_scope($u) {
    $id = (int) $u['id'];
    if ($u['role'] === 'admin') return ['1 = 1', []];
    $w = ['a.user_id = ?']; $p = [$id];
    if (is_superior_role($u)) {
        $w[] = '(t.is_personal = 0 AND t.created_by = ?)'; $p[] = $id;
        $w[] = '(t.is_personal = 0 AND au.supervisor_id = ?)'; $p[] = $id;
    }
    return ['(' . implode(' OR ', $w) . ')', $p];
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
// The same checks for a whole task (used by save and delete). $assigns = its assignment rows (with the assignee's supervisor_id as "sup").
function task_can_see($u, $t, $assigns) {
    if ($u['role'] === 'admin') return true;
    $uid = (int) $u['id'];
    foreach ($assigns as $a) if ((int) $a['user_id'] === $uid) return true;
    if (!is_superior_role($u) || (int) $t['is_personal'] === 1) return false;
    if ($t['created_by'] !== null && (int) $t['created_by'] === $uid) return true;
    foreach ($assigns as $a) if ($a['sup'] !== null && (int) $a['sup'] === $uid) return true;
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
    $assigns = q('SELECT a.*, u.name, u.supervisor_id AS sup FROM task_assignments a JOIN users u ON u.id = a.user_id WHERE a.task_id = ?', [(int) $id]);
    if (!task_can_see($u, $t, $assigns)) fail(404, 'Task not found.');
    if ($needManage && !task_can_manage($u, $t, $assigns)) fail(403, (int) $t['is_personal'] === 1 ? 'This personal task belongs to someone else.' : 'You can edit or delete only the tasks you assigned. You can still update the status of tasks assigned to you.');
    return [$t, $assigns];
}

/* ---------- reading ---------- */
const TASK_SQL = "SELECT a.id AS aid, a.task_id, a.user_id, a.status, a.completed_at, a.updated_at AS a_updated,
        t.title, t.description, t.priority, t.category, t.start_date, t.due_date, t.is_personal, t.created_by, t.created_at, t.updated_at,
        au.name AS assignee_name, au.supervisor_id AS assignee_sup, cu.name AS creator_name,
        (SELECT COUNT(*) FROM task_assignments x WHERE x.task_id = t.id) AS n_total,
        (SELECT COUNT(*) FROM task_assignments x WHERE x.task_id = t.id AND x.status = 'Completed') AS n_done
    FROM task_assignments a JOIN tasks t ON t.id = a.task_id JOIN users au ON au.id = a.user_id LEFT JOIN users cu ON cu.id = t.created_by";

function task_row_out($u, $r) {
    $perm = task_perm($u, $r);
    $personal = (int) $r['is_personal'] === 1;
    return [
        'id' => s($r['aid']), 'taskId' => s($r['task_id']), 'title' => $r['title'], 'description' => (string) $r['description'], 'priority' => $r['priority'], 'category' => $r['category'],
        'startDate' => $r['start_date'], 'dueDate' => $r['due_date'], 'status' => $r['status'], 'personal' => $personal,
        'assigneeId' => s($r['user_id']), 'assignee' => $r['assignee_name'], 'creatorId' => $r['created_by'] === null ? '' : s($r['created_by']), 'creator' => $r['creator_name'] === null ? 'a removed account' : $r['creator_name'],
        'createdAt' => iso($r['created_at']), 'updatedAt' => iso($r['updated_at']), 'completedAt' => iso($r['completed_at']),
        'team' => ($perm['edit'] && !$personal) ? ['total' => (int) $r['n_total'], 'done' => (int) $r['n_done']] : null, // progress of everyone on the task: only for the person who assigned it and the admin
        'can' => $perm,
    ];
}
function task_out($u) {
    if (!task_ready()) throw new RuntimeException('The Task Management tables are not installed.');
    list($w, $p) = task_scope($u);
    $rows = array_map(function ($r) use ($u) { return task_row_out($u, $r); }, q(TASK_SQL . ' WHERE ' . $w . ' ORDER BY t.id DESC, a.id DESC', $p));
    $today = date('Y-m-d'); $late = 0;
    foreach ($rows as $r) if ($r['assigneeId'] === s($u['id']) && $r['status'] !== 'Completed' && $r['dueDate'] && $r['dueDate'] < $today) $late++;
    $pool = array_map(function ($x) { return ['id' => s($x['id']), 'name' => $x['name'], 'department' => $x['department'], 'position' => $x['job_title']]; }, task_pool($u));
    return ['rows' => $rows, 'canAssign' => task_can_assign($u), 'monitor' => task_can_assign($u), 'assignable' => $pool, 'supScope' => TASK_SUP_SCOPE, 'categories' => TASK_CATEGORIES,
        'today' => $today, 'badge' => $late, 'rev' => md5(json_encode($rows) . $today)]; // rev changes whenever anything visible to this person changes (the page polls it)
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
    $today = date('Y-m-d'); $soon = date('Y-m-d', strtotime('+' . TASK_DUE_SOON_DAYS . ' days'));
    // 1. due soon: tell the assignee (assigned tasks only; personal tasks are the person's own)
    $rows = q("SELECT a.id, a.user_id, t.title, t.due_date FROM task_assignments a JOIN tasks t ON t.id = a.task_id JOIN users u ON u.id = a.user_id
        WHERE t.is_personal = 0 AND a.status <> 'Completed' AND u.status = 'Active' AND a.due_soon_notified IS NULL AND t.due_date BETWEEN ? AND ?", [$today, $soon]);
    foreach ($rows as $r) {
        if (run('UPDATE task_assignments SET due_soon_notified = ? WHERE id = ? AND due_soon_notified IS NULL', [$today, $r['id']])->rowCount() !== 1) continue; // another request already sent it
        $days = (int) round((strtotime($r['due_date']) - strtotime($today)) / 86400);
        task_note($r['user_id'], 'Task due soon', '"' . task_cut($r['title'], 120) . '" is due ' . ($days <= 0 ? 'today' : ($days === 1 ? 'tomorrow' : 'on ' . task_d($r['due_date']))) . '.');
    }
    // 2. overdue: tell the assignee, and the person who assigned it and the assignee's own supervisor (one note per task, listing the people)
    $rows = q("SELECT a.id, a.user_id, a.task_id, t.title, t.due_date, t.created_by, au.name AS assignee_name, au.supervisor_id FROM task_assignments a JOIN tasks t ON t.id = a.task_id JOIN users au ON au.id = a.user_id
        WHERE t.is_personal = 0 AND a.status <> 'Completed' AND au.status = 'Active' AND a.overdue_notified = 0 AND t.due_date < ?", [$today]);
    $mgr = [];
    foreach ($rows as $r) {
        if (run('UPDATE task_assignments SET overdue_notified = 1 WHERE id = ? AND overdue_notified = 0', [$r['id']])->rowCount() !== 1) continue;
        task_note($r['user_id'], 'Task overdue', 'Your task "' . task_cut($r['title'], 120) . '" was due on ' . task_d($r['due_date']) . ' and is not completed yet.');
        foreach (array_unique(array_filter([(int) $r['created_by'], (int) $r['supervisor_id']])) as $m) {
            if ($m === (int) $r['user_id']) continue;
            if (!isset($mgr[$m][$r['task_id']])) $mgr[$m][$r['task_id']] = ['title' => $r['title'], 'due' => $r['due_date'], 'names' => []];
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
                task_note($m, 'Task overdue', $who . ' not completed "' . task_cut($t['title'], 80) . '" (due ' . task_d($t['due']) . ').');
            }
        }
    }
}
