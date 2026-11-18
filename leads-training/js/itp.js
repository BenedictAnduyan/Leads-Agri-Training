/* IT Procurement Requisition tab: every role (admin, immediate superior, executive, employee) can fill in the form and save it as a draft. Then it follows this process (api/itp.php):
   1. The requestor submits: the requestor's e-signature is added. The Line Manager gets a notification and APPROVES (and signs with their own e-signature) or REJECTS it (rejected = back to a draft).
   2. An IT Department employee checks the stock:
        in stock  > Check Inventory: tick the matching inventory items (item, quantity, description / specs, purchased for) and submit for approval > the IT Manager / Executive reviews (or returns it to the IT assessment)
                  > Releasing item (an IT user presses Item released) > Closed (the requestor or any IT user closes it)
        no stock  > attach the link of the assessment > the IT Manager / Executive approves > print and give it to the PO > Submitted for PO > Mark item as received (both by the IT Manager / Executive) > Closed (the requestor or any IT user)
      The IT Department can also deem a form invalid (closed) or send it back to the requestor.
   Every step shows who did it and the date AND time. The process is shown at the right of the preview (like the print preview of a browser).
   Saved by api/itp.php. An employee sees their own requisitions; the admin and the IT Department see the submitted ones. The screens are templates in index.html.
   Small helpers (peso, rfcToday, rfcDate, rfcCopy, rfcFocus) come from js/rfc.js, which is loaded first. */
const ITP_NATURES = ['Equipment', 'License', 'Repair', 'Maintenance', 'Software', 'Others'];
const ITP_IT_MANAGER = 'Sherwin Greso';
const ITP_MIN_ROWS = 6; // the paper form has six rows; the printed sheet is padded to this many
const ITP_ORDER_P = ['draft', 'linemgr', 'assessment', 'approval', 'approved', 'po', 'received', 'closed']; // the steps when there is no stock (procurement)
const ITP_ORDER_S = ['draft', 'linemgr', 'assessment', 'stock_approval', 'releasing', 'released', 'closed']; // the steps when the IT Department has the item in stock
const itpWhen = (d) => (d ? new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''); // date AND time
const itpEv = (r, k) => { const L = (r.events || []).filter((e) => e.step === k); return L.length ? L[L.length - 1] : null; };
const itpStamp = (r, k, fallback) => { const e = itpEv(r, k); return e ? e.who + (e.note ? ' (' + e.note + ')' : '') + ' · ' + itpWhen(e.at) : fallback; };
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
const itpStageCls = (r) => ({ draft: 'gray', linemgr: 'orange', assessment: 'orange', approval: 'orange', stock_approval: 'orange', approved: 'green', po: 'blue', received: 'blue', releasing: 'blue', released: 'green', closed: 'gray' })[r.stage];
function itpListView() {
  if (ui.itpTab === 'inventory' && db.itp.canInventory) return itpInventoryView();
  const L = db.itp.requests, tab = ui.itpTab || 'pending', admin = me.role === 'admin', n = db.itp.pending;
  const f = tpl('tpl-itp-list', { q: ui.itpQ || '', pendingCls: tab === 'pending' ? 'active' : '', closedCls: tab === 'closed' ? 'active' : '', canInv: !!db.itp.canInventory, invCls: '', nPending: '(' + L.filter((r) => !r.closed).length + ')', nClosed: '(' + L.filter((r) => r.closed).length + ')',
    intro: db.itp.isExec ? 'Your forms and every submitted IT Procurement Requisition Form. As an Executive you can approve the ones that are waiting for approval.' : admin ? 'All IT Procurement Requisition Forms. Pending forms stay here until the item is received and the form is closed; closed forms are kept in the Closed tab.' : db.itp.isIt ? 'Your forms and the submitted forms that need the IT Department. Pending forms stay here until the item is received or released and the form is closed.' : 'Your IT Procurement Requisition Forms. Save a form, submit it, and print it when it is approved. It stays in Pending until it is closed.',
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

/* ---------- one saved requisition: the preview at the left, the process and the actions that belong to this person at the right ---------- */
function itpSteps(r) { // the process of this requisition, every step with who did it and the date and time
  const mine = r.ownerId === me.id, stock = r.path === 'stock', order = stock ? ITP_ORDER_S : ITP_ORDER_P, idx = order.indexOf(r.stage), lmE = itpEv(r, 'lm'), asE = itpEv(r, 'assess');
  const head = [
    { label: 'Requestor submits', who: itpStamp(r, 'submit', r.owner), done: idx >= 1 },
    { label: 'Line Manager approval', who: lmE ? 'Approved and signed by ' + itpStamp(r, 'lm', '') : (r.lineManagerName || 'Not chosen') + (r.stage === 'linemgr' ? ' · waiting to approve or reject' : ''), done: idx >= 2 }];
  if (r.outcome === 'invalid') return [...head.map((x) => ({ ...x, done: true })), { label: 'IT Department assessment', who: itpStamp(r, 'assess', 'Invalid'), done: true }, { label: 'Closed as invalid', who: itpStamp(r, 'close', ''), done: true }];
  const assess = { label: stock ? 'IT Department: Check Inventory' : r.path === 'procure' ? 'IT Department assessment (no stock)' : 'IT Department assessment', who: asE ? itpStamp(r, 'assess', '') : r.stage === 'assessment' && r.stageNote ? r.stageNote : 'Another IT Department employee: check the inventory', done: idx >= 3 };
  const appr = { label: 'IT Manager / Executive approval', who: itpStamp(r, 'approve', ITP_IT_MANAGER + ' or an Executive'), done: idx >= 4 };
  const close = (n) => ({ label: 'Closed', who: itpStamp(r, 'close', 'The requestor or an IT Department employee'), done: idx >= n });
  if (stock) return [...head, assess, appr, { label: 'Releasing item', who: itpStamp(r, 'release', 'IT Department gives the item to the requestor, then presses Item released'), done: idx >= 5 }, close(6)];
  if (r.path === 'procure') return [...head, assess, appr, { label: 'Print and give to the PO', who: itpStamp(r, 'po', 'Requestor prints it; the IT Manager / Executive presses Submitted for PO'), done: idx >= 5 }, { label: 'Item received', who: itpStamp(r, 'receive', 'The IT Manager / Executive presses Mark item as received when the supplier delivers'), done: idx >= 6 }, close(7)];
  return [...head, assess, { label: 'Then: release from stock, or procurement', who: 'Depends on the IT assessment (in stock, or no stock)', done: false }];
}
function itpViewPage() {
  const r = itpCur(); if (!r) { ui.itp = { mode: 'list' }; return itpListView(); }
  const F = r.flags, mine = r.ownerId === me.id, steps = itpSteps(r), cur = steps.findIndex((x) => !x.done);
  const hints = { draft: mine ? (r.stageNote ? r.stageNote + '. ' : '') + 'Check the form, then press Submit requisition. Your e-signature is added when you submit, and your Line Manager (' + (r.lineManagerName || 'not chosen yet') + ') approves or rejects it. You cannot edit it after that.' : 'This requisition is still a draft.',
    linemgr: F.canLmDecide ? 'Approve it and sign with your e-signature, or reject it. A rejected form goes back to scratch (a draft for the requestor).' : 'Waiting for the Line Manager (' + (r.lineManagerName || '-') + ') to approve or reject.',
    assessment: (r.stageNote ? r.stageNote + '. ' : '') + (F.canAssess ? 'Press Check Inventory if the item is in stock. If there is no stock, attach the link of your assessment. If the request is not valid, deem it invalid or send it back.' : 'Waiting for another IT Department employee to check the inventory or attach the assessment.'),
    approval: F.canApprove ? 'Open the assessment link and check it. If it is okay, approve it and your e-signature is added above your printed name.' : 'Waiting for the IT Manager (' + ITP_IT_MANAGER + ') or an Executive to check the assessment.',
    stock_approval: F.canApprove ? 'Check that the ticked inventory items match the request. If they do, approve it. If not, return it to the IT Department.' : 'Waiting for the IT Manager (' + ITP_IT_MANAGER + ') or an Executive to review the items from stock.',
    approved: mine ? 'Approved. Print the form and give it to the PO. The IT Manager or an Executive presses Submitted for PO afterwards.' : F.canPo ? 'Print the form, give it to the PO, then press Submitted for PO.' : 'Approved. The requestor prints it and gives it to the PO.',
    po: F.canReceive ? 'When the supplier has delivered the item to the IT Department, press Mark item as received.' : 'Submitted to the PO. Waiting for the supplier to deliver the item to the IT Department.',
    received: F.canClose ? 'The item was received. Close the form to move it to the Closed tab.' : 'The item was received. The requestor or an IT Department employee closes the form.',
    releasing: F.canRelease ? 'Give the item to the requestor, then press Item released. The quantity leaves the inventory.' : 'Approved. The IT Department is releasing the item to the requestor.',
    released: F.canClose ? 'The item was released to the requestor. Close the form to move it to the Closed tab.' : 'The item was released. The requestor or an IT Department employee closes the form.',
    closed: r.outcome === 'invalid' ? 'Closed as invalid by the IT Department. ' + (r.stageNote || '') : 'This form is closed and kept in the Closed tab.' };
  const f = tpl('tpl-itp-view', { id: r.id, no: itpNo(r.id), nature: r.nature, owner: r.owner || '-', stageLabel: r.stageLabel, stageCls: itpStageCls(r), hint: hints[r.stage], hasUrl: !!r.assessmentUrl && /^https?:\/\//i.test(r.assessmentUrl), url: r.assessmentUrl,
    hasStock: r.path === 'stock' && r.stock.length > 0, stockRows: r.stock.map((k) => ({ title: k.item + ' × ' + k.qty, info: [k.description, k.purchasedFor ? 'Purchased for: ' + k.purchasedFor : ''].filter(Boolean).join(' · ') || '-' })),
    steps: steps.map((x, i) => ({ label: x.label, who: x.who, cls: x.done ? 'done' : i === cur ? 'current' : '' })),
    canEdit: F.canEdit, canSubmit: F.canSubmit, canPrint: F.canPrint, canLmDecide: F.canLmDecide, canAssess: F.canAssess, canApprove: F.canApprove, canReturn: F.canReturn, canPo: F.canPo, canReceive: F.canReceive, canRelease: F.canRelease, canClose: F.canClose });
  slot(f, 'sheet', itpSheet(r)); slot(f, 'inv', ui.itp.checking && F.canAssess ? itpInvCard(r) : document.createDocumentFragment()); return f;
}
async function itpAct(action, extra, title, text) {
  const z = ui.itp;
  try { await api('itp', action, { id: z.id, ...(extra || {}) }); z.checking = false; await refresh(); render(); window.scrollTo(0, 0); popup(title, text); }
  catch (err) { if (err.status === 401) { me = null; db = null; render(); return; } popup('Could not continue', err.message, 'error'); }
}
const itpVal = (id) => (($id(id) || {}).value || '').trim();
async function itpSubmit() {
  const r = itpCur(); if (!r) return;
  if (!(await confirmBox({ title: 'Submit this requisition?', text: 'Your e-signature will be added, and your Line Manager (' + (r.lineManagerName || 'not chosen yet') + ') will be asked to approve or reject it. You can no longer edit it after you submit.', yes: 'Submit', no: 'Cancel' }))) return;
  itpAct('submit', null, 'Requisition submitted', itpNo(r.id) + ' was submitted. Your Line Manager can approve or reject it now.');
}
async function itpLmApprove() {
  const r = itpCur(); if (!r) return;
  if (!(await confirmBox({ title: 'Approve and sign?', text: 'Your e-signature will be added to ' + itpNo(r.id) + ' as Line Manager, and the IT Department can check it next.', yes: 'Approve and sign', no: 'Cancel' }))) return;
  itpAct('lm_approve', null, 'Approved', itpNo(r.id) + ' was approved and signed. The IT Department was notified.');
}
async function itpLmReject() {
  const r = itpCur(); if (!r) return;
  if (!(await confirmBox({ title: 'Reject this requisition?', text: itpNo(r.id) + ' goes back to scratch: a draft that ' + r.owner + ' can edit and submit again. All e-signatures on it are removed.', yes: 'Reject', no: 'Cancel' }))) return;
  itpAct('lm_reject', { reason: itpVal('itp-lmwhy') }, 'Rejected', itpNo(r.id) + ' was sent back to ' + r.owner + ' as a draft.');
}
function itpAssess() {
  const r = itpCur(), url = itpVal('itp-url');
  if (!/^https?:\/\/\S+$/i.test(url)) return popup('Link needed', 'Enter the link of the assessment. It must start with http:// or https://.', 'error');
  itpAct('assess', { url }, 'Assessment submitted', 'Your e-signature was added to ' + itpNo(r.id) + '. The IT Manager can check it now (no stock: procurement).');
}
async function itpInvalid() {
  const r = itpCur(), why = itpVal('itp-iwhy'); if (!r) return;
  if (!why) return popup('Reason needed', 'Enter the reason why the request is invalid (for example: the printer is not really broken).', 'error');
  if (!(await confirmBox({ title: 'Deem this request invalid?', text: itpNo(r.id) + ' will be closed as invalid. The requestor is told the reason.', yes: 'Close as invalid', no: 'Cancel' }))) return;
  itpAct('invalid', { reason: why }, 'Closed as invalid', itpNo(r.id) + ' was closed as invalid.');
}
async function itpSendBack() {
  const r = itpCur(), why = itpVal('itp-iwhy'); if (!r) return;
  if (!why) return popup('Reason needed', 'Enter the reason why it goes back to the requestor.', 'error');
  if (!(await confirmBox({ title: 'Send back to the requestor?', text: itpNo(r.id) + ' goes back to scratch: a draft that ' + r.owner + ' can edit and submit again. All e-signatures on it are removed.', yes: 'Send back', no: 'Cancel' }))) return;
  itpAct('sendback', { reason: why }, 'Sent back', itpNo(r.id) + ' was sent back to ' + r.owner + ' as a draft.');
}
async function itpApprove() {
  const r = itpCur(); if (!r) return;
  if (!(await confirmBox({ title: 'Approve this requisition?', text: 'Your e-signature will be added above your printed name on ' + itpNo(r.id) + '.', yes: 'Approve', no: 'Cancel' }))) return;
  itpAct('approve', null, 'Requisition approved', itpNo(r.id) + (r.path === 'stock' ? ' is approved. The IT Department will release the item.' : ' is approved and all e-signatures are complete. The requestor can print it now.'));
}
function itpReturn() { const r = itpCur(); itpAct('return', { reason: itpVal('itp-why') }, 'Returned', itpNo(r.id) + ' was returned to the IT Department assessment.'); }
async function itpPo() {
  const r = itpCur(); if (!r) return;
  if (!(await confirmBox({ title: 'Submitted for PO?', text: 'Confirm that the printed form of ' + itpNo(r.id) + ' was given to the PO.', yes: 'Submitted for PO', no: 'Cancel' }))) return;
  itpAct('po', null, 'Status updated', itpNo(r.id) + ' is marked as submitted for PO.');
}
async function itpReceive() {
  const r = itpCur(); if (!r) return;
  if (!(await confirmBox({ title: 'Mark the item as received?', text: 'Confirm that the supplier delivered the item of ' + itpNo(r.id) + ' to the IT Department.', yes: 'Mark as received', no: 'Cancel' }))) return;
  itpAct('receive', null, 'Status updated', itpNo(r.id) + ' is marked as item received.');
}
async function itpRelease() {
  const r = itpCur(); if (!r) return;
  if (!(await confirmBox({ title: 'Item released?', text: 'Confirm that the item of ' + itpNo(r.id) + ' was given to ' + r.owner + '. The released quantity leaves the inventory.', yes: 'Item released', no: 'Cancel' }))) return;
  itpAct('release', null, 'Status updated', itpNo(r.id) + ' is marked as item released.');
}
async function itpClose() {
  const r = itpCur(); if (!r) return;
  if (!(await confirmBox({ title: 'Close this form?', text: itpNo(r.id) + ' will move to the Closed tab.', yes: 'Close form', no: 'Cancel' }))) return;
  itpAct('close', null, 'Form closed', itpNo(r.id) + ' was closed and moved to the Closed tab.');
}

/* ---------- Check Inventory: the IT Department ticks the items in stock that match the request ---------- */
function itpCheckInv() { const r = itpCur(), z = ui.itp; if (!r) return; z.checking = true; z.invQ = ''; z.picks = {}; r.stock.forEach((k) => { if (k.invId) z.picks[k.invId] = k.qty; }); render(); window.scrollTo(0, 0); }
function itpInvCancel() { ui.itp.checking = false; render(); }
function itpInvCard(r) {
  const z = ui.itp, f = tpl('tpl-itp-inv', { no: itpNo(r.id), asked: r.items.map((i) => i.qty + ' ' + (i.unit || '') + ' ' + i.description).join('; '), q: z.invQ || '', empty: !db.itp.inventory.length });
  itpInvRows(f); return f;
}
function itpInvRows(root) { // the rows of the inventory (also redrawn while typing in the search box)
  const z = ui.itp, q = (z.invQ || '').trim().toLowerCase(), box = root.querySelector('#itp-inv-rows'); if (!box) return;
  const L = db.itp.inventory.filter((x) => !q || (x.item + ' ' + x.description + ' ' + x.purchasedFor).toLowerCase().includes(q));
  box.replaceChildren(...L.map((x) => { const on = z.picks[x.id] !== undefined; return tpl('tpl-itp-inv-row', { id: x.id, item: x.item, qty: x.qty, description: x.description || '-', purchasedFor: x.purchasedFor || '-', on, pick: on ? z.picks[x.id] : 1, off: !on, max: x.qty, cls: on ? 'itp-picked' : '', gone: x.qty < 1 }); }));
}
function itpInvQ(v) { ui.itp.invQ = v; itpInvRows(document); }
function itpInvTick(id, on) { const z = ui.itp, x = db.itp.inventory.find((y) => y.id === id); if (on) z.picks[id] = Math.min(1, x ? x.qty : 1) || 1; else delete z.picks[id]; itpInvRows(document); }
function itpInvQty(id, v) { ui.itp.picks[id] = Math.max(0, parseInt(v, 10) || 0); }
async function itpInvSubmit() {
  const r = itpCur(), z = ui.itp, picks = Object.keys(z.picks).map((id) => ({ invId: id, qty: z.picks[id] })); if (!r) return;
  if (!picks.length) return popup('Tick an item', 'Tick at least one inventory item that matches the request.', 'error');
  const bad = picks.find((p) => { const x = db.itp.inventory.find((y) => y.id === p.invId); return !x || p.qty < 1 || p.qty > x.qty; });
  if (bad) { const x = db.itp.inventory.find((y) => y.id === bad.invId); return popup('Check the quantity', 'The quantity of ' + (x ? x.item : 'an item') + ' must be from 1 to ' + (x ? x.qty : 0) + ' (what is in stock).', 'error'); }
  if (!(await confirmBox({ title: 'Submit for approval?', text: picks.length + (picks.length === 1 ? ' item' : ' items') + ' from stock will be added to ' + itpNo(r.id) + ' and your e-signature is added. The IT Manager or an Executive reviews it next.', yes: 'Submit for approval', no: 'Cancel' }))) return;
  itpAct('stock_submit', { picks }, 'Submitted for approval', itpNo(r.id) + ' was submitted to the IT Manager / Executive with the items from stock.');
}

/* ---------- IT Inventory: the list the IT Department checks (item, quantity, description / specs, purchased for) ---------- */
const itpInvBlank = () => ({ id: '', item: '', quantity: '1', description: '', purchasedFor: '' });
function itpInventoryView() {
  const d = ui.itpInv || (ui.itpInv = itpInvBlank());
  const f = tpl('tpl-itp-inventory', { ...d, heading: d.id ? 'Edit inventory item' : 'Add inventory item', saveLabel: d.id ? 'Save changes' : 'Add item', editing: !!d.id, pendingCls: '', closedCls: '', nPending: '(' + db.itp.requests.filter((r) => !r.closed).length + ')', nClosed: '(' + db.itp.requests.filter((r) => r.closed).length + ')', noItems: !db.itp.inventory.length,
    rows: db.itp.inventory.map((x) => ({ id: x.id, item: x.item, qty: x.qty, description: x.description || '-', purchasedFor: x.purchasedFor || '-' })) });
  return f;
}
function itpInvSet(k, v) { (ui.itpInv || (ui.itpInv = itpInvBlank()))[k] = v; }
function itpInvEdit(id) { const x = db.itp.inventory.find((y) => y.id === id); if (!x) return; ui.itpInv = { id: x.id, item: x.item, quantity: String(x.qty), description: x.description, purchasedFor: x.purchasedFor }; render(); window.scrollTo(0, 0); }
function itpInvReset() { ui.itpInv = itpInvBlank(); render(); }
async function itpInvSave(e) {
  e.preventDefault();
  try { await api('itp', 'inv_save', ui.itpInv); const edit = !!ui.itpInv.id; ui.itpInv = itpInvBlank(); await refresh(); render(); popup(edit ? 'Item saved' : 'Item added', edit ? 'The inventory item was updated.' : 'The item was added to the IT inventory.'); }
  catch (err) { if (err.status === 401) { me = null; db = null; render(); return; } say('itp-inv-err', 'red', err.message); }
}
async function itpInvDelete(id) {
  const x = db.itp.inventory.find((y) => y.id === id); if (!x) return;
  if (!(await confirmBox({ title: 'Delete this inventory item?', text: x.item + ' will be removed from the inventory. Forms that already used it keep their own copy.', yes: 'Delete', no: 'Cancel' }))) return;
  try { await api('itp', 'inv_del', { id }); await refresh(); render(); } catch (err) { if (err.status === 401) { me = null; db = null; render(); return; } popup('Could not delete', err.message, 'error'); }
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
    requestorName: d.requestorName, lineManagerName: d.lineManagerName, itStaffName: d.itStaffName, itManager: S.executive ? S.executive.name : ITP_IT_MANAGER, mgCap: S.executive ? 'Executive' : 'IT Manager', reqSig: img('requestor'), lmSig: img('linemanager'), itSig: img('itstaff'), mgSig: S.executive ? img('executive') : img('itmanager') });
}
function itpPrint() { // prints only the form: a copy of it is put at the end of the page, and the CSS hides everything else while printing
  const s = $id('itp-sheet'); if (!s) return;
  const c = s.cloneNode(true); c.id = 'itp-print'; document.body.appendChild(c);
  const clean = () => { c.remove(); window.removeEventListener('afterprint', clean); };
  window.addEventListener('afterprint', clean);
  const wait = [...c.querySelectorAll('img')].map((i) => (i.complete ? 0 : new Promise((ok) => { i.onload = i.onerror = ok; }))); // print only after the logo and e-signatures are loaded
  Promise.race([Promise.all(wait), new Promise((ok) => setTimeout(ok, 2500))]).then(() => window.print());
}
