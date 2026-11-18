<?php
// Login and logout.
require __DIR__ . '/helpers.php';
$action = isset($_GET['action']) ? $_GET['action'] : '';

if ($action === 'login') {
    $in = input();
    $email = strtolower(trim(isset($in['email']) ? $in['email'] : ''));
    $pw = isset($in['password']) ? $in['password'] : '';
    if ($email === '' || $pw === '') fail(400, 'Please enter your email and password.');
    $u = q1('SELECT * FROM users WHERE LOWER(email) = ?', [$email]);
    if (!$u || !password_verify($pw, $u['password_hash'])) fail(401, 'Invalid email or password.');
    if ($u['status'] !== 'Active') fail(403, 'This account is deactivated. Contact your administrator.');
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $u['id'];
    out(['user' => user_out($u)]);
}
if ($action === 'logout') { $_SESSION = []; session_destroy(); out(['ok' => true]); }
fail(404, 'Unknown action.');
