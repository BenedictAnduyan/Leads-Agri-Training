<?php
// IT Procurement Requisition: the data sent to the browser. Everyone signed in can use it:
// an employee / immediate superior sees and edits their own requisitions, the admin sees all of them.
// The form follows a fixed process (stage):
//   draft          the requestor fills in the form and saves it
//   linemgr        submitted: the requestor's e-signature is on the form; the Line Manager approves (and e-signs) or rejects it (rejected = back to a draft)
//   assessment     an IT Department employee (not the IT Manager, not the requestor) checks the stock. In stock: Check Inventory (path 'stock'). Not in stock: attach the assessment link (path 'procure').
//                  Or the IT employee deems the form invalid (closed) or sends it back to the requestor (draft)
//   --- path 'procure' (no stock) ---
//   approval       the IT employee's e-signature is on the form; the IT Manager or an Executive checks the assessment and approves (or returns it to the IT Department)
//   approved       the manager's e-signature is on the form; print it and give it to the PO (outside the system); the IT Manager / Executive presses "Submitted for PO"
//   po             submitted to the PO, waiting for the supplier; the IT Manager / Executive presses "Mark item as received"
//   received       the item arrived: the requestor or any IT Department account closes the form
//   --- path 'stock' (the IT Department has the item) ---
//   stock_approval the ticked inventory items are on the form; the IT Manager or an Executive reviews them and approves (or returns it to the IT Department)
//   releasing      an IT Department account gives the item to the requestor and presses "Item released" (the quantity leaves the inventory)
//   released       the requestor or any IT Department account closes the form
//   closed         the form is in the Closed list (outcome 'invalid' when the IT Department deemed it invalid)
// Every step is written in itp_events with the name and the date AND time. Every e-signature comes from the picture saved in the Profile of that person.
// The tables are extended automatically (see itp_ready), no SQL file has to be imported.
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/rfc_lib.php'; // rfc_signer_of, rfc_user_of, esig functions

const ITP_NATURES = ['Equipment', 'License', 'Repair', 'Maintenance', 'Software', 'Others'];
const ITP_IT_MANAGER = 'Sherwin Greso'; // the IT Manager on every form. It is a constant: it is never read from the browser and never saved.
const ITP_STAGES = ['draft' => 'Draft', 'linemgr' => 'For Line Manager approval', 'assessment' => 'For IT assessment', 'approval' => 'For IT Manager approval', 'stock_approval' => 'For IT Manager approval (stock)', 'approved' => 'Approved: print for the PO', 'po' => 'Submitted to PO', 'received' => 'Item received', 'releasing' => 'Releasing item', 'released' => 'Item released', 'closed' => 'Closed'];

function itp_ready() { // adds the new columns and the signature table when they are missing
    static $ok = null;
    if ($ok !== null) return $ok;
    try {
        $cols = array_column(q('SHOW COLUMNS FROM itp_requests'), 'Field'); $add = [];
        $want = ['stage' => "VARCHAR(20) NOT NULL DEFAULT 'draft'", 'line_manager_id' => 'INT UNSIGNED NULL', 'assessment_url' => "VARCHAR(500) NOT NULL DEFAULT ''", 'assessed_by' => 'INT UNSIGNED NULL',
            'submitted_at' => 'DATETIME NULL', 'received_at' => 'DATETIME NULL', 'closed_at' => 'DATETIME NULL',
            'path' => "VARCHAR(10) NOT NULL DEFAULT ''", 'stage_note' => "VARCHAR(250) NOT NULL DEFAULT ''", 'outcome' => "VARCHAR(10) NOT NULL DEFAULT ''"];
        foreach ($want as $c => $def) if (!in_array($c, $cols, true)) $add[] = 'ADD COLUMN ' . $c . ' ' . $def;
        if ($add) run('ALTER TABLE itp_requests ' . implode(', ', $add));
        run("CREATE TABLE IF NOT EXISTS itp_signatures (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, itp_id INT UNSIGNED NOT NULL, role VARCHAR(20) NOT NULL, user_id INT UNSIGNED NULL,
            signer_name VARCHAR(120) NOT NULL DEFAULT '', image MEDIUMTEXT NULL, auto_applied TINYINT(1) NOT NULL DEFAULT 0, signed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY one_signature (itp_id, role), FOREIGN KEY (itp_id) REFERENCES itp_requests(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        run("CREATE TABLE IF NOT EXISTS itp_events (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, itp_id INT UNSIGNED NOT NULL, step VARCHAR(20) NOT NULL, user_id INT UNSIGNED NULL, user_name VARCHAR(120) NOT NULL DEFAULT '',
            note VARCHAR(250) NOT NULL DEFAULT '', at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX (itp_id), FOREIGN KEY (itp_id) REFERENCES itp_requests(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        run("CREATE TABLE IF NOT EXISTS it_inventory (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, item VARCHAR(160) NOT NULL, quantity INT NOT NULL DEFAULT 0, description VARCHAR(500) NOT NULL DEFAULT '',
            purchased_for VARCHAR(200) NOT NULL DEFAULT '', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        run("CREATE TABLE IF NOT EXISTS itp_stock (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, itp_id INT UNSIGNED NOT NULL, inv_id INT UNSIGNED NULL, item VARCHAR(160) NOT NULL, qty INT NOT NULL DEFAULT 1,
            description VARCHAR(500) NOT NULL DEFAULT '', purchased_for VARCHAR(200) NOT NULL DEFAULT '', INDEX (itp_id), FOREIGN KEY (itp_id) REFERENCES itp_requests(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $ok = esig_ready();
    } catch (Throwable $e) { $ok = false; }
    return $ok;
}

function itp_is_it($u) { return (bool) preg_match('/^(it|information technology)$/i', trim((string) $u['department'])); } // an account of the IT Department
function itp_is_manager($u) { return rfc_signer_of($u) === 'sherwin'; } // the IT Manager (Sherwin Greso)
function itp_is_exec($u) { return $u['role'] === 'executive'; } // an Executive approves requisitions too (at the same step as the IT Manager)
function itp_can_see($u, $r) {
    if ($u['role'] === 'admin' || (int) $r['user_id'] === (int) $u['id']) return true;
    if ($r['stage'] === 'draft') return false;
    if ((int) $r['line_manager_id'] === (int) $u['id']) return true; // the Line Manager sees it from the moment it is submitted
    return $r['stage'] !== 'linemgr' && (itp_is_exec($u) || itp_is_it($u)); // the IT Department and the Executives see it once the Line Manager approved
}
function itp_esig_of($uid) { // the e-signature picture (base64) saved in the Profile of an account, or ''
    $x = $uid ? q1('SELECT esignature FROM users WHERE id = ?', [(int) $uid]) : null;
    return $x && !empty($x['esignature']) ? $x['esignature'] : '';
}
// what the logged-in person may do with a requisition right now
function itp_flags($u, $r) {
    $st = $r['stage']; $mine = (int) $r['user_id'] === (int) $u['id']; $admin = $u['role'] === 'admin'; $it = itp_is_it($u); $mgr = itp_is_manager($u); $ex = itp_is_exec($u);
    $lm = (int) $r['line_manager_id'] === (int) $u['id'];
    $f = ['canEdit' => $st === 'draft' && ($mine || $admin), 'canSubmit' => $st === 'draft' && $mine, 'canDelete' => ($st === 'draft' && $mine) || $admin,
        'canLmDecide' => $st === 'linemgr' && $lm,
        'canAssess' => $st === 'assessment' && $it && !$mgr && !$mine,
        'canApprove' => in_array($st, ['approval', 'stock_approval'], true) && ($mgr || $ex), 'canReturn' => in_array($st, ['approval', 'stock_approval'], true) && ($mgr || $ex),
        'canPo' => $st === 'approved' && ($mgr || $ex || $admin), 'canReceive' => $st === 'po' && ($mgr || $ex || $admin),
        'canRelease' => $st === 'releasing' && ($it || $admin), 'canClose' => in_array($st, ['received', 'released'], true) && ($mine || $it || $admin),
        'canPrint' => in_array($st, ['approved', 'po', 'received', 'releasing', 'released'], true) || ($st === 'closed' && $r['outcome'] !== 'invalid')];
    $f['needsMe'] = $f['canLmDecide'] || $f['canAssess'] || $f['canApprove'] || $f['canPo'] || $f['canReceive'] || $f['canRelease'] || $f['canClose'];
    return $f;
}
function itp_ev($id, $step, $u, $note = '') { run('INSERT INTO itp_events (itp_id, step, user_id, user_name, note) VALUES (?, ?, ?, ?, ?)', [(int) $id, $step, $u ? (int) $u['id'] : null, $u ? $u['name'] : '', mb_substr((string) $note, 0, 250)]); }

function itp_out($u) {
    if (!itp_ready()) throw new Exception('IT Procurement Requisition is not ready.');
    $it = itp_is_it($u);
    $me0 = (int) $u['id'];
    if ($u['role'] === 'admin') $rows = q('SELECT * FROM itp_requests ORDER BY id DESC LIMIT 300');
    else $rows = q("SELECT * FROM itp_requests WHERE user_id = ? OR (stage <> 'draft' AND line_manager_id = ?)" . ($it || itp_is_exec($u) ? " OR stage NOT IN ('draft', 'linemgr')" : '') . ' ORDER BY id DESC LIMIT 300', [$me0, $me0]);
    $items = []; $sigs = []; $stock = []; $events = [];
    if ($rows) {
        $in = implode(',', array_map('intval', array_column($rows, 'id')));
        foreach (q("SELECT * FROM itp_items WHERE itp_id IN ($in) ORDER BY sort_order, id") as $i) {
            $items[$i['itp_id']][] = ['qty' => (int) $i['qty'], 'unit' => $i['unit'], 'description' => $i['description'], 'budgetedPrice' => (float) $i['budgeted_price']];
        }
        foreach (q("SELECT * FROM itp_stock WHERE itp_id IN ($in) ORDER BY id") as $k) $stock[$k['itp_id']][] = ['invId' => $k['inv_id'] ? s($k['inv_id']) : '', 'item' => $k['item'], 'qty' => (int) $k['qty'], 'description' => $k['description'], 'purchasedFor' => $k['purchased_for']];
        foreach (q("SELECT itp_id, step, user_name, note, at FROM itp_events WHERE itp_id IN ($in) ORDER BY id") as $e) $events[$e['itp_id']][] = ['step' => $e['step'], 'who' => $e['user_name'], 'note' => $e['note'], 'at' => iso($e['at'])];
        foreach (q("SELECT id, itp_id, role, signer_name, signed_at, auto_applied FROM itp_signatures WHERE itp_id IN ($in)") as $g) {
            $sigs[$g['itp_id']][$g['role']] = ['img' => 'api/esig.php?itpsig=' . (int) $g['id'], 'name' => $g['signer_name'], 'at' => iso($g['signed_at']), 'auto' => (bool) $g['auto_applied']];
        }
    }
    $me = q1('SELECT supervisor_id FROM users WHERE id = ?', [(int) $u['id']]);
    $sup = $me && $me['supervisor_id'] ? q1("SELECT id, name FROM users WHERE id = ? AND status = 'Active'", [(int) $me['supervisor_id']]) : null;
    $mgrs = array_map(function ($x) { return ['id' => s($x['id']), 'name' => $x['name']]; }, q("SELECT id, name FROM users WHERE status = 'Active' AND role IN ('superior', 'executive', 'admin') AND id <> ? ORDER BY name", [(int) $u['id']]));
    $reqs = array_map(function ($r) use ($items, $sigs, $stock, $events, $u) {
        $fl = itp_flags($u, $r);
        return ['id' => s($r['id']), 'ownerId' => $r['user_id'] ? s($r['user_id']) : '', 'owner' => $r['owner_name'],
            'dateOfRequest' => $r['date_of_request'] ?: '', 'dateRequired' => $r['date_required'] ?: '', 'department' => $r['department'],
            'requestedBy' => $r['requested_by'], 'notedBy' => $r['noted_by'], 'subsidiary' => $r['subsidiary'],
            'chargeable' => $r['chargeable'], 'chargeableTo' => $r['chargeable_to'], 'budget' => $r['budget'], 'budgetAmount' => $r['budget_amount'] === null ? '' : (float) $r['budget_amount'],
            'nature' => $r['nature'], 'natureOther' => $r['nature_other'], 'specialInstructions' => (string) $r['special_instructions'], 'purpose' => (string) $r['purpose'],
            'assignee' => $r['assignee'], 'requestorName' => $r['requestor_name'], 'lineManagerName' => $r['line_manager_name'], 'lineManagerId' => $r['line_manager_id'] ? s($r['line_manager_id']) : '', 'itStaffName' => $r['it_staff_name'],
            'stage' => $r['stage'], 'stageLabel' => $r['stage'] === 'closed' && $r['outcome'] === 'invalid' ? 'Closed: invalid' : ITP_STAGES[$r['stage']], 'closed' => $r['stage'] === 'closed', 'path' => $r['path'], 'outcome' => $r['outcome'], 'stageNote' => $r['stage_note'],
            'stock' => isset($stock[$r['id']]) ? $stock[$r['id']] : [], 'events' => isset($events[$r['id']]) ? $events[$r['id']] : [], 'assessmentUrl' => $r['assessment_url'],
            'submittedAt' => iso($r['submitted_at']), 'receivedAt' => iso($r['received_at']), 'closedAt' => iso($r['closed_at']), 'sigs' => isset($sigs[$r['id']]) ? $sigs[$r['id']] : new stdClass(), 'flags' => $fl,
            'total' => (float) $r['total'], 'createdAt' => iso($r['created_at']), 'items' => isset($items[$r['id']]) ? $items[$r['id']] : []];
    }, $rows);
    $inv = $it || $u['role'] === 'admin' ? array_map(function ($x) { return ['id' => s($x['id']), 'item' => $x['item'], 'qty' => (int) $x['quantity'], 'description' => $x['description'], 'purchasedFor' => $x['purchased_for']]; }, q('SELECT * FROM it_inventory ORDER BY item, id')) : [];
    return ['inventory' => $inv, 'canInventory' => $it || $u['role'] === 'admin', 'itManager' => ITP_IT_MANAGER, 'isIt' => $it, 'isExec' => itp_is_exec($u), 'myManager' => $sup ? ['id' => s($sup['id']), 'name' => $sup['name']] : null, 'lineManagers' => $mgrs,
        'pending' => count(array_filter($reqs, function ($x) { return $x['flags']['needsMe']; })), 'requests' => $reqs];
}
