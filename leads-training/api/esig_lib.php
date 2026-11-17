<?php
// E-signature saved in the Profile of an account (any role). It is one transparent PNG picture kept in the database (table users, column esignature).
// The column is added automatically the first time it is needed, so no SQL file has to be imported.
require_once __DIR__ . '/helpers.php';

function esig_ready() {
    static $ok = null;
    if ($ok === null) {
        try { q('SELECT esignature, esignature_at FROM users LIMIT 1'); $ok = true; }
        catch (Throwable $e) {
            try { run('ALTER TABLE users ADD COLUMN esignature MEDIUMTEXT NULL, ADD COLUMN esignature_at DATETIME NULL'); $ok = true; }
            catch (Throwable $e2) { $ok = false; }
        }
    }
    return $ok;
}

// what the Profile page needs to know about the e-signature of the logged-in account
function esig_out($u) {
    if (!esig_ready()) return ['has' => false, 'v' => 0];
    $r = q1('SELECT esignature_at, (esignature IS NOT NULL AND esignature <> \'\') AS has_sig FROM users WHERE id = ?', [(int) $u['id']]);
    return ['has' => $r && !empty($r['has_sig']), 'v' => $r && $r['esignature_at'] ? (int) strtotime($r['esignature_at']) : 0];
}

// checks the picture sent by the browser (the browser already turned it into a small PNG) and returns it as plain base64
function esig_clean($dataUrl) {
    if (!is_string($dataUrl) || !preg_match('#^data:image/png;base64,([A-Za-z0-9+/=]+)$#', $dataUrl, $m)) fail(400, 'The e-signature must be a PNG picture. Choose the picture again.');
    $bin = base64_decode($m[1], true);
    if ($bin === false || $bin === '') fail(400, 'The e-signature picture could not be read. Choose it again.');
    if (strlen($bin) > 400 * 1024) fail(400, 'The e-signature picture is too big. Use a smaller picture.');
    $info = @getimagesizefromstring($bin);
    if (!$info || $info[2] !== IMAGETYPE_PNG) fail(400, 'The e-signature must be a PNG picture. Choose the picture again.');
    if ($info[0] < 20 || $info[1] < 10 || $info[0] > 1200 || $info[1] > 600) fail(400, 'The e-signature picture has an unusual size. Use a picture of your signature only.');
    return base64_encode($bin);
}
