<?php
// Task Management actions: list, save (create or edit), status, delete, detail, and the steps (subtasks) of a task.
// Every action is checked here with the functions of task_lib.php / task_sub.php (login, role, hierarchy, ownership); the buttons in the browser are only a convenience.
// Every change answers with the fresh task list of the person, so the screen never shows something the database does not hold.
require __DIR__ . '/helpers.php';
require __DIR__ . '/task_lib.php';
require __DIR__ . '/task_sub.php';
$me = require_login();
if (!task_ready()) fail(500, 'Task Management could not be set up. In phpMyAdmin, import sql/migration_tasks.sql into the leads_training database, then reload this page.');
$in = input();
$action = isset($_GET['action']) ? $_GET['action'] : '';
if (in_array($action, ['save', 'status', 'delete', 'sub_status', 'sub_dep', 'sub_open', 'sub_claim', 'sub_review', 'sub_unable_review', 'sub_date', 'sub_update'], true) && $_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'Use POST for this action.');

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
    $time = task_time(isset($in['dueTime']) ? $in['dueTime'] : '', 'due time');
    if ($time && !$due) fail(400, 'Choose a due date for the due time.');
    $status = isset($in['status']) ? $in['status'] : 'To Do';
    if (!is_string($status) || !in_array($status, TASK_STATUSES, true)) fail(400, 'Choose a valid status.');
    $freq = isset($in['frequency']) ? $in['frequency'] : '';
    if ($freq !== '' && (!is_string($freq) || !in_array($freq, TASK_FREQS, true))) fail(400, 'Choose Personal, Daily or Weekly.');
    $subs = array_key_exists('subtasks', $in) ? task_subs_clean($in['subtasks'], $due, $start, $time) : null; // null = the form did not send the steps: leave them as they are
    return ['title' => $title, 'description' => $desc, 'priority' => $priority, 'category' => $cat, 'start' => $start, 'due' => $due, 'time' => $time, 'status' => $status, 'freq' => $freq, 'subs' => $subs];
}
function task_ids($v) { // a list of user ids from the browser: whole numbers only, no duplicates
    $o = [];
    if (is_array($v)) foreach ($v as $x) if (is_scalar($x) && ctype_digit((string) $x) && (int) $x > 0) $o[(int) $x] = true;
    return array_keys($o);
}
function task_when($due, $time = null) { return $due ? ' Due ' . task_dt($due, $time) . '.' : ''; }
function task_kind_label($f) { return $f === 'daily' ? 'daily task' : ($f === 'weekly' ? 'weekly task' : 'task'); }
function task_unlink($names) { foreach ($names as $n) @unlink(task_upload_dir() . '/' . basename($n)); }
function task_stored_files($where, $params) { // the stored names of the attachments of some assignments, to delete the files from the disk afterwards
    return array_column(q('SELECT f.stored_name FROM subtask_files f JOIN assignment_subtasks s ON s.id = f.a_subtask_id JOIN task_assignments a ON a.id = s.assignment_id WHERE ' . $where, $params), 'stored_name');
}

switch ($action) {

case 'list':
    task_sweep_throttled();
    out(['task' => task_out($me)]);

case 'detail': // who is on a task and how far each person is (only the rows this person may see: an employee sees only their own)
    $id = (int) (isset($in['taskId']) ? $in['taskId'] : (isset($_GET['id']) ? $_GET['id'] : 0));
    list($w, $p) = task_scope($me);
    $rows = q(TASK_SQL . ' WHERE a.task_id = ? AND ' . $w . ' ORDER BY au.name', array_merge([$id], $p));
    if (!$rows) fail(404, 'Task not found.');
    $sums = task_sub_summary(array_column($rows, 'aid'));
    out(['detail' => ['taskId' => s($id), 'assignees' => array_map(function ($r) use ($sums) {
        $sum = isset($sums[(int) $r['aid']]) ? $sums[(int) $r['aid']] : null; $st = task_state($r, $sum);
        return ['assignmentId' => s($r['aid']), 'userId' => s($r['user_id']), 'name' => $r['assignee_name'], 'status' => $st['shown'], 'completedAt' => iso($r['completed_at']),
            'subDone' => $sum ? $sum['done'] : 0, 'subTotal' => $sum ? $sum['total'] : 0, 'pct' => $sum ? (int) round($sum['sum'] / $sum['total']) : ($r['status'] === 'Completed' ? 100 : 0)];
    }, $rows)]]);

case 'subs': // the steps of one assignment (the person must be allowed to see it, or be allowed to take over one of its open steps)
    $aid = (int) (isset($in['assignmentId']) ? $in['assignmentId'] : (isset($_GET['aid']) ? $_GET['aid'] : 0));
    $d = task_subs_payload($me, $aid);
    if (!$d || (!$d['visible'] && !$d['subs'])) fail(404, 'Task not found.');
    out(['data' => $d]);

case 'file':
    task_file_download($me, (int) (isset($_GET['id']) ? $_GET['id'] : 0));

case 'sub_update': task_act_sub_update($me);
case 'sub_status': task_act_sub_status($me, $in);
case 'sub_dep': task_act_sub_dep($me, $in);
case 'sub_open': task_act_sub_open($me, $in);
case 'sub_claim': task_act_sub_claim($me, $in);
case 'sub_review': task_act_sub_review($me, $in);
case 'sub_unable_review': task_act_sub_unable_review($me, $in);
case 'sub_date': task_act_sub_date($me, $in);

case 'save': // create (no id) or edit (id)
    $f = task_clean($in);
    if (!task_can_assign($me) && in_array($f['freq'], ['daily', 'weekly'], true)) fail(403, 'Only administrators, immediate superiors and executives can add daily and weekly tasks. You can add personal tasks.');
    $id = (int) (isset($in['id']) ? $in['id'] : 0);
    $actor = $me['name'];
    $pdo = db();

    if (!$id) {
        $mode = task_str(isset($in['mode']) ? $in['mode'] : 'self');
        if (!in_array($mode, ['self', 'selected', 'all'], true)) fail(400, 'Unknown way of assigning the task.');
        if ($mode !== 'self' && !task_can_assign($me)) fail(403, 'Only administrators and immediate superiors can assign tasks to other employees.');
        $personal = $mode === 'self' ? 1 : 0;
        if ($personal) { $targets = [(int) $me['id']]; $freq = 'personal'; } // an employee's own task: the logged-in person is the owner, nothing is read from the form
        else {
            $freq = $f['freq'] === '' ? 'weekly' : $f['freq'];
            if (!in_array($freq, ['daily', 'weekly'], true)) fail(400, 'Choose Daily or Weekly for a task you assign to employees.');
            $pool = array_map('intval', array_column(task_pool($me), 'id'));
            if ($mode === 'all') $targets = $pool;
            else {
                $targets = task_ids(isset($in['assignees']) ? $in['assignees'] : []);
                if (!$targets) fail(400, 'Choose at least one employee.');
                foreach ($targets as $x) if (!in_array($x, $pool, true)) fail(403, $me['role'] === 'admin' ? 'You can assign tasks only to active employees.' : 'You can assign tasks only to the employees under you. People above you in the hierarchy cannot be chosen.');
            }
            if (!$targets) fail(400, $me['role'] === 'admin' ? 'There are no active employees to assign this task to.' : 'There are no employees under you yet. Ask the administrator to set you as the immediate superior of your team (Admin > Employees).');
        }
        $hasSubs = !empty($f['subs']);
        $status = $hasSubs ? 'To Do' : $f['status']; // the status of a task with steps follows its steps
        $pdo->beginTransaction();
        try {
            run('INSERT INTO tasks (title, description, priority, category, frequency, start_date, due_date, due_time, is_personal, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$f['title'], $f['description'], $f['priority'], $f['category'], $freq, $f['start'], $f['due'], $f['time'], $personal, (int) $me['id'], (int) $me['id']]);
            $tid = (int) $pdo->lastInsertId();
            foreach ($targets as $x) run('INSERT INTO task_assignments (task_id, user_id, status, completed_at) VALUES (?, ?, ?, ?)', [$tid, $x, $status, $status === 'Completed' ? date('Y-m-d H:i:s') : null]);
            if ($hasSubs) task_sync_subtasks($tid, $f['subs'], $f['due']);
            $pdo->commit();
        } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
        if (!$personal) {
            foreach ($targets as $x) if ($x !== (int) $me['id']) task_note($x, 'Task assigned', $actor . ' assigned you a ' . task_kind_label($freq) . ': "' . task_cut($f['title'], 90) . '" (' . $f['priority'] . ' priority).' . task_when($f['due'], $f['time']));
            log_activity($actor . ' assigned the ' . task_kind_label($freq) . ' "' . task_cut($f['title'], 80) . '" to ' . count($targets) . ' employee' . (count($targets) === 1 ? '' : 's') . '.');
        }
        out(['task' => task_out($me), 'taskId' => s($tid), 'count' => count($targets)]);
    }

    // ----- edit -----
    list($t, $assigns) = task_load($me, $id, true);
    $personal = (int) $t['is_personal'] === 1;
    $freq = $personal ? 'personal' : ($f['freq'] !== '' ? $f['freq'] : $t['frequency']);
    if (!$personal && !in_array($freq, ['daily', 'weekly'], true)) fail(400, 'Choose Daily or Weekly.');
    $dueTime = $t['due_time'] ? substr($t['due_time'], 0, 8) : null;
    $before = ['title' => $t['title'], 'description' => (string) $t['description'], 'priority' => $t['priority'], 'category' => $t['category'], 'frequency' => $t['frequency'], 'start' => $t['start_date'], 'due' => $t['due_date'], 'time' => $dueTime];
    $after = ['title' => $f['title'], 'description' => $f['description'], 'priority' => $f['priority'], 'category' => $f['category'], 'frequency' => $freq, 'start' => $f['start'], 'due' => $f['due'], 'time' => $f['time']];
    $labels = ['title' => 'title', 'description' => 'description', 'priority' => 'priority', 'category' => 'category', 'frequency' => 'type', 'start' => 'start date', 'due' => 'due date', 'time' => 'due time'];
    $changed = [];
    foreach ($labels as $k => $label) if ((string) $before[$k] !== (string) $after[$k]) $changed[] = $label;

    $subsAfter = $f['subs'];
    if ($subsAfter === null) { // the steps are left as they are: the new dates must still fit them
        $m = q1('SELECT COUNT(*) AS n, MAX(projected_date) AS mx FROM task_subtasks WHERE task_id = ?', [$id]);
        if ((int) $m['n'] > 0 && (!$f['due'] || $m['mx'] > $f['due'])) fail(400, 'Every step must be planned on or before the due date. Move the dates of the steps first.');
        $hasSubs = (int) $m['n'] > 0;
    } else $hasSubs = count($subsAfter) > 0;

    $old = array_map('intval', array_column($assigns, 'user_id'));
    $add = []; $drop = [];
    if (!$personal && array_key_exists('assignees', $in)) { // the employees of an assigned task can be changed (reassigned)
        $new = task_ids($in['assignees']);
        if (!$new) fail(400, 'Choose at least one employee.');
        $add = array_values(array_diff($new, $old)); $drop = array_values(array_diff($old, $new));
        if ($add) {
            $pool = array_map('intval', array_column(task_pool($me), 'id'));
            foreach ($add as $x) if (!in_array($x, $pool, true)) fail(403, $me['role'] === 'admin' ? 'You can assign tasks only to active employees.' : 'You can assign tasks only to the employees under you. People above you in the hierarchy cannot be chosen.');
        }
    }
    $gone = [];
    if ($drop) $gone = task_stored_files('a.task_id = ? AND a.user_id IN (' . implode(',', array_map('intval', $drop)) . ')', [$id]);
    $pdo->beginTransaction();
    try {
        run('UPDATE tasks SET title = ?, description = ?, priority = ?, category = ?, frequency = ?, start_date = ?, due_date = ?, due_time = ?, updated_by = ? WHERE id = ?',
            [$f['title'], $f['description'], $f['priority'], $f['category'], $freq, $f['start'], $f['due'], $f['time'], (int) $me['id'], $id]);
        if (in_array('due date', $changed, true) || in_array('due time', $changed, true)) run('UPDATE task_assignments SET due_soon_notified = NULL, overdue_notified = 0 WHERE task_id = ?', [$id]); // a new deadline gets its own reminders
        if ($personal) { // a personal task has exactly one row: its status can be set in the form (unless it has steps: then the steps decide)
            $a = $assigns[0];
            if (!$hasSubs && $a['status'] !== $f['status']) run('UPDATE task_assignments SET status = ?, completed_at = ? WHERE id = ?', [$f['status'], $f['status'] === 'Completed' ? date('Y-m-d H:i:s') : null, $a['id']]);
        } else {
            foreach ($drop as $x) run('DELETE FROM task_assignments WHERE task_id = ? AND user_id = ?', [$id, $x]);
            foreach ($add as $x) run("INSERT INTO task_assignments (task_id, user_id, status) VALUES (?, ?, 'To Do')", [$id, $x]);
        }
        if ($subsAfter !== null) task_sync_subtasks($id, $subsAfter, $f['due']); // saves the steps, gives the new ones to every employee and updates each task status
        else foreach (q('SELECT id FROM task_assignments WHERE task_id = ?', [$id]) as $a) { task_seed($a['id'], $id); task_recompute($a['id']); } // new employees get the steps
        $pdo->commit();
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    task_unlink($gone);
    if (!$personal) {
        $keep = array_diff($old, $drop);
        foreach ($keep as $x) if ($changed && $x !== (int) $me['id']) task_note($x, 'Task updated', $actor . ' updated "' . task_cut($f['title'], 80) . '" (' . implode(', ', $changed) . ').' . task_when($f['due'], $f['time']));
        foreach ($add as $x) if ($x !== (int) $me['id']) task_note($x, 'Task assigned', $actor . ' assigned you a ' . task_kind_label($freq) . ': "' . task_cut($f['title'], 90) . '" (' . $f['priority'] . ' priority).' . task_when($f['due'], $f['time']));
        foreach ($drop as $x) if ($x !== (int) $me['id']) task_note($x, 'Task reassigned', $actor . ' removed you from the task "' . task_cut($f['title'], 100) . '". You no longer need to work on it.');
        if ($add || $drop) log_activity($actor . ' changed who is assigned to the task "' . task_cut($f['title'], 80) . '".');
    }
    out(['task' => task_out($me), 'taskId' => s($id)]);

case 'status': // one employee's own status of a task (drag and drop, Mark as Completed, Reopen, the status list) and/or where the person put the card on their own board (pos).
    // A task with steps follows its steps instead. Moving a card up or down inside a column changes only this person's own board.
    $aid = (int) (isset($in['assignmentId']) ? $in['assignmentId'] : 0);
    $st = isset($in['status']) ? $in['status'] : '';
    $hasPos = isset($in['pos']) && is_numeric($in['pos']);
    if ($st === '' ? !$hasPos : (!is_string($st) || !in_array($st, TASK_STATUSES, true))) fail(400, 'Choose a valid status.');
    list($w, $p) = task_scope($me);
    $r = q1(TASK_SQL . ' WHERE a.id = ? AND ' . $w, array_merge([$aid], $p));
    if (!$r) fail(404, 'Task not found.');
    $change = $st !== '' && $r['status'] !== $st;
    if ($change) {
        if (!task_perm($me, $r)['status']) fail(403, 'You cannot change the status of this task.');
        if ((int) q1('SELECT COUNT(*) AS n FROM assignment_subtasks WHERE assignment_id = ?', [$aid])['n'] > 0) fail(409, 'The status of this task follows its steps. Open the task and update its steps.');
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
    if ($hasPos) task_set_pos($me, $aid, (float) $in['pos']);
    out(['task' => task_out($me), 'changed' => $change]);

case 'delete':
    $id = (int) (isset($in['taskId']) ? $in['taskId'] : 0);
    list($t, $assigns) = task_load($me, $id, true);
    $gone = task_stored_files('a.task_id = ?', [$id]);
    $pdo = db(); $pdo->beginTransaction();
    try { run('DELETE FROM tasks WHERE id = ?', [$id]); $pdo->commit(); } // the assignments, steps and their history go with it (ON DELETE CASCADE)
    catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
    task_unlink($gone);
    if ((int) $t['is_personal'] === 0) {
        foreach ($assigns as $a) if ((int) $a['user_id'] !== (int) $me['id']) task_note($a['user_id'], 'Task removed', $me['name'] . ' deleted the task "' . task_cut($t['title'], 100) . '".');
        log_activity($me['name'] . ' deleted the task "' . task_cut($t['title'], 80) . '".');
    }
    out(['task' => task_out($me)]);
}
fail(404, 'Unknown action.');
