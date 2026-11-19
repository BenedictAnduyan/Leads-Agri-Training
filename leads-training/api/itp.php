<?php
// IT Procurement Requisition actions (save, delete). Every signed-in account may use it; a person can change only their own requests, the admin any.
// Process (see itp_lib.php): draft (save) > submit > Line Manager approves and e-signs (or rejects: back to a draft) > IT Department checks the stock:
//   in stock:  Check Inventory (stock_submit) > IT Manager / Executive approves > Item released (release) > close
//   no stock:  attach the assessment link (assess) > IT Manager / Executive approves > print for the PO > Submitted for PO (po) > Mark item as received (receive) > close
// The IT Department can also deem a form invalid (invalid) or send it back to the requestor (sendback). Every step is written with its date and time. Every e-signature is the picture saved in the Profile of that person.
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

function itp_notify_approvers($r, $me, $title, $msg) { // the IT Manager and the Executives (not the person who just acted)
    $told = [];
    $mg = rfc_user_of('sherwin');
    if ($mg && (int) $mg['id'] !== (int) $me['id']) { $told[(int) $mg['id']] = true; add_note($mg['id'], $title, mb_substr($msg, 0, 250)); }
    foreach (q("SELECT id FROM users WHERE role = 'executive' AND status = 'Active'") as $ex) {
        if ((int) $ex['id'] === (int) $me['id'] || isset($told[(int) $ex['id']])) continue;
        add_note($ex['id'], $title, mb_substr($msg, 0, 250));
    }
}
function itp_reason() { global $in; $why = trim((string) (isset($in['reason']) ? $in['reason'] : '')); if (mb_strlen($why) > 200) fail(400, 'The reason can have at most 200 characters.'); return $why; }
function itp_regress($r, $by, $why, $label) { // back to scratch: a draft the requestor can edit and submit again (every e-signature, the stock and the steps are cleared)
    db()->beginTransaction();
    run('DELETE FROM itp_signatures WHERE itp_id = ?', [(int) $r['id']]); run('DELETE FROM itp_stock WHERE itp_id = ?', [(int) $r['id']]); run('DELETE FROM itp_events WHERE itp_id = ?', [(int) $r['id']]);
    run("UPDATE itp_requests SET stage = 'draft', path = '', assessment_url = '', assessed_by = NULL, it_staff_name = '', submitted_at = NULL, stage_note = ? WHERE id = ?", [mb_substr($label . ': ' . $by['name'] . ($why !== '' ? ' - ' . $why : ''), 0, 250), (int) $r['id']]);
    itp_ev($r['id'], 'regress', $by, $label . ($why !== '' ? ': ' . $why : ''));
    db()->commit();
    log_activity($by['name'] . ' returned ' . itp_no($r['id']) . ' to the requestor (' . $label . ').');
    if ($r['user_id'] && (int) $r['user_id'] !== (int) $by['id']) add_note($r['user_id'], 'ITP returned to you: ' . itp_no($r['id']), mb_substr($by['name'] . ' ' . strtolower($label) . ' your requisition.' . ($why !== '' ? ' Reason: ' . $why : '') . ' Edit it and submit it again.', 0, 250));
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
        $lm = q1("SELECT * FROM users WHERE id = ? AND status = 'Active' AND role IN ('superior', 'executive', 'admin')", [$lmId]);
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

case 'submit': // the requestor submits: the requestor's e-signature is added, then the Line Manager approves or rejects it
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if ((int) $r['user_id'] !== (int) $me['id']) fail(403, 'Only the requestor can submit this requisition.');
    if ($r['stage'] !== 'draft') fail(400, 'This requisition was already submitted.');
    $lm = $r['line_manager_id'] ? q1("SELECT * FROM users WHERE id = ? AND status = 'Active'", [(int) $r['line_manager_id']]) : null;
    if (!$lm) fail(400, 'Choose your Line Manager first (Edit the requisition, then save it).');
    $mine = itp_esig_of($me['id']);
    if ($mine === '') fail(400, 'Add your e-signature in Profile first, then submit.');
    db()->beginTransaction();
    itp_sign($r['id'], 'requestor', $me['id'], $me['name'], $mine, 0);
    run("UPDATE itp_requests SET stage = 'linemgr', submitted_at = NOW(), stage_note = '' WHERE id = ?", [(int) $r['id']]);
    itp_ev($r['id'], 'submit', $me);
    db()->commit();
    log_activity($me['name'] . ' submitted ' . itp_no($r['id']) . ' (' . $r['nature'] . ').');
    add_note($lm['id'], 'ITP approval needed: ' . itp_no($r['id']), mb_substr($me['name'] . ' submitted an IT Procurement Requisition (' . $r['nature'] . '). Open IT Procurement Requisition to approve (and e-sign) or reject it.', 0, 250));
    out(['ok' => true]);

case 'lm_approve': // the Line Manager approves and signs with their own e-signature
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canLmDecide']) fail(403, $r['stage'] === 'linemgr' ? 'Only the Line Manager chosen on this requisition can approve it.' : 'This requisition is not waiting for the Line Manager.');
    $img = itp_esig_of($me['id']);
    if ($img === '') fail(400, 'Add your e-signature in Profile first, then approve.');
    db()->beginTransaction();
    itp_sign($r['id'], 'linemanager', $me['id'], $me['name'], $img, 0);
    run("UPDATE itp_requests SET stage = 'assessment' WHERE id = ?", [(int) $r['id']]);
    itp_ev($r['id'], 'lm', $me);
    db()->commit();
    log_activity($me['name'] . ' approved ' . itp_no($r['id']) . ' as Line Manager.');
    if ($r['user_id'] && (int) $r['user_id'] !== (int) $me['id']) add_note($r['user_id'], 'ITP approved by your Line Manager: ' . itp_no($r['id']), $me['name'] . ' approved your requisition and signed it. The IT Department will check it next.');
    itp_notify_it($r, 'ITP assessment needed: ' . itp_no($r['id']), $r['owner_name'] . ' submitted an IT Procurement Requisition (' . $r['nature'] . ') and the Line Manager approved it. Check the inventory, or attach the assessment.', [(int) $r['user_id'], (int) $me['id']]);
    out(['ok' => true]);

case 'lm_reject': // the Line Manager rejects it: the form goes back to scratch (a draft for the requestor)
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canLmDecide']) fail(403, 'Only the Line Manager chosen on this requisition can reject it while it waits for them.');
    itp_regress($r, $me, itp_reason(), 'Rejected by the Line Manager');
    out(['ok' => true]);

case 'assess': // no stock: an IT employee attaches the assessment link; their e-signature is added
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canAssess']) fail(403, $r['stage'] === 'assessment' ? 'Only another IT Department employee can attach the assessment.' : 'This requisition is not waiting for an assessment.');
    $url = trim((string) (isset($in['url']) ? $in['url'] : ''));
    if ($url === '' || mb_strlen($url) > 500 || !filter_var($url, FILTER_VALIDATE_URL) || !preg_match('#^https?://#i', $url)) fail(400, 'Enter the link of the assessment (it must start with http:// or https://).');
    $img = itp_esig_of($me['id']);
    if ($img === '') fail(400, 'Add your e-signature in Profile first, then submit the assessment.');
    db()->beginTransaction();
    itp_sign($r['id'], 'itstaff', $me['id'], $me['name'], $img, 0);
    run("DELETE FROM itp_stock WHERE itp_id = ?", [(int) $r['id']]);
    run("UPDATE itp_requests SET stage = 'approval', path = 'procure', assessment_url = ?, assessed_by = ?, it_staff_name = ? WHERE id = ?", [$url, (int) $me['id'], $me['name'], (int) $r['id']]);
    itp_ev($r['id'], 'assess', $me, 'No stock: procurement');
    db()->commit();
    log_activity($me['name'] . ' attached the assessment of ' . itp_no($r['id']) . ' (no stock).');
    itp_notify_approvers($r, $me, 'ITP approval needed: ' . itp_no($r['id']), $me['name'] . ' attached the assessment (no stock). Please check it and approve the requisition of ' . $r['owner_name'] . '.');
    out(['ok' => true]);

case 'stock_submit': // in stock: an IT employee ticked the inventory items that match the request and submits them for approval
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canAssess']) fail(403, $r['stage'] === 'assessment' ? 'Only another IT Department employee can check the inventory.' : 'This requisition is not waiting for an assessment.');
    $picks = isset($in['picks']) && is_array($in['picks']) ? $in['picks'] : [];
    if (!$picks) fail(400, 'Tick at least one inventory item that matches the request.');
    if (count($picks) > 40) fail(400, 'At most 40 inventory items can be added to one requisition.');
    $rows = []; $seen = [];
    foreach ($picks as $pk) {
        $invId = (int) (is_array($pk) && isset($pk['invId']) ? $pk['invId'] : 0); $qty = (int) (is_array($pk) && isset($pk['qty']) ? $pk['qty'] : 0);
        $inv = $invId ? q1('SELECT * FROM it_inventory WHERE id = ?', [$invId]) : null;
        if (!$inv || isset($seen[$invId])) fail(400, 'One of the ticked inventory items was not found. Reload the page and tick again.');
        $seen[$invId] = true;
        if ($qty < 1 || $qty > (int) $inv['quantity']) fail(400, 'The quantity of "' . $inv['item'] . '" must be from 1 to ' . (int) $inv['quantity'] . ' (what is in stock).');
        $rows[] = [$invId, $inv['item'], $qty, $inv['description'], $inv['purchased_for']];
    }
    $img = itp_esig_of($me['id']);
    if ($img === '') fail(400, 'Add your e-signature in Profile first, then submit for approval.');
    db()->beginTransaction();
    run('DELETE FROM itp_stock WHERE itp_id = ?', [(int) $r['id']]);
    foreach ($rows as $k) run('INSERT INTO itp_stock (itp_id, inv_id, item, qty, description, purchased_for) VALUES (?, ?, ?, ?, ?, ?)', [(int) $r['id'], $k[0], $k[1], $k[2], $k[3], $k[4]]);
    itp_sign($r['id'], 'itstaff', $me['id'], $me['name'], $img, 0);
    run("UPDATE itp_requests SET stage = 'stock_approval', path = 'stock', assessment_url = '', assessed_by = ?, it_staff_name = ? WHERE id = ?", [(int) $me['id'], $me['name'], (int) $r['id']]);
    itp_ev($r['id'], 'assess', $me, 'In stock: ' . count($rows) . (count($rows) === 1 ? ' item' : ' items'));
    db()->commit();
    log_activity($me['name'] . ' checked the inventory for ' . itp_no($r['id']) . ' (' . count($rows) . ' item(s) in stock).');
    itp_notify_approvers($r, $me, 'ITP approval needed: ' . itp_no($r['id']), $me['name'] . ' found stock for the requisition of ' . $r['owner_name'] . '. Please review the items and approve.');
    out(['ok' => true]);

case 'invalid': // the IT Department finds the request invalid (for example the printer is not really broken): the form is closed as invalid
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canAssess']) fail(403, 'Only another IT Department employee can do this while the form is waiting for the IT assessment.');
    $why = itp_reason(); if ($why === '') fail(400, 'Enter the reason why the request is invalid.');
    db()->beginTransaction();
    run("UPDATE itp_requests SET stage = 'closed', outcome = 'invalid', stage_note = ?, closed_at = NOW() WHERE id = ?", [mb_substr('Invalid: ' . $why, 0, 250), (int) $r['id']]);
    itp_ev($r['id'], 'assess', $me, 'Invalid: ' . $why); itp_ev($r['id'], 'close', $me, 'Closed as invalid');
    db()->commit();
    log_activity($me['name'] . ' deemed ' . itp_no($r['id']) . ' invalid and closed it.');
    if ($r['user_id'] && (int) $r['user_id'] !== (int) $me['id']) add_note($r['user_id'], 'ITP closed as invalid: ' . itp_no($r['id']), mb_substr($me['name'] . ' (IT Department) closed your requisition as invalid. Reason: ' . $why, 0, 250));
    out(['ok' => true]);

case 'sendback': // the IT Department sends the form back to the requestor (back to scratch)
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canAssess']) fail(403, 'Only another IT Department employee can do this while the form is waiting for the IT assessment.');
    $why = itp_reason(); if ($why === '') fail(400, 'Enter the reason why it goes back to the requestor.');
    itp_regress($r, $me, $why, 'Sent back by the IT Department');
    out(['ok' => true]);

case 'approve': // the IT Manager or an Executive approves: the e-signature is added above the printed name (an Executive signs in their own slot with their own name)
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canApprove']) fail(403, in_array($r['stage'], ['approval', 'stock_approval'], true) ? 'Only the IT Manager or an Executive can approve this requisition.' : 'This requisition is not waiting for approval.');
    $img = itp_esig_of($me['id']);
    if ($img === '') fail(400, 'Add your e-signature in Profile first, then approve.');
    $stock = $r['stage'] === 'stock_approval'; $asExec = itp_is_exec($me) && !itp_is_manager($me);
    db()->beginTransaction();
    itp_sign($r['id'], $asExec ? 'executive' : 'itmanager', $me['id'], $me['name'], $img, 0);
    run('UPDATE itp_requests SET stage = ? WHERE id = ?', [$stock ? 'releasing' : 'approved', (int) $r['id']]);
    itp_ev($r['id'], 'approve', $me, $asExec ? 'As Executive' : '');
    db()->commit();
    log_activity($me['name'] . ' approved ' . itp_no($r['id']) . ($asExec ? ' as Executive' : '') . '.');
    $by = $asExec ? 'The Executive (' . $me['name'] . ')' : 'The IT Manager';
    if ($r['user_id'] && (int) $r['user_id'] !== (int) $me['id']) add_note($r['user_id'], 'ITP approved: ' . itp_no($r['id']), $stock ? $by . ' approved your requisition. The IT Department will release the item to you.' : $by . ' approved your requisition. All e-signatures are complete: you can print it and give it to the PO.');
    if ($stock) itp_notify_it($r, 'ITP item to release: ' . itp_no($r['id']), 'The requisition of ' . $r['owner_name'] . ' was approved. Release the item and press Item released.', [(int) $r['user_id'], (int) $me['id']]);
    out(['ok' => true]);

case 'return': // the IT Manager / Executive sends it back to the IT Department assessment (the IT employee's e-signature is removed; the ticked items stay, so they can be fixed)
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canReturn']) fail(403, 'Only the IT Manager or an Executive can return a requisition that is waiting for approval.');
    $why = itp_reason();
    db()->beginTransaction();
    run("DELETE FROM itp_signatures WHERE itp_id = ? AND role = 'itstaff'", [(int) $r['id']]);
    run("DELETE FROM itp_events WHERE itp_id = ? AND step = 'assess'", [(int) $r['id']]);
    run("UPDATE itp_requests SET stage = 'assessment', path = '', assessment_url = '', assessed_by = NULL, it_staff_name = '', stage_note = ? WHERE id = ?", [$why !== '' ? mb_substr('Returned by ' . $me['name'] . ': ' . $why, 0, 250) : 'Returned by ' . $me['name'], (int) $r['id']]);
    itp_ev($r['id'], 'return', $me, $why);
    db()->commit();
    log_activity($me['name'] . ' returned ' . itp_no($r['id']) . ' to the IT Department.');
    itp_notify_it($r, 'ITP returned: ' . itp_no($r['id']), ($me['role'] === 'executive' ? 'The Executive' : 'The IT Manager') . ' returned the requisition of ' . $r['owner_name'] . ' for a new assessment.' . ($why !== '' ? ' Reason: ' . $why : ''), [(int) $r['user_id']]);
    out(['ok' => true]);

case 'po': // no stock: the IT Manager / Executive pressed "Submitted for PO" (the printed form was given to the PO)
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canPo']) fail(403, $r['stage'] === 'approved' ? 'Only the IT Manager or an Executive can do this.' : 'The requisition must be approved first.');
    run("UPDATE itp_requests SET stage = 'po' WHERE id = ?", [(int) $r['id']]);
    itp_ev($r['id'], 'po', $me);
    log_activity($me['name'] . ' marked ' . itp_no($r['id']) . ' as submitted for PO.');
    if ($r['user_id'] && (int) $r['user_id'] !== (int) $me['id']) add_note($r['user_id'], 'ITP submitted for PO: ' . itp_no($r['id']), 'Your requisition was submitted to the PO. The IT Department is waiting for the supplier to deliver the item.');
    out(['ok' => true]);

case 'receive': // no stock: the IT Manager / Executive pressed "Mark item as received" (the supplier delivered the item to the IT Department)
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canReceive']) fail(403, $r['stage'] === 'po' ? 'Only the IT Manager or an Executive can mark the item as received.' : 'Press Submitted for PO first.');
    run("UPDATE itp_requests SET stage = 'received', received_at = NOW() WHERE id = ?", [(int) $r['id']]);
    itp_ev($r['id'], 'receive', $me);
    log_activity($me['name'] . ' marked ' . itp_no($r['id']) . ' as item received.');
    if ($r['user_id'] && (int) $r['user_id'] !== (int) $me['id']) add_note($r['user_id'], 'ITP item received: ' . itp_no($r['id']), 'The item of your requisition was received by the IT Department.');
    out(['ok' => true]);

case 'release': // in stock: an IT employee gave the item to the requestor and pressed "Item released" (the quantity leaves the inventory)
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canRelease']) fail(403, $r['stage'] === 'releasing' ? 'Only an IT Department account can release the item.' : 'The requisition must be approved first.');
    db()->beginTransaction();
    foreach (q('SELECT * FROM itp_stock WHERE itp_id = ?', [(int) $r['id']]) as $k) {
        if (!$k['inv_id']) continue;
        $st = run('UPDATE it_inventory SET quantity = quantity - ? WHERE id = ? AND quantity >= ?', [(int) $k['qty'], (int) $k['inv_id'], (int) $k['qty']]);
        if ($st->rowCount() < 1) { db()->rollBack(); fail(400, 'There is not enough stock of "' . $k['item'] . '" in the inventory anymore. Return the form to the IT assessment and tick the items again.'); }
    }
    run("UPDATE itp_requests SET stage = 'released' WHERE id = ?", [(int) $r['id']]);
    itp_ev($r['id'], 'release', $me);
    db()->commit();
    log_activity($me['name'] . ' released the item of ' . itp_no($r['id']) . ' to the requestor.');
    if ($r['user_id'] && (int) $r['user_id'] !== (int) $me['id']) add_note($r['user_id'], 'ITP item released: ' . itp_no($r['id']), 'The IT Department released your item. You or the IT Department can close the form now.');
    out(['ok' => true]);

case 'close': // the requestor or any IT Department account closes the form (it moves to the Closed list)
    $r = itp_get(isset($in['id']) ? $in['id'] : 0);
    if (!itp_flags($me, $r)['canClose']) fail(403, in_array($r['stage'], ['received', 'released'], true) ? 'Only the requestor or an IT Department account can close this requisition.' : 'The item must be received or released first.');
    run("UPDATE itp_requests SET stage = 'closed', closed_at = NOW() WHERE id = ?", [(int) $r['id']]);
    itp_ev($r['id'], 'close', $me);
    log_activity($me['name'] . ' closed ' . itp_no($r['id']) . '.');
    if ($r['user_id'] && (int) $r['user_id'] !== (int) $me['id']) add_note($r['user_id'], 'ITP closed: ' . itp_no($r['id']), 'Your IT Procurement Requisition was closed.');
    out(['ok' => true]);

case 'inv_save': // the IT Department (and the admin) keep the inventory list: item, quantity, description / specs, purchased for
    if (!itp_is_it($me) && $me['role'] !== 'admin') fail(403, 'Only the IT Department can change the inventory.');
    $iid = (int) (isset($in['id']) ? $in['id'] : 0);
    $item = itp_text('item', 160, 'the item', true); $desc = itp_text('description', 500, 'the description / specs'); $for = itp_text('purchasedFor', 200, 'what it was purchased for');
    $qty = isset($in['quantity']) ? trim((string) $in['quantity']) : '';
    if (!ctype_digit($qty) || (int) $qty > 100000) fail(400, 'Enter the quantity as a whole number (0 or more).');
    if ($iid) { if (!q1('SELECT id FROM it_inventory WHERE id = ?', [$iid])) fail(404, 'Item not found.'); run('UPDATE it_inventory SET item = ?, quantity = ?, description = ?, purchased_for = ? WHERE id = ?', [$item, (int) $qty, $desc, $for, $iid]); }
    else run('INSERT INTO it_inventory (item, quantity, description, purchased_for) VALUES (?, ?, ?, ?)', [$item, (int) $qty, $desc, $for]);
    out(['ok' => true]);

case 'inv_del':
    if (!itp_is_it($me) && $me['role'] !== 'admin') fail(403, 'Only the IT Department can change the inventory.');
    run('DELETE FROM it_inventory WHERE id = ?', [(int) (isset($in['id']) ? $in['id'] : 0)]); // forms that already used the item keep their own copy of it
    out(['ok' => true]);

case 'delete':
    $r = itp_mine(isset($in['id']) ? $in['id'] : 0);
    if ($r['stage'] !== 'draft' && $me['role'] !== 'admin') fail(403, 'A submitted requisition can be deleted only by the admin.');
    run('DELETE FROM itp_requests WHERE id = ?', [(int) $r['id']]); // its items and e-signatures go with it
    out(['ok' => true]);
}
fail(404, 'Unknown action.');
