<?php
// Task Management actions: list, save (create or edit), status, delete, detail.
// Every action is checked here with the functions of task_lib.php (login, role, ownership); the buttons in the browser are only a convenience.
// Every change answers with the fresh task list of the person, so the screen never shows something the database does not hold.
require __DIR__ . '/helpers.php';
require __DIR__ . '/task_lib.php';
$me = require_login();
if (!task_ready()) fail(500, 'Task Management could not be set up. In phpMyAdmin, import sql/migration_tasks.sql into the leads_training database, then reload this page.');
$in = input();
$action = isset($_GET['action']) ? $_GET['action'] : '';
if (in_array($action, ['save', 'status', 'delete'], true) && $_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'Use POST for this action.');

/* ---------- validation of the form (the browser's checks are not trusted) ---------- */
function task_clean($in) {
    $title = task_str(isset($in['title']) ? $in['title'] : '');
    if ($title === '') fail(400, 'Enter a task title.');
    if (mb_strlen($title) > 160) fail(400, 'The task title can have at most 160 characters.');
    $desc = task_str(isset($in['description']) ? $in['description'] : '');
    if (mb_strlen($desc) > 2000) fail(400, 'The description can have at most 2000 characters.');
    $priority = isset($in['priority']) ? $in['priority'] : 'Medium';
    if (!is_string($priority) || !in_array($priority, TASK_PRIORITIES, true)) fail(400, 'Choose Low, Medium or High priority.');
    $cat = task_str(isset($in['category']) ? $in['category'] : '');
    if ($cat === '') $cat = 'General';
    if (mb_strlen($cat) > 40) fail(400, 'The category can have at most 40 characters.');
    $start = task_date(isset($in['startDate']) ? $in['startDate'] : '', 'start date');
    $due = task_date(isset($in['dueDate']) ? $in['dueDate'] : '', 'due date');
    if ($start && $due && $start > $due) fail(400, 'The due date cannot be before the start date.');
    $status = isset($in['status']) ? $in['status'] : 'To Do';
    if (!is_string($status) || !in_array($status, TASK_STATUSES, true)) fail(400, 'Choose a valid status.');
    return ['title' => $title, 'description' => $desc, 'priority' => $priority, 'category' => $cat, 'start' => $start, 'due' => $due, 'status' => $status];
}
function task_ids($v) { // a list of user ids from the browser: whole numbers only, no duplicates
    $o = [];
    if (is_array($v)) foreach ($v as $x) if (is_scalar($x) && ctype_digit((string) $x) && (int) $x > 0) $o[(int) $x] = true;
    return array_keys($o);
}
function task_when($due) { return $due ? ' Due ' . task_d($due) . '.' : ''; }

switch ($action) {

case 'list':
    task_sweep_throttled();
    out(['task' => task_out($me)]);

case 'detail': // who is on a task and how far each person is (only the rows this person may see: an employee sees only their own)
    $id = (int) (isset($in['taskId']) ? $in['taskId'] : (isset($_GET['id']) ? $_GET['id'] : 0));
    list($w, $p) = task_scope($me);
    $rows = q(TASK_SQL . ' WHERE a.task_id = ? AND ' . $w . ' ORDER BY au.name', array_merge([$id], $p));
    if (!$rows) fail(404, 'Task not found.');
    out(['detail' => ['taskId' => s($id), 'assignees' => array_map(function ($r) {
        return ['assignmentId' => s($r['aid']), 'userId' => s($r['user_id']), 'name' => $r['assignee_name'], 'status' => $r['status'], 'completedAt' => iso($r['completed_at'])];
    }, $rows)]]);

case 'save': // create (no id) or edit (id)
    $f = task_clean($in);
    $id = (int) (isset($in['id']) ? $in['id'] : 0);
    $actor = $me['name'];
    $pdo = db();

    if (!$id) {
        $mode = task_str(isset($in['mode']) ? $in['mode'] : 'self');
        if (!in_array($mode, ['self', 'selected', 'all'], true)) fail(400, 'Unknown way of assigning the task.');
        if ($mode !== 'self' && !task_can_assign($me)) fail(403, 'Only administrators and immediate superiors can assign tasks to other employees.');
        $personal = $mode === 'self' ? 1 : 0;
        if ($personal) $targets = [(int) $me['id']]; // an employee's own task: the logged-in person is the owner, nothing is read from the form
        else {
            $pool = array_map('intval', array_column(task_pool($me), 'id'));
            if ($mode === 'all') $targets = $pool;
            else {
                $targets = task_ids(isset($in['assignees']) ? $in['assignees'] : []);
                if (!$targets) fail(400, 'Choose at least one employee.');
                foreach ($targets as $x) if (!in_array($x, $pool, true)) fail(403, $me['role'] === 'admin' ? 'You can assign tasks only to active employees.' : 'You can assign tasks only to the employees of your team.');
            }
            if (!$targets) fail(400, $me['role'] === 'admin' ? 'There are no active employees to assign this task to.' : 'No employees are assigned to you yet. Ask the administrator to set you as the immediate superior of your team (Admin > Employees).');
        }
        $pdo->beginTransaction();
        try {
            run('INSERT INTO tasks (title, description, priority, category, start_date, due_date, is_personal, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$f['title'], $f['description'], $f['priority'], $f['category'], $f['start'], $f['due'], $personal, (int) $me['id'], (int) $me['id']]);
            $tid = (int) $pdo->lastInsertId();
            foreach ($targets as $x) run('INSERT INTO task_assignments (task_id, user_id, status, completed_at) VALUES (?, ?, ?, ?)', [$tid, $x, $f['status'], $f['status'] === 'Completed' ? date('Y-m-d H:i:s') : null]);
            $pdo->commit();
        } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
        if (!$personal) {
            foreach ($targets as $x) if ($x !== (int) $me['id']) task_note($x, 'Task assigned', $actor . ' assigned you a task: "' . task_cut($f['title'], 100) . '" (' . $f['priority'] . ' priority).' . task_when($f['due']));
            log_activity($actor . ' assigned the task "' . task_cut($f['title'], 80) . '" to ' . count($targets) . ' employee' . (count($targets) === 1 ? '' : 's') . '.');
        }
        out(['task' => task_out($me), 'taskId' => s($tid), 'count' => count($targets)]);
    }

    // ----- edit -----
    list($t, $assigns) = task_load($me, $id, true);
    $personal = (int) $t['is_personal'] === 1;
    $before = ['title' => $t['title'], 'description' => (string) $t['description'], 'priority' => $t['priority'], 'category' => $t['category'], 'start' => $t['start_date'], 'due' => $t['due_date']];
    $labels = ['title' => 'title', 'description' => 'description', 'priority' => 'priority', 'category' => 'category', 'start' => 'start date', 'due' => 'due date'];
    $changed = [];
    foreach ($labels as $k => $label) if ((string) $before[$k] !== (string) $f[$k]) $changed[] = $label;

    $old = array_map('intval', array_column($assigns, 'user_id'));
    $add = []; $drop = [];
    if (!$personal && array_key_exists('assignees', $in)) { // the employees of an assigned task can be changed (reassigned)
        $new = task_ids($in['assignees']);
        if (!$new) fail(400, 'Choose at least one employee.');
        $add = array_values(array_diff($new, $old)); $drop = array_values(array_diff($old, $new));
        if ($add) {
            $pool = array_map('intval', array_column(task_pool($me), 'id'));
            foreach ($add as $x) if (!in_array($x, $pool, true)) fail(403, $me['role'] === 'admin' ? 'You can assign tasks only to active employees.' : 'You can assign tasks only to the employees of your team.');
        }
    }
    $pdo->beginTransaction();
    try {
        run('UPDATE tasks SET title = ?, description = ?, priority = ?, category = ?, start_date = ?, due_date = ?, updated_by = ? WHERE id = ?',
            [$f['title'], $f['description'], $f['priority'], $f['category'], $f['start'], $f['due'], (int) $me['id'], $id]);
        if (in_array('due date', $changed, true)) run('UPDATE task_assignments SET due_soon_notified = NULL, overdue_notified = 0 WHERE task_id = ?', [$id]); // a new due date gets its own reminders
        if ($personal) { // a personal task has exactly one row: its status can be set in the form
            $a = $assigns[0];
            if ($a['status'] !== $f['status']) run('UPDATE task_assignments SET status = ?, completed_at = ? WHERE id = ?', [$f['status'], $f['status'] === 'Completed' ? date('Y-m-d H:i:s') : null, $a['id']]);
        } else {
            foreach ($drop as $x) run('DELETE FROM task_assignments WHERE task_id = ? AND user_id = ?', [$id, $x]);
            foreach ($add as $x) run("INSERT INTO task_assignments (task_id, user_id, status) VALUES (?, ?, 'To Do')", [$id, $x]);
        }
        $pdo->commit();
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    if (!$personal) {
        $keep = array_diff($old, $drop);
        foreach ($keep as $x) if ($changed && $x !== (int) $me['id']) task_note($x, 'Task updated', $actor . ' updated "' . task_cut($f['title'], 80) . '" (' . implode(', ', $changed) . ').' . task_when($f['due']));
        foreach ($add as $x) if ($x !== (int) $me['id']) task_note($x, 'Task assigned', $actor . ' assigned you a task: "' . task_cut($f['title'], 100) . '" (' . $f['priority'] . ' priority).' . task_when($f['due']));
        foreach ($drop as $x) if ($x !== (int) $me['id']) task_note($x, 'Task reassigned', $actor . ' removed you from the task "' . task_cut($f['title'], 100) . '". You no longer need to work on it.');
        if ($add || $drop) log_activity($actor . ' changed who is assigned to the task "' . task_cut($f['title'], 80) . '".');
    }
    out(['task' => task_out($me), 'taskId' => s($id)]);

case 'status': // one employee's own status of a task (drag and drop, Mark as Completed, Reopen, the status list)
    $aid = (int) (isset($in['assignmentId']) ? $in['assignmentId'] : 0);
    $st = isset($in['status']) ? $in['status'] : '';
    if (!is_string($st) || !in_array($st, TASK_STATUSES, true)) fail(400, 'Choose a valid status.');
    list($w, $p) = task_scope($me);
    $r = q1(TASK_SQL . ' WHERE a.id = ? AND ' . $w, array_merge([$aid], $p));
    if (!$r) fail(404, 'Task not found.');
    if (!task_perm($me, $r)['status']) fail(403, 'You cannot change the status of this task.');
    if ($r['status'] !== $st) {
        run('UPDATE task_assignments SET status = ?, completed_at = ? WHERE id = ?', [$st, $st === 'Completed' ? date('Y-m-d H:i:s') : null, $aid]);
        if ((int) $r['is_personal'] === 0) {
            $owner = (int) $r['user_id']; $actorId = (int) $me['id']; $title = task_cut($r['title'], 100);
            if ($owner === $actorId) { // the employee updated their own task: tell the person who assigned it and the employee's supervisor when it is completed
                if ($st === 'Completed') {
                    $to = array_unique(array_filter([(int) $r['created_by'], (int) $r['assignee_sup']]));
                    foreach ($to as $x) {
                        if ($x === $actorId) continue;
                        $m = q1("SELECT id FROM users WHERE id = ? AND status = 'Active'", [$x]);
                        if ($m) task_note($x, 'Task completed', $me['name'] . ' completed the task "' . $title . '".');
                    }
                }
            } else task_note($owner, 'Task updated', $me['name'] . ' ' . ($r['status'] === 'Completed' ? 'reopened' : 'changed the status of') . ' your task "' . $title . '"' . ($r['status'] === 'Completed' ? ' (now ' . $st . ').' : ' to ' . $st . '.'));
        }
    }
    out(['task' => task_out($me), 'changed' => $r['status'] !== $st]);

case 'delete':
    $id = (int) (isset($in['taskId']) ? $in['taskId'] : 0);
    list($t, $assigns) = task_load($me, $id, true);
    $pdo = db(); $pdo->beginTransaction();
    try { run('DELETE FROM tasks WHERE id = ?', [$id]); $pdo->commit(); } // the assignments go with it (ON DELETE CASCADE)
    catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    if ((int) $t['is_personal'] === 0) {
        foreach ($assigns as $a) if ((int) $a['user_id'] !== (int) $me['id']) task_note($a['user_id'], 'Task removed', $me['name'] . ' deleted the task "' . task_cut($t['title'], 100) . '".');
        log_activity($me['name'] . ' deleted the task "' . task_cut($t['title'], 80) . '".');
    }
    out(['task' => task_out($me)]);
}
fail(404, 'Unknown action.');
