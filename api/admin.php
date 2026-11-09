<?php
// Admin actions. Every action first checks that the logged-in user is an admin.
require __DIR__ . '/helpers.php';
$in = input();
$action = isset($_GET['action']) ? $_GET['action'] : '';
// Everything is for the admin only, except adding, editing and removing suppliers (the Supplier Master), which an employee with the Supplier Master access permission may also do.
// The rest of the Supplier Evaluation tab (criteria, responses, corrective actions, re-evaluation requests) stays admin only.
$supplierActions = ['save_supplier', 'delete_supplier', 'import_suppliers']; // every signed-in account may use these two, for the suppliers of their own department
$admin = require_login();
if ($admin['role'] !== 'admin' && !(in_array($action, $supplierActions, true) && can_add_suppliers($admin))) fail(403, 'You do not have access to this action.');
function val($k) { $in = input(); return isset($in[$k]) ? $in[$k] : ''; }

// checks of the learning material and of the quiz questions of a card
function check_blocks($content) {
    foreach ($content as $b) {
        if (!is_array($b) || count($b) < 2 || !in_array($b[0], ['h', 'p', 'ul', 'ol', 'warn', 'video', 'image'], true)) fail(400, 'The learning material has an invalid block.');
        if (($b[0] === 'video' || $b[0] === 'image') && !preg_match('/^[A-Za-z0-9_\-\/.]+$/', (string) $b[1])) fail(400, 'A video or image path may only contain letters, numbers and the characters / . _ -');
    }
}
function check_questions($questions) {
    foreach ($questions as $x) {
        if (!is_array($x) || trim((string) (isset($x['text']) ? $x['text'] : '')) === '' || trim((string) (isset($x['explanation']) ? $x['explanation'] : '')) === '' || !isset($x['options']) || !is_array($x['options']) || count($x['options']) < 2) fail(400, 'Every question needs text, answers and an explanation.');
        foreach ($x['options'] as $o) if (trim((string) $o) === '') fail(400, 'Every answer option must be filled in.');
        if ((int) $x['answer'] < 0 || (int) $x['answer'] >= count($x['options'])) fail(400, 'Choose the correct answer for every question.');
    }
}

switch ($action) {

case 'save_employee':
    $f = [];
    foreach (['name', 'employeeId', 'email', 'department', 'position', 'role'] as $k) $f[$k] = trim((string) val($k));
    if ($f['name'] === '' || $f['email'] === '' || $f['employeeId'] === '') fail(400, 'Name, email and employee ID are required.');
    if (!filter_var($f['email'], FILTER_VALIDATE_EMAIL)) fail(400, 'Enter a valid email address.');
    if (!in_array($f['role'], ['admin', 'employee', 'superior'], true)) $f['role'] = 'employee'; // superior = Immediate Superior
    $dep = q1('SELECT name FROM departments WHERE name = ?', [$f['department']]); // the department must come from the Departments list
    if (!$dep) fail(400, 'Choose a department from the list. Departments are created in the Departments tab.');
    $f['department'] = $dep['name'];
    $sv = (int) val('supervisorId'); // the immediate head / supervisor of this employee (0 = none)
    if ($sv && !q1("SELECT id FROM users WHERE id = ? AND role = 'superior'", [$sv])) fail(400, 'Choose an account with the role Immediate Superior as the supervisor.');
    if ($sv && $sv === (int) val('id')) fail(400, 'An employee cannot be their own supervisor.');
    $canAdd = !empty(val('canAddSuppliers')) && $f['role'] === 'employee' ? 1 : 0; // Supplier Master access (employees only; the admin always has it)
    if (!array_key_exists('canAddSuppliers', input())) { // the employee form does not send this setting, so editing an account must not take the access away
        $had = (int) val('id') ? q1('SELECT can_add_suppliers FROM users WHERE id = ?', [(int) val('id')]) : null;
        $canAdd = ($had && $f['role'] === 'employee') ? (int) $had['can_add_suppliers'] : 0;
    }
    $password = (string) val('password'); // new account: required. Existing account: leave empty to keep the current password.
    $id = (int) val('id');
    if (q1('SELECT id FROM users WHERE (LOWER(email) = ? OR employee_id = ?) AND id <> ?', [strtolower($f['email']), $f['employeeId'], $id])) fail(409, 'Email or employee ID already exists.');
    if (!$id && strlen($password) < 8) fail(400, 'Enter a password of at least 8 characters for the new account.');
    if ($id && $password !== '' && strlen($password) < 8) fail(400, 'The new password must have at least 8 characters.');
    if ($id) {
        if ($id === (int) $admin['id'] && $f['role'] !== 'admin') fail(400, 'You cannot remove your own admin role.');
        run('UPDATE users SET name = ?, employee_id = ?, email = ?, department = ?, job_title = ?, role = ?, supervisor_id = ?, can_add_suppliers = ? WHERE id = ?', [$f['name'], $f['employeeId'], $f['email'], $f['department'], $f['position'], $f['role'], $sv ?: null, $canAdd, $id]);
        if ($password !== '') run('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $id]);
    } else {
        run('INSERT INTO users (employee_id, name, email, password_hash, department, job_title, role, supervisor_id, can_add_suppliers, joined) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())',
            [$f['employeeId'], $f['name'], $f['email'], password_hash($password, PASSWORD_DEFAULT), $f['department'], $f['position'], $f['role'], $sv ?: null, $canAdd]);
        log_activity('A new employee was added: ' . $f['name']);
    }
    out(['ok' => true]);

case 'toggle_employee':
    $id = (int) val('id');
    if ($id === (int) $admin['id']) fail(400, 'You cannot deactivate your own account.');
    run("UPDATE users SET status = IF(status = 'Active', 'Inactive', 'Active') WHERE id = ?", [$id]);
    out(['ok' => true]);

case 'delete_employee': // removes the account for good. Progress, quiz attempts, notifications, support requests and evaluations go with it (ON DELETE CASCADE)
    $id = (int) val('id');
    if ($id === (int) $admin['id']) fail(400, 'You cannot remove your own account.');
    $user = q1('SELECT name FROM users WHERE id = ?', [$id]);
    if (!$user) fail(404, 'Employee not found.');
    $suppliers = q('SELECT DISTINCT supplier_id FROM supplier_evaluations WHERE evaluator_id = ?', [$id]); // their evaluations are deleted, so these suppliers need a new score
    db()->beginTransaction();
    run('DELETE FROM users WHERE id = ?', [$id]);
    foreach ($suppliers as $r) recalc_supplier($r['supplier_id']);
    log_activity('The account of ' . $user['name'] . ' was removed.');
    db()->commit();
    out(['ok' => true]);

case 'add_course':
    $title = trim((string) val('title')); $desc = trim((string) val('description'));
    if ($title === '' || $desc === '') fail(400, 'Course name and description are required.');
    run("INSERT INTO courses (title, description, category, duration, deadline, status) VALUES (?, ?, ?, ?, ?, 'Draft')", [$title, $desc, trim((string) val('category')), trim((string) val('duration')), valid_date(val('deadline'))]);
    $id = last_id();
    log_activity('A new course was created: ' . $title);
    out(['id' => $id]);

case 'update_course': // edit the name, description, category, duration and deadline of a course
    if (!q1('SELECT id FROM courses WHERE id = ?', [(int) val('id')])) fail(404, 'Course not found.');
    $title = trim((string) val('title')); $desc = trim((string) val('description'));
    if ($title === '' || $desc === '') fail(400, 'Course name and description are required.');
    run('UPDATE courses SET title = ?, description = ?, category = ?, duration = ?, deadline = ? WHERE id = ?', [$title, $desc, trim((string) val('category')), trim((string) val('duration')), valid_date(val('deadline')), (int) val('id')]);
    log_activity('The course was edited: ' . $title);
    out(['ok' => true]);

case 'set_course_status':
    if (!in_array(val('status'), ['Draft', 'Published', 'Archived'], true)) fail(400, 'Unknown status.');
    run('UPDATE courses SET status = ? WHERE id = ?', [val('status'), (int) val('id')]);
    out(['ok' => true]);

case 'delete_course': // removes the whole course. Its cards, quiz questions, assignments, progress and quiz attempts go with it (ON DELETE CASCADE)
    $c = q1('SELECT * FROM courses WHERE id = ?', [(int) val('id')]);
    if (!$c) fail(404, 'Course not found.');
    run('DELETE FROM courses WHERE id = ?', [$c['id']]);
    log_activity('The course "' . $c['title'] . '" was deleted.');
    out(['ok' => true]);

case 'add_card':
    $course = q1('SELECT id FROM courses WHERE id = ?', [(int) val('courseId')]);
    if (!$course) fail(404, 'Course not found.');
    $title = trim((string) val('title'));
    $types = ['Manual', 'SOP', 'Policy', 'Instruction', 'Guideline', 'Procedure', 'Standard', 'Rule', 'Notice', 'Other'];
    $type = val('type'); $passing = (int) val('passing'); $content = val('content'); $questions = val('questions');
    if ($title === '' || !in_array($type, $types, true)) fail(400, 'Enter a card title and choose a document type.');
    if ($passing < 1 || $passing > 100) fail(400, 'The passing score must be between 1 and 100.');
    if (!is_array($content) || !$content) fail(400, 'The learning material is empty.');
    if (!is_array($questions) || !$questions) fail(400, 'Add at least one quiz question.');
    check_blocks($content);
    foreach ($questions as $x) {
        if (!is_array($x) || trim((string) $x['text']) === '' || trim((string) $x['explanation']) === '' || !is_array($x['options']) || count($x['options']) < 2) fail(400, 'Every question needs text, answers and an explanation.');
        foreach ($x['options'] as $o) if (trim((string) $o) === '') fail(400, 'Every answer option must be filled in.');
        if ((int) $x['answer'] < 0 || (int) $x['answer'] >= count($x['options'])) fail(400, 'Choose the correct answer for every question.');
    }
    db()->beginTransaction();
    $pos = (int) q1('SELECT COALESCE(MAX(sort_order), 0) AS m FROM training_cards WHERE course_id = ?', [$course['id']])['m'] + 1;
    run('INSERT INTO training_cards (course_id, title, document_type, content, sort_order, passing_score) VALUES (?, ?, ?, ?, ?, ?)', [$course['id'], $title, $type, json_encode($content, JSON_UNESCAPED_UNICODE), $pos, $passing]);
    $cid = (int) db()->lastInsertId();
    foreach ($questions as $i => $x) {
        $n = count($x['options']);
        run('INSERT INTO quiz_questions (card_id, question, type, options_json, correct_answer, explanation, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$cid, trim($x['text']), $n === 2 ? 'true_false' : 'multiple_choice', json_encode(array_values(array_map('trim', $x['options'])), JSON_UNESCAPED_UNICODE), (int) $x['answer'], trim($x['explanation']), $i + 1]);
    }
    db()->commit();
    out(['id' => s($cid)]);

case 'update_card': // edit a card: title, type, pass mark, learning material and quiz questions (questions are updated in place, so existing attempts are kept)
    $c = q1('SELECT * FROM training_cards WHERE id = ?', [(int) val('id')]);
    if (!$c) fail(404, 'Card not found.');
    $isEval = $c['card_kind'] === 'evaluation'; // the supplier evaluation form has no quiz questions
    $title = trim((string) val('title')); $type = val('type'); $passing = (int) val('passing'); $content = val('content'); $questions = val('questions');
    $types = ['Manual', 'SOP', 'Policy', 'Instruction', 'Guideline', 'Procedure', 'Standard', 'Rule', 'Notice', 'Other'];
    if ($title === '' || !in_array($type, $types, true)) fail(400, 'Enter a card title and choose a document type.');
    if ($passing < 1 || $passing > 100) fail(400, 'The passing score must be between 1 and 100.');
    if (!is_array($content) || !$content) fail(400, 'The learning material is empty.');
    check_blocks($content);
    if (!$isEval) { if (!is_array($questions) || !$questions) fail(400, 'Add at least one quiz question.'); check_questions($questions); }
    db()->beginTransaction();
    run('UPDATE training_cards SET title = ?, document_type = ?, content = ?, passing_score = ? WHERE id = ?', [$title, $type, json_encode($content, JSON_UNESCAPED_UNICODE), $passing, $c['id']]);
    if (!$isEval) {
        $keep = [];
        foreach ($questions as $i => $x) {
            $n = count($x['options']); $qt = $n === 2 ? 'true_false' : 'multiple_choice';
            $opts = json_encode(array_values(array_map('trim', $x['options'])), JSON_UNESCAPED_UNICODE);
            $qid = isset($x['id']) ? (int) $x['id'] : 0;
            if ($qid && q1('SELECT id FROM quiz_questions WHERE id = ? AND card_id = ?', [$qid, $c['id']])) {
                run('UPDATE quiz_questions SET question = ?, type = ?, options_json = ?, correct_answer = ?, explanation = ?, sort_order = ? WHERE id = ?', [trim($x['text']), $qt, $opts, (int) $x['answer'], trim($x['explanation']), $i + 1, $qid]);
                $keep[] = $qid;
            } else {
                run('INSERT INTO quiz_questions (card_id, question, type, options_json, correct_answer, explanation, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)', [$c['id'], trim($x['text']), $qt, $opts, (int) $x['answer'], trim($x['explanation']), $i + 1]);
                $keep[] = (int) db()->lastInsertId();
            }
        }
        run('DELETE FROM quiz_questions WHERE card_id = ? AND id NOT IN (' . implode(',', array_map('intval', $keep)) . ')', [$c['id']]);
    }
    db()->commit();
    log_activity('The card was edited: ' . $title);
    out(['ok' => true]);

case 'delete_card':
    run('DELETE FROM training_cards WHERE id = ?', [(int) val('id')]);
    out(['ok' => true]);

case 'move_card':
    $c = q1('SELECT * FROM training_cards WHERE id = ?', [(int) val('id')]);
    if (!$c) fail(404, 'Card not found.');
    $ids = array_map('intval', array_column(q('SELECT id FROM training_cards WHERE course_id = ? ORDER BY sort_order, id', [$c['course_id']]), 'id'));
    $i = array_search((int) $c['id'], $ids, true);
    $j = $i + ((int) val('dir') < 0 ? -1 : 1);
    if ($j >= 0 && $j < count($ids)) {
        $t = $ids[$i]; $ids[$i] = $ids[$j]; $ids[$j] = $t;
        db()->beginTransaction();
        foreach ($ids as $k => $cardId) run('UPDATE training_cards SET sort_order = ? WHERE id = ?', [$k + 1, $cardId]);
        db()->commit();
    }
    out(['ok' => true]);

case 'assign':
    $course = q1('SELECT * FROM courses WHERE id = ?', [(int) val('courseId')]);
    if (!$course || $course['status'] !== 'Published') fail(400, 'Choose a published course.');
    $sql = "SELECT id FROM users WHERE role IN ('employee', 'superior') AND status = 'Active'"; $p = [];
    $target = val('target');
    if ($target === 'department') { $sql .= ' AND department = ?'; $p[] = (string) val('value'); }
    elseif ($target === 'employee') { $sql .= ' AND id = ?'; $p[] = (int) val('value'); }
    elseif ($target !== 'all') fail(400, 'Choose who to assign the course to.');
    $deadline = valid_date(val('deadline')) ?: $course['deadline'];
    $count = 0;
    foreach (q(str_replace('SELECT id FROM users', 'SELECT id, department FROM users', $sql), $p) as $e) {
        $st = run('INSERT IGNORE INTO course_assignments (course_id, employee_id, deadline) VALUES (?, ?, ?)', [$course['id'], $e['id'], $deadline]);
        if ($st->rowCount() > 0) { $count++; add_note($e['id'], 'New course assigned', 'You have been assigned ' . dept_course_title($course, $e['department']) . '.'); }
    }
    out(['count' => $count]);

case 'set_permissions': // what an employee or immediate superior may answer: one checkbox per published course / evaluation form (a permission = an assignment)
    $emp = q1("SELECT * FROM users WHERE id = ? AND role IN ('employee', 'superior')", [(int) val('employeeId')]);
    if (!$emp) fail(404, 'Employee not found.');
    $want = val('courseIds'); $want = is_array($want) ? array_map('intval', $want) : [];
    $added = 0; $removed = 0;
    db()->beginTransaction();
    foreach (q("SELECT * FROM courses WHERE status = 'Published'") as $c) {
        $has = q1('SELECT id FROM course_assignments WHERE course_id = ? AND employee_id = ?', [$c['id'], $emp['id']]);
        if (in_array((int) $c['id'], $want, true)) {
            if (!$has) { run('INSERT INTO course_assignments (course_id, employee_id, deadline) VALUES (?, ?, ?)', [$c['id'], $emp['id'], $c['deadline']]); $added++; add_note($emp['id'], 'New access', 'You can now answer ' . dept_course_title($c, $emp['department']) . '.'); }
        } elseif ($has) { run('DELETE FROM course_assignments WHERE id = ?', [$has['id']]); $removed++; }
    }
    db()->commit();
    log_activity('Permissions of ' . $emp['name'] . ' were set: ' . $added . ' added, ' . $removed . ' removed.');
    out(['added' => $added, 'removed' => $removed]);

case 'remove_assignment':
    run('DELETE FROM course_assignments WHERE id = ?', [(int) val('id')]);
    out(['ok' => true]);

case 'save_supplier':
    $f = [];
    foreach (['name', 'category', 'contactPerson', 'contactNo', 'email', 'department'] as $k) $f[$k] = trim((string) val($k));
    if ($f['name'] === '') fail(400, 'Enter the supplier name.');
    if ($f['email'] !== '' && !filter_var($f['email'], FILTER_VALIDATE_EMAIL)) fail(400, 'Enter a valid email address.');
    if ($admin['role'] !== 'admin') { // an employee adds, edits and removes suppliers of their own department only
        $mine = trim((string) $admin['department']);
        if ($mine === '') fail(403, 'Your account has no department yet. Ask your administrator to set it before you add suppliers.');
        $f['department'] = $mine;
        if ((int) val('id')) { $own = q1('SELECT department FROM suppliers WHERE id = ?', [(int) val('id')]); if (!$own || strtolower($own['department']) !== strtolower($mine)) fail(403, 'You can only edit suppliers of your own department.'); }
    }
    if ($f['department'] !== '') { // empty means all departments; otherwise it must come from the Departments list
        $dep = q1('SELECT name FROM departments WHERE name = ?', [$f['department']]);
        if (!$dep) fail(400, 'Choose a department from the list.');
        $f['department'] = $dep['name'];
    }
    $id = (int) val('id');
    if (q1('SELECT id FROM suppliers WHERE LOWER(name) = ? AND id <> ?', [strtolower($f['name']), $id])) fail(409, 'A supplier with this name already exists.');
    if ($id) run('UPDATE suppliers SET name = ?, category = ?, contact_person = ?, contact_no = ?, email = ?, department = ? WHERE id = ?', [$f['name'], $f['category'], $f['contactPerson'], $f['contactNo'], $f['email'], $f['department'], $id]);
    else {
        $n = (int) q1('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM suppliers')['n'];
        run('INSERT INTO suppliers (supplier_code, name, category, contact_person, contact_no, email, department) VALUES (?, ?, ?, ?, ?, ?, ?)', ['SUP-' . str_pad($n, 4, '0', STR_PAD_LEFT), $f['name'], $f['category'], $f['contactPerson'], $f['contactNo'], $f['email'], $f['department']]);
        log_activity('A new supplier was added: ' . $f['name']);
    }
    out(['ok' => true]);

case 'import_suppliers': // Excel import: a row adds a supplier, or updates the supplier with the same Supplier ID or name (empty cells keep what is there)
    $rows = val('rows');
    if (!is_array($rows) || !$rows) fail(400, 'There are no rows to import.');
    if (count($rows) > 1000) fail(400, 'Import at most 1000 rows at a time.');
    $isAdmin = $admin['role'] === 'admin'; $mine = trim((string) $admin['department']);
    if (!$isAdmin && $mine === '') fail(403, 'Your account has no department yet. Ask your administrator to set it before you import suppliers.');
    $added = 0; $updated = 0; $skipped = 0; $errors = [];
    db()->beginTransaction();
    foreach ($rows as $i => $r) {
        if (!is_array($r)) continue;
        $line = isset($r['row']) ? (int) $r['row'] : $i + 2; $f = [];
        foreach (['code', 'name', 'category', 'contactPerson', 'contactNo', 'email', 'department'] as $k) $f[$k] = trim((string) (isset($r[$k]) ? $r[$k] : ''));
        $why = '';
        $old = null;
        if ($f['code'] !== '') $old = q1('SELECT * FROM suppliers WHERE LOWER(supplier_code) = ?', [strtolower($f['code'])]);
        if (!$old && $f['name'] !== '') $old = q1('SELECT * FROM suppliers WHERE LOWER(name) = ?', [strtolower($f['name'])]);
        if ($f['name'] === '' && $old) $f['name'] = $old['name'];
        if ($f['name'] === '') $why = 'the supplier name is empty.';
        elseif ($f['email'] !== '' && !filter_var($f['email'], FILTER_VALIDATE_EMAIL)) $why = '"' . $f['email'] . '" is not a valid email address.';
        elseif (!$isAdmin && $old && strtolower($old['department']) !== strtolower($mine)) $why = '"' . $f['name'] . '" belongs to another department.';
        if ($why === '') {
            if (!$isAdmin) $f['department'] = $mine;
            if ($f['department'] !== '') {
                $dep = q1('SELECT name FROM departments WHERE LOWER(name) = ?', [strtolower($f['department'])]);
                if (!$dep) $why = 'the department "' . $f['department'] . '" is not in the Departments list.'; else $f['department'] = $dep['name'];
            }
        }
        if ($why === '' && q1('SELECT id FROM suppliers WHERE LOWER(name) = ? AND id <> ?', [strtolower($f['name']), $old ? (int) $old['id'] : 0])) $why = 'another supplier already has the name "' . $f['name'] . '".';
        if ($why !== '') { $skipped++; $errors[] = 'Row ' . $line . ': ' . $why; continue; }
        if ($old) {
            run('UPDATE suppliers SET name = ?, category = ?, contact_person = ?, contact_no = ?, email = ?, department = ? WHERE id = ?', [$f['name'], $f['category'] !== '' ? $f['category'] : $old['category'], $f['contactPerson'] !== '' ? $f['contactPerson'] : $old['contact_person'],
                $f['contactNo'] !== '' ? $f['contactNo'] : $old['contact_no'], $f['email'] !== '' ? $f['email'] : $old['email'], $f['department'] !== '' ? $f['department'] : $old['department'], (int) $old['id']]);
            $updated++;
        } else {
            $n = (int) q1('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM suppliers')['n'];
            run('INSERT INTO suppliers (supplier_code, name, category, contact_person, contact_no, email, department) VALUES (?, ?, ?, ?, ?, ?, ?)', ['SUP-' . str_pad($n, 4, '0', STR_PAD_LEFT), $f['name'], $f['category'], $f['contactPerson'], $f['contactNo'], $f['email'], $f['department']]);
            $added++;
        }
    }
    db()->commit();
    log_activity($admin['name'] . ' imported suppliers from Excel: ' . $added . ' added, ' . $updated . ' updated, ' . $skipped . ' skipped.');
    out(['added' => $added, 'updated' => $updated, 'skipped' => $skipped, 'errors' => array_slice($errors, 0, 30)]);

case 'delete_supplier': // removes the supplier. Its evaluations, their ratings and its re-evaluation requests go with it (ON DELETE CASCADE)
    $s = q1('SELECT * FROM suppliers WHERE id = ?', [(int) val('id')]);
    if (!$s) fail(404, 'Supplier not found.');
    if ($admin['role'] !== 'admin' && ($s['department'] === '' || strtolower($s['department']) !== strtolower((string) $admin['department']))) fail(403, 'You can only remove suppliers of your own department.');
    run('DELETE FROM suppliers WHERE id = ?', [$s['id']]);
    log_activity('The supplier "' . $s['name'] . '" was removed.');
    out(['ok' => true]);

case 'save_criteria': // the whole Criteria Master is saved at once: rename, add, remove. The weights must add up to 100
    $list = val('criteria'); if (!is_array($list) || !$list) fail(400, 'Add at least one criterion.');
    $rows = []; $total = 0; $seen = [];
    foreach ($list as $c) {
        if (!is_array($c)) fail(400, 'Invalid criteria received.');
        $name = trim((string) (isset($c['name']) ? $c['name'] : '')); $purpose = trim((string) (isset($c['purpose']) ? $c['purpose'] : '')); $v = isset($c['weight']) ? $c['weight'] : '';
        if ($name === '') fail(400, 'Every criterion needs a name.');
        if (mb_strlen($name) > 80) fail(400, 'A criterion name can have at most 80 characters.');
        if (mb_strlen($purpose) > 255) fail(400, 'A description can have at most 255 characters.');
        if (isset($seen[mb_strtolower($name)])) fail(400, 'Two criteria have the same name: ' . $name . '.');
        $seen[mb_strtolower($name)] = true;
        if (!is_numeric($v) || (float) $v != (int) $v || (int) $v < 1 || (int) $v > 100) fail(400, 'Each weight must be a whole number from 1 to 100 (' . $name . ').');
        $total += (int) $v;
        $rows[] = ['id' => (int) (isset($c['id']) ? $c['id'] : 0), 'name' => $name, 'purpose' => $purpose, 'weight' => (int) $v];
    }
    if ($total !== 100) fail(400, 'The weights must add up to 100. They add up to ' . $total . ' now.');
    $old = array_map('intval', array_column(q('SELECT id FROM criteria_master'), 'id'));
    $keep = [];
    db()->beginTransaction();
    foreach ($rows as $i => $r) {
        if ($r['id'] && in_array($r['id'], $old, true)) {
            run('UPDATE criteria_master SET name = ?, purpose = ?, weight = ?, sort_order = ? WHERE id = ?', [$r['name'], $r['purpose'], $r['weight'], $i + 1, $r['id']]);
            $keep[] = $r['id'];
        } else {
            run('INSERT INTO criteria_master (name, purpose, weight, sort_order) VALUES (?, ?, ?, ?)', [$r['name'], $r['purpose'], $r['weight'], $i + 1]);
            $keep[] = (int) db()->lastInsertId();
        }
    }
    foreach ($old as $oid) if (!in_array($oid, $keep, true)) run('DELETE FROM criteria_master WHERE id = ?', [$oid]); // old evaluations keep their saved ratings
    db()->commit();
    out(['ok' => true]);

case 'set_request_status':
    if (!in_array(val('status'), ['Open', 'Resolved'], true)) fail(400, 'Unknown status.');
    run('UPDATE support_requests SET status = ? WHERE id = ?', [val('status'), (int) val('id')]);
    out(['ok' => true]);

case 'delete_request':
    run('DELETE FROM support_requests WHERE id = ?', [(int) val('id')]);
    out(['ok' => true]);

case 'decide_reeval':
    decide_reeval(val('id'), val('decision'), $admin);
    out(['ok' => true]);

case 'save_corrective': // the admin records the corrective action of an evaluation where the employee answered "corrective action required: Yes"
    $e = q1('SELECT * FROM supplier_evaluations WHERE id = ?', [(int) val('id')]);
    if (!$e) fail(404, 'Evaluation not found.');
    if ($e['corrective_required'] !== 'Yes') fail(400, 'This evaluation does not need corrective action.');
    $resp = trim((string) val('supplierResponse')); $person = trim((string) val('responsiblePerson'));
    $target = valid_date(val('targetDate')); $follow = val('followUp'); $status = val('status');
    if (!$target || $person === '' || !in_array($follow, ['Yes', 'No'], true) || !in_array($status, ['Open', 'Resolved'], true)) fail(400, 'Fill in the target completion date, responsible person, follow-up and status.');
    run('UPDATE supplier_evaluations SET supplier_response = ?, target_date = ?, responsible_person = ?, follow_up = ?, corrective_status = ? WHERE id = ?',
        [$resp === '' ? null : $resp, $target, $person, $follow, $status, $e['id']]);
    $sup = q1('SELECT name FROM suppliers WHERE id = ?', [$e['supplier_id']]);
    log_activity('Corrective action for the evaluation of ' . $sup['name'] . ($status === 'Resolved' ? ' was marked solved.' : ' was recorded.'));
    if ($e['supervisor_id']) // tell the supervisor what has to be done
        add_note($e['supervisor_id'], 'Corrective action recorded: ' . $sup['name'],
            mb_substr('Responsible: ' . $person . ' | Target date: ' . $target . ($resp === '' ? '' : ' | Supplier response: ' . $resp), 0, 250));
    out(['ok' => true]);

case 'delete_evaluation': // removes one evaluation and recalculates the supplier's score and dates
    $e = q1('SELECT * FROM supplier_evaluations WHERE id = ?', [(int) val('id')]);
    if (!$e) fail(404, 'Evaluation not found.');
    $sup = q1('SELECT name FROM suppliers WHERE id = ?', [$e['supplier_id']]);
    db()->beginTransaction();
    run('DELETE FROM supplier_evaluations WHERE id = ?', [$e['id']]);
    recalc_supplier($e['supplier_id']);
    log_activity('An evaluation of ' . $sup['name'] . ' was deleted by the admin.');
    db()->commit();
    out(['ok' => true]);

case 'delete_user_evaluations': // removes every evaluation submitted by one employee
    $who = (int) val('userId');
    $user = q1('SELECT name FROM users WHERE id = ?', [$who]);
    if (!$user) fail(404, 'Employee not found.');
    $suppliers = q('SELECT DISTINCT supplier_id FROM supplier_evaluations WHERE evaluator_id = ?', [$who]);
    db()->beginTransaction();
    $n = run('DELETE FROM supplier_evaluations WHERE evaluator_id = ?', [$who])->rowCount();
    foreach ($suppliers as $r) recalc_supplier($r['supplier_id']);
    log_activity('All ' . $n . ' evaluation(s) by ' . $user['name'] . ' were deleted by the admin.');
    db()->commit();
    out(['count' => $n]);

case 'save_department': // add a department, or rename one (the new name is also written on its employees and suppliers)
    $name = trim((string) val('name')); $id = (int) val('id');
    if ($name === '') fail(400, 'Enter the department name.');
    if (mb_strlen($name) > 80) fail(400, 'The department name can have at most 80 characters.');
    if (q1('SELECT id FROM departments WHERE name = ? AND id <> ?', [$name, $id])) fail(409, 'This department already exists.');
    if ($id) {
        $old = q1('SELECT * FROM departments WHERE id = ?', [$id]);
        if (!$old) fail(404, 'Department not found.');
        db()->beginTransaction();
        run('UPDATE departments SET name = ? WHERE id = ?', [$name, $id]);
        run('UPDATE users SET department = ? WHERE department = ?', [$name, $old['name']]);
        run('UPDATE suppliers SET department = ? WHERE department = ?', [$name, $old['name']]);
        log_activity('Department "' . $old['name'] . '" was renamed to "' . $name . '".');
        db()->commit();
    } else {
        run('INSERT INTO departments (name) VALUES (?)', [$name]);
        log_activity('A new department was added: ' . $name);
    }
    out(['ok' => true]);

case 'delete_department': // the browser has already asked the admin to confirm. Employees in it end up with no department; suppliers in it become "all departments"
    $d = q1('SELECT * FROM departments WHERE id = ?', [(int) val('id')]);
    if (!$d) fail(404, 'Department not found.');
    db()->beginTransaction();
    run("UPDATE users SET department = '' WHERE department = ?", [$d['name']]);
    run("UPDATE suppliers SET department = '' WHERE department = ?", [$d['name']]);
    run('DELETE FROM departments WHERE id = ?', [$d['id']]);
    log_activity('Department "' . $d['name'] . '" was deleted.');
    db()->commit();
    out(['ok' => true]);

case 'clear_activity': // empties the Recent Activity list on the dashboard
    run('DELETE FROM activity_log');
    out(['ok' => true]);
}
fail(404, 'Unknown action.');
