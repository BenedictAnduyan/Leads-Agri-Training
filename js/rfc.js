/* Request for Check tab: every role (admin, immediate superior, employee) can fill in the request, save it, and print it.
   The printed form has NO signatures: the three signature lines are left blank and are signed by hand on paper.
   Saved by api/rfc.php. An employee sees their own requests, the admin sees all. The screens are templates in index.html. */
const RFC_REASONS = ['Reimbursement', 'Incentive', 'Sponsorship', 'Payment', 'Others'];
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rfcToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const rfcDate = (d) => (d ? fmt(d) : '');
const rfcPath = () => (me.role === 'admin' ? '/admin/rfc' : '/rfc');
const rfcCopy = (o) => JSON.parse(JSON.stringify(o));
const rfcItem = () => ({ name: '', units: 1, amount: '', users: [] });
const rfcTotal = (d) => d.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
const rfcNo = (id) => 'RFC #' + String(id).padStart(4, '0');
function rfcBlank() {
  return { id: '', employeeName: me.name, accountNumber: '', vendorName: '', vendorAddress: '', vendorTin: '', dateNeeded: '', dateOfCheck: '', reason: 'Payment', purpose: '', note: 'Please see the attached files', instructions: '',
    requestedBy: me.name, recommendedBy: '', approvedBy: '', requestedDate: rfcToday(), recommendedDate: '', approvedDate: '', items: [rfcItem()] };
}

/* ---------- the page: list, form, or one saved request ---------- */
function rfcHome() { ui.rfc = null; if (location.hash === '#' + rfcPath()) render(); else go(rfcPath()); return false; } // the menu link always starts at the list
function rfcPage() {
  if (!db.rfc) return message('Request for Check', db.rfcSetup ? 'The Request for Check tables need to be set up. In phpMyAdmin, import migration_rfc.sql (first time only) and reload this page.' : 'This page is not available.', me.role === 'admin' ? '/admin' : '/home', 'Back to Home');
  const z = ui.rfc || (ui.rfc = { mode: 'list' });
  if (z.mode === 'form') return rfcFormView();
  if (z.mode === 'view') return rfcViewPage();
  return rfcListView();
}
function rfcListView() {
  const L = db.rfc.requests, admin = me.role === 'admin';
  return tpl('tpl-rfc-list', { empty: !L.length, isAdmin: admin, intro: admin ? 'All requests for check made by the employees and the administrator.' : 'Your requests for check. Fill in a request, save it, then print it and sign it by hand.',
    rows: L.map((r) => ({ id: r.id, isAdmin: admin, no: rfcNo(r.id), vendor: r.vendorName, reason: r.reason, items: r.items.length + (r.items.length === 1 ? ' item' : ' items'), total: peso(r.total), needed: r.dateNeeded ? fmt(r.dateNeeded) : '-', owner: r.owner || '-', created: fmt(r.createdAt) })) });
}
function rfcNew() { ui.rfc = { mode: 'form', draft: rfcBlank() }; render(); window.scrollTo(0, 0); }
function rfcOpen(id, mode) { const r = db.rfc.requests.find((x) => x.id === id); if (!r) return; ui.rfc = { mode, draft: rfcCopy(r) }; render(); window.scrollTo(0, 0); }
function rfcBack() { ui.rfc = { mode: 'list' }; render(); window.scrollTo(0, 0); }
async function rfcDelete(id) {
  const r = db.rfc.requests.find((x) => x.id === id); if (!r) return;
  if (!(await confirmBox({ title: 'Delete this request?', text: 'The request for check for ' + r.vendorName + ' (' + rfcNo(r.id) + ') will be deleted for good.', yes: 'Delete', no: 'Cancel' }))) return;
  ui.rfc = { mode: 'list' }; await call('rfc', 'delete', { id });
}
function rfcViewPage() {
  const d = ui.rfc.draft, f = tpl('tpl-rfc-view', { no: rfcNo(d.id), vendor: d.vendorName, id: d.id });
  slot(f, 'sheet', rfcSheet(d)); return f;
}

/* ---------- the form ---------- */
function rfcFormView() {
  const d = ui.rfc.draft;
  const f = tpl('tpl-rfc-form', { ...d, heading: d.id ? 'Edit request for check (' + rfcNo(d.id) + ')' : 'New request for check', people: db.rfc.people, total: peso(rfcTotal(d)),
    reasons: RFC_REASONS.map((v) => ({ v, checked: d.reason === v })),
    items: d.items.map((it, i) => ({ i, title: 'Item ' + (i + 1), name: it.name, units: it.units, amount: it.amount, noUsers: !it.users.length, users: it.users.map((u, k) => ({ i, u: k, name: u.name, detail: u.detail })) })) });
  slot(f, 'sheet', rfcSheet(d)); return f;
}
function rfcDraw() { // only the printable preview and the total are redrawn while typing, so the cursor stays where it is
  const z = ui.rfc; if (!z || z.mode !== 'form') return;
  slot(document, 'sheet', rfcSheet(z.draft)); const t = $id('rfc-total'); if (t) t.textContent = peso(rfcTotal(z.draft));
}
function rfcSet(k, v) { ui.rfc.draft[k] = v; rfcDraw(); }
function rfcItemSet(el, k) { ui.rfc.draft.items[+el.dataset.i][k] = el.value; rfcDraw(); }
function rfcUserSet(el, k) {
  const u = ui.rfc.draft.items[+el.dataset.i].users[+el.dataset.u]; u[k] = el.value;
  if (k === 'name' && !u.detail) { // a name from the list of accounts fills in the department and position
    const p = db.rfc.people.find((x) => x.name.toLowerCase() === el.value.trim().toLowerCase());
    if (p && p.detail) { u.detail = p.detail; const dt = el.parentNode.querySelector('[data-f="detail"]'); if (dt) dt.value = p.detail; }
  }
  rfcDraw();
}
function rfcFocus(sel) { setTimeout(() => { const l = document.querySelectorAll(sel); if (l.length) l[l.length - 1].focus(); }, 0); }
function rfcAddItem() { ui.rfc.draft.items.push(rfcItem()); render(); rfcFocus('.rfc-item-name'); }
function rfcDelItem(i) { const L = ui.rfc.draft.items; if (L.length === 1) L[0] = rfcItem(); else L.splice(+i, 1); render(); }
function rfcAddUser(i) { ui.rfc.draft.items[+i].users.push({ name: '', detail: '' }); render(); const rows = document.querySelectorAll('.rfc-item')[+i].querySelectorAll('.rfc-user [data-f="name"]'); rows[rows.length - 1].focus(); }
function rfcDelUser(i, u) { ui.rfc.draft.items[+i].users.splice(+u, 1); render(); }
async function rfcSave(e) {
  e.preventDefault();
  const z = ui.rfc;
  try {
    const r = await api('rfc', 'save', z.draft); await refresh();
    const saved = db.rfc.requests.find((x) => x.id === r.id);
    ui.rfc = { mode: 'view', draft: rfcCopy(saved) }; render(); window.scrollTo(0, 0);
    popup('Request saved', rfcNo(r.id) + ' for ' + saved.vendorName + ' was saved (' + peso(saved.total) + '). Print it and sign it by hand.');
  } catch (err) {
    if (err.status === 401) { me = null; db = null; render(); return; }
    say('rfc-err', 'red', err.message); $id('rfc-err').scrollIntoView({ block: 'center' });
  }
}

/* ---------- the printable form (same layout as the RFC sheet; the signature lines stay blank) ---------- */
function rfcSheet(d) {
  const lines = d.items.map((i) => {
    const n = Number(i.units) || 1, us = (i.users || []).filter((u) => u.name.trim());
    return { title: '(' + n + ' Unit' + (n === 1 ? '' : 's') + ')  ' + i.name, amount: peso(i.amount), hasUsers: us.length > 0, users: us.map((u) => ({ text: u.name.trim() + (u.detail.trim() ? ' (' + u.detail.trim() + ')' : '') })) };
  });
  return tpl('tpl-rfc-sheet', { employeeName: d.employeeName, accountNumber: d.accountNumber, vendorName: d.vendorName, vendorAddress: d.vendorAddress, vendorTin: d.vendorTin,
    needed: rfcDate(d.dateNeeded), check: rfcDate(d.dateOfCheck), reasons: RFC_REASONS.map((r) => ({ label: r, mark: d.reason === r ? '✔' : '' })), lines,
    hasPurpose: !!d.purpose.trim(), purpose: d.purpose, hasNote: !!d.note.trim(), note: d.note, instructions: d.instructions, total: peso(rfcTotal(d)),
    requestedBy: d.requestedBy, recommendedBy: d.recommendedBy, approvedBy: d.approvedBy, reqDate: rfcDate(d.requestedDate), recDate: rfcDate(d.recommendedDate), appDate: rfcDate(d.approvedDate) });
}
function rfcPrint() { // prints only the form: a copy of it is put at the end of the page, and the CSS hides everything else while printing
  const s = $id('rfc-sheet'); if (!s) return;
  const c = s.cloneNode(true); c.id = 'rfc-print'; document.body.appendChild(c);
  const clean = () => { c.remove(); window.removeEventListener('afterprint', clean); };
  window.addEventListener('afterprint', clean); window.print();
}

/* ---------- Excel copy of the form (same rows and merged cells as the RFC sheet; signature lines blank) ---------- */
function rfcWrap(text, n) { // splits a text into lines of at most n characters (the free SheetJS cannot wrap text inside a cell)
  const out = [];
  String(text || '').split('\n').forEach((p) => { let line = ''; p.split(' ').forEach((w) => { if (line && (line + ' ' + w).length > n) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; }); out.push(line); });
  return out;
}
function rfcExcel() {
  if (!window.XLSX) return alert('The Excel library could not be loaded. Check your internet connection or the file js/xlsx.full.min.js.');
  const d = ui.rfc.draft, A = [], mg = [], money = [], put = (r, c, v) => { (A[r] = A[r] || [])[c] = v; }, m = (r1, c1, r2, c2) => mg.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
  put(3, 0, 'REQUEST FOR CHECK'); m(0, 0, 2, 21); m(3, 0, 3, 21);
  put(4, 0, 'EMPLOYEE INFORMATION'); m(4, 0, 4, 21);
  put(5, 0, 'Name:'); m(5, 0, 5, 1); put(5, 2, d.employeeName); m(5, 2, 5, 13); put(5, 14, 'Account Number:'); m(5, 14, 5, 17); put(5, 18, d.accountNumber); m(5, 18, 5, 21);
  put(6, 0, 'VENDOR / PAYEE INFORMATION'); m(6, 0, 6, 21);
  put(7, 0, 'Name:'); m(7, 0, 7, 1); put(7, 2, d.vendorName); m(7, 2, 7, 13); put(7, 14, 'Date check is needed:'); m(7, 14, 7, 17); put(7, 18, rfcDate(d.dateNeeded)); m(7, 18, 7, 21);
  put(8, 0, 'Address:'); m(8, 0, 8, 2); put(8, 3, d.vendorAddress); m(8, 3, 8, 13); put(8, 14, 'Date of Check:'); m(8, 14, 8, 16); put(8, 17, rfcDate(d.dateOfCheck)); m(8, 17, 8, 21);
  put(9, 0, 'TIN, if available:'); m(9, 0, 9, 2); put(9, 3, d.vendorTin); m(9, 3, 9, 21);
  put(10, 0, 'DESCRIPTION / REASON FOR CHECK'); m(10, 0, 10, 16); put(10, 17, 'AMOUNT'); m(10, 17, 10, 21);
  let r = 11; const body = r, row = (text, amount) => { put(r, 6, text); m(r, 6, r, 16); m(r, 17, r, 21); if (amount !== undefined) { put(r, 17, amount); money.push(XLSX.utils.encode_cell({ r, c: 17 })); } r++; };
  d.items.forEach((i) => {
    const n = Number(i.units) || 1; row('(' + n + ' Unit' + (n === 1 ? '' : 's') + ')  ' + i.name, Number(i.amount) || 0);
    const us = (i.users || []).filter((u) => u.name.trim()); if (us.length) { row('Users:'); us.forEach((u) => rfcWrap(u.name.trim() + (u.detail.trim() ? ' (' + u.detail.trim() + ')' : ''), 60).forEach((t) => row(t))); }
  });
  if (d.purpose.trim()) rfcWrap('Purpose: ' + d.purpose.trim(), 60).forEach((t) => row(t));
  if (d.note.trim()) rfcWrap('Note: ' + d.note.trim(), 60).forEach((t) => row(t));
  while (r < body + 5) r++; // room for the five reasons
  RFC_REASONS.forEach((x, k) => { put(body + k, 2, x); m(body + k, 2, body + k, 5); if (d.reason === x) put(body + k, 1, '✔'); });
  put(r, 0, 'Special instruction/s:'); m(r, 0, r, 14); put(r, 15, 'TOTAL'); m(r, 15, r + 1, 16); put(r, 17, rfcTotal(d)); money.push(XLSX.utils.encode_cell({ r, c: 17 })); m(r, 17, r + 1, 21); r++;
  rfcWrap(d.instructions.trim(), 85).forEach((t) => { put(r, 0, t); m(r, 0, r, 14); r++; });
  put(r, 0, 'Requested by:'); m(r, 0, r, 7); put(r, 8, 'Recommended by :'); m(r, 8, r, 15); put(r, 16, 'Approved by:'); m(r, 16, r, 21); r++;
  put(r, 0, d.requestedBy); m(r, 0, r + 1, 7); put(r, 8, d.recommendedBy); m(r, 8, r + 1, 15); put(r, 16, d.approvedBy); m(r, 16, r + 1, 21); const nameRow = r; r += 2;
  [[0, 7], [8, 15], [16, 21]].forEach((c) => { put(r, c[0], 'Signature over printed name'); m(r, c[0], r, c[1]); }); r++; // the signature itself is written by hand on the printed paper
  put(r, 0, 'Date:'); put(r, 2, rfcDate(d.requestedDate)); m(r, 2, r, 7); put(r, 8, 'Date:'); put(r, 9, rfcDate(d.recommendedDate)); m(r, 9, r, 15); put(r, 16, 'Date:'); put(r, 18, rfcDate(d.approvedDate)); m(r, 18, r, 21); r++;
  put(r, 0, 'For Finance use only:'); m(r, 0, r, 21); r++;
  [['Checked by', 0, 5], ['RFC Control number', 6, 9], ['Encoded / Posted / Date:', 10, 12], ['Received / Processed by', 13, 15], ['APV / VOUCHER NO.', 16, 19], ['Final Amount', 20, 21]].forEach((f) => { put(r, f[1], f[0]); m(r, f[1], r, f[2]); m(r + 1, f[1], r + 1, f[2]); });
  r += 2; put(r, 21, 'v.2017');
  const ws = XLSX.utils.aoa_to_sheet(A); ws['!merges'] = mg; ws['!cols'] = Array.from({ length: 22 }, () => ({ wch: 6 }));
  ws['!rows'] = []; ws['!rows'][nameRow] = { hpx: 24 }; ws['!rows'][nameRow + 1] = { hpx: 24 };
  money.forEach((a) => { if (ws[a]) ws[a].z = '#,##0.00'; });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'RFC');
  XLSX.writeFile(wb, (d.id ? 'RFC-' + String(d.id).padStart(4, '0') + '_' : 'RFC_') + (d.vendorName || 'request').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.xlsx');
}
