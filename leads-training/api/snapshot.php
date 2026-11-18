<?php
// Sends the logged-in user everything they are allowed to see.
require __DIR__ . '/helpers.php';
require __DIR__ . '/kpi_lib.php';
require __DIR__ . '/rfc_lib.php';
require __DIR__ . '/itp_lib.php';
require_once __DIR__ . '/esig_lib.php';
$u = require_login();
try { sup_schema(); } catch (Throwable $e) { /* the supplier TIN / attachments are added next time */ }
$kpi = kpi_allowed($u); // the IT KPI Matrix is only for the admin and immediate heads / supervisors
$missing = false;
try { if ($kpi) kpi_annual_check(); } // creates the yearly reminder (once) before the notifications are read below
catch (Throwable $e) { $missing = true; } // the KPI tables are not installed yet: the rest of the site keeps working
$data = $u['role'] === 'admin' ? snapshot_admin($u) : snapshot_employee($u);
if ($kpi && !$missing) {
    try { $data['kpi'] = kpi_out($u); } catch (Throwable $e) { $missing = true; }
}
if ($missing && $u['role'] === 'admin') $data['kpiSetup'] = true;
try { $data['rfc'] = rfc_out($u); } // Request for Check: every role; an employee gets only their own requests
catch (Throwable $e) { $data['rfcSetup'] = true; } // its tables are not installed yet (import migration_rfc.sql): the rest of the site keeps working
try { $data['esig'] = esig_out($u); } // the e-signature saved in the Profile of this account
catch (Throwable $e) { $data['esig'] = ['has' => false, 'v' => 0]; }
try { $data['itp'] = itp_out($u); } // IT Procurement Requisition: every role; an employee gets only their own requisitions
catch (Throwable $e) { $data['itpSetup'] = true; } // its tables are not installed yet (import migration_itp.sql): the rest of the site keeps working
out($data);
