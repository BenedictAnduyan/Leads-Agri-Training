<?php
// Attachments of the Supplier Master: Attachment 2303 (one file per supplier) and Extra Document/s (as many as needed).
//   POST supplier_files.php?action=upload   multipart form: supplierId, kind ("2303" or "extra"), file
//   GET  supplier_files.php?action=download&id=ID   opens or downloads one attachment (only people who can see that supplier)
//   POST supplier_files.php?action=delete   body: {id: ID}   removes one attachment (admin, or the employee whose department owns the supplier)
// The files are kept in the folder uploads/suppliers under a random name, and that folder cannot be opened from the browser directly.
require __DIR__ . '/helpers.php';
$me = require_login();
$action = isset($_GET['action']) ? $_GET['action'] : '';
sup_schema();

const SUP_FILE_MAX = 10 * 1024 * 1024; // 10 MB for each file
const SUP_FILE_TYPES = ['pdf' => 'application/pdf', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'doc' => 'application/msword', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls' => 'application/vnd.ms-excel', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

function sup_can_see($sup) { // the admin sees every supplier; an employee sees the suppliers of their own department and the ones for all departments
    global $me;
    return $me['role'] === 'admin' || $sup['department'] === '' || strtolower($sup['department']) === strtolower((string) $me['department']);
}
function sup_can_change($sup) { // same rule as editing the supplier: the admin, or the employee whose department owns it
    global $me;
    return $me['role'] === 'admin' || ($sup['department'] !== '' && strtolower($sup['department']) === strtolower((string) $me['department']));
}

if ($action === 'download') {
    $a = q1('SELECT * FROM supplier_attachments WHERE id = ?', [(int) (isset($_GET['id']) ? $_GET['id'] : 0)]);
    $sup = $a ? q1('SELECT * FROM suppliers WHERE id = ?', [$a['supplier_id']]) : null;
    if (!$a || !$sup || !sup_can_see($sup)) fail(404, 'File not found.');
    $path = sup_upload_dir() . '/' . basename($a['stored_name']);
    if (!is_file($path)) fail(404, 'The file is no longer on the server.');
    $ext = strtolower(pathinfo($a['file_name'], PATHINFO_EXTENSION));
    $type = isset(SUP_FILE_TYPES[$ext]) ? SUP_FILE_TYPES[$ext] : 'application/octet-stream';
    $inline = in_array($ext, ['pdf', 'png', 'jpg', 'jpeg'], true);
    header('Content-Type: ' . $type);
    header('X-Content-Type-Options: nosniff');
    header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . str_replace(['"', "\r", "\n"], '', $a['file_name']) . '"');
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: private, max-age=0');
    readfile($path);
    exit;
}

if ($action === 'upload') {
    $sup = q1('SELECT * FROM suppliers WHERE id = ?', [(int) (isset($_POST['supplierId']) ? $_POST['supplierId'] : 0)]);
    if (!$sup) fail(404, 'Supplier not found.');
    if (!sup_can_change($sup)) fail(403, 'You can only add attachments to suppliers of your own department.');
    $kind = isset($_POST['kind']) ? $_POST['kind'] : '';
    if (!in_array($kind, ['2303', 'extra'], true)) fail(400, 'Choose the kind of attachment.');
    $f = isset($_FILES['file']) ? $_FILES['file'] : null;
    if (!$f || $f['error'] === UPLOAD_ERR_NO_FILE) fail(400, 'Choose a file to upload.');
    if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE || $f['size'] > SUP_FILE_MAX) fail(400, 'The file "' . $f['name'] . '" is too big. Each file can be 10 MB at most.');
    if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) fail(400, 'The file "' . $f['name'] . '" could not be uploaded. Please try again.');
    $name = trim(basename(str_replace('\\', '/', (string) $f['name'])));
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!isset(SUP_FILE_TYPES[$ext])) fail(400, 'The file "' . $name . '" is not allowed. Upload a PDF, picture (PNG, JPG), Word or Excel file.');
    if (mb_strlen($name) > 255) $name = mb_substr($name, 0, 240) . '.' . $ext;
    $stored = bin2hex(random_bytes(16)) . '.' . $ext;
    if (!move_uploaded_file($f['tmp_name'], sup_upload_dir() . '/' . $stored)) fail(500, 'The server could not save the file "' . $name . '". Check that the folder uploads/suppliers can be written to.');
    if ($kind === '2303') { // there is only one Attachment 2303: a new file replaces the old one
        foreach (q("SELECT * FROM supplier_attachments WHERE supplier_id = ? AND kind = '2303'", [$sup['id']]) as $old) { @unlink(sup_upload_dir() . '/' . basename($old['stored_name'])); run('DELETE FROM supplier_attachments WHERE id = ?', [$old['id']]); }
    }
    run('INSERT INTO supplier_attachments (supplier_id, kind, file_name, stored_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [$sup['id'], $kind, $name, $stored, SUP_FILE_TYPES[$ext], (int) $f['size'], $me['id']]);
    out(['ok' => true, 'id' => last_id()]);
}

if ($action === 'delete') {
    $a = q1('SELECT * FROM supplier_attachments WHERE id = ?', [(int) val_in('id')]);
    $sup = $a ? q1('SELECT * FROM suppliers WHERE id = ?', [$a['supplier_id']]) : null;
    if (!$a || !$sup) fail(404, 'File not found.');
    if (!sup_can_change($sup)) fail(403, 'You can only remove attachments of suppliers of your own department.');
    @unlink(sup_upload_dir() . '/' . basename($a['stored_name']));
    run('DELETE FROM supplier_attachments WHERE id = ?', [$a['id']]);
    out(['ok' => true]);
}

fail(404, 'Unknown action.');

function val_in($k) { $in = input(); return isset($in[$k]) ? $in[$k] : ''; }
