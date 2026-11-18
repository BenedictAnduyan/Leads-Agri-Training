<?php
// Request for Check actions (save, delete). Every signed-in account may use it; a person can change only their own requests, the admin any.
// Signatures: the lines are e-signed in order (Requested by, then Recommended by, then Approved by) with the "sign" action, using the e-signature each person saved in their Profile.
// The name in Employee information and in Requested by is always the account that made the request. Any other name is signed by hand on the printed form.
// Changing a saved request clears its e-signatures.
// Header logo: one of the saved company logos (RFC_LOGOS in rfc_lib.php), one the person uploaded earlier (saved in their own list: logo_add / logo_del / mylogo), or none. The picture is copied into the request (action=logo sends it to the browser).
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

// the uploaded logo: a data URL (png, jpg, webp or gif, at most 2 MB) -> [base64, mime]; anything else is refused (no SVG, so no scripts can be hidden in it)
function rfc_logo_clean($v) {
    if (!is_string($v) || !preg_match('#^data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$#', $v, $m)) fail(400, 'The logo must be a PNG, JPG, WEBP or GIF picture.');
    $b64 = preg_replace('/\s+/', '', $m[2]); $bin = base64_decode($b64, true);
    if ($bin === false || $bin === '') fail(400, 'The logo picture could not be read. Choose the file again.');
    if (strlen($bin) > 2000000) fail(400, 'The logo is too big (at most 2 MB).');
    $g = @getimagesizefromstring($bin);
    if (!$g || !in_array($g['mime'], ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], true) || $g[0] > 4000 || $g[1] > 4000) fail(400, 'The logo must be a PNG, JPG, WEBP or GIF picture of at most 4000 x 4000 pixels.');
    return [base64_encode($bin), $g['mime']];
}

switch ($action) {

case 'save': // add a request, or change one (the whole form is sent at once)
    $id = (int) (isset($in['id']) ? $in['id'] : 0);
    $old = $id ? rfc_mine($id) : null;
    $ownerName = $old ? ($old['owner_name'] !== '' ? $old['owner_name'] : $me['name']) : $me['name']; // fixed: the one who made the request (the admin editing it does not change it)
    $reason = isset($in['reason']) ? $in['reason'] : '';
    if (!in_array($reason, RFC_REASONS, true)) fail(400, 'Choose the reason for the check.');
    $f = [
        'employee_name' => $ownerName, 'account_number' => rfc_text('accountNumber', 60, 'the account number'),
        'vendor_name' => rfc_text('vendorName', 200, 'the vendor / payee name', true), 'vendor_address' => rfc_text('vendorAddress', 300, 'the address'), 'vendor_tin' => rfc_text('vendorTin', 40, 'the TIN'),
        'date_needed' => rfc_date('dateNeeded', 'the date the check is needed'), 'date_of_check' => rfc_date('dateOfCheck', 'the date of the check'),
        'reason' => $reason, 'purpose' => rfc_text('purpose', 3000, 'the purpose'), 'note' => rfc_text('note', 300, 'the note'), 'instructions' => rfc_text('instructions', 1000, 'the special instructions'),
        'requested_by' => $ownerName, 'recommended_by' => rfc_text('recommendedBy', 240, 'the recommended by names'), 'approved_by' => rfc_text('approvedBy', 120, 'the name of the approver'),
        'requested_date' => rfc_date('requestedDate', 'Requested by'), 'recommended_date' => rfc_date('recommendedDate', 'Recommended by'), 'approved_date' => rfc_date('approvedDate', 'Approved by'),
    ];
    // Only the admin chooses or uploads the header logo. For everybody else the logo of a saved request is left as it is (a new request has none), whatever the browser sends.
    if ($me['role'] === 'admin') {
        // the header logo: '' = none, a key of RFC_LOGOS, my<id> (one of the logos this person saved), or 'custom' (the picture already kept with this request)
        // A chosen saved logo is copied into the request, so deleting it from the saved list later never changes forms that already use it.
        $logoKey = isset($in['logoKey']) ? (string) $in['logoKey'] : ''; $mine = null;
        if (preg_match('/^my(\d+)$/', $logoKey, $mm)) {
            $mine = rfc_mylogo_ready() ? q1('SELECT data, mime FROM rfc_user_logos WHERE id = ? AND user_id = ?', [(int) $mm[1], (int) $me['id']]) : null;
            if (!$mine) fail(400, 'That saved logo was not found. Choose another one.');
            $logoKey = 'custom';
        } elseif ($logoKey !== '' && $logoKey !== 'custom' && !isset(RFC_LOGOS[$logoKey])) fail(400, 'Choose one of the saved logos, or upload your own.');
        if (rfc_logo_ready()) {
            $f['logo_key'] = $logoKey; $f['logo_data'] = null; $f['logo_mime'] = '';
            if ($logoKey === 'custom') {
                if ($mine) { $f['logo_data'] = $mine['data']; $f['logo_mime'] = $mine['mime']; }
                elseif (!empty($in['logoData'])) { $lg = rfc_logo_clean($in['logoData']); $f['logo_data'] = $lg[0]; $f['logo_mime'] = $lg[1]; }
                elseif ($old && isset($old['logo_key']) && $old['logo_key'] === 'custom' && !empty($old['logo_data'])) { $f['logo_data'] = $old['logo_data']; $f['logo_mime'] = $old['logo_mime']; }
                else fail(400, 'Choose a logo, or upload one.');
            }
        } elseif ($logoKey !== '') fail(500, 'The logo could not be saved. Check that MySQL allows changing the table rfc_requests.');
    }
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
    if ($old && rfc_sig_ready()) run('DELETE FROM rfc_signatures WHERE rfc_id = ?', [$id]); // the form was changed, so the e-signatures on it are cleared and must be added again
    db()->commit();
    // tell the people whose turn it is (right after saving nobody has signed yet, so these are the first lines in the signing order)
    if (rfc_sig_ready()) {
        $row = q1('SELECT * FROM rfc_requests WHERE id = ?', [$id]); $told = [];
        foreach (rfc_steps($row, []) as $st) {
            if (!$st['ready']) continue;
            $acct = rfc_user_of($st['key']); if (!$acct || (int) $acct['id'] === (int) $me['id'] || isset($told[$acct['id']])) continue;
            $told[$acct['id']] = true;
            add_note($acct['id'], 'Signature needed: RFC #' . str_pad($id, 4, '0', STR_PAD_LEFT), mb_substr(($old ? 'The request for ' : 'New request for ') . $f['vendor_name'] . ' (' . RFC_SLOT_LABEL[$st['slot']] . ')' . ($old ? ' was changed' : '') . ' needs your e-signature. Open Request for Check > For Signing.', 0, 250));
        }
    }
    out(['id' => s($id)]);

case 'exec_approve': // an Executive approves a request: they take the Approved by line (if nobody has signed it yet) and sign it with their own e-signature, once the lines before it are signed
    if ($me['role'] !== 'executive') fail(403, 'Only an Executive can approve a request this way.');
    if (!rfc_sig_ready()) fail(500, 'E-signing is not set up yet. Check that the table rfc_signatures exists (sql/schema.sql).');
    $r = q1('SELECT * FROM rfc_requests WHERE id = ?', [(int) (isset($in['id']) ? $in['id'] : 0)]);
    if (!$r) fail(404, 'Request not found.');
    $ek = rfc_key_of($me);
    if (!isset(rfc_signers()[$ek])) fail(400, 'Your account could not be matched to a signer name. Ask the admin to check your account name.');
    if (q1("SELECT id FROM rfc_signatures WHERE rfc_id = ? AND slot = 'approved'", [(int) $r['id']])) fail(400, 'This request was already approved.');
    $before = array_values(array_filter(rfc_steps($r, q('SELECT id, rfc_id, signer_key, slot, user_id, signer_name, signed_at FROM rfc_signatures WHERE rfc_id = ?', [(int) $r['id']])), function ($x) { return $x['slot'] !== 'approved' && !$x['signed']; }));
    if ($before) fail(409, 'The lines before Approved by must be signed first. Waiting for ' . implode(', ', array_map(function ($x) { return $x['name'] . ' (' . RFC_SLOT_LABEL[$x['slot']] . ')'; }, $before)) . '.');
    if (!rfc_has_name($r['approved_by'], $ek)) { // the executive replaces the name on the Approved by line (the earlier lines keep their e-signatures)
        run('UPDATE rfc_requests SET approved_by = ? WHERE id = ?', [rfc_signers()[$ek]['name'], (int) $r['id']]);
        log_activity($me['name'] . ' took the Approved by line of RFC #' . str_pad($r['id'], 4, '0', STR_PAD_LEFT) . ' as Executive' . ($r['approved_by'] !== '' ? ' (was: ' . $r['approved_by'] . ')' : '') . '.');
    }
    // continues below: the same e-signing steps as every other signer (order is checked there)

case 'sign': // adds the e-signature of one person to every line of the request that carries their name and whose turn it is
    if (!rfc_sig_ready()) fail(500, 'E-signing is not set up yet. Check that the table rfc_signatures exists (sql/schema.sql).');
    $own = rfc_key_of($me); $admin = $me['role'] === 'admin';
    $key = $admin && isset($in['key']) && $in['key'] !== '' ? (string) $in['key'] : $own; // the admin may sign any line; everybody else only their own
    $r = q1('SELECT * FROM rfc_requests WHERE id = ?', [(int) (isset($in['id']) ? $in['id'] : 0)]);
    if (!$r) fail(404, 'Request not found.');
    $sigs = q('SELECT id, rfc_id, signer_key, slot, user_id, signer_name, signed_at FROM rfc_signatures WHERE rfc_id = ?', [(int) $r['id']]);
    $steps = rfc_steps($r, $sigs);
    $mine = array_values(array_filter($steps, function ($x) use ($key) { return $x['key'] === $key; }));
    if (!$mine) fail(403, 'This account is not on a signature line of this request.');
    $todo = array_values(array_filter($mine, function ($x) { return $x['ready']; }));
    if (!$todo) {
        $left = array_values(array_filter($mine, function ($x) { return !$x['signed']; }));
        if (!$left) fail(400, 'This request is already signed.');
        fail(409, 'It is not your turn yet. Waiting for ' . $left[0]['waitingFor'] . ' to sign first.');
    }
    // the picture: the e-signature saved in the Profile of the signer, else the old picture file of a fixed signer
    $acct = $key === $own ? ['id' => $me['id']] : rfc_acct($key); $b64 = '';
    if ($acct && esig_ready()) { $x = q1('SELECT esignature FROM users WHERE id = ?', [(int) $acct['id']]); if ($x && !empty($x['esignature'])) $b64 = $x['esignature']; }
    if ($b64 === '' && rfc_has_file($key)) $b64 = base64_encode(file_get_contents(__DIR__ . '/../' . rfc_signers()[$key]['img']));
    if ($b64 === '') fail(400, $key === $own ? 'Add your e-signature in Profile first, then sign again.' : $todo[0]['name'] . ' has not added an e-signature in Profile yet.');
    $by = $admin && $key !== $own ? ' (added by ' . $me['name'] . ')' : '';
    $withImg = rfc_img_ready();
    foreach ($todo as $st) {
        if ($withImg) run('INSERT IGNORE INTO rfc_signatures (rfc_id, signer_key, slot, user_id, signer_name, image) VALUES (?, ?, ?, ?, ?, ?)', [(int) $r['id'], $key, $st['slot'], (int) $me['id'], $st['name'], $b64]);
        else run('INSERT IGNORE INTO rfc_signatures (rfc_id, signer_key, slot, user_id, signer_name) VALUES (?, ?, ?, ?, ?)', [(int) $r['id'], $key, $st['slot'], (int) $me['id'], $st['name']]);
    }
    $no = 'RFC #' . str_pad($r['id'], 4, '0', STR_PAD_LEFT);
    log_activity($todo[0]['name'] . ' e-signed ' . $no . ' for ' . $r['vendor_name'] . $by . '.');
    $after = rfc_steps($r, q('SELECT id, rfc_id, signer_key, slot, user_id, signer_name, signed_at FROM rfc_signatures WHERE rfc_id = ?', [(int) $r['id']]));
    $was = []; foreach ($steps as $st) $was[$st['key'] . '|' . $st['slot']] = $st['ready'];
    $closed = count(array_filter($after, function ($x) { return !$x['signed']; })) === 0; $told = [];
    foreach ($after as $st) { // tell the next signers that it is their turn now
        if (!$st['ready'] || !empty($was[$st['key'] . '|' . $st['slot']])) continue;
        $a2 = rfc_user_of($st['key']); if (!$a2 || (int) $a2['id'] === (int) $me['id'] || isset($told[$a2['id']])) continue;
        $told[$a2['id']] = true;
        add_note($a2['id'], 'Signature needed: ' . $no, mb_substr('The request for ' . $r['vendor_name'] . ' (' . RFC_SLOT_LABEL[$st['slot']] . ') is ready for your e-signature. Open Request for Check > For Signing.', 0, 250));
    }
    if ($r['user_id'] && (int) $r['user_id'] !== (int) $me['id']) add_note($r['user_id'], 'RFC signed: ' . $no, mb_substr($todo[0]['name'] . ' added an e-signature to your request for ' . $r['vendor_name'] . '.' . ($closed ? ' All e-signatures are complete.' : ''), 0, 250));
    out(['ok' => true, 'closed' => $closed]);

case 'logo': // sends the uploaded logo of one request (only people who can see that request)
    $r = q1('SELECT * FROM rfc_requests WHERE id = ?', [(int) (isset($_GET['id']) ? $_GET['id'] : 0)]);
    if (!$r || !rfc_can_see($me, $r)) fail(404, 'No logo.');
    if (!rfc_logo_ready() || $r['logo_key'] !== 'custom' || empty($r['logo_data'])) fail(404, 'No logo.');
    $mime = in_array($r['logo_mime'], ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], true) ? $r['logo_mime'] : 'image/png';
    header('Content-Type: ' . $mime); header('X-Content-Type-Options: nosniff'); header('Cache-Control: private, max-age=86400');
    echo base64_decode($r['logo_data']); exit;

case 'logo_add': // saves an uploaded logo in the person's own list of saved logos (it is then chosen on the form)
    if ($me['role'] !== 'admin') fail(403, 'Only the admin can manage the header logos.');
    if (!rfc_mylogo_ready()) fail(500, 'The logo could not be saved. Check that MySQL allows creating tables.');
    $lg = rfc_logo_clean(isset($in['data']) ? $in['data'] : '');
    $name = mb_substr(trim(preg_replace('/\s+/', ' ', (string) (isset($in['name']) ? $in['name'] : ''))), 0, 80); if ($name === '') $name = 'My logo';
    if ((int) q1('SELECT COUNT(*) AS n FROM rfc_user_logos WHERE user_id = ?', [(int) $me['id']])['n'] >= 30) fail(400, 'You can keep at most 30 saved logos. Delete one first.');
    run('INSERT INTO rfc_user_logos (user_id, name, mime, data) VALUES (?, ?, ?, ?)', [(int) $me['id'], $name, $lg[1], $lg[0]]);
    out(['id' => last_id(), 'key' => 'my' . last_id()]);

case 'logo_del': // removes one of the person's saved logos (forms that already use it keep their own copy)
    if ($me['role'] !== 'admin') fail(403, 'Only the admin can manage the header logos.');
    if (rfc_mylogo_ready()) run('DELETE FROM rfc_user_logos WHERE id = ? AND user_id = ?', [(int) (isset($in['id']) ? $in['id'] : 0), (int) $me['id']]);
    out(['ok' => true]);

case 'mylogo': // sends one saved logo of the person (only its owner)
    if ($me['role'] !== 'admin') fail(403, 'Only the admin can manage the header logos.');
    $g = rfc_mylogo_ready() ? q1('SELECT mime, data FROM rfc_user_logos WHERE id = ? AND user_id = ?', [(int) (isset($_GET['id']) ? $_GET['id'] : 0), (int) $me['id']]) : null;
    if (!$g) fail(404, 'No logo.');
    header('Content-Type: ' . (in_array($g['mime'], ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], true) ? $g['mime'] : 'image/png')); header('X-Content-Type-Options: nosniff'); header('Cache-Control: private, max-age=86400');
    echo base64_decode($g['data']); exit;

case 'delete':
    $r = rfc_mine(isset($in['id']) ? $in['id'] : 0);
    run('DELETE FROM rfc_requests WHERE id = ?', [(int) $r['id']]); // its items go with it
    out(['ok' => true]);
}
fail(404, 'Unknown action.');
