<?php
// KPI Matrix actions. Only the admin and immediate heads / supervisors may use them (checked here, on the server).
require __DIR__ . '/helpers.php';
require __DIR__ . '/kpi_lib.php';
$me = require_kpi_access();
$action = isset($_GET['action']) ? $_GET['action'] : '';
function kval($k) { $in = input(); return isset($in[$k]) ? $in[$k] : ''; }
function kdec($v, $label, $min, $max, $nullable = false) { // a number with at most 2 decimals inside a range
    if ($nullable && ($v === '' || $v === null)) return null;
    if (!is_numeric($v)) fail(400, $label . ' must be a number.');
    $n = round((float) $v, 2);
    if ($n < $min || $n > $max) fail(400, $label . ' must be between ' . $min . ' and ' . $max . '.');
    return $n;
}
function kpi_position($id) { $p = q1('SELECT * FROM kpi_positions WHERE id = ?', [(int) $id]); if (!$p) fail(404, 'Position not found.'); return $p; }
// the custom weights of the active KPIs of a KRA can never be more than the weight of the KRA
function check_custom_weights($kraId, $kraWeight, $exceptItem = 0, $extra = 0) {
    $sum = (float) q1('SELECT COALESCE(SUM(custom_weight), 0) AS w FROM kpi_items WHERE kra_id = ? AND active = 1 AND custom_weight IS NOT NULL AND id <> ?', [(int) $kraId, (int) $exceptItem])['w'] + $extra;
    if ($sum > $kraWeight + 0.0001) fail(400, 'The custom KPI weights of this KRA add up to ' . round($sum, 2) . '%, which is more than the KRA weight of ' . round($kraWeight, 2) . '%.');
}

switch ($action) {

case 'save_position': // add a position, or rename one
    $name = trim((string) kval('name')); $id = (int) kval('id');
    if ($name === '') fail(400, 'Enter the position name.');
    if (mb_strlen($name) > 120) fail(400, 'The position name can have at most 120 characters.');
    if (q1('SELECT id FROM kpi_positions WHERE LOWER(name) = ? AND id <> ?', [mb_strtolower($name), $id])) fail(409, 'This position already exists.');
    if ($id) { kpi_position($id); run('UPDATE kpi_positions SET name = ? WHERE id = ?', [$name, $id]); out(['id' => s($id)]); }
    run('INSERT INTO kpi_positions (name, created_by) VALUES (?, ?)', [$name, (int) $me['id']]);
    $new = last_id();
    log_activity($me['name'] . ' added the KPI position: ' . $name);
    out(['id' => $new]);

case 'delete_position': // its KRAs, KPIs, results and partial-credit scale go with it (ON DELETE CASCADE)
    $p = kpi_position(kval('id'));
    run('DELETE FROM kpi_positions WHERE id = ?', [$p['id']]);
    log_activity($me['name'] . ' deleted the KPI position: ' . $p['name']);
    out(['ok' => true]);

case 'save_kra':
    $p = kpi_position(kval('positionId')); $id = (int) kval('id');
    $name = trim((string) kval('name'));
    if ($name === '' || mb_strlen($name) > 160) fail(400, 'Enter the KRA name (at most 160 characters).');
    $weight = kdec(kval('weight'), 'The KRA weight', 0.01, 100);
    $no = (int) kval('kraNo');
    if ($no < 1) $no = (int) q1('SELECT COALESCE(MAX(kra_no), 0) + 1 AS n FROM kpi_kras WHERE position_id = ?', [$p['id']])['n'];
    $used = (float) q1('SELECT COALESCE(SUM(weight), 0) AS w FROM kpi_kras WHERE position_id = ? AND id <> ?', [$p['id'], $id])['w'];
    if ($used + $weight > 100.0001) fail(400, 'The KRA weights of a position cannot add up to more than 100%. The other KRAs already use ' . round($used, 2) . '%, so this KRA can have at most ' . round(100 - $used, 2) . '%.');
    if ($id) {
        if (!q1('SELECT id FROM kpi_kras WHERE id = ? AND position_id = ?', [$id, $p['id']])) fail(404, 'KRA not found.');
        check_custom_weights($id, $weight);
        run('UPDATE kpi_kras SET kra_no = ?, name = ?, weight = ? WHERE id = ?', [$no, $name, $weight, $id]);
    } else run('INSERT INTO kpi_kras (position_id, kra_no, name, weight) VALUES (?, ?, ?, ?)', [$p['id'], $no, $name, $weight]);
    out(['ok' => true]);

case 'delete_kra':
    run('DELETE FROM kpi_kras WHERE id = ?', [(int) kval('id')]); // its KPIs and results go with it
    out(['ok' => true]);

case 'save_kpi': // add or edit a KPI. Same columns as the matrix sheet: Specific KPI, KPI Weight (optional) and Target (%)
    $kra = q1('SELECT * FROM kpi_kras WHERE id = ?', [(int) kval('kraId')]);
    if (!$kra) fail(404, 'KRA not found.');
    $id = (int) kval('id');
    $old = $id ? q1('SELECT * FROM kpi_items WHERE id = ? AND kra_id = ?', [$id, $kra['id']]) : null;
    if ($id && !$old) fail(404, 'KPI not found.');
    $name = trim((string) kval('name'));
    if ($name === '' || mb_strlen($name) > 200) fail(400, 'Enter the Specific KPI (at most 200 characters).');
    $target = kdec(kval('target'), 'The target', 0, 100);
    $custom = kdec(kval('customWeight'), 'The KPI weight', 0.01, 100, true); // empty = the KRA weight is shared equally
    $active = $old ? (int) $old['active'] : 1;
    if ($active && $custom !== null) check_custom_weights($kra['id'], (float) $kra['weight'], $id, $custom);
    if ($id) run('UPDATE kpi_items SET name = ?, target = ?, custom_weight = ? WHERE id = ?', [$name, $target, $custom, $id]); // the other columns of an older KPI are kept as they are
    else run("INSERT INTO kpi_items (kra_id, name, unit, target, direction, custom_weight, active) VALUES (?, ?, '%', ?, 'higher', ?, 1)", [$kra['id'], $name, $target, $custom]);
    out(['ok' => true]);

case 'delete_kpi':
    run('DELETE FROM kpi_items WHERE id = ?', [(int) kval('id')]); // its results go with it
    out(['ok' => true]);

case 'save_result': // one result, sent by the KPI Calculation Assistant ("Apply to Spreadsheet")
    $k = q1('SELECT i.id FROM kpi_items i JOIN kpi_kras r ON r.id = i.kra_id WHERE i.id = ?', [(int) kval('kpiId')]);
    if (!$k) fail(404, 'KPI not found.');
    $year = (int) kval('year'); $cy = (int) date('Y');
    if ($year < 2000 || $year > $cy + 1) fail(400, 'Choose a valid year.');
    $n = kdec(kval('actual'), 'The actual score', 0, 1000000000);
    run('INSERT INTO kpi_results (kpi_id, year, actual) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE actual = VALUES(actual)', [(int) $k['id'], $year, $n]);
    out(['ok' => true]);

case 'save_results': // the results (actual values) of one position for one year. An empty box removes the result.
    $p = kpi_position(kval('positionId'));
    $year = (int) kval('year'); $cy = (int) date('Y');
    if ($year < 2000 || $year > $cy + 1) fail(400, 'Choose a valid year.');
    $results = kval('results'); if (!is_array($results)) fail(400, 'No results received.');
    $valid = array_map('intval', array_column(q('SELECT i.id FROM kpi_items i JOIN kpi_kras k ON k.id = i.kra_id WHERE k.position_id = ?', [$p['id']]), 'id'));
    db()->beginTransaction();
    foreach ($results as $kid => $v) {
        if (!in_array((int) $kid, $valid, true)) continue;
        if ($v === '' || $v === null) { run('DELETE FROM kpi_results WHERE kpi_id = ? AND year = ?', [(int) $kid, $year]); continue; }
        $n = kdec($v, 'Every result', 0, 1000000000);
        run('INSERT INTO kpi_results (kpi_id, year, actual) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE actual = VALUES(actual)', [(int) $kid, $year, $n]);
    }
    db()->commit();
    out(['ok' => true]);

case 'save_scale': // the approved partial-credit scale of a position (the whole list is saved at once; an empty list = all-or-nothing)
    $p = kpi_position(kval('positionId'));
    $rows = kval('rows'); if (!is_array($rows)) $rows = [];
    $clean = []; $seen = [];
    foreach ($rows as $r) {
        if (!is_array($r)) continue;
        $min = kdec(isset($r['min']) ? $r['min'] : '', 'The minimum % of the target', 0.01, 99.99);
        $cr = kdec(isset($r['credit']) ? $r['credit'] : '', 'The credit %', 0, 100);
        if (isset($seen[(string) $min])) fail(400, 'Two lines of the scale have the same minimum (' . $min . '%).');
        $seen[(string) $min] = true; $clean[] = [$min, $cr];
    }
    db()->beginTransaction();
    run('DELETE FROM kpi_scale WHERE position_id = ?', [$p['id']]);
    foreach ($clean as $c) run('INSERT INTO kpi_scale (position_id, min_pct, credit_pct) VALUES (?, ?, ?)', [$p['id'], $c[0], $c[1]]);
    db()->commit();
    out(['ok' => true]);

case 'save_sla': // add a priority (no "original") or edit one (the name can be changed too)
    $orig = trim((string) kval('original')); $pr = trim((string) kval('priority'));
    if ($pr === '' || mb_strlen($pr) > 40) fail(400, 'Enter the priority name (at most 40 characters).');
    $f = []; foreach (['description', 'examples', 'firstResponse', 'resolution'] as $k) $f[$k] = trim((string) kval($k));
    if ($f['firstResponse'] === '' || $f['resolution'] === '') fail(400, 'Enter the first response and the resolution target.');
    if (mb_strlen($f['description']) > 255 || mb_strlen($f['examples']) > 255) fail(400, 'The description and the examples can have at most 255 characters.');
    if (mb_strlen($f['firstResponse']) > 40 || mb_strlen($f['resolution']) > 40) fail(400, 'The response and resolution targets can have at most 40 characters.');
    if (q1('SELECT id FROM kpi_sla WHERE LOWER(priority) = ? AND priority <> ?', [mb_strtolower($pr), $orig])) fail(409, 'This priority already exists.');
    if ($orig !== '') {
        if (!q1('SELECT id FROM kpi_sla WHERE priority = ?', [$orig])) fail(404, 'Priority not found.');
        db()->beginTransaction();
        run('UPDATE kpi_sla SET priority = ?, description = ?, examples = ?, first_response = ?, resolution = ? WHERE priority = ?', [$pr, $f['description'], $f['examples'], $f['firstResponse'], $f['resolution'], $orig]);
        if ($pr !== $orig) run('UPDATE kpi_items SET sla_priority = ? WHERE sla_priority = ?', [$pr, $orig]); // KPIs linked to it follow the new name
        db()->commit();
    } else {
        $n = (int) q1('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM kpi_sla')['n'];
        run('INSERT INTO kpi_sla (priority, description, examples, first_response, resolution, sort_order) VALUES (?, ?, ?, ?, ?, ?)', [$pr, $f['description'], $f['examples'], $f['firstResponse'], $f['resolution'], $n]);
        log_activity($me['name'] . ' added the SLA priority: ' . $pr);
    }
    out(['ok' => true]);

case 'delete_sla': // KPIs that were linked to this priority keep their data and only lose the link
    $pr = trim((string) kval('priority'));
    if (!q1('SELECT id FROM kpi_sla WHERE priority = ?', [$pr])) fail(404, 'Priority not found.');
    db()->beginTransaction();
    run('UPDATE kpi_items SET sla_priority = NULL, sla_type = NULL WHERE sla_priority = ?', [$pr]);
    run('DELETE FROM kpi_sla WHERE priority = ?', [$pr]);
    log_activity($me['name'] . ' removed the SLA priority: ' . $pr);
    db()->commit();
    out(['ok' => true]);

case 'complete_review': // marks the yearly review as done, which removes the reminder banner
    $y = (int) date('Y');
    kpi_annual_check();
    $st = run('UPDATE kpi_reviews SET done_by = ?, done_at = NOW() WHERE year = ? AND done_at IS NULL', [(int) $me['id'], $y]);
    if ($st->rowCount() > 0) log_activity($me['name'] . ' marked the KPI review for ' . $y . ' as done.');
    out(['ok' => true]);
}
fail(404, 'Unknown action.');
