/* Request for Check tab: every role (admin, immediate superior, employee) can fill in the request, save it, and print it.
   The name in Employee information and in "Requested by" is always the account that made the request. Recommended by and Approved by are chosen from the four fixed signers
   (Jel, Sherwin, Joel, Catherine) or typed under "Other" (those are signed by hand).
   E-signatures come from the picture each person saved in Profile. The lines are signed in a fixed order in the "For Signing" subtab: Requested by, then Recommended by, then Approved by.
   Every account has the For Signing subtab (the admin sees every request, grouped by RFC number, and can search and filter them).
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
/* ---- the two name lines (Recommended by, Approved by): each name is chosen from the four signers or typed under "Other" ---- */
const RFC_LINES = { recommended: 'recommendedBy', approved: 'approvedBy' }; // Requested by is not a choice: it is always the one who made the request
function rfcRows(str) {
  const names = db.rfc.signerNames || {}, rows = String(str || '').split('|').map((x) => x.trim()).filter(Boolean).map((n) => {
    const k = Object.keys(names).find((x) => names[x].toLowerCase() === n.toLowerCase()); return k ? { sel: k, text: '' } : { sel: 'other', text: n };
  });
  return rows.length ? rows : [{ sel: '', text: '' }];
}
const rfcJoin = (rows) => rows.map((r) => (r.sel && r.sel !== 'other' ? db.rfc.signerNames[r.sel] : r.text.trim())).filter(Boolean).join(' | ');
function rfcInitRows(d) { d.rows = {}; Object.keys(RFC_LINES).forEach((l) => { d.rows[l] = rfcRows(d[RFC_LINES[l]]); }); return d; }
function rfcSyncNames(d) { Object.keys(RFC_LINES).forEach((l) => { d[RFC_LINES[l]] = rfcJoin(d.rows[l]); }); }
function rfcPickData(d, line) {
  const names = db.rfc.signerNames || {}, rows = d.rows[line];
  return rows.map((r, n) => ({ line, n, text: r.text, custom: r.sel === 'other', canDel: line === 'recommended' && rows.length > 1,
    opts: [{ v: '', label: 'Select a name...', sel: r.sel === '' }, ...Object.keys(names).map((k) => ({ v: k, label: names[k], sel: r.sel === k })), { v: 'other', label: 'Other (type a name)', sel: r.sel === 'other' }] }));
}
function rfcPickSel(el) { const d = ui.rfc.draft, r = d.rows[el.dataset.line][+el.dataset.n]; r.sel = el.value; if (el.value !== 'other') r.text = ''; rfcSyncNames(d); render(); }
function rfcPickText(el) { const d = ui.rfc.draft; d.rows[el.dataset.line][+el.dataset.n].text = el.value; rfcSyncNames(d); rfcDraw(); }
function rfcPickAdd(line) { const d = ui.rfc.draft; d.rows[line].push({ sel: '', text: '' }); render(); }
function rfcPickDel(line, n) { const d = ui.rfc.draft, L = d.rows[line]; L.splice(+n, 1); if (!L.length) L.push({ sel: '', text: '' }); rfcSyncNames(d); render(); }
/* ---------- Vendor / Payee: choose a registered supplier from the Supplier Master, or Others (type the name) ---------- */
const RFC_OTHER = 'other';
function rfcVendorSelValue(d) { // what the Name list shows: '' (nothing chosen), a supplier id, or 'other'. A saved request is matched to the Supplier Master by its name.
  if (d.vendorSel !== undefined) return d.vendorSel;
  const n = (d.vendorName || '').trim().toLowerCase(); if (!n) return '';
  const m = (db.suppliers || []).find((x) => x.name.trim().toLowerCase() === n);
  return m ? m.id : RFC_OTHER;
}
function rfcVendorOpts(d) {
  const cur = rfcVendorSelValue(d), L = (db.suppliers || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  return [{ v: '', label: 'Select a registered vendor / supplier...', sel: cur === '' }, ...L.map((x) => ({ v: x.id, label: x.name, sel: cur === x.id })), { v: RFC_OTHER, label: 'Others (type the payee / vendor name)', sel: cur === RFC_OTHER }];
}
function rfcVendorPick(v) {
  const d = ui.rfc.draft, was = rfcVendorSelValue(d), sup = (db.suppliers || []).find((x) => x.id === v);
  d.vendorSel = v;
  if (sup) { d.vendorName = sup.name; d.vendorTin = sup.tin || ''; d.vendorAddress = sup.address || ''; }  // the TIN and the physical address come from the Supplier Master (they can still be corrected here)
  else if (was !== RFC_OTHER) { d.vendorName = ''; d.vendorTin = ''; d.vendorAddress = ''; } // from a registered supplier to Others / nothing: start with empty boxes
  render();
  if (v === RFC_OTHER) rfcFocus('.rfc-form label[data-vendor-other] input');
}
// "Add supplier" opens the Supplier Master form in a large window. When it is saved, the Supplier Master is updated and the new supplier is chosen here.
function rfcAddSupplier() {
  const d = ui.rfc.draft;
  supplierForm('', { modal: true, name: rfcVendorSelValue(d) === RFC_OTHER ? (d.vendorName || '') : '', onSaved: (sup) => { d.vendorSel = sup.id; d.vendorName = sup.name; d.vendorTin = sup.tin || ''; d.vendorAddress = sup.address || ''; } });
}
function rfcBlank() {
  return { id: '', employeeName: me.name, accountNumber: '', vendorName: '', vendorAddress: '', vendorTin: '', dateNeeded: '', dateOfCheck: '', reason: 'Payment', purpose: '', note: 'Please see the attached files', instructions: '',
    requestedBy: me.name, recommendedBy: db.rfc.defaults.recommendedBy, approvedBy: db.rfc.defaults.approvedBy, requestedDate: rfcToday(), recommendedDate: '', approvedDate: '', items: [rfcItem()] };
}

/* ---------- the page: list, form, or one saved request ---------- */
function rfcHome() { ui.rfc = null; ui.rfcs = null; if (location.hash === '#' + rfcPath()) render(); else go(rfcPath()); return false; } // the menu link always starts at the list
const RFC_SLOT_LABEL = { requested: 'Requested by', recommended: 'Recommended by', approved: 'Approved by' };
const rfcSub = () => routeParts()[me.role === 'admin' ? 2 : 1] || ''; // '' = My requests, 'sign' = For Signing
// The sidebar / top menu entry. The For Signing subtab exists only when the server sent signing data (the four signers and the admin), never for employees.
function rfcNavItem(lk, sec) {
  const S = db.rfc && db.rfc.sign, sign = sec === 'rfc' && rfcSub() === 'sign', n = S ? S.pending : 0;
  const main = lk('rfc', 'Request for Check' + (n ? ' (' + n + ')' : ''), sec === 'rfc' && !sign, 'return rfcHome()');
  if (!S) return main;
  return { key: 'rfc', ...main, cls: sec === 'rfc' ? 'active' : '', hasSub: true,
    sub: [lk('rfc', 'My Requests', sec === 'rfc' && !sign, 'return rfcHome()'), lk('rfc/sign', 'For Signing' + (n ? ' (' + n + ')' : ''), sign, 'return rfcSignHome()')] };
}
function rfcPage() {
  if (!db.rfc) return message('Request for Check', db.rfcSetup ? 'The Request for Check tables need to be set up. In phpMyAdmin, import migration_rfc.sql (first time only) and reload this page.' : 'This page is not available.', me.role === 'admin' ? '/admin' : '/home', 'Back to Home');
  if (rfcSub() === 'sign') return rfcSignPage();
  const z = ui.rfc || (ui.rfc = { mode: 'list' });
  if (z.mode === 'form') return rfcFormView();
  if (z.mode === 'view') return rfcViewPage();
  return rfcListView();
}
function rfcListView() {
  const L = db.rfc.requests, admin = me.role === 'admin';
  return tpl('tpl-rfc-list', { empty: !L.length, isAdmin: admin, intro: admin ? 'All requests for check made by the employees and the administrator.' : 'Your requests for check. Fill in a request, save it, then e-sign it in For Signing, or print it and sign it by hand.',
    rows: L.map((r) => ({ id: r.id, isAdmin: admin, no: rfcNo(r.id), vendor: r.vendorName, reason: r.reason, items: r.items.length + (r.items.length === 1 ? ' item' : ' items'), total: peso(r.total), needed: r.dateNeeded ? fmt(r.dateNeeded) : '-', esig: r.stepCount ? r.signedCount + ' of ' + r.stepCount + ' e-signed' : '-', owner: r.owner || '-', created: fmt(r.createdAt) })) });
}
function rfcNew() { ui.rfc = { mode: 'form', draft: rfcInitRows(rfcBlank()) }; render(); window.scrollTo(0, 0); }
function rfcOpen(id, mode) { const r = db.rfc.requests.find((x) => x.id === id); if (!r) return; ui.rfc = { mode, draft: rfcInitRows(rfcCopy(r)) }; render(); window.scrollTo(0, 0); }
function rfcBack() { ui.rfc = { mode: 'list' }; render(); window.scrollTo(0, 0); }
async function rfcDelete(id) {
  const r = db.rfc.requests.find((x) => x.id === id); if (!r) return;
  if (!(await confirmBox({ title: 'Delete this request?', text: 'The request for check for ' + r.vendorName + ' (' + rfcNo(r.id) + ') will be deleted for good.', yes: 'Delete', no: 'Cancel' }))) return;
  ui.rfc = { mode: 'list' }; await call('rfc', 'delete', { id });
}
function rfcViewPage() {
  const d = ui.rfc.draft, f = tpl('tpl-rfc-view', { no: rfcNo(d.id), vendor: d.vendorName, id: d.id });
  slot(f, 'sheet', rfcSheet(d, d.signatures)); return f;
}

/* ---------- the form ---------- */
function rfcFormView() {
  const d = ui.rfc.draft;
  const f = tpl('tpl-rfc-form', { ...d, heading: d.id ? 'Edit request for check (' + rfcNo(d.id) + ')' : 'New request for check', people: db.rfc.people, total: peso(rfcTotal(d)), namesOpen: ui.rfcNames !== false, namesBtn: ui.rfcNames !== false ? 'Minimize' : 'Maximize', pickRecommended: rfcPickData(d, 'recommended'), pickApproved: rfcPickData(d, 'approved'),
    recommendedBy: d.recommendedBy || '-', approvedBy: d.approvedBy || '-', reasons: RFC_REASONS.map((v) => ({ v, checked: d.reason === v })),
    vendorOpts: rfcVendorOpts(d), vendorOther: rfcVendorSelValue(d) === RFC_OTHER,
    items: d.items.map((it, i) => ({ i, title: 'Item ' + (i + 1), name: it.name, units: it.units, amount: it.amount, noUsers: !it.users.length, users: it.users.map((u, k) => ({ i, u: k, name: u.name, detail: u.detail })) })) });
  slot(f, 'sheet', rfcSheet(d)); return f;
}
function rfcToggleNames() { ui.rfcNames = ui.rfcNames === false; render(); } // minimize / maximize the "Names for the signature lines" box (the chosen names are kept in the draft)
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
    popup('Request saved', rfcNo(r.id) + ' for ' + saved.vendorName + ' was saved (' + peso(saved.total) + ').' + (db.rfc.sign && saved.stepCount ? ' Open For Signing to add your e-signature first, so the next people can sign. You can also print it and sign it by hand.' : ' Print it and sign it by hand.'));
  } catch (err) {
    if (err.status === 401) { me = null; db = null; render(); return; }
    say('rfc-err', 'red', err.message); $id('rfc-err').scrollIntoView({ block: 'center' });
  }
}

/* ---------- the printable form (same layout as the RFC sheet; the signature lines stay blank) ---------- */
function rfcSheet(d, sigs) { // sigs = e-signatures to print above the names (none while the form is being edited: saving a change clears them)
  const lines = d.items.map((i) => {
    const n = Number(i.units) || 1, us = (i.users || []).filter((u) => u.name.trim());
    return { title: '(' + n + ' Unit' + (n === 1 ? '' : 's') + ')  ' + i.name, amount: peso(i.amount), hasUsers: us.length > 0, users: us.map((u) => ({ text: u.name.trim() + (u.detail.trim() ? ' (' + u.detail.trim() + ')' : '') })) };
  });
  return rfcSigFallback(tpl('tpl-rfc-sheet', { employeeName: d.employeeName, accountNumber: d.accountNumber, vendorName: d.vendorName, vendorAddress: d.vendorAddress, vendorTin: d.vendorTin,
    needed: rfcDate(d.dateNeeded), check: rfcDate(d.dateOfCheck), reasons: RFC_REASONS.map((r) => ({ label: r, mark: d.reason === r ? '✔' : '' })), lines,
    hasPurpose: !!d.purpose.trim(), purpose: d.purpose, hasNote: !!d.note.trim(), note: d.note, instructions: d.instructions, total: peso(rfcTotal(d)),
    reqSigs: rfcBlocks(d.requestedBy, 'requested', sigs), recSigs: rfcBlocks(d.recommendedBy, 'recommended', sigs), appSigs: rfcBlocks(d.approvedBy, 'approved', sigs),
    requestedBy: d.requestedBy, recommendedBy: d.recommendedBy, approvedBy: d.approvedBy, reqDate: rfcDate(d.requestedDate), recDate: rfcDate(d.recommendedDate), appDate: rfcDate(d.approvedDate) }));
}
// one block per printed name ("Jel Mabato | Sherwin" = two blocks), each with its e-signature above the name when that person has signed
// (the Requested by line is matched by its line, because it is always the one who made the request; the other lines by the name of the fixed signer)
function rfcBlocks(text, slot, sigs) {
  const names = String(text || '').split('|').map((x) => x.trim()).filter(Boolean);
  if (!names.length) names.push('');
  return names.map((name) => {
    const words = name.toLowerCase().split(/[^a-z0-9]+/), key = Object.keys(db.rfc.signerNames || {}).find((k) => words.includes(k));
    const g = (sigs || []).find((x) => x.slot === slot && (slot === 'requested' || (key && x.key === key)));
    return { name, hasSig: !!g && !!g.img, src: g ? g.img : '', alt: g ? g.name : '', cls: g && g.temp ? 'rfc-esig preview' : 'rfc-esig' };
  });
}
// a signature picture that is missing (or not uploaded yet) is replaced by the signer's name in handwriting style, so the form still shows who signed
function rfcSigFallback(root) {
  root.querySelectorAll('img.rfc-esig').forEach((img) => img.addEventListener('error', () => {
    const t = document.createElement('span'); t.className = 'rfc-esig-text' + (img.classList.contains('preview') ? ' preview' : ''); t.textContent = img.alt; img.replaceWith(t);
  }));
  return root;
}
function rfcPrint() { // prints only the form: a copy of it is put at the end of the page, and the CSS hides everything else while printing
  const s = $id('rfc-sheet'); if (!s) return;
  const c = s.cloneNode(true); c.id = 'rfc-print'; document.body.appendChild(c);
  const clean = () => { c.remove(); window.removeEventListener('afterprint', clean); };
  window.addEventListener('afterprint', clean); window.print();
}

/* ---------- "For Signing" subtab: one card for each request, with its signature lines in signing order ---------- */
const RFC_SIGN_FILTERS = [['all', 'All requests'], ['pending', 'Pending (not fully signed)'], ['mine', 'Waiting for my signature'], ['closed', 'Closed (fully signed)']];
const rfcSignState = () => ui.rfcs || (ui.rfcs = { id: '', key: '', adding: false, q: '', f: 'all' });
const rfcReq = (c) => c.request || db.rfc.requests.find((x) => x.id === c.id); // a request the browser already has is not sent a second time
function rfcSignHome() { // the sidebar link: always starts at the list of cards
  ui.rfc = null; ui.rfcs = null;
  const p = me.role === 'admin' ? '/admin/rfc/sign' : '/rfc/sign';
  if (location.hash === '#' + p) render(); else go(p);
  return false;
}
function rfcSignPage() {
  const S = db.rfc.sign;
  if (!S) return message('For Signing', db.rfc.signSetup ? 'E-signing needs the table rfc_signatures. Import sql/schema.sql in phpMyAdmin (this resets the demo data), or ask the administrator.' : 'This page is not available.', me.role === 'admin' ? '/admin' : '/home', 'Back to Home');
  const z = rfcSignState();
  if (z.id) { const c = S.cards.find((x) => x.id === z.id); if (c && rfcReq(c)) return rfcSignDetail(c, z); z.id = ''; z.key = ''; z.adding = false; }
  const f = tpl('tpl-rfc-sign-list', { q: z.q, filters: RFC_SIGN_FILTERS.map((x) => ({ v: x[0], label: x[1], sel: z.f === x[0] })),
    intro: S.admin ? 'Every request for check, one card for each RFC number, with its signature lines in signing order: Requested by, then Recommended by, then Approved by. As the admin you can review and e-sign any line.' : 'Requests for check that carry your name. A line can be signed only after the lines before it are signed. Your e-signature comes from your Profile.' });
  rfcSignFill(f); return f;
}
function rfcSignFilter() { // the cards that match the search box and the filter
  const S = db.rfc.sign, z = rfcSignState(), q = z.q.trim().toLowerCase(), isNo = /^(rfc)?\s*#?\s*\d+$/.test(q), digits = q.replace(/\D/g, '');
  return S.cards.filter((c) => {
    const r = rfcReq(c); if (!r) return false;
    const mine = r.steps.some((s) => s.key === S.mineKey && s.ready);
    if (z.f === 'pending' && r.closed) return false;
    if (z.f === 'mine' && !mine) return false;
    if (z.f === 'closed' && !r.closed) return false;
    if (!q) return true;
    if (isNo) return String(r.id).padStart(4, '0').includes(digits); // "3", "0003", "#0003" and "RFC #0003" all find RFC #0003
    return (rfcNo(r.id) + ' ' + r.vendorName + ' ' + r.owner + ' ' + r.reason).toLowerCase().includes(q);
  });
}
function rfcSignCard(c) {
  const S = db.rfc.sign, r = rfcReq(c);
  return tpl('tpl-rfc-sign-card', { no: rfcNo(r.id), vendor: r.vendorName, total: peso(r.total), reason: r.reason, owner: r.owner || '-', created: fmt(r.createdAt),
    statusLabel: r.closed ? '✓ Closed' : r.signedCount + ' of ' + r.stepCount + ' signed', statusCls: r.closed ? 'green' : 'orange',
    steps: r.steps.map((s, i) => {
      const mine = s.key === S.mineKey, act = !s.signed && s.ready;
      return { n: i + 1, label: RFC_SLOT_LABEL[s.slot], name: s.name, id: r.id, key: s.key, hasBtn: S.admin || mine, btn: act ? 'Review & sign' : 'View', btnCls: act ? '' : 'ghost',
        status: s.signed ? '✓ Signed ' + fmt(s.at) : s.ready ? (mine ? 'Waiting for your signature' : 'Waiting for signature') : 'Waiting for ' + s.waitingFor, cls: s.signed ? 'green' : s.ready ? 'orange' : 'gray' };
    }) });
}
function rfcSignFill(root) { // draws the cards and the count (also used while typing in the search box, so the cursor stays where it is)
  const S = db.rfc.sign, list = rfcSignFilter();
  root.querySelector('#rfc-sign-cards').replaceChildren(...list.map(rfcSignCard));
  root.querySelector('#rfc-sign-count').textContent = list.length + ' of ' + S.cards.length + (S.cards.length === 1 ? ' request' : ' requests');
  const box = root.querySelector('#rfc-sign-empty'); box.replaceChildren();
  if (!list.length) {
    const card = document.createElement('div'), h = document.createElement('h3'), p = document.createElement('p');
    card.className = 'card center'; p.className = 'muted';
    h.textContent = S.cards.length ? 'No request matches' : 'Nothing to sign';
    p.textContent = S.cards.length ? 'Try another number, name or filter.' : 'When a request for check carries your name, its card appears here and you are notified.';
    card.append(h, p); box.append(card);
  }
}
function rfcSignQ(v) { rfcSignState().q = v; rfcSignFill(document); }
function rfcSignF(v) { rfcSignState().f = v; rfcSignFill(document); }
function rfcSignOpen(id, key) { const z = rfcSignState(); z.id = id; z.key = key; z.adding = false; render(); window.scrollTo(0, 0); }
function rfcSignBack() { const z = rfcSignState(); z.id = ''; z.key = ''; z.adding = false; render(); window.scrollTo(0, 0); }
function rfcSignDetail(c, z) {
  const S = db.rfc.sign, r = rfcReq(c), own = S.mineKey === z.key, allowed = own || S.admin;
  const mine = r.steps.filter((s) => s.key === z.key), ready = mine.filter((s) => s.ready), left = mine.filter((s) => !s.signed);
  const nm = mine.length ? mine[0].name : '', usable = ready.length > 0 && !!ready[0].img, canSign = allowed && usable, signed = mine.length > 0 && !left.length;
  const sigs = r.signatures.concat(z.adding && canSign ? ready.map((s) => ({ key: s.key, name: s.name, slot: s.slot, img: s.img, temp: true })) : []);
  let hint;
  if (z.adding && canSign) hint = (own ? 'Your e-signature' : nm + "'s e-signature, added by you as admin,") + ' is shown above the printed name. Press Confirm to save it, or Remove to take it off.';
  else if (signed) hint = 'This request is already signed by ' + nm + '.';
  else if (!allowed) hint = 'View only.';
  else if (!ready.length) hint = (own ? 'Not your turn yet. ' : '') + 'Waiting for ' + (left.length ? left[0].waitingFor : 'the lines before') + ' to sign first.';
  else if (!usable) hint = own ? 'You have not added an e-signature yet. Add it in Profile, then come back to sign.' : nm + ' has not added an e-signature in Profile yet.';
  else hint = 'Check the request, then press Add e-signature' + (own ? '.' : ' for ' + nm + ' (as admin).');
  const f = tpl('tpl-rfc-sign-detail', { no: rfcNo(r.id), vendor: r.vendorName, canAdd: canSign && !z.adding, adding: canSign && z.adding, needProfile: own && ready.length > 0 && !usable, signed,
    signedText: signed ? 'Signed ' + fmt(mine.map((s) => s.at).sort().pop()) : '', hint });
  slot(f, 'sheet', rfcSheet(r, sigs)); return f;
}
function rfcSignAdd() { rfcSignState().adding = true; render(); }
function rfcSignRemove() { rfcSignState().adding = false; render(); }
async function rfcSignConfirm() {
  const z = rfcSignState(); if (!z.adding) return;
  const btn = $id('rfc-sign-confirm'); if (btn) btn.disabled = true;
  try {
    const r = await api('rfc', 'sign', { id: z.id, key: z.key }), id = z.id; await refresh(); z.id = ''; z.key = ''; z.adding = false; render(); window.scrollTo(0, 0);
    popup('E-signature saved', rfcNo(id) + (r.closed ? ' is now fully signed and closed.' : ' was signed. The next person in the signing order can sign now.'));
  } catch (err) {
    if (err.status === 401) { me = null; db = null; render(); return; }
    if (btn) btn.disabled = false; popup('Could not sign', err.message, 'error');
    if (err.status === 409) { z.adding = false; try { await refresh(); } catch (e) { /* ignore */ } render(); }
  }
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
  put(9, 0, 'TIN:'); m(9, 0, 9, 2); put(9, 3, d.vendorTin); m(9, 3, 9, 21);
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
