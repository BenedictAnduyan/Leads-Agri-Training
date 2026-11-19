<?php
// Task Management: the steps (subtasks) of a task. Loaded by api/task.php.
// Each task can have ordered steps with a projected date. Every assigned employee has their OWN progress on each step (table assignment_subtasks):
//   - steps are done in order (a step cannot be started or completed before the step before it is completed),
//   - a step has dependencies (what it waits for) and cannot be completed while one of them is unresolved,
//   - an employee who misses a projected date explains why (with files); the administrator / immediate superior accepts or rejects the reason and may move the date
//     (never later than the due date of the whole task),
//   - a superior can OPEN one step to the other people of the same department: one of them takes it over and can work on that step only.
// The task itself is Completed when all its steps are Completed (its status follows its steps).
require_once __DIR__ . '/task_lib.php';

/* ---------- loading ---------- */
function task_assign_ctx($aid) {
    return q1('SELECT a.id AS aid, a.task_id, a.user_id, a.status, t.title, t.due_date, t.due_time, t.start_date, t.is_personal, t.created_by, au.name AS assignee_name, au.department AS assignee_dept, au.supervisor_id AS assignee_sup
        FROM task_assignments a JOIN tasks t ON t.id = a.task_id JOIN users au ON au.id = a.user_id WHERE a.id = ?', [(int) $aid]);
}
function task_ctx_visible($u, $c) { // may this person see the assignment (the same rule as task_scope)
    if ($u['role'] === 'admin') return true;
    $uid = (int) $u['id'];
    if ((int) $c['user_id'] === $uid) return true;
    if (!is_superior_role($u) || (int) $c['is_personal'] === 1) return false;
    return ($c['created_by'] !== null && (int) $c['created_by'] === $uid) || in_array((int) $c['user_id'], task_downline($uid), true);
}
function task_sub_rows($aid) {
    return q('SELECT s.*, st.title, st.details, st.position, st.projected_date AS plan_date, st.dependencies AS plan_deps, st.task_id, cb.name AS completed_by_name, cl.name AS claimed_by_name, ob.name AS opened_by_name
        FROM assignment_subtasks s JOIN task_subtasks st ON st.id = s.subtask_id LEFT JOIN users cb ON cb.id = s.completed_by LEFT JOIN users cl ON cl.id = s.claimed_by LEFT JOIN users ob ON ob.id = s.opened_by
        WHERE s.assignment_id = ? ORDER BY st.position, s.id', [(int) $aid]);
}
function task_sub_flags($rows, $asid) { // [all steps before this one are completed, a step after this one is completed]
    $prev = true; $later = false; $seen = false;
    foreach ($rows as $r) {
        if ((int) $r['id'] === (int) $asid) { $seen = true; continue; }
        if (!$seen) { if ($r['status'] !== 'Completed') $prev = false; }
        elseif ($r['status'] === 'Completed') $later = true;
    }
    return [$prev, $later];
}
// Has this person already taken over (or completed) a step of this assignment? A teammate who helps takes ONE step only: the other steps stay with the assignee.
function task_helper_used($uid, $aid) {
    return (int) q1('SELECT COUNT(*) AS n FROM assignment_subtasks WHERE assignment_id = ? AND (claimed_by = ? OR completed_by = ?)', [(int) $aid, (int) $uid, (int) $uid])['n'] > 0;
}
function task_sub_eligible($u, $c, $s) { // may this person take over the (open) step: same department as the assignee, not the assignee, and has not helped with another step of this task yet
    return (int) $s['is_open'] === 1 && $s['status'] !== 'Completed' && $s['claimed_by'] === null && (int) $c['user_id'] !== (int) $u['id'] && task_same_dept($u['department'], $c['assignee_dept'])
        && !(TASK_HELPER_ONE_STEP && task_helper_used($u['id'], $c['aid']));
}
function task_sub_perm($u, $c, $s, $prev, $later) {
    $uid = (int) $u['id'];
    $assignee = (int) $c['user_id'] === $uid;
    $helper = $s['claimed_by'] !== null && (int) $s['claimed_by'] === $uid;
    $personal = (int) $c['is_personal'] === 1;
    $boss = task_is_boss($u, $c);
    $owner = $personal && $assignee;
    $done = $s['status'] === 'Completed';
    $actor = $assignee || $helper || $boss;
    $helperOnly = $helper && !$assignee && !$boss; // a teammate who took over this one step: works on it until it is completed, then it is finished for them
    return [
        'work' => $actor && !$done && $prev, 'waitPrev' => $actor && !$done && !$prev, 'reopen' => $done && ($assignee || $boss) && !$later, 'deps' => $actor && !$done, 'helperDone' => $helperOnly && $done,
        'reason' => $assignee && !$personal && !$done, 'adjust' => ($boss || $owner) && !$done,
        'open' => $boss && !$personal && !$done && (int) $s['is_open'] === 0, 'closeOpen' => $boss && !$personal && (int) $s['is_open'] === 1,
        'review' => $boss && !$personal && !$done && $s['reason_status'] === 'pending', 'claim' => task_sub_eligible($u, $c, $s), 'release' => $helper && !$done,
    ];
}
// One step the person may act on: [step row, assignment context, permissions, all steps]. 404 when they have no business with it.
function task_sub_access($u, $asid) {
    $s = q1('SELECT s.*, st.title, st.position FROM assignment_subtasks s JOIN task_subtasks st ON st.id = s.subtask_id WHERE s.id = ?', [(int) $asid]);
    if (!$s) fail(404, 'Step not found.');
    $c = task_assign_ctx($s['assignment_id']);
    if (!$c) fail(404, 'Step not found.');
    $rows = task_sub_rows($s['assignment_id']);
    $helper = $s['claimed_by'] !== null && (int) $s['claimed_by'] === (int) $u['id'];
    if (!task_ctx_visible($u, $c) && !$helper && !task_sub_eligible($u, $c, $s)) fail(404, 'Step not found.');
    list($prev, $later) = task_sub_flags($rows, $asid);
    return [$s, $c, task_sub_perm($u, $c, $s, $prev, $later), $rows];
}

/* ---------- what the browser gets ---------- */
function task_subs_payload($u, $aid) {
    $c = task_assign_ctx($aid);
    if (!$c) return null;
    $visible = task_ctx_visible($u, $c);
    $rows = task_sub_rows($aid);
    $ids = array_map('intval', array_column($rows, 'id'));
    $deps = []; $ups = []; $files = [];
    if ($ids) {
        $in = implode(',', $ids);
        foreach (q("SELECT * FROM subtask_dependencies WHERE a_subtask_id IN ($in) ORDER BY id") as $d) $deps[(int) $d['a_subtask_id']][] = ['id' => s($d['id']), 'label' => $d['label'], 'resolved' => (int) $d['resolved'] === 1];
        foreach (q("SELECT f.* FROM subtask_files f WHERE a_subtask_id IN ($in) ORDER BY id") as $f) $files[(int) $f['update_id']][] = ['id' => s($f['id']), 'name' => $f['file_name'], 'size' => (int) $f['size']];
        foreach (q("SELECT u.*, n.name AS who FROM subtask_updates u LEFT JOIN users n ON n.id = u.user_id WHERE u.a_subtask_id IN ($in) ORDER BY u.id DESC") as $x) {
            $k = (int) $x['a_subtask_id'];
            if (isset($ups[$k]) && count($ups[$k]) >= 40) continue;
            $ups[$k][] = ['id' => s($x['id']), 'kind' => $x['kind'], 'who' => $x['who'] === null ? 'a removed account' : $x['who'], 'note' => (string) $x['note'], 'progress' => $x['progress'] === null ? null : (int) $x['progress'], 'at' => iso($x['created_at']), 'files' => isset($files[(int) $x['id']]) ? $files[(int) $x['id']] : []];
        }
    }
    $today = date('Y-m-d'); $o = []; $n = 0;
    foreach ($rows as $s) {
        $n++;
        list($prev, $later) = task_sub_flags($rows, $s['id']);
        $helper = $s['claimed_by'] !== null && (int) $s['claimed_by'] === (int) $u['id'];
        if (!$visible && !$helper && !task_sub_eligible($u, $c, $s)) continue; // a person who may only help sees just the opened step
        $done = $s['status'] === 'Completed';
        $miss = !$done && $s['projected_date'] < $today;
        $o[] = ['id' => s($s['id']), 'stepId' => s($s['subtask_id']), 'planDeps' => (string) $s['plan_deps'], 'n' => $n, 'title' => $s['title'], 'details' => (string) $s['details'], 'plan' => $s['plan_date'], 'date' => $s['projected_date'], 'moved' => $s['projected_date'] !== $s['plan_date'],
            'status' => $done ? 'Completed' : ($miss ? 'Missing' : $s['status']), 'rawStatus' => $s['status'], 'missing' => $miss, 'progress' => $done ? 100 : (int) $s['progress'],
            'completedAt' => iso($s['completed_at']), 'completedBy' => $s['completed_by_name'], 'completedLate' => $done && $s['completed_at'] && substr($s['completed_at'], 0, 10) > $s['projected_date'],
            'open' => (int) $s['is_open'] === 1, 'openedBy' => $s['opened_by_name'], 'claimedBy' => $s['claimed_by_name'], 'claimedById' => $s['claimed_by'] === null ? '' : s($s['claimed_by']),
            'reasonStatus' => $done && $s['reason_status'] === 'pending' ? 'none' : $s['reason_status'], 'deps' => isset($deps[(int) $s['id']]) ? $deps[(int) $s['id']] : [], 'updates' => isset($ups[(int) $s['id']]) ? $ups[(int) $s['id']] : [],
            'can' => task_sub_perm($u, $c, $s, $prev, $later)];
    }
    return ['assignmentId' => s($aid), 'visible' => $visible, 'task' => ['title' => $c['title'], 'dueDate' => $c['due_date'], 'dueTime' => $c['due_time'] ? substr($c['due_time'], 0, 5) : '', 'assignee' => $c['assignee_name'], 'assigneeId' => s($c['user_id']), 'personal' => (int) $c['is_personal'] === 1], 'subs' => $o];
}
function task_sub_reply($u, $aid, $extra = []) { out(array_merge(['task' => task_out($u), 'data' => task_subs_payload($u, $aid)], $extra)); }

/* ---------- small writers ---------- */
function task_log($asid, $uid, $kind, $note, $progress = null) {
    run('INSERT INTO subtask_updates (a_subtask_id, user_id, kind, note, progress) VALUES (?, ?, ?, ?, ?)', [(int) $asid, $uid === null ? null : (int) $uid, $kind, $note === null || $note === '' ? null : $note, $progress]);
    return (int) db()->lastInsertId();
}
function task_bosses($c, $exceptId) { // who reviews this assignment: the person who assigned the task and the assignee's immediate superior (active accounts only)
    $ids = array_unique(array_filter([(int) $c['created_by'], (int) $c['assignee_sup']]));
    $o = [];
    foreach ($ids as $x) { if ($x === (int) $exceptId || $x === (int) $c['user_id']) continue; $p = task_people(); if (isset($p[$x]) && $p[$x]['status'] === 'Active') $o[] = $x; }
    return $o;
}
// The task follows its steps: all steps Completed = Completed, any step started = In Progress, otherwise To Do.
function task_recompute($aid, $actorName = '') {
    $a = q1('SELECT a.*, t.title, t.created_by, t.is_personal, au.name AS assignee_name, au.supervisor_id FROM task_assignments a JOIN tasks t ON t.id = a.task_id JOIN users au ON au.id = a.user_id WHERE a.id = ?', [(int) $aid]);
    $rows = q('SELECT status, progress FROM assignment_subtasks WHERE assignment_id = ?', [(int) $aid]);
    if (!$a || !$rows) return;
    $done = 0; $started = false;
    foreach ($rows as $r) { if ($r['status'] === 'Completed') $done++; if ($r['status'] !== 'To Do' || (int) $r['progress'] > 0) $started = true; }
    $new = $done === count($rows) ? 'Completed' : ($started ? 'In Progress' : 'To Do');
    if ($new === $a['status']) return;
    run('UPDATE task_assignments SET status = ?, completed_at = ? WHERE id = ?', [$new, $new === 'Completed' ? date('Y-m-d H:i:s') : null, (int) $aid]);
    if ($new === 'Completed' && (int) $a['is_personal'] === 0) {
        foreach (array_unique(array_filter([(int) $a['created_by'], (int) $a['supervisor_id']])) as $x) {
            if ($x === (int) $a['user_id']) continue;
            $m = q1("SELECT id FROM users WHERE id = ? AND status = 'Active'", [$x]);
            if ($m) task_note($x, 'Task completed', $a['assignee_name'] . ' completed all the steps of "' . task_cut($a['title'], 100) . '".');
        }
    }
}
// Gives an assignment its own row for every step of the task that it does not have yet (with the planned dependencies as its first dependencies).
function task_seed($aid, $tid) {
    $have = array_map('intval', array_column(q('SELECT subtask_id FROM assignment_subtasks WHERE assignment_id = ?', [(int) $aid]), 'subtask_id'));
    foreach (q('SELECT * FROM task_subtasks WHERE task_id = ? ORDER BY position, id', [(int) $tid]) as $st) {
        if (in_array((int) $st['id'], $have, true)) continue;
        run('INSERT INTO assignment_subtasks (assignment_id, subtask_id, projected_date) VALUES (?, ?, ?)', [(int) $aid, (int) $st['id'], $st['projected_date']]);
        $asid = (int) db()->lastInsertId();
        foreach (preg_split('/\R/', (string) $st['dependencies']) as $line) { $line = trim($line); if ($line !== '') run('INSERT INTO subtask_dependencies (a_subtask_id, label) VALUES (?, ?)', [$asid, mb_substr($line, 0, 200)]); }
    }
}
// The list of steps sent by the form: [{id, title, details, date, deps}]. Checks everything again (the browser is not trusted).
function task_subs_clean($raw, $due, $start) {
    if (!is_array($raw)) return [];
    if (count($raw) > TASK_MAX_SUBTASKS) fail(400, 'A task can have at most ' . TASK_MAX_SUBTASKS . ' steps.');
    $o = [];
    foreach (array_values($raw) as $i => $x) {
        if (!is_array($x)) continue;
        $n = $i + 1;
        $title = task_str(isset($x['title']) ? $x['title'] : '');
        if ($title === '') fail(400, 'Enter a title for step ' . $n . ', or remove the step.');
        if (mb_strlen($title) > 160) fail(400, 'The title of step ' . $n . ' can have at most 160 characters.');
        $date = task_date(isset($x['date']) ? $x['date'] : '', 'projected date for step ' . $n);
        if (!$date) fail(400, 'Choose the projected date of step ' . $n . '.');
        if (!$due) fail(400, 'Choose the due date of the task first: every step must be planned on or before it.');
        if ($date > $due) fail(400, 'The projected date of step ' . $n . ' (' . task_d($date) . ') cannot be after the due date of the task (' . task_d($due) . ').');
        if ($start && $date < $start) fail(400, 'The projected date of step ' . $n . ' cannot be before the start date of the task.');
        $details = task_str(isset($x['details']) ? $x['details'] : '');
        if (mb_strlen($details) > 1000) fail(400, 'The details of step ' . $n . ' can have at most 1000 characters.');
        $deps = isset($x['deps']) ? (is_array($x['deps']) ? implode("\n", array_map('task_str', $x['deps'])) : task_str($x['deps'])) : '';
        $deps = implode("\n", array_slice(array_filter(array_map(function ($l) { return mb_substr(trim($l), 0, 200); }, preg_split('/\R/', $deps)), 'strlen'), 0, 10));
        $o[] = ['id' => (int) (isset($x['id']) ? $x['id'] : 0), 'title' => $title, 'details' => $details, 'date' => $date, 'deps' => $deps];
    }
    return $o;
}
// Saves the list of steps of a task: updates the ones that keep their id, adds the new ones, removes the ones that are gone. Then every assignment gets the new steps.
function task_sync_subtasks($tid, $subs, $due) {
    $old = []; foreach (q('SELECT * FROM task_subtasks WHERE task_id = ?', [(int) $tid]) as $r) $old[(int) $r['id']] = $r;
    $keep = []; $pos = 0;
    foreach ($subs as $x) {
        $pos++;
        if ($x['id'] && isset($old[$x['id']])) {
            $o = $old[$x['id']];
            run('UPDATE task_subtasks SET position = ?, title = ?, details = ?, projected_date = ?, dependencies = ? WHERE id = ?', [$pos, $x['title'], $x['details'], $x['date'], $x['deps'], $x['id']]);
            if ($o['projected_date'] !== $x['date']) run("UPDATE assignment_subtasks SET projected_date = ?, missed_notified = 0 WHERE subtask_id = ? AND projected_date = ? AND status <> 'Completed'", [$x['date'], $x['id'], $o['projected_date']]);
            $keep[] = $x['id'];
        } else {
            run('INSERT INTO task_subtasks (task_id, position, title, details, projected_date, dependencies) VALUES (?, ?, ?, ?, ?, ?)', [(int) $tid, $pos, $x['title'], $x['details'], $x['date'], $x['deps']]);
            $keep[] = (int) db()->lastInsertId();
        }
    }
    foreach ($old as $id => $o) if (!in_array($id, $keep, true)) run('DELETE FROM task_subtasks WHERE id = ?', [$id]); // the employees' rows for it go with it (ON DELETE CASCADE)
    if ($due) run('UPDATE assignment_subtasks s JOIN task_assignments a ON a.id = s.assignment_id SET s.projected_date = ?, s.missed_notified = 0 WHERE a.task_id = ? AND s.projected_date > ?', [$due, (int) $tid, $due]); // a date moved by a superior never goes past the due date
    foreach (q('SELECT id FROM task_assignments WHERE task_id = ?', [(int) $tid]) as $a) { task_seed($a['id'], $tid); task_recompute($a['id']); }
}

/* ---------- attachments ---------- */
function task_files_in() { // the files of a multipart form (field "files"), checked before anything is saved
    $o = [];
    if (empty($_FILES['files'])) return $o;
    $f = $_FILES['files'];
    if (!is_array($f['name'])) foreach (['name', 'type', 'tmp_name', 'error', 'size'] as $k) $f[$k] = [$f[$k]];
    foreach ($f['name'] as $i => $n) {
        if ($f['error'][$i] === UPLOAD_ERR_NO_FILE) continue;
        $o[] = ['name' => $n, 'tmp' => $f['tmp_name'][$i], 'error' => $f['error'][$i], 'size' => (int) $f['size'][$i]];
    }
    if (count($o) > 5) fail(400, 'Attach at most 5 files at a time.');
    foreach ($o as &$x) {
        $name = trim(basename(str_replace('\\', '/', (string) $x['name'])));
        if ($x['error'] === UPLOAD_ERR_INI_SIZE || $x['error'] === UPLOAD_ERR_FORM_SIZE || $x['size'] > TASK_FILE_MAX) fail(400, 'The file "' . $name . '" is too big. Each file can be 10 MB at most.');
        if ($x['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($x['tmp'])) fail(400, 'The file "' . $name . '" could not be uploaded. Please try again.');
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if (!isset(TASK_FILE_TYPES[$ext])) fail(400, 'The file "' . $name . '" is not allowed. Upload a PDF, picture (PNG, JPG), Word or Excel file.');
        if (mb_strlen($name) > 255) $name = mb_substr($name, 0, 240) . '.' . $ext;
        $x['clean'] = $name; $x['ext'] = $ext;
    }
    unset($x);
    return $o;
}
function task_files_save($files, $asid, $updateId, $uid) {
    foreach ($files as $x) {
        $stored = bin2hex(random_bytes(16)) . '.' . $x['ext'];
        if (!move_uploaded_file($x['tmp'], task_upload_dir() . '/' . $stored)) fail(500, 'The server could not save the file "' . $x['clean'] . '". Check that the folder uploads/tasks can be written to.');
        run('INSERT INTO subtask_files (a_subtask_id, update_id, user_id, file_name, stored_name, mime, size) VALUES (?, ?, ?, ?, ?, ?, ?)', [(int) $asid, (int) $updateId, (int) $uid, $x['clean'], $stored, TASK_FILE_TYPES[$x['ext']], $x['size']]);
    }
}
function task_file_download($u, $fid) {
    $f = q1('SELECT * FROM subtask_files WHERE id = ?', [(int) $fid]);
    if (!$f) fail(404, 'File not found.');
    task_sub_access($u, $f['a_subtask_id']); // 404 when the person may not see that step
    $path = task_upload_dir() . '/' . basename($f['stored_name']);
    if (!is_file($path)) fail(404, 'The file is no longer on the server.');
    $ext = strtolower(pathinfo($f['file_name'], PATHINFO_EXTENSION));
    $inline = in_array($ext, ['pdf', 'png', 'jpg', 'jpeg'], true);
    header('Content-Type: ' . (isset(TASK_FILE_TYPES[$ext]) ? TASK_FILE_TYPES[$ext] : 'application/octet-stream'));
    header('X-Content-Type-Options: nosniff');
    header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . str_replace(['"', "\r", "\n"], '', $f['file_name']) . '"');
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: private, max-age=0');
    readfile($path);
    exit;
}

/* ---------- actions on one step (called by api/task.php) ---------- */
function task_sub_who($u, $c) { return $u['name'] . ((int) $c['user_id'] === (int) $u['id'] ? '' : ' (for ' . $c['assignee_name'] . ')'); }

// Progress update and "explain a missed date": multipart form (so files can be attached). kind = progress | reason
function task_act_sub_update($u) {
    $asid = (int) (isset($_POST['asid']) ? $_POST['asid'] : 0);
    $kind = isset($_POST['kind']) ? $_POST['kind'] : 'progress';
    if (!in_array($kind, ['progress', 'reason'], true)) fail(400, 'Unknown update.');
    list($s, $c, $p) = task_sub_access($u, $asid);
    $note = task_str(isset($_POST['note']) ? $_POST['note'] : '');
    if (mb_strlen($note) > 2000) fail(400, 'The note can have at most 2000 characters.');
    $files = task_files_in();
    $aid = (int) $s['assignment_id'];
    if ($kind === 'reason') {
        if (!$p['reason']) fail(403, 'You cannot explain this step.');
        if (mb_strlen($note) < 5) fail(400, 'Write why the step could not be finished on time (at least a few words).');
        $rid = task_log($asid, $u['id'], 'reason', $note);
        task_files_save($files, $asid, $rid, $u['id']);
        run("UPDATE assignment_subtasks SET reason_status = 'pending' WHERE id = ?", [$asid]);
        foreach (task_bosses($c, $u['id']) as $x) task_note($x, 'Task step reason', $c['assignee_name'] . ' explained the step "' . task_cut($s['title'], 60) . '" of "' . task_cut($c['title'], 60) . '". Review it and accept or adjust the date.');
        task_sub_reply($u, $aid);
    }
    if (!$p['work']) fail(403, $p['waitPrev'] ? 'Complete the step before this one first.' : 'You cannot update this step.');
    $has = isset($_POST['progress']) && $_POST['progress'] !== '';
    $pr = $has ? (int) $_POST['progress'] : null;
    if ($has && (!preg_match('/^\d{1,3}$/', trim((string) $_POST['progress'])) || $pr > 100)) fail(400, 'Progress must be a number from 0 to 100.');
    if ($pr === null && $note === '' && !$files) fail(400, 'Enter your progress, write a note, or attach a file.');
    $pr = $pr === null ? (int) $s['progress'] : $pr;
    $st = $s['status'] === 'To Do' && ($pr > 0 || $note !== '') ? 'In Progress' : $s['status'];
    run('UPDATE assignment_subtasks SET progress = ?, status = ? WHERE id = ?', [$pr, $st, $asid]);
    $uidn = task_log($asid, $u['id'], 'progress', $note, $pr);
    task_files_save($files, $asid, $uidn, $u['id']);
    task_recompute($aid);
    task_sub_reply($u, $aid);
}
function task_act_sub_status($u, $in) {
    list($s, $c, $p) = task_sub_access($u, (int) (isset($in['asid']) ? $in['asid'] : 0));
    $st = isset($in['status']) ? $in['status'] : '';
    if (!is_string($st) || !in_array($st, TASK_STATUSES, true)) fail(400, 'Choose a valid status.');
    $asid = (int) $s['id']; $aid = (int) $s['assignment_id'];
    if ($s['status'] === $st) task_sub_reply($u, $aid);
    if ($s['status'] === 'Completed') { // reopening
        if (!$p['reopen']) fail(403, 'This step cannot be reopened because a later step is already completed.');
        run("UPDATE assignment_subtasks SET status = ?, progress = LEAST(progress, 99), completed_at = NULL, completed_by = NULL WHERE id = ?", [$st, $asid]);
        task_log($asid, $u['id'], 'status', 'Reopened (' . $st . ').');
    } else {
        if (!$p['work']) fail(403, $p['waitPrev'] ? 'Complete the step before this one first.' : 'You cannot update this step.');
        if ($st === 'Completed') {
            $pend = (int) q1('SELECT COUNT(*) AS n FROM subtask_dependencies WHERE a_subtask_id = ? AND resolved = 0', [$asid])['n'];
            if ($pend) fail(400, 'This step cannot be completed yet: ' . $pend . ' dependenc' . ($pend === 1 ? 'y is' : 'ies are') . ' not resolved. Mark them as resolved first.');
            run("UPDATE assignment_subtasks SET status = 'Completed', progress = 100, completed_at = ?, completed_by = ?, is_open = 0, reason_status = IF(reason_status = 'pending', 'none', reason_status) WHERE id = ?", [date('Y-m-d H:i:s'), (int) $u['id'], $asid]); // a step that is done no longer waits for a decision
            task_log($asid, $u['id'], 'status', 'Completed' . ((int) $c['user_id'] === (int) $u['id'] ? '.' : ' by ' . $u['name'] . ' (took over this step).'), 100);
            if ((int) $c['user_id'] !== (int) $u['id']) task_note($c['user_id'], 'Task step done', $u['name'] . ' completed the step "' . task_cut($s['title'], 70) . '" of "' . task_cut($c['title'], 70) . '" for you. The next steps are yours to continue.');
        } else {
            run('UPDATE assignment_subtasks SET status = ? WHERE id = ?', [$st, $asid]);
            task_log($asid, $u['id'], 'status', 'Moved to ' . $st . '.');
        }
    }
    task_recompute($aid);
    task_sub_reply($u, $aid);
}
function task_act_sub_dep($u, $in) {
    list($s, $c, $p) = task_sub_access($u, (int) (isset($in['asid']) ? $in['asid'] : 0));
    if (!$p['deps']) fail(403, 'You cannot change the dependencies of this step.');
    $op = isset($in['op']) ? $in['op'] : ''; $asid = (int) $s['id'];
    if ($op === 'add') {
        $label = task_str(isset($in['label']) ? $in['label'] : '');
        if ($label === '') fail(400, 'Write what this step depends on.');
        if (mb_strlen($label) > 200) fail(400, 'A dependency can have at most 200 characters.');
        run('INSERT INTO subtask_dependencies (a_subtask_id, label, created_by) VALUES (?, ?, ?)', [$asid, $label, (int) $u['id']]);
        task_log($asid, $u['id'], 'dependency', 'Added dependency: ' . $label);
    } else {
        $d = q1('SELECT * FROM subtask_dependencies WHERE id = ? AND a_subtask_id = ?', [(int) (isset($in['depId']) ? $in['depId'] : 0), $asid]);
        if (!$d) fail(404, 'Dependency not found.');
        if ($op === 'toggle') {
            $r = (int) $d['resolved'] === 1 ? 0 : 1;
            run('UPDATE subtask_dependencies SET resolved = ?, resolved_at = ? WHERE id = ?', [$r, $r ? date('Y-m-d H:i:s') : null, $d['id']]);
            task_log($asid, $u['id'], 'dependency', ($r ? 'Resolved: ' : 'Not resolved again: ') . $d['label']);
        } elseif ($op === 'remove') {
            run('DELETE FROM subtask_dependencies WHERE id = ?', [$d['id']]);
            task_log($asid, $u['id'], 'dependency', 'Removed dependency: ' . $d['label']);
        } else fail(400, 'Unknown dependency action.');
    }
    task_sub_reply($u, (int) $s['assignment_id']);
}
// A superior opens (or closes) ONE step to the other people of the assignee's department.
function task_act_sub_open($u, $in) {
    list($s, $c, $p) = task_sub_access($u, (int) (isset($in['asid']) ? $in['asid'] : 0));
    $asid = (int) $s['id']; $open = !empty($in['open']);
    if ($open) {
        if (!$p['open']) fail(403, 'Only an administrator or the immediate superior can open a step to the department, and only a step that is not completed.');
        run('UPDATE assignment_subtasks SET is_open = 1, opened_by = ?, opened_at = ?, claimed_by = NULL, claimed_at = NULL WHERE id = ?', [(int) $u['id'], date('Y-m-d H:i:s'), $asid]);
        task_log($asid, $u['id'], 'open', 'Opened this step to the other people of the ' . ($c['assignee_dept'] !== '' ? $c['assignee_dept'] . ' ' : '') . 'department.');
        $n = 0;
        foreach (task_people() as $x) {
            if ($x['status'] !== 'Active' || !in_array($x['role'], ['employee', 'superior', 'executive'], true) || (int) $x['id'] === (int) $c['user_id'] || (int) $x['id'] === (int) $u['id'] || !task_same_dept($c['assignee_dept'], $x['department'])) continue;
            task_note($x['id'], 'Task step open', $u['name'] . ' opened the step "' . task_cut($s['title'], 60) . '" of "' . task_cut($c['title'], 60) . '" (' . $c['assignee_name'] . '). You can take it over.'); $n++;
        }
        task_note($c['user_id'], 'Task step open', $u['name'] . ' opened your step "' . task_cut($s['title'], 70) . '" of "' . task_cut($c['title'], 70) . '" so a teammate can complete it.');
    } else {
        if (!$p['closeOpen']) fail(403, 'You cannot close this step.');
        if ($s['claimed_by'] !== null) task_note($s['claimed_by'], 'Task step closed', $u['name'] . ' closed the step "' . task_cut($s['title'], 70) . '" of "' . task_cut($c['title'], 70) . '". You no longer need to work on it.');
        run('UPDATE assignment_subtasks SET is_open = 0, claimed_by = NULL, claimed_at = NULL WHERE id = ?', [$asid]);
        task_log($asid, $u['id'], 'open', 'Closed the step to the department.');
    }
    task_sub_reply($u, (int) $s['assignment_id']);
}
function task_act_sub_claim($u, $in) {
    list($s, $c, $p) = task_sub_access($u, (int) (isset($in['asid']) ? $in['asid'] : 0));
    $asid = (int) $s['id']; $take = !empty($in['claim']);
    if ($take) {
        if (!$p['claim']) {
            if (TASK_HELPER_ONE_STEP && (int) $c['user_id'] !== (int) $u['id'] && task_helper_used($u['id'], $c['aid'])) fail(403, 'You already took over a step of this task. You help with one step only, so the other steps stay with ' . $c['assignee_name'] . '.');
            fail(409, 'This step is not available to take over (someone else took it, or it was closed).');
        }
        if (run('UPDATE assignment_subtasks SET claimed_by = ?, claimed_at = ? WHERE id = ? AND claimed_by IS NULL AND is_open = 1', [(int) $u['id'], date('Y-m-d H:i:s'), $asid])->rowCount() !== 1) fail(409, 'Someone else just took this step.');
        task_log($asid, $u['id'], 'claim', $u['name'] . ' took over this step.');
        foreach (array_unique(array_merge([(int) $c['user_id']], task_bosses($c, $u['id']))) as $x) if ($x !== (int) $u['id']) task_note($x, 'Task step taken', $u['name'] . ' took over the step "' . task_cut($s['title'], 60) . '" of "' . task_cut($c['title'], 60) . '" (' . $c['assignee_name'] . ').');
    } else {
        if (!$p['release']) fail(403, $s['status'] === 'Completed' ? 'You already completed this step.' : 'You have not taken this step.');
        run('UPDATE assignment_subtasks SET claimed_by = NULL, claimed_at = NULL WHERE id = ?', [$asid]);
        task_log($asid, $u['id'], 'claim', $u['name'] . ' gave the step back.');
    }
    task_sub_reply($u, (int) $s['assignment_id']);
}
// The administrator / immediate superior accepts or rejects the reason for a missed date. Accepting needs the new projected date.
function task_act_sub_review($u, $in) {
    list($s, $c, $p) = task_sub_access($u, (int) (isset($in['asid']) ? $in['asid'] : 0));
    if (!$p['review']) fail(403, 'There is no reason waiting for your decision on this step.');
    $asid = (int) $s['id']; $d = isset($in['decision']) ? $in['decision'] : '';
    $note = task_str(isset($in['note']) ? $in['note'] : '');
    if (mb_strlen($note) > 1000) fail(400, 'The note can have at most 1000 characters.');
    if ($d === 'valid') {
        $new = task_new_date($c, isset($in['date']) ? $in['date'] : '', true);
        run("UPDATE assignment_subtasks SET reason_status = 'valid', projected_date = ?, missed_notified = 0 WHERE id = ?", [$new, $asid]);
        task_log($asid, $u['id'], 'review', 'Reason accepted by ' . $u['name'] . '. New projected date: ' . task_d($new) . '.' . ($note !== '' ? ' ' . $note : ''));
        task_note($c['user_id'], 'Task step accepted', $u['name'] . ' accepted your reason for "' . task_cut($s['title'], 60) . '". New projected date: ' . task_d($new) . '.');
    } elseif ($d === 'rejected') {
        if ($note === '') fail(400, 'Write why the reason is not accepted.');
        run("UPDATE assignment_subtasks SET reason_status = 'rejected' WHERE id = ?", [$asid]);
        task_log($asid, $u['id'], 'review', 'Reason not accepted by ' . $u['name'] . '. ' . $note);
        task_note($c['user_id'], 'Task step rejected', $u['name'] . ' did not accept your reason for "' . task_cut($s['title'], 60) . '". ' . task_cut($note, 100));
    } else fail(400, 'Choose to accept or reject the reason.');
    task_sub_reply($u, (int) $s['assignment_id']);
}
// A date for a step: a real date, not after the due date of the task, not before its start date. $future = it must also be today or later (used when a missed step is given more time).
function task_new_date($c, $raw, $future) {
    $new = task_date($raw, 'new projected date');
    if (!$new) fail(400, 'Choose the new projected date.');
    if ($c['due_date'] && $new > $c['due_date']) fail(400, 'The projected date cannot be after the due date of the whole task (' . task_d($c['due_date']) . '). Change the due date of the task first.');
    if ($c['start_date'] && $new < $c['start_date']) fail(400, 'The projected date cannot be before the start date of the task.');
    if ($future && $new < date('Y-m-d')) fail(400, 'Choose today or a later date, so the step has time to be finished.');
    return $new;
}
// Moves the projected date of one step without a review (administrator / immediate superior; the owner of a personal task).
function task_act_sub_date($u, $in) {
    list($s, $c, $p) = task_sub_access($u, (int) (isset($in['asid']) ? $in['asid'] : 0));
    if (!$p['adjust']) fail(403, 'You cannot change the projected date of this step.');
    $new = task_new_date($c, isset($in['date']) ? $in['date'] : '', false);
    if ($new === $s['projected_date']) task_sub_reply($u, (int) $s['assignment_id']);
    run('UPDATE assignment_subtasks SET projected_date = ?, missed_notified = 0 WHERE id = ?', [$new, (int) $s['id']]);
    task_log($s['id'], $u['id'], 'date', 'Projected date changed from ' . task_d($s['projected_date']) . ' to ' . task_d($new) . ' by ' . $u['name'] . '.');
    if ((int) $c['user_id'] !== (int) $u['id']) task_note($c['user_id'], 'Task step date', $u['name'] . ' moved the projected date of "' . task_cut($s['title'], 60) . '" to ' . task_d($new) . '.');
    task_sub_reply($u, (int) $s['assignment_id']);
}
