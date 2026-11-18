<?php
// IT Procurement Requisition: the data sent to the browser. Everyone signed in can use it:
// an employee / immediate superior sees and edits their own requisitions, the admin sees all of them.
// The form follows a fixed process (stage):
//   draft       the requestor fills in the form and saves it
//   assessment  submitted: the requestor's e-signature and the Line Manager's e-signature are on the form; another IT Department employee attaches the assessment link
//   approval    the IT employee's e-signature is on the form; the IT Manager (Sherwin Greso) checks the assessment and approves (or returns it)
//   approved    the IT Manager's e-signature is on the form; the requestor can print it and give it to the PO (outside the system)
//   received    an IT Department account marked the item as received
//   closed      an IT Department account closed the form (it moves to the Closed list)
// Every e-signature comes from the picture saved in the Profile of that person. The tables are extended automatically (see itp_ready), no SQL file has to be imported.
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/rfc_lib.php'; // rfc_signer_of, rfc_user_of, esig functions

const ITP_NATURES = ['Equipment', 'License', 'Repair', 'Maintenance', 'Software', 'Others'];
const ITP_IT_MANAGER = 'Sherwin Greso'; // the IT Manager on every form. It is a constant: it is never read from the browser and never saved.
const ITP_STAGES = ['draft' => 'Draft', 'assessment' => 'For IT assessment', 'approval' => 'For IT Manager approval', 'approved' => 'Approved', 'received' => 'Item received', 'closed' => 'Closed'];

function itp_ready() { // adds the new columns and the signature table when they are missing
    static $ok = null;
    if ($ok !== null) return $ok;
    try {
        $cols = array_column(q('SHOW COLUMNS FROM itp_requests'), 'Field'); $add = [];
        $want = ['stage' => "VARCHAR(20) NOT NULL DEFAULT 'draft'", 'line_manager_id' => 'INT UNSIGNED NULL', 'assessment_url' => "VARCHAR(500) NOT NULL DEFAULT ''", 'assessed_by' => 'INT UNSIGNED NULL',
            'submitted_at' => 'DATETIME NULL', 'received_at' => 'DATETIME NULL', 'closed_at' => 'DATETIME NULL'];
        foreach ($want as $c => $def) if (!in_array($c, $cols, true)) $add[] = 'ADD COLUMN ' . $c . ' ' . $def;
        if ($add) run('ALTER TABLE itp_requests ' . implode(', ', $add));
        run("CREATE TABLE IF NOT EXISTS itp_signatures (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, itp_id INT UNSIGNED NOT NULL, role VARCHAR(20) NOT NULL, user_id INT UNSIGNED NULL,
            signer_name VARCHAR(120) NOT NULL DEFAULT '', image MEDIUMTEXT NULL, auto_applied TINYINT(1) NOT NULL DEFAULT 0, signed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY one_signature (itp_id, role), FOREIGN KEY (itp_id) REFERENCES itp_requests(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $ok = esig_ready();
    } catch (Throwable $e) { $ok = false; }
    return $ok;
}

function itp_is_it($u) { return (bool) preg_match('/^(it|information technology)$/i', trim((string) $u['department'])); } // an account of the IT Department
function itp_is_manager($u) { return rfc_signer_of($u) === 'sherwin'; } // the IT Manager (Sherwin Greso)
function itp_can_see($u, $r) {
    if ($u['role'] === 'admin' || (int) $r['user_id'] === (int) $u['id']) return true;
    return $r['stage'] !== 'draft' && (itp_is_it($u) || (int) $r['line_manager_id'] === (int) $u['id']);
}
function itp_esig_of($uid) { // the e-signature picture (base64) saved in the Profile of an account, or ''
    $x = $uid ? q1('SELECT esignature FROM users WHERE id = ?', [(int) $uid]) : null;
    return $x && !empty($x['esignature']) ? $x['esignature'] : '';
}
// what the logged-in person may do with a requisition right now
function itp_flags($u, $r) {
    $st = $r['stage']; $mine = (int) $r['user_id'] === (int) $u['id']; $admin = $u['role'] === 'admin'; $it = itp_is_it($u); $mgr = itp_is_manager($u);
    $f = ['canEdit' => $st === 'draft' && ($mine || $admin), 'canSubmit' => $st === 'draft' && $mine, 'canDelete' => ($st === 'draft' && $mine) || $admin,
        'canAssess' => $st === 'assessment' && $it && !$mgr && !$mine, 'canApprove' => $st === 'approval' && $mgr, 'canReturn' => $st === 'approval' && $mgr,
        'canReceive' => $st === 'approved' && ($it || $admin), 'canClose' => $st === 'received' && ($it || $admin), 'canPrint' => in_array($st, ['approved', 'received', 'closed'], true)];
    $f['needsMe'] = $f['canAssess'] || $f['canApprove'] || $f['canReceive'] || $f['canClose'];
    return $f;
}

function itp_out($u) {
    if (!itp_ready()) throw new Exception('IT Procurement Requisition is not ready.');
    $it = itp_is_it($u);
    if ($u['role'] === 'admin') $rows = q('SELECT * FROM itp_requests ORDER BY id DESC LIMIT 300');
    else $rows = q("SELECT * FROM itp_requests WHERE user_id = ? OR (stage <> 'draft' AND (line_manager_id = ?" . ($it ? ' OR 1 = 1' : '') . ')) ORDER BY id DESC LIMIT 300', [(int) $u['id'], (int) $u['id']]);
    $items = []; $sigs = [];
    if ($rows) {
        $in = implode(',', array_map('intval', array_column($rows, 'id')));
        foreach (q("SELECT * FROM itp_items WHERE itp_id IN ($in) ORDER BY sort_order, id") as $i) {
            $items[$i['itp_id']][] = ['qty' => (int) $i['qty'], 'unit' => $i['unit'], 'description' => $i['description'], 'budgetedPrice' => (float) $i['budgeted_price']];
        }
        foreach (q("SELECT id, itp_id, role, signer_name, signed_at, auto_applied FROM itp_signatures WHERE itp_id IN ($in)") as $g) {
            $sigs[$g['itp_id']][$g['role']] = ['img' => 'api/esig.php?itpsig=' . (int) $g['id'], 'name' => $g['signer_name'], 'at' => iso($g['signed_at']), 'auto' => (bool) $g['auto_applied']];
        }
    }
    $me = q1('SELECT supervisor_id FROM users WHERE id = ?', [(int) $u['id']]);
    $sup = $me && $me['supervisor_id'] ? q1("SELECT id, name FROM users WHERE id = ? AND status = 'Active'", [(int) $me['supervisor_id']]) : null;
    $mgrs = array_map(function ($x) { return ['id' => s($x['id']), 'name' => $x['name']]; }, q("SELECT id, name FROM users WHERE status = 'Active' AND role IN ('superior', 'admin') AND id <> ? ORDER BY name", [(int) $u['id']]));
    $reqs = array_map(function ($r) use ($items, $sigs, $u) {
        $fl = itp_flags($u, $r);
        return ['id' => s($r['id']), 'ownerId' => $r['user_id'] ? s($r['user_id']) : '', 'owner' => $r['owner_name'],
            'dateOfRequest' => $r['date_of_request'] ?: '', 'dateRequired' => $r['date_required'] ?: '', 'department' => $r['department'],
            'requestedBy' => $r['requested_by'], 'notedBy' => $r['noted_by'], 'subsidiary' => $r['subsidiary'],
            'chargeable' => $r['chargeable'], 'chargeableTo' => $r['chargeable_to'], 'budget' => $r['budget'], 'budgetAmount' => $r['budget_amount'] === null ? '' : (float) $r['budget_amount'],
            'nature' => $r['nature'], 'natureOther' => $r['nature_other'], 'specialInstructions' => (string) $r['special_instructions'], 'purpose' => (string) $r['purpose'],
            'assignee' => $r['assignee'], 'requestorName' => $r['requestor_name'], 'lineManagerName' => $r['line_manager_name'], 'lineManagerId' => $r['line_manager_id'] ? s($r['line_manager_id']) : '', 'itStaffName' => $r['it_staff_name'],
            'stage' => $r['stage'], 'stageLabel' => ITP_STAGES[$r['stage']], 'closed' => $r['stage'] === 'closed', 'assessmentUrl' => $r['assessment_url'],
            'submittedAt' => iso($r['submitted_at']), 'receivedAt' => iso($r['received_at']), 'closedAt' => iso($r['closed_at']), 'sigs' => isset($sigs[$r['id']]) ? $sigs[$r['id']] : new stdClass(), 'flags' => $fl,
            'total' => (float) $r['total'], 'createdAt' => iso($r['created_at']), 'items' => isset($items[$r['id']]) ? $items[$r['id']] : []];
    }, $rows);
    return ['itManager' => ITP_IT_MANAGER, 'isIt' => $it, 'myManager' => $sup ? ['id' => s($sup['id']), 'name' => $sup['name']] : null, 'lineManagers' => $mgrs,
        'pending' => count(array_filter($reqs, function ($x) { return $x['flags']['needsMe']; })), 'requests' => $reqs];
}
