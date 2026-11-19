<?php
// KPI Matrix: who may use it, the score computation, the data sent to the browser, and the yearly reminder.
require_once __DIR__ . '/helpers.php';

/* ---------- access: the admin and every immediate head / supervisor (someone chosen as supervisor of at least one employee) ---------- */
function is_supervisor($uid) { return (bool) q1('SELECT id FROM users WHERE supervisor_id = ? LIMIT 1', [(int) $uid]); }
function kpi_allowed($u) { return $u['role'] === 'admin' || is_supervisor($u['id']); }
function require_kpi_access() {
    $u = require_login();
    if (!kpi_allowed($u)) fail(403, 'Only the administrator and immediate heads / supervisors can use the KPI Matrix.');
    return $u;
}

/* ---------- SLA criteria (Admin > KPI Matrix > SLA) ---------- */
function kpi_sla_rows() { return q('SELECT * FROM kpi_sla ORDER BY sort_order, id'); }
function kpi_sla_text($priority, $type, $rows) {
    if (!$priority || !$type) return '';
    foreach ($rows as $r) if ($r['priority'] === $priority)
        return $priority . ' priority - ' . ($type === 'first_response' ? 'first response within ' . $r['first_response'] : 'resolution within ' . $r['resolution']);
    return '';
}

/* ---------- the computation (one place only: the browser just shows what this returns) ----------
   KRA weight = how important the KRA is (all KRA weights of a position should add up to 100).
   KPI weight = the KRA weight shared equally among its ACTIVE KPIs, unless a KPI has a custom weight (management approved):
                the custom weights are taken first and the rest of the KRA weight is shared equally among the other KPIs.
   KPI result = 100% of the KPI weight when the target is met (higher: result >= target, lower: result <= target).
                Below target: 0%, unless the position has an approved partial-credit scale. Then the % of the target reached
                (higher: result / target, lower: target / result) picks the credit from the scale.
   Overall performance = total earned / total weight allocated x 100.
   Bands (Management Guide): 90-100 target achieved, 80-89 partially achieved, below 80 target materially missed. */
function kpi_band($pct, $measured) {
    if (!$measured) return ['key' => 'none', 'label' => 'No results yet', 'text' => 'Enter the results to see the performance rating.'];
    if ($pct >= 90) return ['key' => 'strong', 'label' => 'Target achieved', 'text' => 'Target achieved / strong performance against agreed KPI'];
    if ($pct >= 80) return ['key' => 'partial', 'label' => 'Partially achieved', 'text' => 'Partially achieved; improvement action may be required'];
    return ['key' => 'missed', 'label' => 'Target materially missed', 'text' => 'Target materially missed; root-cause and corrective action required'];
}
function kpi_score_item($dir, $target, $actual, $weight, $scale) {
    if ($actual === null) return ['ratio' => null, 'credit' => 0, 'earned' => 0, 'status' => 'No result'];
    $met = $dir === 'lower' ? $actual <= $target : $actual >= $target;
    if ($met) return ['ratio' => 100, 'credit' => 100, 'earned' => round($weight, 2), 'status' => 'Met'];
    if ($dir === 'lower') $ratio = $actual > 0 ? $target / $actual * 100 : 100;
    else $ratio = $target > 0 ? $actual / $target * 100 : 0;
    $credit = 0;
    foreach ($scale as $r) if ($ratio >= (float) $r['min_pct']) { $credit = (float) $r['credit_pct']; break; } // $scale is sorted from the highest minimum down
    return ['ratio' => round($ratio, 1), 'credit' => $credit, 'earned' => round($weight * $credit / 100, 2), 'status' => $credit > 0 ? 'Partial' : 'Missed'];
}
function kpi_compute($pid, $year, $sla) {
    $kras = q('SELECT * FROM kpi_kras WHERE position_id = ? ORDER BY kra_no, id', [(int) $pid]);
    $scale = q('SELECT min_pct, credit_pct FROM kpi_scale WHERE position_id = ? ORDER BY min_pct DESC', [(int) $pid]);
    $items = []; $results = [];
    if ($kras) {
        $in = implode(',', array_map('intval', array_column($kras, 'id')));
        foreach (q("SELECT * FROM kpi_items WHERE kra_id IN ($in) ORDER BY id") as $i) $items[$i['kra_id']][] = $i;
        foreach (q("SELECT r.kpi_id, r.actual FROM kpi_results r JOIN kpi_items i ON i.id = r.kpi_id WHERE r.year = ? AND i.kra_id IN ($in)", [(int) $year]) as $r) $results[$r['kpi_id']] = (float) $r['actual'];
    }
    $out = ['year' => (int) $year, 'kras' => [], 'allocated' => 0, 'earned' => 0, 'activeKpis' => 0, 'totalKpis' => 0, 'measured' => 0];
    foreach ($kras as $k) {
        $list = isset($items[$k['id']]) ? $items[$k['id']] : [];
        $kw = (float) $k['weight']; $custom = 0; $auto = 0;
        foreach ($list as $i) if ((int) $i['active'] === 1) { if ($i['custom_weight'] !== null) $custom += (float) $i['custom_weight']; else $auto++; }
        $share = $auto ? max(0, $kw - $custom) / $auto : 0;
        $kr = ['id' => s($k['id']), 'no' => (int) $k['kra_no'], 'name' => $k['name'], 'weight' => $kw, 'earned' => 0, 'pct' => 0, 'active' => 0, 'kpis' => []];
        foreach ($list as $i) {
            $active = (int) $i['active'] === 1; $out['totalKpis']++;
            $w = !$active ? 0 : ($i['custom_weight'] !== null ? (float) $i['custom_weight'] : $share);
            $actual = isset($results[$i['id']]) ? $results[$i['id']] : null;
            $sc = $active ? kpi_score_item($i['direction'], (float) $i['target'], $actual, $w, $scale) : ['ratio' => null, 'credit' => 0, 'earned' => 0, 'status' => 'Inactive'];
            if ($active) { $kr['active']++; $out['activeKpis']++; if ($actual !== null) $out['measured']++; }
            $kr['earned'] += $sc['earned'];
            $kr['kpis'][] = ['id' => s($i['id']), 'name' => $i['name'], 'description' => $i['description'], 'unit' => $i['unit'], 'target' => (float) $i['target'], 'direction' => $i['direction'],
                'customWeight' => $i['custom_weight'] === null ? null : (float) $i['custom_weight'], 'evidence' => $i['evidence'], 'slaPriority' => $i['sla_priority'], 'slaType' => $i['sla_type'],
                'slaText' => kpi_sla_text($i['sla_priority'], $i['sla_type'], $sla), 'active' => $active, 'weight' => round($w, 2), 'actual' => $actual,
                'ratio' => $sc['ratio'], 'credit' => $sc['credit'], 'earned' => $sc['earned'], 'status' => $sc['status']];
        }
        $kr['earned'] = round($kr['earned'], 2); $kr['pct'] = $kw > 0 ? round($kr['earned'] / $kw * 100, 1) : 0;
        $kr['band'] = kpi_band($kr['pct'], array_reduce($kr['kpis'], function ($c, $x) { return $c || ($x['active'] && $x['actual'] !== null); }, false));
        $out['allocated'] += $kw; $out['earned'] += $kr['earned'];
        $out['kras'][] = $kr;
    }
    $out['allocated'] = round($out['allocated'], 2); $out['earned'] = round($out['earned'], 2);
    $out['pct'] = $out['allocated'] > 0 ? round($out['earned'] / $out['allocated'] * 100, 1) : 0;
    $out['band'] = kpi_band($out['pct'], $out['measured'] > 0);
    return $out;
}

/* ---------- everything the KPI Matrix screens need (sent only to the admin and supervisors) ---------- */
function kpi_out($u) {
    $cy = (int) date('Y');
    $years = array_map('intval', array_column(q('SELECT DISTINCT year FROM kpi_results ORDER BY year'), 'year'));
    if (!in_array($cy, $years, true)) $years[] = $cy;
    sort($years);
    $sla = kpi_sla_rows(); $positions = [];
    foreach (q('SELECT * FROM kpi_positions ORDER BY name') as $p) {
        $calc = [];
        foreach ($years as $y) $calc[(string) $y] = kpi_compute($p['id'], $y, $sla);
        $positions[] = ['id' => s($p['id']), 'name' => $p['name'], 'calc' => $calc,
            'scale' => array_map(function ($r) { return ['min' => (float) $r['min_pct'], 'credit' => (float) $r['credit_pct']]; }, q('SELECT min_pct, credit_pct FROM kpi_scale WHERE position_id = ? ORDER BY min_pct DESC', [(int) $p['id']]))];
    }
    $rv = q1('SELECT * FROM kpi_reviews WHERE year = ?', [$cy]);
    return ['currentYear' => $cy, 'years' => $years, 'positions' => $positions,
        'sla' => array_map(function ($r) { return ['priority' => $r['priority'], 'description' => $r['description'], 'examples' => $r['examples'], 'firstResponse' => $r['first_response'], 'resolution' => $r['resolution']]; }, $sla),
        'review' => ['year' => $cy, 'due' => $rv ? $rv['done_at'] === null : false]];
}

/* ---------- yearly reminder ----------
   There is no scheduler on XAMPP, so the first time anyone loads the site in a new year, the reminder is created once:
   a notification for every active admin and every immediate head / supervisor. Admin > KPI Matrix shows a banner until the review is marked done. */
function kpi_annual_check() {
    $y = (int) date('Y');
    if (q1('SELECT year FROM kpi_reviews WHERE year = ?', [$y])) return;
    if (run('INSERT IGNORE INTO kpi_reviews (year) VALUES (?)', [$y])->rowCount() < 1) return; // somebody else just created it
    $who = q("SELECT id FROM users WHERE status = 'Active' AND (role = 'admin' OR id IN (SELECT supervisor_id FROM users WHERE supervisor_id IS NOT NULL))");
    foreach ($who as $w)
        add_note($w['id'], 'KPI review for ' . $y, 'It is time for the yearly KPI review: check the positions, KRAs, KPI targets and weights for ' . $y . ', then enter the results.');
    log_activity('The yearly KPI review for ' . $y . ' was opened.');
}
