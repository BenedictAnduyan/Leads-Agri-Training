<?php
// IT Procurement Requisition actions (save, delete). Every signed-in account may use it; a person can change only their own requests, the admin any.
// Process: draft (save) > submit (requestor and Line Manager e-signatures are added) > assess (an IT employee attaches the assessment link and e-signs) > approve (the IT Manager e-signs)
// > approved (the requestor prints it) > receive (item received) > close. Every e-signature is the picture saved in the Profile of that person (see esig_lib.php).
// The names of the requestor and of the Line Manager are fixed, the IT staff name is filled in when the assessment is attached, and the IT Manager is the constant ITP_IT_MANAGER.
require __DIR__ . '/helpers.php';
require __DIR__ . '/itp_lib.php';
$me = require_login();
if (!itp_ready()) fail(500, 'IT Procurement Requisition could not be set up. Check that MySQL allows changing the tables.');
$in = input();
$action = isset($_GET['action']) ? $_GET['action'] : '';

function itp_text($k, $max, $label, $required = false) {
    global $in;
    $v = trim((string) (isset($in[$k]) ? $in[$k] : ''));
    if ($required && $v === '') fail(400, 'Enter ' . $label . '.');
    if (mb_strlen($v) > $max) fail(400, ucfirst($label) . ' can have at most ' . $max . ' characters.');
    return $v;
}
function itp_date($k, $label) {
    global $in;
    $v = isset($in[$k]) ? trim((string) $in[$k]) : '';
    if ($v === '') return null;
    if (!valid_date($v)) fail(400, 'Enter a valid date for ' . $label . '.');
    return $v;
}
function itp_yes($k) { global $in; return isset($in[$k]) && $in[$k] === 'Yes' ? 'Yes' : 'No'; }
function itp_mine($id) { // a request the person may change
    global $me;
    $r = q1('SELECT * FROM itp_requests WHERE id = ?', [(int) $id]);
    if (!$r) fail(404, 'Request not found.');
    if ($me['role'] !== 'admin' && (int) $r['user_id'] !== (int) $me['id']) fail(403, 'This request belongs to someone else.');
    return $r;
}
function itp_get($id) { // any requisition the person is allowed to see
    global $me;
    $r = q1('SELECT * FROM itp_requests WHERE id = ?', [(int) $id]);
    if (!$r || !itp_can_see($me, $r)) fail(404, 'Requisition not found.');
    return $r;
}
function itp_no($id) { return 'ITP #' . str_pad($id, 4, '0', STR_PAD_LEFT); }
function itp_sign($id, $role, $uid, $name, $b64, $auto = 0) { run('INSERT INTO itp_signatures (itp_id, role, user_id, signer_name, image, auto_applied) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), signer_name = VALUES(signer_name), image = VALUES(image), auto_applied = VALUES(auto_applied), signed_at = NOW()', [(int) $id, $role, (int) $uid, $name, $b64, $auto]); }
function itp_notify_it($r, $title, $msg, $skip) { // tells the IT Department accounts (not the IT Manager, who is told separately, and not the people in $skip)
    foreach (q("SELECT * FROM users WHERE status = 'Active'") as $x) {
        if (!itp_is_it($x) || itp_is_manager($x) || in_array((int) $x['id'], $skip, true)) continue;
        add_note($x['id'], $title, mb_substr($msg, 0, 250));
    }
}

switch ($action) {

case 'save': // add a request, or change one (the whole form is sent at once)
    $id = (int) (isset($in['id']) ? $in['id'] : 0);
    $old = $id ? itp_mine($id) : null;
    if ($old && $old['stage'] !== 'draft') fail(400, 'This requisition was already submitted and can no longer be edited.');
    $ownerName = $old ? ($old['owner_name'] !== '' ? $old['owner_name'] : $me['name']) : $me['name']; // fixed: the one who made the requisition
    $owner = $old ? ($old['user_id'] ? q1('SELECT * FROM users WHERE id = ?', [(int) $old['user_id']]) : null) : $me;
    $lmId = $owner && $owner['supervisor_id'] ? (int) $owner['supervisor_id'] : (int) (isset($in['lineManagerId']) ? $in['lineManagerId'] : 0); // the Line Manager is the immediate supervisor of the requestor, else chosen from the list
    $lm = null;
    if ($lmId) {
        $lm = q1("SELECT * FROM users WHERE id = ? AND status = 'Active' AND role IN ('superior', 'admin')", [$lmId]);
        if (!$lm || ($owner && (int) $lm['id'] === (int) $owner['id'])) fail(400, 'Choose a valid Line Manager.');
    }
    $nature = isset($in['nature']) ? $in['nature'] : '';
    if (!in_array($nature, ITP_NATURES, true)) fail(400, 'Choose the nature of request.');
    $chargeable = itp_yes('chargeable'); $budget = itp_yes('budget');
    $amount = isset($in['budgetAmount']) ? trim((string) $in['budgetAmount']) : '';
    if ($budget === 'Yes' && $amount !== '') {
        if (!is_numeric($amount) || (float) $amount < 0 || (float) $amount > 1000000000) fail(400, 'Enter the budget amount as a number (0 or more).');
        $amount = round((float) $amount, 2);
    } else $amount = null;
    $f = [
        'date_of_request' => itp_date('dateOfRequest', 'the date of request'), 'date_required' => itp_date('dateRequired', 'the date required'),
        'department' => itp_text('department', 100, 'the department'), 'requested_by' => $ownerName,
        'noted_by' => itp_text('notedBy', 120, 'the name in Noted By'), 'subsidiary' => itp_text('subsidiary', 160, 'the subsidiary'),
        'chargeable' => $chargeable, 'chargeable_to' => $chargeable === 'Yes' ? itp_text('chargeableTo', 160, 'the subsidiary it is chargeable to') : '',
        'budget' => $budget, 'budget_amount' => $amount,
        'nature' => $nature, 'nature_other' => $nature === 'Others' ? itp_text('natureOther', 100, 'the other nature of request', true) : '',
        'special_instructions' => itp_text('specialInstructions', 2000, 'the special instructions'), 'purpose' => itp_text('purpose', 3000, 'the purpose'),
        'assignee' => itp_text('assignee', 160, 'the assignee'), 'requestor_name' => $ownerName,
        'line_manager_name' => $lm ? $lm['name'] : '', 'line_manager_id' => $lm ? (int) $lm['id'] : null, 'it_staff_name' => '',
    ];
    // the items: quantity, unit, type of equipment, budgeted price. The total price of a line is quantity x budgeted price, worked out here (never trusted from the browser).
    $raw = isset($in['items']) && is_array($in['items']) ? $in['items'] : [];
    $items = []; $total = 0; $n = 0;
    foreach ($raw as $it) {
        if (!is_array($it)) continue;
        $n++;
        $desc = trim((string) (isset($it['description']) ? $it['description'] : ''));
        if ($desc === '') fail(400, 'Enter the type of equipment of item ' . $n . ', or remove it.');
        if (mb_strlen($desc) > 200) fail(400, 'The type of equipment of item ' . $n . ' can have at most 200 characters.');
        $unit = trim((string) (isset($it['unit']) ? $it['unit'] : ''));
        if (mb_strlen($unit) > 30) fail(400, 'The unit of item ' . $n . ' can have at most 30 characters.');
        $qty = (int) (isset($it['qty']) ? $it['qty'] : 1);
        if ($qty < 1 || $qty > 9999) fail(400, 'The quantity of item ' . $n . ' must be from 1 to 9999.');
        $price = isset($it['budgetedPrice']) ? trim((string) $it['budgetedPrice']) : '';
        if ($price === '') $price = 0;
        if (!is_numeric($price) || (float) $price < 0 || (float) $price > 1000000000) fail(400, 'The budgeted price of item ' . $n . ' must be a number (0 or more).');
        $price = round((float) $price, 2);
        $items[] = [$qty, $unit, $desc, $price]; $total += $qty * $price;
    }
    if (!$items) fail(400, 'Add at least one item.');
    if (count($items) > 60) fail(400, 'A request can have at most 60 items.');
    $f['total'] = round($total, 2);
    db()->beginTransaction();
    if ($old) {
        $set = implode(', ', array_map(function ($c) { return $c . ' = ?'; }, array_keys($f)));
        run('UPDATE itp_requests SET ' . $set . ' WHERE id = ?', array_merge(array_values($f), [$id]));
        run('DELETE FROM itp_items WHERE itp_id = ?', [$id]);
    } else {
        $f['user_id'] = (int) $me['id']; $f['owner_name'] = $me['name'];
        run('INSERT INTO itp_requests (' . implode(', ', array_keys($f)) . ') VALUES (' . implode(', ', array_fill(0, count($f), '?')) . ')', array_values($f));
        $id = (int) last_id();
        log_activity($me['name'] . ' created an IT Procurement Requisition (' . $nature . ').');
    }
    foreach ($items as $k => $i) run('INSERT INTO itp_items (itp_id, sort_order, qty, unit, description, budgeted_price) VALUES (?, ?, ?, ?, ?, ?)', [$id, $k + 1, $i[0], $i[1], $i[2], $i[3]]);
    db()->commit();
    out(['id' => s($id)]);

case 'submit': // the requestor submits: the requestor's e-signature and the Line Manager's e-signature are added, then the IT Department can assess it
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if ((int) $r['user_id'] !== (int) $me['id']) fail(403, 'Only the requestor can submit this requisition.');
    if ($r['stage'] !== 'draft') fail(400, 'This requisition was already submitted.');
    $lm = $r['line_manager_id'] ? q1("SELECT * FROM users WHERE id = ? AND status = 'Active'", [(int) $r['line_manager_id']]) : null;
    if (!$lm) fail(400, 'Choose your Line Manager first (Edit the requisition, then save it).');
    $mine = itp_esig_of($me['id']); $theirs = itp_esig_of($lm['id']);
    if ($mine === '') fail(400, 'Add your e-signature in Profile first, then submit.');
    if ($theirs === '') fail(400, $lm['name'] . ' (your Line Manager) has not added an e-signature in Profile yet. Ask them to add it, then submit again.');
    db()->beginTransaction();
    itp_sign($r['id'], 'requestor', $me['id'], $me['name'], $mine, 0);
    itp_sign($r['id'], 'linemanager', $lm['id'], $lm['name'], $theirs, 1); // added automatically when the requestor submits
    run("UPDATE itp_requests SET stage = 'assessment', submitted_at = NOW() WHERE id = ?", [(int) $r['id']]);
    db()->commit();
    log_activity($me['name'] . ' submitted ' . itp_no($r['id']) . ' (' . $r['nature'] . ').');
    add_note($lm['id'], 'ITP submitted: ' . itp_no($r['id']), mb_substr($me['name'] . ' submitted an IT Procurement Requisition and your e-signature was added as Line Manager.', 0, 250));
    itp_notify_it($r, 'ITP assessment needed: ' . itp_no($r['id']), $me['name'] . ' submitted an IT Procurement Requisition (' . $r['nature'] . '). Open IT Procurement Requisition and attach the assessment.', [(int) $me['id']]);
    out(['ok' => true]);

case 'assess': // an IT employee (not the IT Manager, not the requestor) attaches the assessment link; their e-signature is added
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canAssess']) fail(403, $r['stage'] === 'assessment' ? 'Only another IT Department employee can attach the assessment.' : 'This requisition is not waiting for an assessment.');
    $url = trim((string) (isset($in['url']) ? $in['url'] : ''));
    if ($url === '' || mb_strlen($url) > 500 || !filter_var($url, FILTER_VALIDATE_URL) || !preg_match('#^https?://#i', $url)) fail(400, 'Enter the link of the assessment (it must start with http:// or https://).');
    $img = itp_esig_of($me['id']);
    if ($img === '') fail(400, 'Add your e-signature in Profile first, then submit the assessment.');
    db()->beginTransaction();
    itp_sign($r['id'], 'itstaff', $me['id'], $me['name'], $img, 0);
    run("UPDATE itp_requests SET stage = 'approval', assessment_url = ?, assessed_by = ?, it_staff_name = ? WHERE id = ?", [$url, (int) $me['id'], $me['name'], (int) $r['id']]);
    db()->commit();
    log_activity($me['name'] . ' attached the assessment of ' . itp_no($r['id']) . '.');
    $mg = rfc_user_of('sherwin');
    if ($mg && (int) $mg['id'] !== (int) $me['id']) add_note($mg['id'], 'ITP approval needed: ' . itp_no($r['id']), mb_substr($me['name'] . ' attached the assessment. Please check it and approve the requisition of ' . $r['owner_name'] . '.', 0, 250));
    out(['ok' => true]);

case 'approve': // the IT Manager checks the assessment and approves: the e-signature is added above the printed name
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canApprove']) fail(403, $r['stage'] === 'approval' ? 'Only the IT Manager can approve this requisition.' : 'This requisition is not waiting for approval.');
    $img = itp_esig_of($me['id']);
    if ($img === '') fail(400, 'Add your e-signature in Profile first, then approve.');
    db()->beginTransaction();
    itp_sign($r['id'], 'itmanager', $me['id'], $me['name'], $img, 0);
    run("UPDATE itp_requests SET stage = 'approved' WHERE id = ?", [(int) $r['id']]);
    db()->commit();
    log_activity($me['name'] . ' approved ' . itp_no($r['id']) . '.');
    if ($r['user_id'] && (int) $r['user_id'] !== (int) $me['id']) add_note($r['user_id'], 'ITP approved: ' . itp_no($r['id']), 'The IT Manager approved your requisition. All e-signatures are complete: you can print it and give it to the PO.');
    out(['ok' => true]);

case 'return': // the IT Manager sends it back to the IT Department (the IT employee signature and the assessment link are removed)
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canReturn']) fail(403, 'Only the IT Manager can return a requisition that is waiting for approval.');
    $why = trim((string) (isset($in['reason']) ? $in['reason'] : ''));
    if (mb_strlen($why) > 200) fail(400, 'The reason can have at most 200 characters.');
    db()->beginTransaction();
    run("DELETE FROM itp_signatures WHERE itp_id = ? AND role = 'itstaff'", [(int) $r['id']]);
    run("UPDATE itp_requests SET stage = 'assessment', assessment_url = '', assessed_by = NULL, it_staff_name = '' WHERE id = ?", [(int) $r['id']]);
    db()->commit();
    log_activity($me['name'] . ' returned ' . itp_no($r['id']) . ' to the IT Department.');
    itp_notify_it($r, 'ITP returned: ' . itp_no($r['id']), 'The IT Manager returned the requisition of ' . $r['owner_name'] . ' for a new assessment.' . ($why !== '' ? ' Reason: ' . $why : ''), [(int) $r['user_id']]);
    out(['ok' => true]);

case 'receive': // an IT Department account marks that the item has arrived
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canReceive']) fail(403, $r['stage'] === 'approved' ? 'Only an IT Department account can update this status.' : 'The requisition must be approved first.');
    run("UPDATE itp_requests SET stage = 'received', received_at = NOW() WHERE id = ?", [(int) $r['id']]);
    log_activity($me['name'] . ' marked ' . itp_no($r['id']) . ' as item received.');
    if ($r['user_id'] && (int) $r['user_id'] !== (int) $me['id']) add_note($r['user_id'], 'ITP item received: ' . itp_no($r['id']), 'The item of your requisition was received by the IT Department.');
    out(['ok' => true]);

case 'close': // the form is closed and moves to the Closed list
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canClose']) fail(403, $r['stage'] === 'received' ? 'Only an IT Department account can close this requisition.' : 'Mark the item as received first.');
    run("UPDATE itp_requests SET stage = 'closed', closed_at = NOW() WHERE id = ?", [(int) $r['id']]);
    log_activity($me['name'] . ' closed ' . itp_no($r['id']) . '.');
    if ($r['user_id'] && (int) $r['user_id'] !== (int) $me['id']) add_note($r['user_id'], 'ITP closed: ' . itp_no($r['id']), 'Your IT Procurement Requisition was closed.');
    out(['ok' => true]);

case 'delete':
    $r = itp_mine(isset($in['id']) ? $in['id'] : 0);
    if ($r['stage'] !== 'draft' && $me['role'] !== 'admin') fail(403, 'A submitted requisition can be deleted only by the admin.');
    run('DELETE FROM itp_requests WHERE id = ?', [(int) $r['id']]); // its items and e-signatures go with it
    out(['ok' => true]);
}
fail(404, 'Unknown action.');
