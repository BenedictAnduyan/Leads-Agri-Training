<?php
// Employee actions. Locking, scoring and passing are all decided here, on the server.
require __DIR__ . '/helpers.php';
$u = require_login(); // employees, supervisors and the admin (the admin has access to everything)
$uid = (int) $u['id'];
$in = input();
$action = isset($_GET['action']) ? $_GET['action'] : '';

switch ($action) {

case 'card': // learning material of one card (only if it is unlocked)
    $c = open_card($uid, isset($in['id']) ? $in['id'] : 0);
    progress_row($uid, $c['id']);
    $res = ['id' => s($c['id']), 'content' => json_decode($c['content'], true), 'kind' => $c['card_kind']];
    if ($c['card_kind'] === 'evaluation') {
        // the rating questions of the form are the criteria of the Criteria Master
        $res['fields'] = array_map(function ($m) { return ['key' => s($m['id']), 'label' => $m['name'], 'description' => $m['purpose'], 'weight' => (int) $m['weight']]; }, master_rows());
        $res['suppliers'] = array_map(function ($x) { return ['id' => s($x['id']), 'name' => $x['name'], 'category' => $x['category'], 'contactPerson' => $x['contact_person'], 'contactNo' => $x['contact_no'], 'email' => $x['email']]; }, q("SELECT * FROM suppliers WHERE ? = 'admin' OR department = '' OR LOWER(department) = LOWER(?) ORDER BY name", [$u['role'], $u['department']]));
        $res['thresholds'] = thresholds();
        // this employee's evaluations in the current quarter, with the status of their re-evaluation request (one evaluation per supplier per quarter)
        $qr = quarter_range(date('Y-m-d')); $seen = []; $res['mine'] = [];
        $reqs = [];
        foreach (q('SELECT * FROM reeval_requests WHERE employee_id = ? AND quarter_start = ? ORDER BY id', [$uid, $qr['start']]) as $r) $reqs[$r['supplier_id']] = $r['status']; // the latest request of each supplier wins
        foreach (q('SELECT e.*, s.name AS supplier_name FROM supplier_evaluations e JOIN suppliers s ON s.id = e.supplier_id WHERE e.evaluator_id = ? AND e.evaluation_date BETWEEN ? AND ? ORDER BY e.evaluation_date DESC, e.id DESC', [$uid, $qr['start'], $qr['end']]) as $x) {
            if (isset($seen[$x['supplier_id']])) continue;
            $seen[$x['supplier_id']] = true;
            $st = isset($reqs[$x['supplier_id']]) ? $reqs[$x['supplier_id']] : 'None';
            $res['mine'][] = ['supplierId' => s($x['supplier_id']), 'supplier' => $x['supplier_name'], 'service' => $x['service'], 'criticality' => $x['criticality'], 'date' => $x['evaluation_date'], 'score' => (float) $x['overall_score'], 'decision' => $x['decision'], 'requestStatus' => $st === 'Used' ? 'None' : $st];
        }
    }
    out($res);

case 'set_reading':
    $c = open_card($uid, isset($in['id']) ? $in['id'] : 0);
    $p = progress_row($uid, $c['id']);
    $v = max(0, min(100, (int) (isset($in['reading']) ? $in['reading'] : 0)));
    if (!$p['passed'] && $v > (int) $p['reading_progress']) {
        $pct = $p['quiz_started'] ? (int) $p['overall_progress'] : (int) round($v * 0.3);
        run('UPDATE card_progress SET reading_progress = ?, overall_progress = ? WHERE id = ?', [$v, $pct, $p['id']]);
    }
    out(['ok' => true]);

case 'start_quiz':
    $c = open_card($uid, isset($in['id']) ? $in['id'] : 0);
    $p = progress_row($uid, $c['id']);
    if ($p['passed']) fail(400, 'You already passed this card.');
    if ((int) $p['reading_progress'] < 100) fail(400, 'Finish reading the material first.');
    $qs = q('SELECT id, question, options_json FROM quiz_questions WHERE card_id = ? ORDER BY sort_order, id', [$c['id']]);
    if (!$qs) fail(400, 'This card has no quiz questions yet.');
    run('DELETE FROM quiz_attempts WHERE card_id = ? AND employee_id = ? AND completed_at IS NULL', [$c['id'], $uid]);
    $n = (int) q1('SELECT COUNT(*) AS n FROM quiz_attempts WHERE card_id = ? AND employee_id = ?', [$c['id'], $uid])['n'] + 1;
    run('INSERT INTO quiz_attempts (card_id, employee_id, attempt_number, total_questions, started_at) VALUES (?, ?, ?, ?, NOW())', [$c['id'], $uid, $n, count($qs)]);
    $aid = last_id();
    run('UPDATE card_progress SET quiz_started = 1, overall_progress = 30 WHERE id = ?', [$p['id']]);
    out(['attemptId' => $aid, 'questions' => array_map(function ($x) { return ['id' => s($x['id']), 'text' => $x['question'], 'options' => json_decode($x['options_json'], true)]; }, $qs)]);

case 'answer': // checks one answer and tells the employee right away
    $att = q1('SELECT * FROM quiz_attempts WHERE id = ? AND employee_id = ?', [(int) (isset($in['attemptId']) ? $in['attemptId'] : 0), $uid]);
    if (!$att || $att['completed_at']) fail(400, 'This quiz attempt is not open.');
    $qu = q1('SELECT * FROM quiz_questions WHERE id = ? AND card_id = ?', [(int) (isset($in['questionId']) ? $in['questionId'] : 0), $att['card_id']]);
    if (!$qu) fail(404, 'Question not found.');
    $opts = json_decode($qu['options_json'], true);
    $sel = (int) (isset($in['selected']) ? $in['selected'] : -1);
    if ($sel < 0 || $sel >= count($opts)) fail(400, 'Choose one of the answers.');
    $old = q1('SELECT * FROM question_answers WHERE attempt_id = ? AND question_id = ?', [$att['id'], $qu['id']]);
    if (!$old) {
        $ok = $sel === (int) $qu['correct_answer'] ? 1 : 0;
        run('INSERT INTO question_answers (attempt_id, question_id, selected_answer, correct, answered_at) VALUES (?, ?, ?, ?, NOW())', [$att['id'], $qu['id'], $sel, $ok]);
        $old = ['selected_answer' => $sel, 'correct' => $ok];
    }
    $done = (int) q1('SELECT COUNT(*) AS n FROM question_answers WHERE attempt_id = ?', [$att['id']])['n'];
    run('UPDATE card_progress SET overall_progress = ? WHERE card_id = ? AND employee_id = ?', [30 + (int) round($done / max(1, (int) $att['total_questions']) * 60), $att['card_id'], $uid]);
    out(['correct' => (bool) $old['correct'], 'selected' => (int) $old['selected_answer'], 'correctAnswer' => (int) $qu['correct_answer'], 'explanation' => $qu['explanation']]);

case 'finish': // the server counts the score and decides pass or fail
    $att = q1('SELECT * FROM quiz_attempts WHERE id = ? AND employee_id = ?', [(int) (isset($in['attemptId']) ? $in['attemptId'] : 0), $uid]);
    if (!$att) fail(404, 'Quiz attempt not found.');
    $card = q1('SELECT * FROM training_cards WHERE id = ?', [$att['card_id']]);
    $total = (int) $att['total_questions'];
    $required = (int) ceil((int) $card['passing_score'] / 100 * $total);
    if ($att['completed_at']) out(['score' => (int) $att['score'], 'total' => $total, 'percentage' => (int) $att['percentage'], 'passed' => (bool) $att['passed'], 'required' => $required, 'passing' => (int) $card['passing_score']]);
    $row = q1('SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS ok FROM question_answers WHERE attempt_id = ?', [$att['id']]);
    if ((int) $row['n'] < $total) fail(400, 'Answer every question first.');
    $score = (int) $row['ok'];
    $per = (int) round($score / $total * 100);
    $passed = $per >= (int) $card['passing_score'];
    $p = progress_row($uid, $card['id']);
    db()->beginTransaction();
    run('UPDATE quiz_attempts SET score = ?, percentage = ?, passed = ?, completed_at = NOW() WHERE id = ?', [$score, $per, $passed ? 1 : 0, $att['id']]);
    run('UPDATE card_progress SET current_attempt = ?, best_score = GREATEST(COALESCE(best_score, 0), ?), failed = ?, overall_progress = ? WHERE id = ?', [$att['attempt_number'], $per, $passed ? 0 : 1, $passed ? 100 : 90, $p['id']]);
    if ($passed) {
        run('UPDATE card_progress SET passed = 1, completed_at = NOW() WHERE id = ?', [$p['id']]);
        record_pass($u, $card);
    } else {
        add_note($uid, 'Card failed', 'You failed ' . $card['title'] . '. Please restart the card.');
        log_activity($u['name'] . ' failed ' . $card['title'] . ' (' . $score . '/' . $total . ').');
    }
    db()->commit();
    out(['score' => $score, 'total' => $total, 'percentage' => $per, 'passed' => $passed, 'required' => $required, 'passing' => (int) $card['passing_score']]);

case 'restart':
    $c = open_card($uid, isset($in['id']) ? $in['id'] : 0);
    $p = progress_row($uid, $c['id']);
    if ($p['passed']) fail(400, 'You already passed this card.');
    run('DELETE FROM quiz_attempts WHERE card_id = ? AND employee_id = ? AND completed_at IS NULL', [$c['id'], $uid]);
    run('UPDATE card_progress SET reading_progress = 0, overall_progress = 0, quiz_started = 0, failed = 0 WHERE id = ?', [$p['id']]);
    out(['ok' => true]);

case 'save_profile':
    $name = trim(isset($in['name']) ? $in['name'] : '');
    if ($name === '') fail(400, 'Display name cannot be empty.');
    run('UPDATE users SET name = ?, phone = ? WHERE id = ?', [$name, trim(isset($in['phone']) ? $in['phone'] : ''), $uid]);
    out(['ok' => true]);

case 'change_password':
    if (!password_verify(isset($in['current']) ? $in['current'] : '', $u['password_hash'])) fail(400, 'Current password is incorrect.');
    $new = isset($in['new']) ? $in['new'] : '';
    if (strlen($new) < 8) fail(400, 'New password must have at least 8 characters.');
    run('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $uid]);
    out(['ok' => true]);

case 'set_pref':
    $col = ['email' => 'pref_email', 'deadline' => 'pref_deadline'];
    $key = isset($in['key']) ? $in['key'] : '';
    if (!isset($col[$key])) fail(400, 'Unknown setting.');
    run('UPDATE users SET ' . $col[$key] . ' = ? WHERE id = ?', [!empty($in['value']) ? 1 : 0, $uid]);
    out(['ok' => true]);

case 'mark_read':
    run('UPDATE notifications SET is_read = 1 WHERE employee_id = ?', [$uid]);
    out(['ok' => true]);

case 'support_request':
    $subject = trim(isset($in['subject']) ? $in['subject'] : '');
    $message = trim(isset($in['message']) ? $in['message'] : '');
    if ($subject === '' || $message === '') fail(400, 'Please fill in the subject and message.');
    run('INSERT INTO support_requests (employee_id, name, email, subject, message) VALUES (?, ?, ?, ?, ?)', [$uid, $u['name'], $u['email'], $subject, $message]);
    out(['ok' => true]);

case 'request_reeval': // the employee asks permission to evaluate a supplier again in the same quarter
    $sup = q1('SELECT * FROM suppliers WHERE id = ?', [(int) ($in['supplierId'] ?? 0)]);
    if (!$sup) fail(404, 'Supplier not found.');
    $qr = quarter_range(date('Y-m-d'));
    if (!q1('SELECT id FROM supplier_evaluations WHERE evaluator_id = ? AND supplier_id = ? AND evaluation_date BETWEEN ? AND ?', [$uid, $sup['id'], $qr['start'], $qr['end']])) fail(400, 'You have not evaluated this supplier in this quarter yet, so you can evaluate it without permission.');
    if (q1("SELECT id FROM reeval_requests WHERE employee_id = ? AND supplier_id = ? AND quarter_start = ? AND status IN ('Pending', 'Approved')", [$uid, $sup['id'], $qr['start']])) fail(400, 'You already have an open request for this supplier.');
    $reason = mb_substr(trim((string) ($in['reason'] ?? '')), 0, 255);
    $boss = q1("SELECT s.id, s.name FROM users u JOIN users s ON s.id = u.supervisor_id WHERE u.id = ? AND s.status = 'Active'", [$uid]);
    run('INSERT INTO reeval_requests (employee_id, supplier_id, quarter_start, supervisor_id, reason) VALUES (?, ?, ?, ?, ?)', [$uid, $sup['id'], $qr['start'], $boss ? $boss['id'] : null, $reason]);
    if ($boss) add_note($boss['id'], 'Re-evaluation request: ' . $sup['name'], mb_substr($u['name'] . ' asks permission to evaluate ' . $sup['name'] . ' again this quarter.' . ($reason === '' ? '' : ' Reason: ' . $reason), 0, 250));
    log_activity($u['name'] . ' requested to re-evaluate ' . $sup['name'] . '.');
    out(['ok' => true, 'message' => $boss ? 'Your request was sent to ' . $boss['name'] . '.' : 'Your request was sent. No supervisor is assigned to you, so the administrator will review it.']);

case 'decide_reeval': // the supervisor approves or declines a request
    decide_reeval($in['id'] ?? 0, $in['decision'] ?? '', $u);
    out(['ok' => true]);

case 'save_corrective': // the immediate head / supervisor chosen in the evaluation form records the corrective action
    $e = q1('SELECT * FROM supplier_evaluations WHERE id = ? AND supervisor_id = ?', [(int) ($in['id'] ?? 0), $uid]);
    if (!$e || $e['corrective_required'] !== 'Yes') fail(404, 'This corrective action is not assigned to you.');
    $resp = trim((string) ($in['supplierResponse'] ?? '')); $person = trim((string) ($in['responsiblePerson'] ?? ''));
    $target = valid_date($in['targetDate'] ?? ''); $follow = $in['followUp'] ?? ''; $status = $in['status'] ?? '';
    if (!$target || $person === '' || !in_array($follow, ['Yes', 'No'], true) || !in_array($status, ['Open', 'Resolved'], true)) fail(400, 'Fill in the target completion date, responsible person, follow-up and status.');
    run('UPDATE supplier_evaluations SET supplier_response = ?, target_date = ?, responsible_person = ?, follow_up = ?, corrective_status = ? WHERE id = ?',
        [$resp === '' ? null : $resp, $target, $person, $follow, $status, $e['id']]);
    $sup = q1('SELECT name FROM suppliers WHERE id = ?', [$e['supplier_id']]);
    log_activity($u['name'] . ($status === 'Resolved' ? ' marked the corrective action solved for the evaluation of ' : ' recorded the corrective action for the evaluation of ') . $sup['name'] . '.');
    out(['ok' => true]);

case 'submit_evaluation': // saves the supplier evaluation, calculates the score, and updates the Supplier Master
    $c = open_card($uid, isset($in['id']) ? $in['id'] : 0);
    if ($c['card_kind'] !== 'evaluation') fail(400, 'This card has no evaluation form.');
    $p = progress_row($uid, $c['id']);
    $d = validate_evaluation($in, $uid);
    // one evaluation per supplier per quarter: a second one needs an approved re-evaluation request (the admin does not need one)
    $qr = quarter_range($d['date']);
    $had = (int) q1('SELECT COUNT(*) AS n FROM supplier_evaluations WHERE evaluator_id = ? AND supplier_id = ? AND evaluation_date BETWEEN ? AND ?', [$uid, $d['sup']['id'], $qr['start'], $qr['end']])['n'];
    $grant = $had ? q1("SELECT id FROM reeval_requests WHERE employee_id = ? AND supplier_id = ? AND quarter_start = ? AND status = 'Approved' ORDER BY id DESC LIMIT 1", [$uid, $d['sup']['id'], $qr['start']]) : null;
    if ($had && !$grant && $u['role'] !== 'admin') fail(403, 'You already evaluated this supplier in this quarter. Ask your supervisor for permission to evaluate it again.');
    $master = $d['master'];
    $score = score_ratings($d['ratings'], $master);
    $cl = classify($score);
    $cc = $d['c'];
    db()->beginTransaction();
    // a new evaluation replaces the same employee's earlier evaluation of the same supplier in the same quarter (their ratings go with it)
    $replaced = $had;
    if ($grant) run("UPDATE reeval_requests SET status = 'Used' WHERE id = ?", [$grant['id']]);
    if ($replaced) run('DELETE FROM supplier_evaluations WHERE evaluator_id = ? AND supplier_id = ? AND evaluation_date BETWEEN ? AND ?', [$uid, $d['sup']['id'], $qr['start'], $qr['end']]);
    run('INSERT INTO supplier_evaluations (supplier_id, evaluator_id, service, criticality, evaluation_date, meets_requirements, significant_issues, corrective_required, recommendation, comments, issue_identified, required_action, supplier_response, target_date, responsible_person, follow_up, supervisor_id, overall_score, rating, decision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$d['sup']['id'], $uid, $d['service'], $d['crit'], $d['date'],
         $d['meets'], $d['issues'], $d['corr'], $d['rec'], $d['comments'], $cc['issue'], $cc['action'], $cc['response'], $cc['target'], $cc['person'], $cc['follow'], !empty($cc['supervisor']) ? $cc['supervisor']['id'] : null, $score, $cl['rating'], $cl['decision']]);
    $evalId = (int) last_id();
    // every rating is saved with the criterion name and weight it had on this date, so later changes to the Criteria Master do not change old evaluations
    foreach ($master as $i => $m)
        run('INSERT INTO evaluation_ratings (evaluation_id, criterion_id, criterion_name, weight, rating, sort_order) VALUES (?, ?, ?, ?, ?, ?)', [$evalId, $m['id'], $m['name'], $m['weight'], $d['ratings'][$m['id']], $i + 1]);
    // the immediate head / supervisor is notified on the site when the evaluation needs a corrective action
    if (!empty($cc['supervisor']))
        add_note($cc['supervisor']['id'], 'Corrective action needed: ' . $d['sup']['name'],
            mb_substr($u['name'] . ' evaluated ' . $d['sup']['name'] . ' and reported an issue that needs corrective action: ' . $cc['issue'], 0, 250));
    if ($cc['issue'] !== null) // the admin has access to everything, so every active admin is told too
        foreach (q("SELECT id FROM users WHERE role = 'admin' AND status = 'Active' AND id <> ?", [$uid]) as $ad)
            add_note($ad['id'], 'Corrective action needed: ' . $d['sup']['name'], mb_substr($u['name'] . ' evaluated ' . $d['sup']['name'] . ' and reported an issue that needs corrective action: ' . $cc['issue'], 0, 250));
    // the supplier master shows the latest evaluation that is left; the next one is due in the next calendar quarter
    recalc_supplier($d['sup']['id']);
    $n = (int) q1('SELECT COUNT(*) AS n FROM supplier_evaluations WHERE evaluator_id = ?', [$uid])['n'];
    run('UPDATE card_progress SET current_attempt = ?, best_score = 100, failed = 0, overall_progress = 100 WHERE id = ?', [$n, $p['id']]);
    $text = $u['name'] . ($replaced ? ' re-evaluated ' : ' evaluated ') . $d['sup']['name'] . ' (' . number_format($score, 1) . '% ' . $cl['rating'] . ', ' . $cl['decision'] . ').';
    if (!$p['passed']) { run('UPDATE card_progress SET passed = 1, completed_at = NOW() WHERE id = ?', [$p['id']]); record_pass($u, $c, $text); }
    else log_activity($text);
    db()->commit();
    $next = next_quarter_start($d['date']);
    out(['supplierId' => s($d['sup']['id']), 'replaced' => $replaced > 0, 'supplier' => $d['sup']['name'], 'score' => $score, 'rating' => $cl['rating'], 'decision' => $cl['decision'], 'evaluationDate' => $d['date'], 'nextEvaluation' => $next]);
}
fail(404, 'Unknown action.');
