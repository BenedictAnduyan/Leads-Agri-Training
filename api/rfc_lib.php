<?php
// Request for Check: the data sent to the browser. Everyone signed in can use it:
// an employee / immediate superior sees and edits their own requests, the admin sees all of them.
require_once __DIR__ . '/helpers.php';

const RFC_REASONS = ['Reimbursement', 'Incentive', 'Sponsorship', 'Payment', 'Others'];

// names of active accounts, for the "add a user" suggestions of an item (name, department and position only)
function rfc_people() {
    return array_map(function ($p) { return ['name' => $p['name'], 'detail' => trim($p['department'] . ($p['department'] !== '' && $p['job_title'] !== '' ? ' | ' : '') . $p['job_title'])]; },
        q("SELECT name, department, job_title FROM users WHERE status = 'Active' ORDER BY name"));
}
function rfc_out($u) {
    $rows = $u['role'] === 'admin'
        ? q('SELECT * FROM rfc_requests ORDER BY id DESC LIMIT 300')
        : q('SELECT * FROM rfc_requests WHERE user_id = ? ORDER BY id DESC LIMIT 300', [(int) $u['id']]);
    $items = [];
    if ($rows) {
        $in = implode(',', array_map('intval', array_column($rows, 'id')));
        foreach (q("SELECT * FROM rfc_items WHERE rfc_id IN ($in) ORDER BY sort_order, id") as $i) {
            $users = json_decode((string) $i['users_json'], true);
            $items[$i['rfc_id']][] = ['name' => $i['name'], 'units' => (int) $i['units'], 'amount' => (float) $i['amount'], 'users' => is_array($users) ? $users : []];
        }
    }
    return ['requests' => array_map(function ($r) use ($items) {
        return ['id' => s($r['id']), 'ownerId' => $r['user_id'] ? s($r['user_id']) : '', 'owner' => $r['owner_name'], 'employeeName' => $r['employee_name'], 'accountNumber' => $r['account_number'],
            'vendorName' => $r['vendor_name'], 'vendorAddress' => $r['vendor_address'], 'vendorTin' => $r['vendor_tin'], 'dateNeeded' => $r['date_needed'] ?: '', 'dateOfCheck' => $r['date_of_check'] ?: '',
            'reason' => $r['reason'], 'purpose' => (string) $r['purpose'], 'note' => $r['note'], 'instructions' => (string) $r['instructions'],
            'requestedBy' => $r['requested_by'], 'recommendedBy' => $r['recommended_by'], 'approvedBy' => $r['approved_by'],
            'requestedDate' => $r['requested_date'] ?: '', 'recommendedDate' => $r['recommended_date'] ?: '', 'approvedDate' => $r['approved_date'] ?: '',
            'total' => (float) $r['total'], 'createdAt' => iso($r['created_at']), 'items' => isset($items[$r['id']]) ? $items[$r['id']] : []];
    }, $rows), 'people' => rfc_people()];
}
