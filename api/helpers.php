<?php
// Shared functions: database, JSON answers, login checks, and the data sent to the browser.
require_once __DIR__ . '/config.php';

set_exception_handler(function ($e) {
    http_response_code(500);
    echo json_encode(['error' => 'Server error: ' . $e->getMessage()]);
});

function out($data) { echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }
function fail($code, $msg) { http_response_code($code); echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE); exit; }
function input() {
    static $body = null;
    if ($body === null) { $body = json_decode(file_get_contents('php://input'), true); if (!is_array($body)) $body = []; }
    return $body;
}
function s($v) { return (string) $v; }
function iso($d) { return $d ? str_replace(' ', 'T', $d) : null; }

/* ---------- database ---------- */
function db() {
    static $pdo = null;
    if ($pdo === null) {
        try {
            $pdo = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
        } catch (PDOException $e) {
            fail(500, 'Cannot connect to the database. Check that MySQL is running in XAMPP and that the database leads_training exists.');
        }
    }
    return $pdo;
}
function run($sql, $params = []) { $st = db()->prepare($sql); $st->execute($params); return $st; }
function q($sql, $params = []) { return run($sql, $params)->fetchAll(); }
function q1($sql, $params = []) { $r = q($sql, $params); return $r ? $r[0] : null; }
function last_id() { return s(db()->lastInsertId()); }

/* ---------- login checks (done on the server, so they cannot be skipped) ---------- */
function current_user() {
    if (empty($_SESSION['uid'])) return null;
    $u = q1('SELECT * FROM users WHERE id = ?', [(int) $_SESSION['uid']]);
    return ($u && $u['status'] === 'Active') ? $u : null;
}
function require_login() { $u = current_user(); if (!$u) fail(401, 'Please log in.'); return $u; }
function require_role($role) {
    $u = require_login();
    if ($u['role'] !== $role) fail(403, 'You do not have access to this action.');
    return $u;
}

/* ---------- small database helpers ---------- */
// The evaluation schedule is fixed to the calendar quarters: Jan 1-Mar 31, Apr 1-Jun 30, Jul 1-Sep 30, Oct 1-Dec 31.
function quarter_range($date) { // the quarter that contains $date
    $t = strtotime($date); $y = (int) date('Y', $t); $m = ((int) ceil((int) date('n', $t) / 3) - 1) * 3 + 1;
    return ['start' => sprintf('%04d-%02d-01', $y, $m), 'end' => date('Y-m-t', strtotime(sprintf('%04d-%02d-01', $y, $m + 2)))];
}
function next_quarter_start($date) { return date('Y-m-d', strtotime(quarter_range($date)['end'] . ' +1 day')); } // the next evaluation period starts here
function add_note($uid, $title, $message) { run('INSERT INTO notifications (employee_id, title, message) VALUES (?, ?, ?)', [(int) $uid, $title, $message]); }
function log_activity($text) { run('INSERT INTO activity_log (text) VALUES (?)', [$text]); }

// A card is open only when the card before it (in the same course) has been passed.
function is_unlocked($uid, $cardId, $courseId) {
    $ids = array_map('intval', array_column(q('SELECT id FROM training_cards WHERE course_id = ? ORDER BY sort_order, id', [(int) $courseId]), 'id'));
    $i = array_search((int) $cardId, $ids, true);
    if ($i === false) return false;
    if ($i === 0) return true;
    $prev = q1('SELECT passed FROM card_progress WHERE employee_id = ? AND card_id = ?', [(int) $uid, $ids[$i - 1]]);
    return $prev && (int) $prev['passed'] === 1;
}
function open_card($uid, $cardId) {
    $c = q1('SELECT c.*, co.status AS course_status FROM training_cards c JOIN courses co ON co.id = c.course_id WHERE c.id = ?', [(int) $cardId]);
    if (!$c) fail(404, 'This training card does not exist.');
    $a = q1('SELECT id FROM course_assignments WHERE course_id = ? AND employee_id = ?', [$c['course_id'], (int) $uid]);
    if (!$a && q1("SELECT id FROM users WHERE id = ? AND role = 'admin'", [(int) $uid])) $a = true; // the admin can open every published course
    if (!$a || $c['course_status'] !== 'Published') fail(403, 'This course is not assigned to you.');
    if (!is_unlocked($uid, $c['id'], $c['course_id'])) fail(403, 'That card is locked. Pass the previous card first.');
    return $c;
}
function progress_row($uid, $cardId) {
    run('INSERT IGNORE INTO card_progress (card_id, employee_id) VALUES (?, ?)', [(int) $cardId, (int) $uid]);
    return q1('SELECT * FROM card_progress WHERE card_id = ? AND employee_id = ?', [(int) $cardId, (int) $uid]);
}

/* ---------- data sent to the browser (same shape the screens already use) ---------- */
// Supplier Master: every signed-in account (employee, immediate superior or admin) can add suppliers. An employee adds, edits and removes suppliers of their own department only.
// The rest of the Supplier Evaluation tab is admin only, and immediate superiors see only their corrective action requests. (The column can_add_suppliers is no longer used.)
function can_add_suppliers($u) { return true; }
function user_out($u) {
    return ['id' => s($u['id']), 'name' => $u['name'], 'email' => $u['email'], 'employeeId' => $u['employee_id'], 'department' => $u['department'],
        'position' => $u['job_title'], 'role' => $u['role'], 'status' => $u['status'], 'phone' => $u['phone'], 'joined' => $u['joined'], 'supervisorId' => $u['supervisor_id'] ? s($u['supervisor_id']) : '', 'canAddSuppliers' => !empty($u['can_add_suppliers']),
        'prefs' => ['email' => (bool) $u['pref_email'], 'deadline' => (bool) $u['pref_deadline']]];
}
// $full = true is for admins only: it includes the learning material and the correct answers.
function courses_out($rows, $full) {
    if (!$rows) return [];
    $in = implode(',', array_map('intval', array_column($rows, 'id')));
    $cards = q("SELECT * FROM training_cards WHERE course_id IN ($in) ORDER BY sort_order, id");
    $qs = [];
    foreach (q("SELECT * FROM quiz_questions WHERE card_id IN (SELECT id FROM training_cards WHERE course_id IN ($in)) ORDER BY sort_order, id") as $x) $qs[$x['card_id']][] = $x;
    $byCourse = [];
    foreach ($cards as $c) {
        $cq = isset($qs[$c['id']]) ? $qs[$c['id']] : [];
        $card = ['id' => s($c['id']), 'courseId' => s($c['course_id']), 'title' => $c['title'], 'type' => $c['document_type'], 'passing' => (int) $c['passing_score'], 'qcount' => count($cq), 'kind' => $c['card_kind']];
        if ($full) {
            $card['content'] = json_decode($c['content'], true);
            $card['questions'] = array_map(function ($x) {
                return ['id' => s($x['id']), 'text' => $x['question'], 'type' => $x['type'], 'options' => json_decode($x['options_json'], true), 'answer' => (int) $x['correct_answer'], 'explanation' => $x['explanation']];
            }, $cq);
        }
        $byCourse[$c['course_id']][] = $card;
    }
    return array_map(function ($r) use ($byCourse) {
        return ['id' => s($r['id']), 'title' => $r['title'], 'description' => $r['description'], 'category' => $r['category'], 'duration' => $r['duration'],
            'deadline' => $r['deadline'], 'status' => $r['status'], 'cards' => isset($byCourse[$r['id']]) ? $byCourse[$r['id']] : []];
    }, $rows);
}
function assignments_out($rows) {
    return array_map(function ($a) { return ['id' => s($a['id']), 'courseId' => s($a['course_id']), 'employeeId' => s($a['employee_id']), 'deadline' => $a['deadline'], 'assignedAt' => iso($a['assigned_at'])]; }, $rows);
}
function progress_out($rows) {
    $o = [];
    foreach ($rows as $p) {
        $o[$p['employee_id'] . ':' . $p['card_id']] = ['reading' => (int) $p['reading_progress'], 'pct' => (int) $p['overall_progress'], 'quizStarted' => (bool) $p['quiz_started'],
            'passed' => (bool) $p['passed'], 'failed' => (bool) $p['failed'], 'best' => $p['best_score'] === null ? null : (int) $p['best_score'],
            'attempt' => (int) $p['current_attempt'], 'completedAt' => iso($p['completed_at'])];
    }
    return $o ? $o : new stdClass();
}
function attempts_out($uid) {
    $sql = 'SELECT a.*, c.course_id FROM quiz_attempts a JOIN training_cards c ON c.id = a.card_id WHERE a.completed_at IS NOT NULL';
    $rows = $uid ? q($sql . ' AND a.employee_id = ? ORDER BY a.id', [(int) $uid]) : q($sql . ' ORDER BY a.id');
    return array_map(function ($a) {
        return ['id' => s($a['id']), 'cardId' => s($a['card_id']), 'courseId' => s($a['course_id']), 'employeeId' => s($a['employee_id']), 'attemptNumber' => (int) $a['attempt_number'],
            'score' => (int) $a['score'], 'totalQuestions' => (int) $a['total_questions'], 'percentage' => (int) $a['percentage'], 'passed' => (bool) $a['passed'], 'completedAt' => iso($a['completed_at'])];
    }, $rows);
}
function snapshot_employee($u) {
    $uid = (int) $u['id'];
    $courses = q("SELECT co.* FROM courses co JOIN course_assignments a ON a.course_id = co.id WHERE a.employee_id = ? AND co.status = 'Published' ORDER BY co.id", [$uid]);
    $notes = q('SELECT * FROM notifications WHERE employee_id = ? ORDER BY id DESC LIMIT 30', [$uid]);
    // evaluations where this employee was chosen as the immediate head / supervisor of a corrective action
    $corr = q("SELECT e.*, s.name AS supplier_name, u.name AS evaluator_name FROM supplier_evaluations e JOIN suppliers s ON s.id = e.supplier_id JOIN users u ON u.id = e.evaluator_id WHERE e.supervisor_id = ? AND e.corrective_required = 'Yes' ORDER BY e.id DESC", [$uid]);
    $extra = [];
    if (can_add_suppliers($u)) { // Supplier Master only: this person receives the suppliers and the department list (for the supplier form), and nothing else from the evaluations
        $extra = ['suppliers' => array_map('supplier_out', q("SELECT * FROM suppliers WHERE department = '' OR LOWER(department) = LOWER(?) ORDER BY id", [$u['department']])), 'departments' => departments_out()]; // only their own department's suppliers, plus the ones marked for all departments (view only)
    }
    return $extra + ['role' => 'employee', 'me' => user_out($u), 'courses' => courses_out($courses, false),
        'reevalInbox' => reeval_out(q('SELECT r.*, e.name AS employee_name, s.name AS supplier_name, v.name AS supervisor_name FROM reeval_requests r JOIN users e ON e.id = r.employee_id JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN users v ON v.id = r.supervisor_id WHERE r.supervisor_id = ? ORDER BY r.id DESC LIMIT 50', [$uid])),
        'corrective' => array_map(function ($e) { return ['id' => s($e['id']), 'supplier' => $e['supplier_name'], 'evaluator' => $e['evaluator_name'], 'evaluationDate' => $e['evaluation_date'], 'issueIdentified' => $e['issue_identified'],
            'supplierResponse' => $e['supplier_response'], 'targetDate' => $e['target_date'], 'responsiblePerson' => $e['responsible_person'], 'followUp' => $e['follow_up'], 'status' => $e['corrective_status'], 'submittedAt' => iso($e['created_at'])]; }, $corr),
        'assignments' => assignments_out(q('SELECT * FROM course_assignments WHERE employee_id = ?', [$uid])),
        'progress' => progress_out(q('SELECT * FROM card_progress WHERE employee_id = ?', [$uid])), 'attempts' => attempts_out($uid),
        'notifications' => array_map(function ($n) { return ['id' => s($n['id']), 'employeeId' => s($n['employee_id']), 'title' => $n['title'], 'message' => $n['message'], 'read' => (bool) $n['is_read'], 'createdAt' => iso($n['created_at'])]; }, $notes)];
}
function snapshot_admin($u) {
    return ['role' => 'admin', 'me' => user_out($u), 'users' => array_map('user_out', q('SELECT * FROM users ORDER BY id')),
        'courses' => courses_out(q('SELECT * FROM courses ORDER BY id'), true), 'assignments' => assignments_out(q('SELECT * FROM course_assignments ORDER BY id')),
        'progress' => progress_out(q('SELECT * FROM card_progress')), 'attempts' => attempts_out(null),
        'suppliers' => array_map('supplier_out', q('SELECT * FROM suppliers ORDER BY id')), 'criteria' => criteria_out(), 'evaluations' => evaluations_out(),
        'thresholds' => thresholds(), 'departments' => departments_out(),
        'reevals' => reeval_out(q('SELECT r.*, e.name AS employee_name, s.name AS supplier_name, v.name AS supervisor_name FROM reeval_requests r JOIN users e ON e.id = r.employee_id JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN users v ON v.id = r.supervisor_id ORDER BY r.id DESC LIMIT 100')),
        'notifications' => array_map(function ($n) { return ['id' => s($n['id']), 'employeeId' => s($n['employee_id']), 'title' => $n['title'], 'message' => $n['message'], 'read' => (bool) $n['is_read'], 'createdAt' => iso($n['created_at'])]; }, q('SELECT * FROM notifications WHERE employee_id = ? ORDER BY id DESC LIMIT 30', [(int) $u['id']])),
        'requests' => array_map(function ($r) { return ['id' => s($r['id']), 'employeeId' => s($r['employee_id']), 'name' => $r['name'], 'email' => $r['email'], 'subject' => $r['subject'], 'message' => $r['message'], 'status' => $r['status'], 'createdAt' => iso($r['created_at'])]; }, q('SELECT * FROM support_requests ORDER BY id DESC')),
        'activity' => array_map(function ($a) { return ['id' => s($a['id']), 'text' => $a['text'], 'at' => iso($a['created_at'])]; }, q('SELECT * FROM activity_log ORDER BY id DESC LIMIT 30'))];
}

/* ---------- shared: pass recording, dates ---------- */
function valid_date($d) { return is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) ? $d : null; }
// The Supplier Management course (the one with the evaluation form) is written for the department of the employee who answers it:
// the title gets the department ("Admin & Legal Supplier Management") and every "IT" in its text becomes that department. No department = the neutral wording.
function dept_is_eval_course($courseId) { return (bool) q1("SELECT id FROM training_cards WHERE course_id = ? AND card_kind = 'evaluation' LIMIT 1", [(int) $courseId]); }
function dept_text($s, $dept) {
    $dept = trim((string) $dept);
    if ($dept === '') return preg_replace('/\bIT\s+/', '', $s);
    return preg_replace_callback('/\bIT\b/', function () use ($dept) { return $dept; }, $s);
}
function dept_course_title($course, $dept) {
    if (!dept_is_eval_course($course['id'])) return $course['title'];
    $dept = trim((string) $dept); $t = preg_replace('/^IT\s+/i', '', $course['title']);
    return $dept === '' ? $t : $dept . ' ' . $t;
}
function dept_card_title($course, $card, $dept) { return dept_is_eval_course($course['id']) ? dept_text($card['title'], $dept) : $card['title']; }
// Notifications and activity when an employee completes a card (quiz passed or evaluation submitted).
function record_pass($u, $card, $text = null) {
    $uid = (int) $u['id'];
    $course = q1('SELECT * FROM courses WHERE id = ?', [$card['course_id']]);
    $ctitle = dept_course_title($course, $u['department']); $ktitle = dept_card_title($course, $card, $u['department']);
    add_note($uid, 'Card completed', 'You completed ' . $ktitle . '.');
    log_activity($text ? $text : $u['name'] . ' passed ' . $ktitle . ' (' . $ctitle . ').');
    $all = (int) q1('SELECT COUNT(*) AS n FROM training_cards WHERE course_id = ?', [$course['id']])['n'];
    $done = (int) q1('SELECT COUNT(*) AS n FROM card_progress cp JOIN training_cards c ON c.id = cp.card_id WHERE c.course_id = ? AND cp.employee_id = ? AND cp.passed = 1', [$course['id'], $uid])['n'];
    if ($done === $all) { add_note($uid, 'Course completed', 'You completed ' . $ctitle . '.'); log_activity($u['name'] . ' completed ' . $ctitle . '.'); }
    elseif ($done * 2 === $all) add_note($uid, 'Halfway there', 'Your course is now 50% complete.');
}

/* ---------- re-evaluation requests ---------- */
function reeval_out($rows) {
    return array_map(function ($r) {
        return ['id' => s($r['id']), 'employee' => $r['employee_name'], 'supplier' => $r['supplier_name'], 'supervisor' => $r['supervisor_name'], 'reason' => $r['reason'], 'status' => $r['status'], 'quarterStart' => $r['quarter_start'], 'createdAt' => iso($r['created_at'])];
    }, $rows);
}
// A supervisor (or the admin) approves or declines a request. Approved = the employee may submit one more evaluation of that supplier in that quarter.
function decide_reeval($id, $decision, $by) {
    if (!in_array($decision, ['Approved', 'Declined'], true)) fail(400, 'Unknown decision.');
    $r = q1('SELECT * FROM reeval_requests WHERE id = ?', [(int) $id]);
    if (!$r) fail(404, 'Request not found.');
    if ($by['role'] !== 'admin' && (int) $r['supervisor_id'] !== (int) $by['id']) fail(403, 'This request is not assigned to you.');
    if ($r['status'] !== 'Pending') fail(400, 'This request was already answered.');
    run('UPDATE reeval_requests SET status = ?, decided_at = NOW(), decided_by = ? WHERE id = ?', [$decision, (int) $by['id'], $r['id']]);
    $sup = q1('SELECT name FROM suppliers WHERE id = ?', [$r['supplier_id']]);
    add_note($r['employee_id'], 'Re-evaluation ' . strtolower($decision) . ': ' . $sup['name'],
        $decision === 'Approved' ? 'You can now submit a new evaluation of ' . $sup['name'] . ' in this quarter. It will replace your earlier one.' : 'Your request to evaluate ' . $sup['name'] . ' again was declined.');
    log_activity($by['name'] . ' ' . strtolower($decision) . ' a re-evaluation request for ' . $sup['name'] . '.');
}

/* ---------- supplier evaluation: Criteria Master, score ---------- */
function thresholds() {
    return [
        ['min' => 90, 'rating' => 'Excellent', 'decision' => 'Preferred Supplier', 'status' => 'Preferred', 'range' => '≥ 90.0%', 'definition' => 'Excellent Performance', 'guideline' => 'Strategic partner; priority contract renewal and volume allocations', 'action' => 'Prioritize & Expand Contract'],
        ['min' => 80, 'rating' => 'Good', 'decision' => 'Approved', 'status' => 'Approved', 'range' => '80.0% – 89.9%', 'definition' => 'Good / Meets Standards', 'guideline' => 'Active supplier; maintain standard procurement contracts & SLA reviews', 'action' => 'Maintain Active Engagement'],
        ['min' => 70, 'rating' => 'Acceptable', 'decision' => 'Conditional', 'status' => 'Conditional', 'range' => '70.0% – 79.9%', 'definition' => 'Acceptable / Needs Focus', 'guideline' => 'Formal Performance Improvement Plan (PIP) required; 6-month re-audit', 'action' => 'Issue PIP & Semi-Annual Review'],
        ['min' => 0, 'rating' => 'Poor', 'decision' => 'Not Recommended', 'status' => 'Not Recommended', 'range' => '< 70.0%', 'definition' => 'Poor / Below Standards', 'guideline' => 'Freeze new purchase orders; initiate vendor offboarding or replacement', 'action' => 'Disqualify / Alternate Vendor'],
    ];
}
function classify($score) { $all = thresholds(); foreach ($all as $t) if ($score >= $t['min']) return $t; return end($all); }
function master_rows() { return q('SELECT * FROM criteria_master ORDER BY sort_order, id'); }
// Overall score in percent: sum of (weight x rating) / 5. $ratings is keyed by the Criteria Master id of each criterion.
function score_ratings($ratings, $master) {
    $sum = 0;
    foreach ($master as $m) $sum += (int) $m['weight'] * (int) (isset($ratings[$m['id']]) ? $ratings[$m['id']] : 0);
    return round($sum / 5, 1);
}
function supplier_out($s) {
    return ['id' => s($s['id']), 'code' => $s['supplier_code'], 'name' => $s['name'], 'category' => $s['category'], 'contactPerson' => $s['contact_person'], 'contactNo' => $s['contact_no'], 'department' => $s['department'],
        'email' => $s['email'], 'status' => $s['status'], 'score' => $s['current_score'] === null ? null : (float) $s['current_score'], 'lastEvaluation' => $s['last_evaluation'], 'nextEvaluation' => $s['next_evaluation']];
}
function criteria_out() {
    return array_map(function ($m) { return ['id' => s($m['id']), 'name' => $m['name'], 'weight' => (int) $m['weight'], 'purpose' => $m['purpose']]; }, master_rows());
}
function evaluations_out() {
    $rows = q('SELECT e.*, s.name AS supplier_name, s.category AS supplier_category, u.name AS evaluator_name, sv.name AS supervisor_name FROM supplier_evaluations e JOIN suppliers s ON s.id = e.supplier_id JOIN users u ON u.id = e.evaluator_id LEFT JOIN users sv ON sv.id = e.supervisor_id ORDER BY e.id');
    $rt = []; // the ratings of each evaluation, with the criterion name and weight as they were when it was submitted
    foreach (q('SELECT * FROM evaluation_ratings ORDER BY sort_order, id') as $x)
        $rt[$x['evaluation_id']][] = ['criterionId' => $x['criterion_id'] === null ? null : s($x['criterion_id']), 'name' => $x['criterion_name'], 'weight' => (int) $x['weight'], 'rating' => (int) $x['rating']];
    return array_map(function ($e) use ($rt) {
        $r = isset($rt[$e['id']]) ? $rt[$e['id']] : [];
        return ['id' => s($e['id']), 'evaluatorId' => s($e['evaluator_id']), 'timestamp' => iso($e['created_at']), 'supplierId' => s($e['supplier_id']), 'supplier' => $e['supplier_name'], 'category' => $e['supplier_category'], 'service' => $e['service'],
            'criticality' => $e['criticality'], 'evaluationDate' => $e['evaluation_date'], 'evaluator' => $e['evaluator_name'], 'ratings' => $r, 'meets' => $e['meets_requirements'], 'issues' => $e['significant_issues'],
            'corrective' => $e['corrective_required'], 'recommendation' => $e['recommendation'], 'comments' => $e['comments'], 'issueIdentified' => $e['issue_identified'], 'requiredAction' => $e['required_action'],
            'supplierResponse' => $e['supplier_response'], 'targetDate' => $e['target_date'], 'responsiblePerson' => $e['responsible_person'], 'followUp' => $e['follow_up'], 'supervisor' => $e['supervisor_name'], 'correctiveStatus' => $e['corrective_status'],
            'score' => (float) $e['overall_score'], 'rating' => $e['rating'], 'decision' => $e['decision']];
    }, $rows);
}
// Checks the evaluation form answers sent by the browser. Stops with an error message if something is wrong.
function validate_evaluation($in, $evaluatorId = 0) {
    $sup = q1('SELECT * FROM suppliers WHERE id = ?', [(int) ($in['supplierId'] ?? 0)]);
    if (!$sup) fail(400, 'Choose a supplier.');
    $service = trim((string) ($in['service'] ?? ''));
    if ($service === '' || strlen($service) > 160) fail(400, 'Enter the service or product provided.');
    $crit = $in['criticality'] ?? '';
    if (!in_array($crit, ['Critical', 'High', 'Medium', 'Low'], true)) fail(400, 'Choose the supplier criticality.');
    $date = valid_date($in['evaluationDate'] ?? '');
    if (!$date) fail(400, 'Enter a valid evaluation date.');
    if ($date > date('Y-m-d', strtotime('+1 day'))) fail(400, 'The evaluation date cannot be in the future.');
    $cq = quarter_range(date('Y-m-d'));
    if ($date < $cq['start'] || $date > $cq['end']) fail(400, 'The evaluation date must be inside the current quarter (' . $cq['start'] . ' to ' . $cq['end'] . ').');
    $ev = q1('SELECT role, department FROM users WHERE id = ?', [(int) $evaluatorId]);
    if ($ev && $ev['role'] !== 'admin' && $sup['department'] !== '' && strtolower($sup['department']) !== strtolower($ev['department'])) fail(403, 'This supplier belongs to another department.');
    $master = master_rows();
    if (!$master) fail(400, 'No evaluation criteria have been set up yet. Contact your administrator.');
    $given = isset($in['ratings']) && is_array($in['ratings']) ? $in['ratings'] : [];
    $ratings = [];
    foreach ($master as $m) { $v = (int) ($given[$m['id']] ?? 0); if ($v < 1 || $v > 5) fail(400, 'Rate every criterion from 1 to 5.'); $ratings[$m['id']] = $v; }
    $meets = $in['meets'] ?? ''; if (!in_array($meets, ['Yes', 'Partially', 'No'], true)) fail(400, 'Answer: does the supplier meet the requirements?');
    $issues = $in['issues'] ?? ''; if (!in_array($issues, ['Yes', 'No'], true)) fail(400, 'Answer: were there significant issues?');
    $corr = $in['corrective'] ?? ''; if (!in_array($corr, ['Yes', 'No'], true)) fail(400, 'Answer: is corrective action required?');
    $rec = $in['recommendation'] ?? '';
    if (!in_array($rec, ['Continue Supplier', 'Continue with Monitoring', 'Corrective Action Required', 'Management Review', 'Consider Replacement', 'Other'], true)) fail(400, 'Choose a recommendation.');
    if ($rec === 'Other') { $o = trim((string) ($in['recommendationOther'] ?? '')); if ($o === '') fail(400, 'Write your recommendation.'); $rec = 'Other: ' . $o; }
    $comments = trim((string) ($in['comments'] ?? '')); if ($comments === '') fail(400, 'Write your comments.');
    $c = ['issue' => null, 'action' => null, 'response' => null, 'target' => null, 'person' => null, 'follow' => null];
    if ($corr === 'Yes') {
        // the employee only describes the issue; the administrator records the corrective action later (admin.php, save_corrective)
        $c['issue'] = trim((string) ($in['issueIdentified'] ?? ''));
        if ($c['issue'] === '') fail(400, 'Describe the issue identified.');
        // the immediate head / supervisor assigned to this employee by the admin is notified on the site (none assigned = only the admin sees it)
        $c['supervisor'] = q1("SELECT s.id, s.name FROM users u JOIN users s ON s.id = u.supervisor_id WHERE u.id = ? AND s.status = 'Active'", [(int) $evaluatorId]);
    }
    return ['master' => $master, 'sup' => $sup, 'service' => $service, 'crit' => $crit, 'date' => $date, 'ratings' => $ratings, 'meets' => $meets, 'issues' => $issues, 'corr' => $corr, 'rec' => $rec, 'comments' => $comments, 'c' => $c];
}

// After an evaluation is deleted, the Supplier Master shows the latest evaluation that is left (or "Under Review" if none is left).
function recalc_supplier($supplierId) {
    $e = q1('SELECT * FROM supplier_evaluations WHERE supplier_id = ? ORDER BY evaluation_date DESC, id DESC LIMIT 1', [(int) $supplierId]);
    if (!$e) { run("UPDATE suppliers SET status = 'Under Review', current_score = NULL, last_evaluation = NULL, next_evaluation = NULL WHERE id = ?", [(int) $supplierId]); return; }
    $status = 'Under Review';
    foreach (thresholds() as $t) if ($t['decision'] === $e['decision']) $status = $t['status'];
    run('UPDATE suppliers SET status = ?, current_score = ?, last_evaluation = ?, next_evaluation = ? WHERE id = ?', [$status, $e['overall_score'], $e['evaluation_date'], next_quarter_start($e['evaluation_date']), (int) $supplierId]);
}

// The Departments list (Admin > Departments) with how many people and suppliers use each one.
function departments_out() {
    return array_map(function ($d) { return ['id' => s($d['id']), 'name' => $d['name'], 'employees' => (int) $d['employees'], 'suppliers' => (int) $d['suppliers']]; },
        q('SELECT d.id, d.name, (SELECT COUNT(*) FROM users u WHERE u.department = d.name) AS employees, (SELECT COUNT(*) FROM suppliers s WHERE s.department = d.name) AS suppliers FROM departments d ORDER BY d.name'));
}
