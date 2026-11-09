<?php
// Database settings. XAMPP default: user "root" with no password.
const DB_HOST = 'localhost';
const DB_NAME = 'leads_training';
const DB_USER = 'root';
const DB_PASS = '';

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax']);
session_start();
