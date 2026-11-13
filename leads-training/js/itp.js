/* IT Procurement Requisition tab: every role (admin, immediate superior, employee) can fill in the form and save it as a draft. Then it follows this process (api/itp.php):
   1. The requestor submits: the e-signature of the requestor and of the requestor's Line Manager (the immediate supervisor) are added automatically.
   2. An IT Department employee attaches the link of the assessment and submits it: that employee's e-signature is added.
   3. The IT Manager (Sherwin Greso) checks the assessment and approves it (or returns it): the e-signature is added above the printed name.
   4. The requestor prints the form and gives it to the PO (outside the system). When the item arrives an IT Department account marks it as received and closes the form.
   Pending = not closed yet; Closed = the archive. Every e-signature is the picture saved in the Profile of that person.
   The names of the requestor and of the Line Manager are fixed, and the IT Manager is a constant (Sherwin Greso): the server forces them too (api/itp.php).
   Saved by api/itp.php. An employee sees their own requisitions; the admin and the IT Department see the submitted ones. The screens are templates in index.html.
   Small helpers (peso, rfcToday, rfcDate, rfcCopy, rfcFocus) come from js/rfc.js, which is loaded first. */
const ITP_NATURES = ['Equipment', 'License', 'Repair', 'Maintenance', 'Software', 'Others'];
const ITP_IT_MANAGER = 'Sherwin Greso';
const ITP_MIN_ROWS = 6; // the paper form has six rows; the printed sheet is padded to this many
const ITP_STAGES = ['draft', 'assessment', 'approval', 'approved', 'received', 'closed'];
const itpPath = () => (me.role === 'admin' ? '/admin/itp' : '/itp');
const itpNo = (id) => 'ITP #' + String(id).padStart(4, '0');
const itpBadge = () => (db && db.itp && db.itp.pending ? ' (' + db.itp.pending + ')' : ''); // the number of requisitions waiting for this person, shown in the menu
const itpItem = () => ({ qty: 1, unit: '', description: '', budgetedPrice: '' });
const itpLine = (i) => (Number(i.qty) || 0) * (Number(i.budgetedPrice) || 0); // total price of a line = quantity x budgeted price
const itpTotal = (d) => d.items.reduce((s, i) => s + itpLine(i), 0);
function itpBlank() {
  const m = db.itp.myManager;
  return { id: '', ownerId: me.id, dateOfRequest: rfcToday(), dateRequired: '', department: 'IT', requestedBy: me.name, notedBy: '', subsidiary: '', chargeable: 'No', chargeableTo: '', budget: 'No', budgetAmount: '',
    nature: 'Equipment', natureOther: '', specialInstructions: '', purpose: '', assignee: '', requestorName: me.name, lineManagerName: m ? m.name : '', lineManagerId: m ? m.id : '', itStaffName: '', sigs: {}, items: [itpItem()] };
}
const itpCur = () => { const z = ui.itp; return z && z.id ? db.itp.requests.find((x) => x.id === z.id) : null; };

/* ---------- the page: list, form, or one saved requisition ---------- */
function itpHome() { ui.itp = null; if (location.hash === '#' + itpPath()) render(); else go(itpPath()); return false; } // the menu link always starts at the list
function itpPage() {
  if (!db.itp) return message('IT Procurement Requisition', db.itpSetup ? 'The IT Procurement Requisition could not be set up. Check that MySQL is running and allows changing the tables, then reload this page.' : 'This page is not available.', me.role === 'admin' ? '/admin' : '/home', 'Back to Home');
  const z = ui.itp || (ui.itp = { mode: 'list' });
  if (z.mode === 'form') return itpFormView();
  if (z.mode === 'view') return itpViewPage();
  return itpListView();
}
const itpStageCls = (r) => ({ draft: 'gray', assessment: 'orange', approval: 'orange', approved: 'green', received: 'blue', closed: 'gray' })[r.stage];
function itpListView() {
  const L = db.itp.requests, tab = ui.itpTab || 'pending', admin = me.role === 'admin', n = db.itp.pending;
  const f = tpl('tpl-itp-list', { q: ui.itpQ || '', pendingCls: tab === 'pending' ? 'active' : '', closedCls: tab === 'closed' ? 'active' : '', nPending: '(' + L.filter((r) => !r.closed).length + ')', nClosed: '(' + L.filter((r) => r.closed).length + ')',
    intro: admin ? 'All IT Procurement Requisition Forms. Pending forms stay here until the item is received and the form is closed; closed forms are kept in the Closed tab.' : db.itp.isIt ? 'Your forms and the submitted forms that need the IT Department. Pending forms stay here until the item is received and the form is closed.' : 'Your IT Procurement Requisition Forms. Save a form, submit it, and print it when it is approved. It stays in Pending until it is closed.',
    needsText: n ? n + (n === 1 ? ' requisition is' : ' requisitions are') + ' waiting for you.' : '' });
  itpFillRows(f); return f;
}
function itpFillRows(root) { // draws the rows of the chosen tab (also used while typing in the search box, so the cursor stays where it is)
  const tab = ui.itpTab || 'pending', q = (ui.itpQ || '').trim().toLowerCase(), isNo = /^(itp)?\s*#?\s*\d+$/.test(q), digits = q.replace(/\D/g, '');
  const L = db.itp.requests.filter((r) => (tab === 'closed' ? r.closed : !r.closed) && (!q || (isNo ? String(r.id).padStart(4, '0').includes(digits) : (itpNo(r.id) + ' ' + r.nature + ' ' + r.owner + ' ' + r.stageLabel).toLowerCase().includes(q))));
  root.querySelector('#itp-rows').replaceChildren(...L.map((r) => tpl('tpl-itp-row', { id: r.id, no: itpNo(r.id), requested: r.dateOfRequest ? fmt(r.dateOfRequest) : '-', nature: r.nature === 'Others' && r.natureOther ? 'Others: ' + r.natureOther : r.nature,
    items: r.items.length + (r.items.length === 1 ? ' item' : ' items'), total: peso(r.total), required: r.dateRequired ? fmt(r.dateRequired) : '-', owner: r.owner || '-', stage: r.stageLabel, stageCls: itpStageCls(r),
    needsMe: r.flags.needsMe, canEdit: r.flags.canEdit, canDelete: r.flags.canDelete })));
  const box = root.querySelector('#itp-empty'); box.replaceChildren(); root.querySelector('#itp-table').classList.toggle('hidden', !L.length);
  if (!L.length) {
    const card = document.createElement('div'), h = document.createElement('h3'), p = document.createElement('p'); card.className = 'card center'; p.className = 'muted';
    h.textContent = q ? 'No requisition matches' : tab === 'closed' ? 'No closed requisitions yet' : 'No pending requisitions';
    p.textContent = q ? 'Try another number or word.' : tab === 'closed' ? 'Forms are moved here when the item is received and the form is closed.' : 'Press + New requisition to fill in an IT Procurement Requisition Form.';
    card.append(h, p); box.append(card);
  }
}
function itpTab(v) { ui.itpTab = v; render(); }
function itpQ(v) { ui.itpQ = v; itpFillRows(document); }
function itpNew() { ui.itp = { mode: 'form', id: '', draft: itpBlank() }; render(); window.scrollTo(0, 0); }
function itpOpen(id, mode) { const r = db.itp.requests.find((x) => x.id === id); if (!r) return; ui.itp = { mode, id, draft: mode === 'form' ? rfcCopy(r) : null }; render(); window.scrollTo(0, 0); }
function itpBack() { ui.itp = { mode: 'list' }; render(); window.scrollTo(0, 0); }
async function itpDelete(id) {
  const r = db.itp.requests.find((x) => x.id === id); if (!r) return;
  if (!(await confirmBox({ title: 'Delete this requisition?', text: itpNo(r.id) + ' (' + r.nature + ', ' + peso(r.total) + ') will be deleted for good.', yes: 'Delete', no: 'Cancel' }))) return;
  ui.itp = { mode: 'list' }; await call('itp', 'delete', { id });
}

/* ---------- one saved requisition: the process, the actions that belong to this person, and the printable form ---------- */
function itpViewPage() {
  const r = itpCur(); if (!r) { ui.itp = { mode: 'list' }; return itpListView(); }
  const F = r.flags, S = r.sigs || {}, idx = ITP_STAGES.indexOf(r.stage), mine = r.ownerId === me.id, at = (g) => (g ? ' · signed ' + fmt(g.at) : '');
  const steps = [
    { label: 'Requestor submits', who: r.owner + at(S.requestor), done: idx >= 1 },
    { label: 'Line Manager e-signature', who: (r.lineManagerName || 'Not chosen') + (S.linemanager ? ' · added on submit' : ''), done: idx >= 1 },
    { label: 'IT Department assessment', who: (r.itStaffName || 'Another IT employee') + at(S.itstaff), done: idx >= 2 },
    { label: 'IT Manager approval', who: ITP_IT_MANAGER + at(S.itmanager), done: idx >= 3 },
    { label: 'Print and give to the PO', who: 'Outside the system', done: idx >= 4 },
    { label: 'Item received', who: 'IT Department' + (r.receivedAt ? ' · ' + fmt(r.receivedAt) : ''), done: idx >= 4 },
    { label: 'Closed', who: r.closedAt ? fmt(r.closedAt) : 'IT Department', done: idx >= 5 }];
  const cur = steps.findIndex((x) => !x.done);
  const hints = { draft: mine ? 'Check the form, then press Submit requisition. Your e-signature and the e-signature of your Line Manager (' + (r.lineManagerName || 'not chosen yet') + ') are added when you submit. You cannot edit it after that.' : 'This requisition is still a draft.',
    assessment: F.canAssess ? 'Attach the link of your assessment and submit it. Your e-signature is added to the form.' : 'Waiting for another IT Department employee to attach the assessment.',
    approval: F.canApprove ? 'Open the assessment link and check it. If it is okay, approve it and your e-signature is added above your printed name.' : 'Waiting for the IT Manager (' + ITP_IT_MANAGER + ') to check the assessment.',
    approved: mine ? 'All e-signatures are complete. Print the form and give it to the PO. When the item arrives, the IT Department updates the status.' : 'Approved. All e-signatures are complete. The requestor prints it and gives it to the PO.',
    received: F.canClose ? 'The item was received. Close the form to move it to the Closed tab.' : 'The item was received. The IT Department will close the form.',
    closed: 'This form is closed and kept in the Closed tab.' };
  const f = tpl('tpl-itp-view', { id: r.id, no: itpNo(r.id), nature: r.nature, owner: r.owner || '-', stageLabel: r.stageLabel, stageCls: itpStageCls(r), hint: hints[r.stage], hasUrl: !!r.assessmentUrl && /^https?:\/\//i.test(r.assessmentUrl), url: r.assessmentUrl,
    steps: steps.map((x, i) => ({ label: x.label, who: x.who, cls: x.done ? 'done' : i === cur ? 'current' : '' })), canEdit: F.canEdit, canSubmit: F.canSubmit, canPrint: F.canPrint, canAssess: F.canAssess, canApprove: F.canApprove, canReturn: F.canReturn, canReceive: F.canReceive, canClose: F.canClose });
  slot(f, 'sheet', itpSheet(r)); return f;
}
async function itpAct(action, extra, title, text) {
  const z = ui.itp;
  try { await api('itp', action, { id: z.id, ...(extra || {}) }); await refresh(); render(); window.scrollTo(0, 0); popup(title, text); }
  catch (err) { if (err.status === 401) { me = null; db = null; render(); return; } popup('Could not continue', err.message, 'error'); }
}
async function itpSubmit() {
  const r = itpCur(); if (!r) return;
  if (!(await confirmBox({ title: 'Submit this requisition?', text: 'Your e-signature and the e-signature of your Line Manager (' + (r.lineManagerName || 'not chosen yet') + ') will be added to the form, and you can no longer edit it.', yes: 'Submit', no: 'Cancel' }))) return;
  itpAct('submit', null, 'Requisition submitted', itpNo(r.id) + ' was submitted. The IT Department will attach the assessment next.');
}
function itpAssess() {
  const r = itpCur(), url = ($id('itp-url').value || '').trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return popup('Link needed', 'Enter the link of the assessment. It must start with http:// or https://.', 'error');
  itpAct('assess', { url }, 'Assessment submitted', 'Your e-signature was added to ' + itpNo(r.id) + '. The IT Manager can check it now.');
}
async function itpApprove() {
  const r = itpCur(); if (!r) return;
  if (!(await confirmBox({ title: 'Approve this requisition?', text: 'Your e-signature will be added above your printed name on ' + itpNo(r.id) + '.', yes: 'Approve', no: 'Cancel' }))) return;
  itpAct('approve', null, 'Requisition approved', itpNo(r.id) + ' is approved and all e-signatures are complete. The requestor can print it now.');
}
function itpReturn() { const r = itpCur(); itpAct('return', { reason: ($id('itp-why') || {}).value || '' }, 'Returned', itpNo(r.id) + ' was returned to the IT Department for a new assessment.'); }
async function itpReceive() {
  const r = itpCur(); if (!r) return;
  if (!(await confirmBox({ title: 'Mark the item as received?', text: 'The status of ' + itpNo(r.id) + ' becomes Item received.', yes: 'Mark as received', no: 'Cancel' }))) return;
  itpAct('receive', null, 'Status updated', itpNo(r.id) + ' is marked as item received.');
}
async function itpClose() {
  const r = itpCur(); if (!r) return;
  if (!(await confirmBox({ title: 'Close this form?', text: itpNo(r.id) + ' will move to the Closed tab.', yes: 'Close form', no: 'Cancel' }))) return;
  itpAct('close', null, 'Form closed', itpNo(r.id) + ' was closed and moved to the Closed tab.');
}

/* ---------- the form (a draft) ---------- */
const itpPick = (list, cur) => list.map((v) => ({ v, checked: cur === v }));
function itpFormView() {
  const d = ui.itp.draft, m = db.itp.myManager, fixed = !!m && (!d.id || d.ownerId === me.id);
  if (fixed) { d.lineManagerId = m.id; d.lineManagerName = m.name; } // the Line Manager is the immediate supervisor chosen by the admin
  const f = tpl('tpl-itp-form', { ...d, heading: d.id ? 'Edit IT Procurement Requisition (' + itpNo(d.id) + ')' : 'New IT Procurement Requisition', itManager: ITP_IT_MANAGER, total: peso(itpTotal(d)), lmFixed: fixed,
    lmOpts: [{ v: '', label: 'Select a Line Manager...', sel: !d.lineManagerId }, ...db.itp.lineManagers.map((x) => ({ v: x.id, label: x.name, sel: d.lineManagerId === x.id }))],
    natures: itpPick(ITP_NATURES, d.nature), chargeables: itpPick(['Yes', 'No'], d.chargeable), budgets: itpPick(['Yes', 'No'], d.budget),
    items: d.items.map((it, i) => ({ i, title: 'Item ' + (i + 1), qty: it.qty, unit: it.unit, description: it.description, budgetedPrice: it.budgetedPrice, lineTotal: peso(itpLine(it)) })) });
  slot(f, 'sheet', itpSheet(d)); return f;
}
function itpDraw() { // only the printable preview and the totals are redrawn while typing, so the cursor stays where it is
  const z = ui.itp; if (!z || z.mode !== 'form') return;
  slot(document, 'sheet', itpSheet(z.draft)); const t = $id('itp-total'); if (t) t.textContent = peso(itpTotal(z.draft));
  document.querySelectorAll('.itp-rowtotal').forEach((el, i) => { if (z.draft.items[i]) el.textContent = peso(itpLine(z.draft.items[i])); });
}
function itpSet(k, v) { ui.itp.draft[k] = v; itpDraw(); }
function itpLM(id) { const d = ui.itp.draft, x = db.itp.lineManagers.find((y) => y.id === id); d.lineManagerId = id; d.lineManagerName = x ? x.name : ''; itpDraw(); }
function itpItemSet(el, k) { ui.itp.draft.items[+el.dataset.i][k] = el.value; itpDraw(); }
function itpAddItem() { ui.itp.draft.items.push(itpItem()); render(); rfcFocus('.itp-item-desc'); }
function itpDelItem(i) { const L = ui.itp.draft.items; if (L.length === 1) L[0] = itpItem(); else L.splice(+i, 1); render(); }
async function itpSave(e) {
  e.preventDefault();
  const z = ui.itp;
  try {
    const r = await api('itp', 'save', z.draft); await refresh();
    const saved = db.itp.requests.find((x) => x.id === r.id);
    ui.itp = { mode: 'view', id: r.id, draft: null }; render(); window.scrollTo(0, 0);
    popup('Draft saved', itpNo(r.id) + ' (' + saved.nature + ', ' + peso(saved.total) + ') was saved as a draft. Press Submit requisition when it is ready.');
  } catch (err) {
    if (err.status === 401) { me = null; db = null; render(); return; }
    say('itp-err', 'red', err.message); $id('itp-err').scrollIntoView({ block: 'center' });
  }
}

/* ---------- the printable form (same layout as the paper IT Procurement Requisition Form; the e-signatures are printed above the names) ---------- */
function itpSheet(d) {
  const dot = (on) => (on ? '◉' : '○'), yes = (v) => v === 'Yes', S = d.sigs || {}, img = (k) => (S[k] ? S[k].img : '');
  const lines = d.items.map((i, k) => ({ n: k + 1, qty: i.qty, unit: i.unit, description: i.description, price: i.budgetedPrice === '' ? '' : peso(i.budgetedPrice), lineTotal: peso(itpLine(i)) }));
  while (lines.length < ITP_MIN_ROWS) lines.push({ n: '', qty: '', unit: '', description: '', price: '', lineTotal: '' });
  return tpl('tpl-itp-sheet', { dateOfRequest: rfcDate(d.dateOfRequest), dateRequired: rfcDate(d.dateRequired), department: d.department, requestedBy: d.requestedBy, notedBy: d.notedBy, subsidiary: d.subsidiary,
    chYes: dot(yes(d.chargeable)), chNo: dot(!yes(d.chargeable)), chTo: yes(d.chargeable) ? d.chargeableTo : '',
    buYes: dot(yes(d.budget)), buNo: dot(!yes(d.budget)), buAmt: yes(d.budget) && d.budgetAmount !== '' && d.budgetAmount !== null ? peso(d.budgetAmount) : '',
    natures: ITP_NATURES.map((v) => ({ mark: dot(d.nature === v), label: v === 'Others' ? 'Others :' : v, extra: v === 'Others' && d.nature === 'Others' ? d.natureOther : '' })),
    lines, total: peso(itpTotal(d)), specialInstructions: d.specialInstructions, purpose: d.purpose, assignee: d.assignee,
    requestorName: d.requestorName, lineManagerName: d.lineManagerName, itStaffName: d.itStaffName, itManager: ITP_IT_MANAGER, reqSig: img('requestor'), lmSig: img('linemanager'), itSig: img('itstaff'), mgSig: img('itmanager') });
}
function itpPrint() { // prints only the form: a copy of it is put at the end of the page, and the CSS hides everything else while printing
  const s = $id('itp-sheet'); if (!s) return;
  const c = s.cloneNode(true); c.id = 'itp-print'; document.body.appendChild(c);
  const clean = () => { c.remove(); window.removeEventListener('afterprint', clean); };
  window.addEventListener('afterprint', clean); window.print();
}
