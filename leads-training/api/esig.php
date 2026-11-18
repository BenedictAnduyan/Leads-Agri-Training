<?php
// E-signature pictures and the Profile actions for them.
//   GET  esig.php?user=ID   the current e-signature of an account (only the owner of the account, or the admin)
//   GET  esig.php?sig=ID    the picture kept with one e-signature of a Request for Check (only people who can see that request)
//   GET  esig.php?itpsig=ID the picture kept with one e-signature of an IT Procurement Requisition (only people who can see that requisition)
//   POST esig.php?action=save    saves the e-signature of the logged-in account (body: {image: "data:image/png;base64,..."})
//   POST esig.php?action=remove  removes it
require __DIR__ . '/helpers.php';
require_once __DIR__ . '/esig_lib.php';
require __DIR__ . '/rfc_lib.php';
require __DIR__ . '/itp_lib.php';
$me = require_login();
$action = isset($_GET['action']) ? $_GET['action'] : '';

function esig_send($b64) { // sends one stored picture
    header('Content-Type: image/png');
    header('Cache-Control: private, max-age=86400');
    echo base64_decode($b64);
    exit;
}

if (isset($_GET['user'])) {
    $id = (int) $_GET['user'];
    if ($id !== (int) $me['id'] && $me['role'] !== 'admin') fail(403, 'You cannot see this e-signature.');
    if (!esig_ready()) fail(404, 'No e-signature.');
    $r = q1('SELECT esignature FROM users WHERE id = ?', [$id]);
    if (!$r || empty($r['esignature'])) fail(404, 'No e-signature.');
    esig_send($r['esignature']);
}

if (isset($_GET['sig'])) {
    $g = q1('SELECT * FROM rfc_signatures WHERE id = ?', [(int) $_GET['sig']]);
    if (!$g) fail(404, 'No e-signature.');
    $r = q1('SELECT * FROM rfc_requests WHERE id = ?', [(int) $g['rfc_id']]);
    if (!$r || !rfc_can_see($me, $r)) fail(403, 'You cannot see this e-signature.');
    if (!empty($g['image'])) esig_send($g['image']);
    if (isset(RFC_SIGNERS[$g['signer_key']]) && rfc_has_file($g['signer_key'])) { // signed before pictures were kept with the signature: use the picture file of the fixed signer
        header('Content-Type: image/png'); header('Cache-Control: private, max-age=3600');
        readfile(__DIR__ . '/../' . RFC_SIGNERS[$g['signer_key']]['img']); exit;
    }
    fail(404, 'No e-signature.');
}

if (isset($_GET['itpsig'])) {
    if (!itp_ready()) fail(404, 'No e-signature.');
    $g = q1('SELECT * FROM itp_signatures WHERE id = ?', [(int) $_GET['itpsig']]);
    if (!$g) fail(404, 'No e-signature.');
    $r = q1('SELECT * FROM itp_requests WHERE id = ?', [(int) $g['itp_id']]);
    if (!$r || !itp_can_see($me, $r)) fail(403, 'You cannot see this e-signature.');
    if (empty($g['image'])) fail(404, 'No e-signature.');
    esig_send($g['image']);
}

$in = input();
switch ($action) {

case 'save':
    if (!esig_ready()) fail(500, 'The e-signature could not be saved. Check that MySQL allows changing the table users.');
    $png = esig_clean(isset($in['image']) ? $in['image'] : '');
    run('UPDATE users SET esignature = ?, esignature_at = NOW() WHERE id = ?', [$png, (int) $me['id']]);
    out(['ok' => true]);

case 'remove':
    if (esig_ready()) run('UPDATE users SET esignature = NULL, esignature_at = NULL WHERE id = ?', [(int) $me['id']]);
    out(['ok' => true]);
}
fail(404, 'Unknown action.');
