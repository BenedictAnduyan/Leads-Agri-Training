<?php
// Request for Check: the data sent to the browser. Everyone signed in can use it:
// an employee / immediate superior sees and edits their own requests, the admin sees all of them.
// E-signatures: every account can keep an e-signature picture in its Profile (see esig_lib.php). On a request the lines are signed in a fixed order:
// 1. Requested by (the account that made the request), 2. Recommended by (one or more names), 3. Approved by. A line can be signed only when every line before it is signed.
// Besides the requester, only the four fixed signers below (Jel, Sherwin, Joel, Catherine) can be chosen on the Recommended by / Approved by lines; any other name is typed and signed by hand.
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/esig_lib.php';

const RFC_REASONS = ['Reimbursement', 'Incentive', 'Sponsorship', 'Payment', 'Others'];

// The four fixed signers. 'key' must be a whole word of the printed name (Recommended by / Approved by) or of the account name,
// so "Jel Mabato" counts as Jel; an e-mail that starts with it (jelmabato@...) also marks the account.
// 'img' is an old fallback picture: it is used only when that person has not uploaded an e-signature in their Profile (put a transparent PNG with that file name in the folder img/signatures/).
// 'name' is the full name printed on the form (as on the RFC sheets: Jel Renaire V. Mabato, Sherwin Greso, Joel Caburnay, Catherine V. De Vera).
const RFC_SIGNERS = [
    'jel'       => ['name' => 'Jel Renaire V. Mabato',  'img' => 'img/signatures/jel.png'],
    'sherwin'   => ['name' => 'Sherwin Greso',          'img' => 'img/signatures/sherwin.png'],
    'joel'      => ['name' => 'Joel Caburnay',          'img' => 'img/signatures/joel.png'],
    'catherine' => ['name' => 'Catherine V. De Vera',   'img' => 'img/signatures/catherine.png'],
];
// The names a new request starts with (as on the RFC sheet). They are only suggestions: on the form each of those lines is a choice of the four people
// (their e-signature is used when they are chosen) or "Other", where any other name can be typed. The Requested by line is not a choice: it is always the account that made the request.
const RFC_DEFAULTS = ['requested' => ['jel'], 'recommended' => ['sherwin', 'joel'], 'approved' => ['catherine']];
const RFC_SLOTS = ['requested' => 'requested_by', 'recommended' => 'recommended_by', 'approved' => 'approved_by'];
const RFC_SLOT_LABEL = ['requested' => 'Requested by', 'recommended' => 'Recommended by', 'approved' => 'Approved by'];
const RFC_ORDER = ['requested', 'recommended', 'approved']; // the signing order

// Header logo of the form (above the title, like the RFC Excel sheet). The saved logos are picture files in img/logos/; to add another one, put the file there and add a line here.
// A request keeps either one of these keys, '' (no logo), or 'custom' (a picture the person uploaded on the form; it is kept with that request in rfc_requests.logo_data).
const RFC_LOGOS = [
    'malveda'    => ['name' => 'Malveda Holdings',        'file' => 'img/logos/malveda.png'],
    'farmasee'   => ['name' => 'Farmasee Agri-Tech Supplies', 'file' => 'img/logos/farmasee.png'],
    'leads-agri' => ['name' => 'Leads Agri',              'file' => 'img/logos/leads-agri.png'],
    'mpdc'       => ['name' => 'MPDC',                    'file' => 'img/logos/mpdc.png'],
];
function rfc_logo_ready() { // the three logo columns are added to rfc_requests automatically the first time (no need to import anything)
    static $ok = null;
    if ($ok === null) {
        try { q('SELECT logo_key, logo_data, logo_mime FROM rfc_requests LIMIT 1'); $ok = true; }
        catch (Throwable $e) {
            try {
                run("ALTER TABLE rfc_requests ADD COLUMN logo_key VARCHAR(30) NOT NULL DEFAULT ''");
                run('ALTER TABLE rfc_requests ADD COLUMN logo_data MEDIUMTEXT NULL');
                run("ALTER TABLE rfc_requests ADD COLUMN logo_mime VARCHAR(30) NOT NULL DEFAULT ''");
                $ok = true;
            } catch (Throwable $e2) { $ok = false; }
        }
    }
    return $ok;
}
// the columns read for the lists of requests: all of them except the uploaded logo picture itself (it can be large; the browser loads it separately with action=logo)
function rfc_cols() {
    if (!rfc_logo_ready()) return '*';
    return "id, user_id, owner_name, employee_name, account_number, vendor_name, vendor_address, vendor_tin, date_needed, date_of_check, reason, purpose, note, instructions, requested_by, recommended_by, approved_by, requested_date, recommended_date, approved_date, total, created_at, updated_at, logo_key, logo_mime, (logo_data IS NOT NULL AND logo_data <> '') AS has_logo";
}
// Saved logos of each person: every logo someone uploads on the form is kept in rfc_user_logos (the table is created automatically) and listed after the four company logos on that person's forms.
function rfc_mylogo_ready() {
    static $ok = null;
    if ($ok === null) {
        try {
            run("CREATE TABLE IF NOT EXISTS rfc_user_logos (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id INT UNSIGNED NOT NULL, name VARCHAR(80) NOT NULL DEFAULT '', mime VARCHAR(30) NOT NULL DEFAULT '', data MEDIUMTEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX (user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
            $ok = true;
        } catch (Throwable $e) { $ok = false; }
    }
    return $ok;
}
// the logos a person can choose from: the saved company logos for everybody, then the ones this person uploaded (key my<id>)
function rfc_logo_list($u = null) {
    $o = array_values(array_map(function ($k) { return ['key' => $k, 'name' => RFC_LOGOS[$k]['name'], 'url' => RFC_LOGOS[$k]['file'], 'mine' => false]; }, array_keys(RFC_LOGOS)));
    if ($u && $u['role'] === 'admin' && rfc_mylogo_ready()) foreach (q('SELECT id, name FROM rfc_user_logos WHERE user_id = ? ORDER BY id', [(int) $u['id']]) as $g)
        $o[] = ['key' => 'my' . (int) $g['id'], 'name' => $g['name'], 'url' => 'api/rfc.php?action=mylogo&id=' . (int) $g['id'], 'mine' => true, 'id' => s($g['id'])];
    return $o;
}
// the address the browser loads the logo of a saved request from ('' = no logo)
function rfc_logo_url($r) {
    $k = isset($r['logo_key']) ? (string) $r['logo_key'] : '';
    if (isset(RFC_LOGOS[$k])) return RFC_LOGOS[$k]['file'];
    if ($k === 'custom' && (!empty($r['has_logo']) || !empty($r['logo_data']))) return 'api/rfc.php?action=logo&id=' . (int) $r['id'] . '&v=' . (isset($r['updated_at']) ? (int) strtotime($r['updated_at']) : 0);
    return '';
}

// The four fixed signers plus every active Executive account (an executive approves requests for check, so they can be chosen on the Recommended by / Approved by lines
// and sign them like the fixed signers). An executive's key is the first word of the account name; an executive who already is a fixed signer (Joel) is not added twice.
function rfc_signers() {
    static $all = null;
    if ($all === null) {
        $all = RFC_SIGNERS;
        try {
            foreach (q("SELECT name FROM users WHERE role = 'executive' AND status = 'Active' ORDER BY id") as $x) {
                $w = rfc_words($x['name']); if (!$w) continue;
                $hit = false; foreach (array_keys($all) as $k) if (in_array($k, $w, true)) $hit = true;
                if (!$hit && !isset($all[$w[0]])) $all[$w[0]] = ['name' => trim($x['name']), 'img' => ''];
            }
        } catch (Throwable $e) { /* the role column is not ready yet: only the fixed signers */ }
    }
    return $all;
}
function rfc_words($text) { return preg_split('/[^a-z0-9]+/', mb_strtolower((string) $text), -1, PREG_SPLIT_NO_EMPTY); }
function rfc_has_name($text, $key) { return in_array($key, rfc_words($text), true); } // the whole word, so "Jelly" or "Joelle" are not Jel or Joel
// which of the four signers an account is (null = none): by a word of the account name, or the start of the e-mail name (jelmabato@... is Jel)
function rfc_signer_of($u) {
    $local = (string) strstr($u['email'] . '@', '@', true);
    foreach (array_keys(rfc_signers()) as $k) if (rfc_has_name($u['name'], $k) || strpos(mb_strtolower($local), $k) === 0) return $k;
    return null;
}
// the signer key of an account: jel, sherwin, joel, catherine, or u + the account number for every other account
function rfc_key_of($u) { $k = rfc_signer_of($u); return $k ? $k : 'u' . (int) $u['id']; }

// every account (id, name, e-mail, status and whether it has an e-signature), read once per request
function rfc_accounts() {
    static $a = null;
    if ($a === null) {
        $a = ['byId' => [], 'byKey' => []];
        $rows = esig_ready()
            ? q('SELECT id, name, email, status, (esignature IS NOT NULL AND esignature <> \'\') AS has_sig, esignature_at FROM users ORDER BY id')
            : q('SELECT id, name, email, status, 0 AS has_sig, NULL AS esignature_at FROM users ORDER BY id');
        foreach ($rows as $u) {
            $u['has_sig'] = !empty($u['has_sig']);
            $a['byId'][(int) $u['id']] = $u;
            if ($u['status'] === 'Active') { $k = rfc_signer_of($u); if ($k && !isset($a['byKey'][$k])) $a['byKey'][$k] = $u; }
        }
    }
    return $a;
}
function rfc_acct($key) { // the account behind a signer key (null when there is none)
    $a = rfc_accounts();
    if (preg_match('/^u(\d+)$/', (string) $key, $m)) return isset($a['byId'][(int) $m[1]]) ? $a['byId'][(int) $m[1]] : null;
    return isset($a['byKey'][$key]) ? $a['byKey'][$key] : null;
}
// the active account of a signer (to notify), or null when no account has been created for that person yet
function rfc_user_of($key) { $a = rfc_acct($key); return $a && $a['status'] === 'Active' ? $a : null; }
function rfc_has_file($key) { $g = rfc_signers(); return isset($g[$key]) && $g[$key]['img'] !== '' && is_file(__DIR__ . '/../' . $g[$key]['img']); }
// the picture that is added when this person signs now: the e-signature from their Profile, else the old picture file of a fixed signer, else '' (they must upload one first)
function rfc_img_url($key) {
    $a = rfc_acct($key);
    if ($a && $a['has_sig']) return 'api/esig.php?user=' . (int) $a['id'] . '&v=' . ($a['esignature_at'] ? (int) strtotime($a['esignature_at']) : 0);
    return rfc_has_file($key) ? rfc_signers()[$key]['img'] : '';
}
// whether this account may see a request (and so the e-signatures on it): the admin, the one who made it, and the signers whose name is on it
function rfc_can_see($u, $r) {
    if ($u['role'] === 'admin' || $u['role'] === 'executive' || (int) $r['user_id'] === (int) $u['id']) return true; // the admin and the executives (who approve requests) see every request
    $key = rfc_key_of($u);
    return rfc_has_name($r['recommended_by'], $key) || rfc_has_name($r['approved_by'], $key);
}

function rfc_default_text($slot) { return implode(' | ', array_map(function ($k) { return RFC_SIGNERS[$k]['name']; }, RFC_DEFAULTS[$slot])); }
function rfc_sig_ready() { // false until the table rfc_signatures exists (see sql/schema.sql); the rest of Request for Check keeps working
    static $ok = null;
    if ($ok === null) { try { q('SELECT 1 FROM rfc_signatures LIMIT 1'); $ok = true; } catch (Throwable $e) { $ok = false; } }
    return $ok;
}
function rfc_img_ready() { // each e-signature keeps its own copy of the picture, so changing the Profile picture later does not change forms that were already signed (the column is added automatically)
    static $ok = null;
    if ($ok === null) {
        try { q('SELECT image FROM rfc_signatures LIMIT 1'); $ok = true; }
        catch (Throwable $e) { try { run('ALTER TABLE rfc_signatures ADD COLUMN image MEDIUMTEXT NULL'); $ok = true; } catch (Throwable $e2) { $ok = false; } }
    }
    return $ok;
}

// the signature lines of a request that an e-signature can go on: the one who made it (Requested by) and every fixed signer named on Recommended by / Approved by
function rfc_entries($r) {
    $o = [];
    if (!empty($r['user_id'])) {
        $a = rfc_accounts(); $own = isset($a['byId'][(int) $r['user_id']]) ? $a['byId'][(int) $r['user_id']] : null;
        if ($own) $o[] = ['key' => rfc_key_of($own), 'slot' => 'requested', 'name' => $r['owner_name'] !== '' ? $r['owner_name'] : $own['name']];
    }
    foreach (['recommended', 'approved'] as $slot) foreach (rfc_signers() as $key => $sg) if (rfc_has_name($r[RFC_SLOTS[$slot]], $key)) $o[] = ['key' => $key, 'slot' => $slot, 'name' => $sg['name']];
    return $o;
}
// the lines in signing order, each with: signed, when, and ready (every line before it is signed, so it may be signed now) and who it is still waiting for
function rfc_steps($r, $sigs) {
    $done = [];
    foreach ($sigs as $g) $done[$g['signer_key'] . '|' . $g['slot']] = $g;
    $E = rfc_entries($r); $steps = [];
    foreach (RFC_ORDER as $slot) foreach ($E as $e) if ($e['slot'] === $slot) {
        $g = isset($done[$e['key'] . '|' . $slot]) ? $done[$e['key'] . '|' . $slot] : null;
        $steps[] = $e + ['signed' => (bool) $g, 'at' => $g ? iso($g['signed_at']) : null, 'sigId' => $g ? s($g['id']) : ''];
    }
    $rank = array_flip(RFC_ORDER);
    foreach ($steps as $i => $st) {
        $wait = [];
        foreach ($steps as $p) if (!$p['signed'] && $rank[$p['slot']] < $rank[$st['slot']]) $wait[] = $p['name'] . ' (' . RFC_SLOT_LABEL[$p['slot']] . ')';
        $steps[$i]['ready'] = !$st['signed'] && !$wait;
        $steps[$i]['waitingFor'] = $st['signed'] ? '' : implode(', ', array_values(array_unique($wait)));
        $steps[$i]['img'] = $steps[$i]['ready'] ? rfc_img_url($st['key']) : '';
    }
    return $steps;
}

// names of active accounts, for the "add a user" suggestions of an item (name, department and position only)
function rfc_people() {
    return array_map(function ($p) { return ['name' => $p['name'], 'detail' => trim($p['department'] . ($p['department'] !== '' && $p['job_title'] !== '' ? ' | ' : '') . $p['job_title'])]; },
        q("SELECT name, department, job_title FROM users WHERE status = 'Active' ORDER BY name"));
}

// turns request rows into the objects the browser uses (items, e-signatures, and the signing order with who still has to sign)
function rfc_pack($rows) {
    if (!$rows) return [];
    $in = implode(',', array_map('intval', array_column($rows, 'id')));
    $items = []; $sigs = [];
    foreach (q("SELECT * FROM rfc_items WHERE rfc_id IN ($in) ORDER BY sort_order, id") as $i) {
        $users = json_decode((string) $i['users_json'], true);
        $items[$i['rfc_id']][] = ['name' => $i['name'], 'units' => (int) $i['units'], 'amount' => (float) $i['amount'], 'users' => is_array($users) ? $users : []];
    }
    if (rfc_sig_ready()) foreach (q("SELECT id, rfc_id, signer_key, slot, user_id, signer_name, signed_at FROM rfc_signatures WHERE rfc_id IN ($in) ORDER BY id") as $g) $sigs[$g['rfc_id']][] = $g;
    return array_map(function ($r) use ($items, $sigs) {
        $mine = isset($sigs[$r['id']]) ? $sigs[$r['id']] : [];
        $steps = rfc_steps($r, $mine);
        $signedN = count(array_filter($steps, function ($x) { return $x['signed']; }));
        $signatures = [];
        foreach ($steps as $st) if ($st['signed']) $signatures[] = ['key' => $st['key'], 'name' => $st['name'], 'slot' => $st['slot'], 'at' => $st['at'], 'img' => 'api/esig.php?sig=' . (int) $st['sigId']]; // only lines that still exist on the request
        $own = $r['owner_name'] !== '' ? $r['owner_name'] : null; // the name in Employee information and Requested by is always the one who made the request
        return ['id' => s($r['id']), 'ownerId' => $r['user_id'] ? s($r['user_id']) : '', 'owner' => $r['owner_name'], 'employeeName' => $own !== null ? $own : $r['employee_name'], 'accountNumber' => $r['account_number'],
            'vendorName' => $r['vendor_name'], 'vendorAddress' => $r['vendor_address'], 'vendorTin' => $r['vendor_tin'], 'dateNeeded' => $r['date_needed'] ?: '', 'dateOfCheck' => $r['date_of_check'] ?: '',
            'reason' => $r['reason'], 'purpose' => (string) $r['purpose'], 'note' => $r['note'], 'instructions' => (string) $r['instructions'],
            'requestedBy' => $own !== null ? $own : $r['requested_by'], 'recommendedBy' => $r['recommended_by'], 'approvedBy' => $r['approved_by'],
            'logoKey' => isset($r['logo_key']) ? (string) $r['logo_key'] : '', 'logoUrl' => rfc_logo_url($r),
            'requestedDate' => $r['requested_date'] ?: '', 'recommendedDate' => $r['recommended_date'] ?: '', 'approvedDate' => $r['approved_date'] ?: '',
            'total' => (float) $r['total'], 'createdAt' => iso($r['created_at']), 'items' => isset($items[$r['id']]) ? $items[$r['id']] : [],
            'signatures' => $signatures, 'steps' => $steps, 'signedCount' => $signedN, 'stepCount' => count($steps), 'closed' => count($steps) > 0 && $signedN === count($steps)];
    }, $rows);
}

function rfc_out($u) {
    $admin = $u['role'] === 'admin'; $exec = $u['role'] === 'executive'; $wide = $admin || $exec; $key = rfc_key_of($u);
    rfc_logo_ready(); // adds the logo columns once, before the requests are read
    // the admin and the executives get every request; everybody else gets the requests they made, and (for the signers) the ones that carry their name
    if ($wide) $rows = q('SELECT ' . rfc_cols() . ' FROM rfc_requests ORDER BY id DESC LIMIT 300');
    elseif (isset(rfc_signers()[$key])) $rows = q('SELECT ' . rfc_cols() . ' FROM rfc_requests WHERE user_id = ? OR recommended_by LIKE ? OR approved_by LIKE ? ORDER BY id DESC LIMIT 300', [(int) $u['id'], '%' . $key . '%', '%' . $key . '%']);
    else $rows = q('SELECT ' . rfc_cols() . ' FROM rfc_requests WHERE user_id = ? ORDER BY id DESC LIMIT 300', [(int) $u['id']]);
    $all = rfc_pack($rows);
    $requests = $admin ? $all : array_values(array_filter($all, function ($r) use ($u) { return $r['ownerId'] === s($u['id']); })); // "My requests" of an executive are only the ones they made
    $out = ['requests' => $requests, 'people' => rfc_people(), 'defaults' => ['requestedBy' => $u['name'], 'recommendedBy' => rfc_default_text('recommended'), 'approvedBy' => rfc_default_text('approved')],
        'signerNames' => array_map(function ($x) { return $x['name']; }, rfc_signers()), 'logos' => rfc_logo_list($u), 'sign' => null];
    if (!rfc_sig_ready()) { $out['signSetup'] = true; return $out; }

    // The "For Signing" subtab: one card for each request that has a signature line for this account (the admin and the executives see every request; an executive may approve it, see action exec_approve).
    $ownIds = array_flip(array_column($requests, 'id')); $cards = []; $pending = 0;
    foreach ($all as $r) {
        if (!$r['steps']) continue;
        $has = false; $waiting = false;
        foreach ($r['steps'] as $st) if ($st['key'] === $key) { $has = true; if ($st['ready']) $waiting = true; }
        if (!$wide && !$has) continue;
        if ($waiting) $pending++;
        $cards[] = isset($ownIds[$r['id']]) ? ['id' => $r['id']] : ['id' => $r['id'], 'request' => $r]; // a request the browser already has in "requests" is not sent twice
    }
    $out['sign'] = ['mineKey' => $key, 'admin' => $admin, 'exec' => $exec, 'pending' => $pending, 'cards' => $cards];
    return $out;
}
