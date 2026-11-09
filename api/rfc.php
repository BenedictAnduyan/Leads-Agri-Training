<?php
// Request for Check actions (save, delete). Every signed-in account may use it; a person can change only their own requests, the admin any.
// The form is printed and signed by hand, so no signature is stored anywhere.
require __DIR__ . '/helpers.php';
require __DIR__ . '/rfc_lib.php';
$me = require_login();
$in = input();
$action = isset($_GET['action']) ? $_GET['action'] : '';

function rfc_text($k, $max, $label, $required = false) {
    global $in;
    $v = trim((string) (isset($in[$k]) ? $in[$k] : ''));
    if ($required && $v === '') fail(400, 'Enter ' . $label . '.');
    if (mb_strlen($v) > $max) fail(400, ucfirst($label) . ' can have at most ' . $max . ' characters.');
    return $v;
}
function rfc_date($k, $label) {
    global $in;
    $v = isset($in[$k]) ? trim((string) $in[$k]) : '';
    if ($v === '') return null;
    if (!valid_date($v)) fail(400, 'Enter a valid date for ' . $label . '.');
    return $v;
}
function rfc_mine($id) { // a request the person may change
    global $me;
    $r = q1('SELECT * FROM rfc_requests WHERE id = ?', [(int) $id]);
    if (!$r) fail(404, 'Request not found.');
    if ($me['role'] !== 'admin' && (int) $r['user_id'] !== (int) $me['id']) fail(403, 'This request belongs to someone else.');
    return $r;
}

switch ($action) {

case 'save': // add a request, or change one (the whole form is sent at once)
    $id = (int) (isset($in['id']) ? $in['id'] : 0);
    $old = $id ? rfc_mine($id) : null;
    $reason = isset($in['reason']) ? $in['reason'] : '';
    if (!in_array($reason, RFC_REASONS, true)) fail(400, 'Choose the reason for the check.');
    $f = [
        'employee_name' => rfc_text('employeeName', 160, 'the employee name'), 'account_number' => rfc_text('accountNumber', 60, 'the account number'),
        'vendor_name' => rfc_text('vendorName', 200, 'the vendor / payee name', true), 'vendor_address' => rfc_text('vendorAddress', 300, 'the address'), 'vendor_tin' => rfc_text('vendorTin', 40, 'the TIN'),
        'date_needed' => rfc_date('dateNeeded', 'the date the check is needed'), 'date_of_check' => rfc_date('dateOfCheck', 'the date of the check'),
        'reason' => $reason, 'purpose' => rfc_text('purpose', 3000, 'the purpose'), 'note' => rfc_text('note', 300, 'the note'), 'instructions' => rfc_text('instructions', 1000, 'the special instructions'),
        'requested_by' => rfc_text('requestedBy', 120, 'the name of the requester'), 'recommended_by' => rfc_text('recommendedBy', 240, 'the recommended by names'), 'approved_by' => rfc_text('approvedBy', 120, 'the name of the approver'),
        'requested_date' => rfc_date('requestedDate', 'Requested by'), 'recommended_date' => rfc_date('recommendedDate', 'Recommended by'), 'approved_date' => rfc_date('approvedDate', 'Approved by'),
    ];
    // the items: a name, the number of units, the amount, and the users matched with it (none = an item without a user)
    $raw = isset($in['items']) && is_array($in['items']) ? $in['items'] : [];
    $items = []; $total = 0; $n = 0;
    foreach ($raw as $it) {
        if (!is_array($it)) continue;
        $n++;
        $name = trim((string) (isset($it['name']) ? $it['name'] : ''));
        if ($name === '') fail(400, 'Enter the name of item ' . $n . ', or remove it.');
        if (mb_strlen($name) > 200) fail(400, 'The name of item ' . $n . ' can have at most 200 characters.');
        $units = (int) (isset($it['units']) ? $it['units'] : 1);
        if ($units < 1 || $units > 9999) fail(400, 'The units of item ' . $n . ' must be from 1 to 9999.');
        $amt = isset($it['amount']) ? $it['amount'] : '';
        if (!is_numeric($amt) || (float) $amt < 0 || (float) $amt > 1000000000) fail(400, 'Enter the amount of item ' . $n . ' (a number, 0 or more).');
        $amt = round((float) $amt, 2);
        $users = [];
        foreach ((isset($it['users']) && is_array($it['users']) ? $it['users'] : []) as $x) {
            $un = trim((string) (is_array($x) && isset($x['name']) ? $x['name'] : '')); if ($un === '') continue;
            $ud = trim((string) (isset($x['detail']) ? $x['detail'] : ''));
            if (mb_strlen($un) > 120 || mb_strlen($ud) > 160) fail(400, 'A user of item ' . $n . ' has a name or detail that is too long.');
            $users[] = ['name' => $un, 'detail' => $ud];
        }
        if (count($users) > 30) fail(400, 'Item ' . $n . ' can have at most 30 users.');
        $items[] = [$name, $units, $amt, json_encode($users, JSON_UNESCAPED_UNICODE)]; $total += $amt;
    }
    if (!$items) fail(400, 'Add at least one item.');
    if (count($items) > 60) fail(400, 'A request can have at most 60 items.');
    $f['total'] = round($total, 2);
    db()->beginTransaction();
    if ($old) {
        $set = implode(', ', array_map(function ($c) { return $c . ' = ?'; }, array_keys($f)));
        run('UPDATE rfc_requests SET ' . $set . ' WHERE id = ?', array_merge(array_values($f), [$id]));
        run('DELETE FROM rfc_items WHERE rfc_id = ?', [$id]);
    } else {
        $f['user_id'] = (int) $me['id']; $f['owner_name'] = $me['name'];
        run('INSERT INTO rfc_requests (' . implode(', ', array_keys($f)) . ') VALUES (' . implode(', ', array_fill(0, count($f), '?')) . ')', array_values($f));
        $id = (int) last_id();
        log_activity($me['name'] . ' created a Request for Check for ' . $f['vendor_name'] . '.');
    }
    foreach ($items as $k => $i) run('INSERT INTO rfc_items (rfc_id, sort_order, name, units, amount, users_json) VALUES (?, ?, ?, ?, ?, ?)', [$id, $k + 1, $i[0], $i[1], $i[2], $i[3]]);
    db()->commit();
    out(['id' => s($id)]);

case 'delete':
    $r = rfc_mine(isset($in['id']) ? $in['id'] : 0);
    run('DELETE FROM rfc_requests WHERE id = ?', [(int) $r['id']]); // its items go with it
    out(['ok' => true]);
}
fail(404, 'Unknown action.');
