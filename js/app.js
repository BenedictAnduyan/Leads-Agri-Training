/* Leads Training: screens and logic. Every screen is a <template> in index.html.
   All data comes from the PHP server (api/*.php), which reads and writes the MySQL database. */
let db = null, me = null, lastHash = '', navSeq = 0;
const ui = { tab: 'All', search: '', sel: null, cid: null, draft: null, quiz: null, card: null, flash: '' };

/* ---------- talking to the server ---------- */
async function api(file, action, data) {
  const opt = data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  let res;
  try { res = await fetch('api/' + file + '.php' + (action ? '?action=' + action : ''), opt); }
  catch (e) { throw new Error('Cannot reach the server. Check that Apache is running in XAMPP and that you opened the site at http://localhost/leads-training/'); }
  let json;
  try { json = await res.json(); }
  catch (e) { throw new Error('The server sent an unexpected answer. Check that PHP and MySQL are running in XAMPP.'); }
  if (!res.ok) { const err = new Error(json.error || 'Request failed'); err.status = res.status; throw err; }
  return json;
}
// Loads everything the logged-in user may see. The server decides what that is.
async function refresh() {
  try { db = await api('snapshot'); me = db.me; }
  catch (e) { if (e.status === 401) { db = null; me = null; } else throw e; }
}
// Sends one change to the server, reloads the data, and redraws the screen.
async function call(file, action, data, errId) {
  try { const r = await api(file, action, data); await refresh(); render(); return r || {}; }
  catch (e) {
    if (e.status === 401) { me = null; db = null; render(); return null; }
    if (errId && $id(errId)) say(errId, 'red', e.message); else alert(e.message);
    return null;
  }
}

/* ---------- small helpers ---------- */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function qRange(d) { // the fixed calendar quarter that contains the date yyyy-mm-dd: Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec
  const y = +d.slice(0, 4), m = Math.floor((+d.slice(5, 7) - 1) / 3) * 3, last = new Date(y, m + 3, 0).getDate();
  return { start: y + '-' + String(m + 1).padStart(2, '0') + '-01', end: y + '-' + String(m + 3).padStart(2, '0') + '-' + String(last).padStart(2, '0'), label: MONTHS[m] + ' 1 - ' + MONTHS[m + 2] + ' ' + last + ', ' + y };
}
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '-');
const $id = (i) => document.getElementById(i);
const go = (p) => { location.hash = '#' + p; };
const coursesHome = () => (me && me.role === 'admin' ? '/admin/courses' : '/courses'); // the admin takes courses from the Courses tab of the admin area
const goTo = (p) => { if (location.hash === '#' + p) navigate(); else go(p); };
const toggle = (id, cls) => $id(id).classList.toggle(cls || 'hidden');

/* ---------- template engine (see the comment at the top of index.html) ---------- */
function fill(root, d) {
  root.querySelectorAll('[data-attr]').forEach((el) => el.dataset.attr.split(';').forEach((pair) => {
    const i = pair.indexOf(':'); if (i < 0) return;
    const v = d[pair.slice(i + 1).trim()]; if (v === undefined || v === null || v === false) return;
    el.setAttribute(pair.slice(0, i).trim(), v === true ? '' : v);
  }));
  root.querySelectorAll('[data-width]').forEach((el) => { el.style.width = (d[el.dataset.width] || 0) + '%'; });
  root.querySelectorAll('[data-class]').forEach((el) => { const v = d[el.dataset.class]; if (v) el.classList.add(...String(v).split(' ')); });
  root.querySelectorAll('[data-text]').forEach((el) => { const v = d[el.dataset.text]; el.textContent = v === undefined || v === null ? '' : v; });
  root.querySelectorAll('[data-show]').forEach((el) => { if (!d[el.dataset.show]) el.remove(); });
  root.querySelectorAll('[data-hide]').forEach((el) => { if (d[el.dataset.hide]) el.remove(); });
  root.querySelectorAll('[data-value]').forEach((el) => { const v = d[el.dataset.value]; el.value = v === undefined || v === null ? '' : v; });
  root.querySelectorAll('[data-list]').forEach((el) => { // lists last, so items are not filled twice
    const t = el.dataset.itemTemplate ? $id(el.dataset.itemTemplate) : [...el.children].find((c) => c.tagName === 'TEMPLATE');
    (d[el.dataset.list] || []).forEach((item) => el.appendChild(fill(t.content.cloneNode(true), item)));
  });
  return root;
}
const tpl = (id, d) => fill($id(id).content.cloneNode(true), d || {});
function slot(root, name, node, replace) {
  const el = root.querySelector('[data-slot="' + name + '"]');
  if (replace) el.replaceWith(node); else el.replaceChildren(node);
}
function mount(frag) {
  $id('app').replaceChildren(frag);
  if (location.hash !== lastHash) { window.scrollTo(0, 0); lastHash = location.hash; }
}
const say = (id, cls, text) => $id(id).replaceChildren(tpl('tpl-alert', { cls, text }));
const message = (title, text, href, label) => tpl('tpl-message', { title, text, href: '#' + href, label });
function showError(e) {
  const box = document.createElement('main'); box.className = 'page';
  box.appendChild(message('Something went wrong', e.message, me && me.role === 'admin' ? '/admin' : '/home', 'Try again')); mount(box);
}

/* ---------- department in the Supplier Management title ---------- */
// The course with the evaluation form shows the department of the person it is for: "IT Supplier Management" becomes "Admin & Legal Supplier Management".
const isEvalCourse = (c) => c.cards.some((k) => k.kind === 'evaluation');
function deptOf(uid) { const u = uid === me.id ? me : ((db.users || []).find((x) => x.id === uid)); return u ? (u.department || '') : ''; }
// every "IT" in the text of that course becomes the department; no department (or uid null) = neutral wording without "IT"
function deptText(s, d) { return d ? String(s).replace(/\bIT\b/g, () => d) : String(s).replace(/\bIT\s+/g, ''); }
const deptFor = (uid) => (uid === null ? '' : deptOf(uid === undefined ? me.id : uid));
function evalText(c, s, uid) { return c && isEvalCourse(c) ? deptText(s, deptFor(uid)) : s; }
function courseTitle(c, uid) { if (!isEvalCourse(c)) return c.title; const d = deptFor(uid), t = c.title.replace(/^IT\s+/i, ''); return d ? d + ' ' + t : t; }
const evalT = (s) => evalText(db.courses.find((x) => x.id === (ui.quiz && ui.quiz.courseId)), s, me.id); // text inside the card being answered

/* ---------- confirmation pop-up (proof that something was saved or submitted) ---------- */
function closePopup() { const p = $id('popup'); if (p) p.remove(); }
// kind: 'ok' (default, green tick) or 'error' (red exclamation mark)
function popup(title, text, kind) {
  closePopup();
  const f = tpl('tpl-popup', { title, text });
  if (kind === 'error') { f.querySelector('.popup-box').classList.add('error'); f.querySelector('.popup-icon').textContent = '!'; }
  document.body.appendChild(f);
  const b = document.querySelector('#popup .btn'); if (b) b.focus();
}
// A confirmation window in the same style as the other pop-ups. It returns a promise: true when the person clicks the main button, false when they cancel (button, Escape, or a click outside).
// o = { title, text, file, stats: [[number, label], [number, label], [number, label]], yes, no }
function confirmBox(o) {
  return new Promise((resolve) => {
    const old = $id('confirmdlg'); if (old) old.remove();
    const s = o.stats || [];
    const f = tpl('tpl-confirm', { title: o.title, text: o.text || '', file: o.file || '', hasFile: !!o.file, hasStats: s.length === 3,
      n1: s[0] ? s[0][0] : '', l1: s[0] ? s[0][1] : '', n2: s[1] ? s[1][0] : '', l2: s[1] ? s[1][1] : '', n3: s[2] ? s[2][0] : '', l3: s[2] ? s[2][1] : '',
      yesLabel: o.yes || 'OK', noLabel: o.no || 'Cancel' });
    const box = f.querySelector('#confirmdlg');
    const done = (v) => { document.removeEventListener('keydown', onKey); box.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    box.addEventListener('click', (e) => { if (e.target === box) done(false); });
    f.querySelector('#confirm-yes').onclick = () => done(true);
    f.querySelector('#confirm-no').onclick = () => done(false);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(f);
    const y = $id('confirm-yes'); if (y) y.focus();
  });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopup(); });

/* ---------- progress logic (for display; the server makes the real decisions) ---------- */
const prog = (u, c) => db.progress[u + ':' + c];
const rec = (u, c) => db.progress[u + ':' + c] || (db.progress[u + ':' + c] = { reading: 0, pct: 0 });
function courseInfo(u, course) {
  const total = course.cards.length, done = course.cards.filter((c) => prog(u, c.id) && prog(u, c.id).passed).length;
  const idx = course.cards.findIndex((c) => !(prog(u, c.id) && prog(u, c.id).passed));
  const current = idx < 0 ? null : course.cards[idx];
  const started = done > 0 || (current && prog(u, current.id) && prog(u, current.id).pct > 0);
  const status = total > 0 && done === total ? 'Completed' : started ? 'In Progress' : 'Not Started';
  return { total, done, pct: total ? Math.round(done / total * 100) : 0, current, currentIdx: idx, status };
}
function cardStatus(u, course, i) {
  const p = prog(u, course.cards[i].id);
  if (p && p.passed) return 'Completed';
  if (i > 0 && !(prog(u, course.cards[i - 1].id) || {}).passed) return 'Locked';
  if (p && p.failed) return 'Failed';
  return p && p.pct > 0 ? 'In Progress' : 'Available';
}
function myCourses(u) {
  const mine = me.role === 'admin' && u === me.id ? db.courses.filter((c) => c.status === 'Published').map((c) => ({ courseId: c.id, employeeId: u, deadline: '' })) : db.assignments.filter((a) => a.employeeId === u);
  return mine
    .map((a) => ({ a, course: db.courses.find((c) => c.id === a.courseId) }))
    .filter((x) => x.course && x.course.status === 'Published')
    .map((x) => { const info = courseInfo(u, x.course); return { ...x, info, overdue: !!x.a.deadline && new Date(x.a.deadline + 'T23:59:59') < new Date() && info.status !== 'Completed' }; });
}
const ICON = { Completed: '✓', 'In Progress': '▶', Locked: '🔒', Failed: '✗', Overdue: '!', 'Not Started': '○', Available: '●', Published: '✓', Draft: '○', Archived: '–', Active: '✓', Inactive: '–' };
const CLS = { Completed: 'green', Published: 'green', Active: 'green', 'In Progress': 'blue', Available: 'blue', Failed: 'red', Overdue: 'orange' };
const badgeOf = (s) => ({ statusLabel: ICON[s] + ' ' + s, statusCls: CLS[s] || 'gray' });
const courseCardData = (x) => ({
  category: x.course.category, title: courseTitle(x.course, x.a.employeeId), description: evalText(x.course, x.course.description, x.a.employeeId), meta: x.info.total + ' Training Cards · Due ' + fmt(x.a.deadline),
  ...badgeOf(x.overdue ? 'Overdue' : x.info.status), pct: x.info.pct, progressText: x.info.pct + '% · ' + x.info.done + ' / ' + x.info.total + ' completed',
  href: '#/courses/' + x.course.id, button: x.info.status === 'Completed' ? 'View' : x.info.status === 'Not Started' ? 'Start' : 'Continue'
});

/* ---------- navigation: load the data from the server, then draw the screen ---------- */
const routeParts = () => (location.hash || '#/').slice(2).split('/').filter(Boolean);
async function navigate() {
  const seq = ++navSeq;
  try {
    await refresh();
    const parts = routeParts();
    if (parts[0] !== 'training') ui.quiz = null;
    if (me && parts[0] === 'training' && (await loadCard(parts[1], parts[2])) === false) return;
    if (seq === navSeq) render();
  } catch (e) { if (seq === navSeq) showError(e); }
}
// Asks the server for the learning material. The server refuses locked cards.
async function loadCard(cid, kid) {
  ui.card = null;
  const course = db.courses.find((c) => c.id === cid), idx = course ? course.cards.findIndex((c) => c.id === kid) : -1;
  if (idx < 0 || !myCourses(me.id).some((x) => x.course.id === cid) || cardStatus(me.id, course, idx) === 'Locked') return true; // render() shows the message or redirect
  try { ui.card = await api('employee', 'card', { id: kid }); return true; }
  catch (e) { if (e.status === 403) { ui.flash = e.message; go('/courses/' + cid); return false; } throw e; }
}
function render() {
  const parts = routeParts(), a = parts[0];
  const inKpi = a === 'kpi' || (a === 'admin' && parts[1] === 'kpi');
  if (ui.wasKpi && !inKpi) { ui.kpiPos = null; ui.kpiTab = null; ui.kpiYear = null; ui.kpiScale = null; } // coming back to the KPI Matrix starts at the default position
  ui.wasKpi = inKpi;
  if (!(a === 'rfc' || (a === 'admin' && parts[1] === 'rfc'))) ui.rfc = null; // leaving Request for Check closes its form
  if (!me) { if (a !== 'login') { go('/login'); return; } return mount(tpl('tpl-login')); }
  if (!a || a === 'login') { go(me.role === 'admin' ? '/admin' : '/home'); return; }
  if (a === 'admin') { if (me.role !== 'admin') { go('/home'); return; } return mount(adminFrag(parts[1] || '')); }
  if (me.role === 'admin' && a === 'courses' && !parts[1]) { go('/admin/courses'); return; }
  if (me.role === 'admin' && a === 'suppliers') { go('/admin/suppliers'); return; } // the admin manages suppliers inside the admin area
  if (me.role === 'admin' && a === 'kpi') { go('/admin/kpi'); return; } // the admin opens the KPI Matrix inside the admin area
  if (me.role === 'admin' && a === 'rfc') { go('/admin/rfc'); return; } // and Request for Check too
  const views = { home: homeView, courses: () => (parts[1] ? detailView(parts[1]) : coursesView()), training: () => trainingView(parts[1], parts[2]), support: supportView, profile: profileView, corrective: correctiveView, requests: requestsView, kpi: kpiPage, rfc: rfcPage, suppliers: supplierEvalView };
  const page = views[a] ? views[a]() : message('Page not found', 'The page you asked for does not exist.', '/home', 'Back to Home');
  if (page === null) return; // redirected, for example a locked card
  if (me.role === 'admin' && (a === 'courses' || a === 'training')) { mount(adminLayout('courses', page)); if (a === 'training') initReader(); return; } // the admin takes a course inside the admin area
  mount(me.role === 'admin' ? adminLayout(a, page) : employeeLayout(a, page)); // everybody has the sidebar and the top menu now
  if (a === 'training') initReader();
}

/* ---------- login ---------- */
async function doLogin(e) {
  e.preventDefault();
  const email = $id('lemail').value.trim(), pw = $id('lpw').value;
  if (!email || !pw) return say('lerr', 'red', 'Please enter your email and password.');
  try { const r = await api('auth', 'login', { email, password: pw }); goTo(r.user.role === 'admin' ? '/admin' : '/home'); }
  catch (err) { say('lerr', 'red', err.message); }
}
async function logout() { try { await api('auth', 'logout', {}); } catch (e) { /* ignore */ } me = null; db = null; ui.quiz = null; goTo('/login'); }

/* ---------- navbar ---------- */
// the bell: unread count and the latest notifications (used by the employee menu and the admin top bar)
function notesData() {
  const mine = db.notifications;
  return {
    unread: mine.filter((n) => !n.read).length, noNotes: !mine.length,
    notes: mine.slice(0, 8).map((n) => { const kpi = n.title.indexOf('KPI review') === 0, re = n.title.indexOf('Re-evaluation request') === 0; return { title: n.title, message: n.message, date: fmt(n.createdAt), hasLink: /^(Corrective action|Re-evaluation request|KPI review)/.test(n.title), linkHref: kpi ? (me.role === 'admin' ? '#/admin/kpi' : '#/kpi') : re ? '#/requests' : (me.role === 'admin' ? '#/admin/suppliers' : '#/corrective'), linkText: kpi ? 'Open KPI Matrix' : re ? 'Open re-evaluation requests' : 'Open corrective actions' }; })
  };
}
/* ---------- sidebar and top menu of the employee and the immediate superior (the same shell as the admin, without the admin-only pages) ---------- */
function sideMap() { try { return JSON.parse(localStorage.getItem('leads-side-menus') || '{}'); } catch (e) { return {}; } }
const sideEff = {}; // what is open right now, so a click can flip it
function sideToggle(key) { const m = sideMap(); m[key] = !sideEff[key]; try { localStorage.setItem('leads-side-menus', JSON.stringify(m)); } catch (e) { /* ignore */ } render(); }
// groups of the sidebar with open/close arrows: the group that has the open page starts open, the others start closed until the person opens them
function sideModel(groups) {
  const m = sideMap();
  return groups.map((g) => {
    const open = g.key in m ? m[g.key] : true; sideEff[g.key] = open;
    return { isMenu: true, key: g.key, label: g.label, open, chev: open ? '▾' : '▸', children: g.children.map((c) => {
      const on = c.hasSub && (c.cls || c.sub.some((s) => s.cls)), subOpen = c.hasSub ? (c.key in m ? m[c.key] : !!on) : false; if (c.hasSub) sideEff[c.key] = subOpen;
      return { ...c, subOpen, chev: subOpen ? '▾' : '▸' };
    }) };
  });
}
function employeeLayout(sec, page) {
  const lk = (h, label, on, onclick) => ({ href: '#/' + h, label, cls: on ? 'active' : '', onclick });
  const item = (o) => ({ hasSub: !!(o.sub && o.sub.length), sub: o.sub || [], ...o });
  const isSup = me.role === 'superior' || !!(db.corrective && db.corrective.length), hasReq = !!(db.reevalInbox && db.reevalInbox.length);
  const actions = [];
  if (db.suppliers) actions.push(item(lk('suppliers', 'Supplier Master', sec === 'suppliers')));
  const evalMine = myCourses(me.id).filter((x) => isEvalCourse(x.course)), evalSubs = [];
  if (evalMine.length) evalSubs.push(lk('courses/' + evalMine[0].course.id, 'Evaluation Form', (sec === 'courses' || sec === 'training') && routeParts()[1] === evalMine[0].course.id));
  if (isSup) evalSubs.push(lk('corrective', 'Corrective Action Requests', sec === 'corrective'));
  if (evalSubs.length) actions.push(item({ key: 'supEval', ...lk(evalSubs[0].href.slice(2), 'Supplier Evaluation', evalSubs.some((s) => s.cls)), sub: evalSubs }));
  if (hasReq) actions.push(item(lk('requests', 'Re-evaluation Requests', sec === 'requests')));
  if (db.kpi) actions.push(item({ key: 'kpi', ...lk('kpi', 'KPI Matrix', sec === 'kpi'), sub: [lk('kpi', 'Add position', false, "return kpiQuick('position')"), lk('kpi', 'Add KRA', false, "return kpiQuick('kra')"), lk('kpi', 'Add KPI', false, "return kpiQuick('kpi')")] }));
  actions.push(item(lk('rfc', 'Request for Check', sec === 'rfc', 'return rfcHome()'))); // every role has this tab
  const settings = [item(lk('profile', 'Profile', sec === 'profile')), item(lk('support', 'Help', false, "menuGo('/support','faq'); return false")), item(lk('support', 'Contact Support', sec === 'support', "menuGo('/support','contact'); return false"))];
  const home = { isLink: true, ...lk('home', 'Home', sec === 'home') }, crs = { isLink: true, ...lk('courses', 'Courses', sec === 'courses' || sec === 'training') };
  const top = actions.length ? [home, { isMenu: true, label: 'Actions', cls: actions.some((x) => x.cls || x.sub.some((y) => y.cls)) ? 'active' : '', children: actions }, crs] : [home, crs];
  const groups = []; if (actions.length) groups.push({ label: 'Actions', key: 'actions', children: actions }); groups.push({ label: 'Settings', key: 'settings', children: settings });
  const L = tpl('tpl-admin-layout', { isAdmin: false, shellCls: 'emp', name: me.name, initial: me.name[0], ...notesData(), links: top, slinks: [home, crs, ...sideModel(groups)] });
  slot(L, 'page', page); L.querySelector('.admin').classList.toggle('collapsed', !sideOpen()); return L;
}
function navbarFrag() {
  const cur = location.hash.split('/')[1] || '';
  return tpl('tpl-navbar', {
    links: ['home', 'courses', ...(me.role === 'superior' || (db.corrective && db.corrective.length) ? ['corrective'] : []), ...(db.reevalInbox && db.reevalInbox.length ? ['requests'] : []), ...(db.kpi && me.role !== 'admin' ? ['kpi'] : []), ...(me.role !== 'admin' && db.suppliers ? ['suppliers'] : [])].map((p) => ({ href: '#/' + p, label: p === 'corrective' ? 'Supplier Evaluation' : p === 'requests' ? 'Re-evaluation Requests' : p === 'kpi' ? 'KPI Matrix' : p === 'suppliers' ? 'Supplier Master' : p[0].toUpperCase() + p.slice(1), cls: cur === p ? 'active' : '' }))
      .concat(me.role === 'admin' ? [{ href: '#/admin', label: 'Admin', cls: '' }] : []),
    initial: me.name[0], name: me.name, ...notesData()
  });
}
// settings (gear) menu, grouped top menu of the admin, and closing menus when the page is clicked
function menuGo(path, anchor) {
  const p = $id('ps'); if (p) p.classList.add('hidden');
  go(path);
  if (anchor) setTimeout(() => { const el = $id(anchor); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 150);
}
function navMenu(btn) {
  const m = btn.parentNode.querySelector('.nav-menu'), open = m.classList.contains('hidden');
  document.querySelectorAll('.nav-menu').forEach((x) => x.classList.add('hidden')); if (open) m.classList.remove('hidden');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.nav-drop')) document.querySelectorAll('.nav-menu').forEach((x) => x.classList.add('hidden'));
  if (!e.target.closest('.pop-wrap')) ['ps', 'pn'].forEach((id) => { const p = $id(id); if (p) p.classList.add('hidden'); });
});
function openNotes() {
  toggle('pn');
  if (!$id('pn').classList.contains('hidden')) { db.notifications.forEach((n) => { n.read = true; }); api('employee', 'mark_read', {}).catch(() => {}); const c = $id('cnt'); if (c) c.remove(); }
}

/* ---------- corrective actions assigned to the employee as immediate head / supervisor ---------- */
// how long something has been waiting, e.g. "2 days 3 hrs 5 min"
function pendFor(ts) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mi = m % 60;
  return [d ? d + ' day' + (d > 1 ? 's' : '') : '', d || h ? h + ' hr' + (h === 1 ? '' : 's') : '', mi + ' min'].filter(Boolean).join(' ');
}
function correctiveView() {
  const L = db.corrective || [], sel = L.find((x) => x.id === ui.corr);
  const f = tpl('tpl-corrective-page', { empty: !L.length, items: L.map((x) => ({ id: x.id, name: x.supplier, status: x.status === 'Resolved' ? 'Solved' : 'Pending', cls: 'badge ' + CLS[x.status === 'Resolved' ? 'Completed' : 'Overdue'],
    info: 'Evaluated by ' + x.evaluator + ' on ' + fmt(x.evaluationDate), pend: x.status === 'Resolved' || !x.submittedAt ? '' : 'Pending for ' + pendFor(x.submittedAt),
    pcls: 'badge ' + ((Date.now() - new Date(x.submittedAt).getTime()) / 60000 < 1440 ? 'blue' : (Date.now() - new Date(x.submittedAt).getTime()) / 60000 < 4320 ? 'orange' : 'red') })) });
  if (sel) {
    const box = document.createDocumentFragment();
    box.append(tpl('tpl-detail-list', { title: 'Corrective action: ' + sel.supplier, fields: [{ label: 'Evaluated by', value: sel.evaluator }, { label: 'Evaluation Date', value: fmt(sel.evaluationDate) }, { label: 'Issue Identified', value: sel.issueIdentified || '-' }] }));
    box.append(tpl('tpl-corrective-form', { id: sel.id, response: sel.supplierResponse || '', target: sel.targetDate || '', person: sel.responsiblePerson || '', follow: sel.followUp || '', status: sel.status || 'Open' }));
    slot(f, 'detail', box);
  }
  return f;
}
function openCorrective(id) { ui.corr = id; render(); }

/* ---------- home, courses, course detail ---------- */
function homeView() {
  const list = myCourses(me.id).filter((x) => !isEvalCourse(x.course)), n = (s) => list.filter((x) => x.info.status === s).length; // the evaluation form is under Supplier Evaluation, not here
  const active = list.find((x) => x.info.status === 'In Progress') || list.find((x) => x.info.status === 'Not Started'), cur = active && active.info.current, cp = cur && prog(me.id, cur.id);
  const d = { firstName: me.name.split(' ')[0], hasActive: !!cur, noActive: !cur, noActiveText: list.length ? 'All assigned courses are completed. Well done!' : 'You have no assigned courses yet.',
    stats: [['Assigned Courses', list.length], ['Completed', n('Completed')], ['In Progress', n('In Progress')], ['Not Started', n('Not Started')]].map((s) => ({ label: s[0], value: s[1] })) };
  if (cur) Object.assign(d, { activeTitle: courseTitle(active.course, me.id), overall: active.info.pct, overallText: 'Overall: ' + active.info.pct + '% · ' + active.info.done + ' / ' + active.info.total + ' training cards completed',
    currentText: 'Current: Card ' + (active.info.currentIdx + 1) + ' - ' + evalText(active.course, cur.title, me.id), curType: cur.type.toUpperCase(), cardPct: (cp && cp.pct) || 0, cardPctText: 'Card progress: ' + ((cp && cp.pct) || 0) + '%', continueLink: '#/training/' + active.course.id + '/' + cur.id });
  const f = tpl('tpl-home', d);
  slot(f, 'courses', tpl('tpl-courselist', { courses: list.map(courseCardData), empty: !list.length, emptyText: 'No courses assigned. Your administrator will assign training to you.' }));
  return f;
}
function coursesView() {
  const f = tpl('tpl-courses', { search: ui.search, tabs: ['All', 'In Progress', 'Not Started', 'Completed'].map((t) => ({ label: t, cls: ui.tab === t ? 'on' : '' })) });
  slot(f, 'list', coursesList()); return f;
}
function coursesList() {
  const l = myCourses(me.id).filter((x) => !isEvalCourse(x.course) && (ui.tab === 'All' || x.info.status === ui.tab) && (x.course.title + ' ' + x.course.category).toLowerCase().includes(ui.search.toLowerCase()));
  return tpl('tpl-courselist', { courses: l.map(courseCardData), empty: !l.length, emptyText: 'No courses found.' });
}
function drawCourses() { slot(document, 'list', coursesList()); }
function setTab(t) { ui.tab = t; render(); }

function detailView(id) {
  const x = myCourses(me.id).find((y) => y.course.id === id);
  if (!x) return message('Course not available', 'This course does not exist or is not assigned to you.', coursesHome(), 'Back to Courses');
  const c = x.course, i = x.info, flash = ui.flash; ui.flash = '';
  const date = c.cards.map((k) => (prog(me.id, k.id) || {}).completedAt).filter(Boolean).sort().pop();
  return tpl('tpl-detail', {
    coursesHref: '#' + coursesHome(), flash, title: courseTitle(c, me.id), description: evalText(c, c.description, me.id), meta: c.category + ' · Estimated time ' + c.duration + ' · Deadline ' + fmt(x.a.deadline), ...badgeOf(x.overdue ? 'Overdue' : i.status),
    completed: i.status === 'Completed', congrats: 'You have successfully completed ' + courseTitle(c, me.id) + '. Completion Date: ' + fmt(date),
    progressText: 'Progress: ' + i.pct + '% · ' + i.done + ' of ' + i.total + ' cards completed', pct: i.pct, noCards: !c.cards.length,
    cards: c.cards.map((k, n) => {
      const st = cardStatus(me.id, c, n), p = prog(me.id, k.id), locked = st === 'Locked';
      return { no: 'Card ' + (n + 1), title: evalText(c, k.title, me.id), type: k.type.toUpperCase(), ...badgeOf(st), cls: locked ? 'locked' : '', href: locked ? null : '#/training/' + c.id + '/' + k.id, ariaDisabled: locked ? 'true' : null, locked,
        attempts: p && p.attempt ? (k.kind === 'evaluation' ? 'Evaluations submitted: ' + p.attempt : 'Attempts: ' + p.attempt + ' · Best score: ' + p.best + '%') : '', cardPct: (st === 'In Progress' || st === 'Failed') ? 'Card progress: ' + ((p && p.pct) || 0) + '%' : '' };
    })
  });
}

/* ---------- training card: reader, quiz, score ---------- */
function trainingView(cid, kid) {
  const course = db.courses.find((c) => c.id === cid);
  if (!course) return message('Course not found', 'This course does not exist.', coursesHome(), 'Back to Courses');
  if (!myCourses(me.id).some((x) => x.course.id === cid)) return message('Not assigned', 'This course is not assigned to you.', coursesHome(), 'Back to Courses');
  const idx = course.cards.findIndex((c) => c.id === kid);
  if (idx < 0) return message('Card not found', 'This training card does not exist.', '/courses/' + cid, 'Back to Course');
  if (cardStatus(me.id, course, idx) === 'Locked') { ui.flash = 'That card is locked. Pass the previous card first.'; go('/courses/' + cid); return null; }
  if (!ui.card || ui.card.id !== kid) return message('Card not available', 'The learning material could not be loaded.', '/courses/' + cid, 'Back to Course');
  if (!ui.quiz || ui.quiz.cardId !== kid) ui.quiz = { courseId: cid, cardId: kid, stage: 'read', qi: 0, sel: null, shown: false, answers: [], feedback: null, result: null, attemptId: null, questions: [] };
  const card = course.cards[idx], isEval = card.kind === 'evaluation', z = ui.quiz, p = rec(me.id, kid), next = course.cards[idx + 1], L = 'ABCDEFGH';
  if (isEval && z.stage === 'read') z.stage = 'form'; // the evaluation opens straight on the form
  const f = tpl('tpl-training', { isEval, backLink: '#/courses/' + cid, backText: isEval ? '← Back to evaluation' : '← ' + courseTitle(course, me.id), cardNo: 'CARD ' + (idx + 1) + ' OF ' + course.cards.length, title: evalText(course, card.title, me.id), type: card.type.toUpperCase(), pct: p.pct });
  let body;
  if (z.stage === 'read') {
    body = tpl('tpl-read', {
      hasMine: isEval && !!(ui.card.mine && ui.card.mine.length), mine: (ui.card.mine || []).map((m) => ({ id: m.supplierId, name: m.supplier, info: 'Last evaluated ' + fmt(m.date) + ' - ' + m.score.toFixed(1) + '% - ' + m.decision })),
      passed: !!p.passed, readingText: p.reading + '% complete', reading: p.reading, noQuiz: !isEval && !card.qcount, backLink: '#/courses/' + cid, canStart: isEval || (!!card.qcount && !p.passed), startDisabled: !p.passed && p.reading < 100,
      startLabel: isEval ? (p.passed ? 'Evaluate another supplier' : 'Start Evaluation') : 'Start Quiz', hint: !p.passed && p.reading < 100 ? 'Finish reading the material to unlock the ' + (isEval ? 'evaluation form.' : 'quiz.') : '',
      blocks: ui.card.content.map((b) => ({ isH: b[0] === 'h', isP: b[0] === 'p', isUl: b[0] === 'ul', isOl: b[0] === 'ol', isWarn: b[0] === 'warn', isVideo: b[0] === 'video', isImg: b[0] === 'image', src: (b[0] === 'video' || b[0] === 'image') ? b[1] : '', cap: (b[0] === 'video' || b[0] === 'image') ? (b[2] || '') : '', text: (typeof b[1] === 'string' && b[0] !== 'video' && b[0] !== 'image') ? evalT(b[1]) : '', items: Array.isArray(b[1]) ? b[1].map((t) => ({ text: evalT(t) })) : [] }))
    });
  } else if (z.stage === 'form') {
    body = evaluationFrag();
  } else if (z.stage === 'evalresult') {
    body = tpl('tpl-eval-result', { supplier: z.evalResult.supplier, scoreText: z.evalResult.score.toFixed(1) + '%', rating: z.evalResult.rating, decision: z.evalResult.decision, cls: 'badge ' + (CLS[z.evalResult.decision === 'Preferred Supplier' ? 'Completed' : z.evalResult.decision === 'Not Recommended' ? 'Failed' : z.evalResult.decision === 'Conditional' ? 'Overdue' : 'In Progress']), replaced: !!z.evalResult.replaced, nextText: 'Next evaluation of this supplier is due in ' + qRange(z.evalResult.nextEvaluation).label + '.', courseHref: '#/courses/' + cid });
  } else if (z.stage === 'quiz') {
    const q = z.questions[z.qi], fb = z.feedback, ok = !!(fb && fb.correct), right = fb ? fb.correctAnswer : -1;
    body = tpl('tpl-quiz', {
      progressText: 'Question ' + (z.qi + 1) + ' of ' + z.questions.length, question: q.text, showSubmit: !z.shown, submitDisabled: z.sel === null, shown: z.shown, wrong: z.shown && !ok, fbCls: ok ? 'green' : 'red',
      yourAnswer: z.shown ? L[z.sel] + '. ' + q.options[z.sel] : '', resultText: ok ? '✓ Correct' : '✗ Incorrect', correctAnswer: fb ? L[right] + '. ' + q.options[right] : '', explanation: fb ? fb.explanation : '', nextLabel: z.qi + 1 < z.questions.length ? 'Next Question' : 'See Result',
      options: q.options.map((o, i) => ({ i, label: L[i] + '. ' + o, checked: String(z.sel === i), disabled: z.shown, cls: z.shown ? (i === right ? 'right' : i === z.sel ? 'wrong' : '') : (z.sel === i ? 'picked' : '') }))
    });
  } else {
    const r = z.result;
    body = tpl('tpl-result', {
      title: card.title, scoreText: r.score + ' / ' + r.total, pctText: r.percentage + '%', requiredText: 'Required: ' + r.required + ' / ' + r.total + ' (' + r.passing + '%)', ...badgeOf(r.passed ? 'Completed' : 'Failed'),
      verdict: r.passed ? 'PASSED ✓' : 'FAILED', passed: r.passed, hasNext: !!next, nextHref: next ? '/training/' + cid + '/' + next.id : '', courseHref: '#/courses/' + cid, failText: 'You must achieve a score of ' + r.passing + '% to complete this training card.'
    });
  }
  slot(f, 'body', body); return f;
}
// Reading progress follows the real scroll position. The server keeps a copy.
let readPending = Promise.resolve(), readSent = 0;
function sendReading(kid, v) { readSent = v; readPending = api('employee', 'set_reading', { id: kid, reading: v }).catch(() => {}); }
function initReader() {
  const el = $id('reader'); if (!el) return;
  const kid = ui.quiz.cardId; readSent = rec(me.id, kid).reading;
  const calc = () => {
    const max = el.scrollHeight - el.clientHeight, v = (max <= 4 || el.scrollTop >= max - 2) ? 100 : Math.round(el.scrollTop / max * 100), p = rec(me.id, kid);
    if (!p.passed && v > p.reading) { p.reading = v; if (!p.quizStarted) p.pct = Math.round(v * 0.3); if (v >= 100 || v - readSent >= 10) sendReading(kid, v); }
    $id('rtxt').textContent = p.reading + '% complete' + (p.reading >= 100 ? ' · Reading Completed ✓' : '');
    $id('rbar').style.width = p.reading + '%'; $id('cp').textContent = p.pct; $id('cbar').style.width = p.pct + '%';
    const b = $id('startBtn'); if (b && p.reading >= 100) { b.disabled = false; $id('hint').textContent = ''; }
  };
  el.addEventListener('scroll', calc); calc();
}
async function startQuiz() {
  const z = ui.quiz, p = rec(me.id, z.cardId);
  const card = db.courses.find((c) => c.id === z.courseId).cards.find((c) => c.id === z.cardId);
  if (card.kind === 'evaluation') { if (p.passed || p.reading >= 100) { await readPending; z.stage = 'form'; render(); } return; }
  if (p.reading < 100) return;
  try {
    await readPending;
    const r = await api('employee', 'start_quiz', { id: z.cardId });
    Object.assign(z, { stage: 'quiz', qi: 0, sel: null, shown: false, answers: [], feedback: null, attemptId: r.attemptId, questions: r.questions });
    p.quizStarted = true; p.pct = 30; render();
  } catch (e) { alert(e.message); }
}
function pick(i) { if (!ui.quiz.shown) { ui.quiz.sel = Number(i); render(); } }
async function submitAns() {
  const z = ui.quiz; if (z.sel === null || z.shown) return;
  const q = z.questions[z.qi];
  try {
    const r = await api('employee', 'answer', { attemptId: z.attemptId, questionId: q.id, selected: z.sel });
    z.feedback = r; z.shown = true; z.answers.push({ questionId: q.id, selected: z.sel, correct: r.correct });
    rec(me.id, z.cardId).pct = 30 + Math.round(z.answers.length / z.questions.length * 60); render();
  } catch (e) { alert(e.message); }
}
async function nextQ() {
  const z = ui.quiz;
  if (z.qi + 1 < z.questions.length) { z.qi++; z.sel = null; z.shown = false; z.feedback = null; return render(); }
  try { z.result = await api('employee', 'finish', { attemptId: z.attemptId }); await refresh(); z.stage = 'result'; render(); } // the server counted the score
  catch (e) { alert(e.message); }
}
async function restartCard() {
  const z = ui.quiz;
  try { await api('employee', 'restart', { id: z.cardId }); await refresh(); Object.assign(z, { stage: 'read', qi: 0, sel: null, shown: false, answers: [], feedback: null, result: null }); render(); }
  catch (e) { alert(e.message); }
}

/* ---------- support and profile ---------- */
const FAQ = [
  ['How do I start a course?', 'Open Courses, choose a course and open the first available training card.'],
  ['What happens if I fail a training card?', 'The next card stays locked. Restart the card, review the material and take the quiz again.'],
  ['How is my progress calculated?', 'Course progress is the number of passed cards divided by all cards. Card progress follows your reading and quiz position.'],
  ['Why is the next card locked?', 'Cards open in order. You must pass the current card with the required score first.'],
  ['How do I retake a card?', 'After a failed result, press Restart Card to begin a new attempt.'],
  ['How do I update my profile?', 'Open Profile from the top menu and edit your display name or contact details.']
];
const supportView = () => tpl('tpl-support', { name: me.name, email: me.email, faq: FAQ.map((f) => ({ q: f[0], a: f[1] })) });
function faqFilter(v) { document.querySelectorAll('.faq').forEach((d) => d.classList.toggle('hidden', !d.textContent.toLowerCase().includes(v.toLowerCase()))); }
async function sendSupport(e) {
  e.preventDefault(); const s = $id('ssub').value.trim(), m = $id('smes').value.trim();
  if (!s || !m) return say('smsg', 'red', 'Please fill in the subject and message.');
  const r = await call('employee', 'support_request', { subject: s, message: m }, 'smsg');
  if (r) say('smsg', 'green', 'Your support request has been submitted.');
}
const profileView = () => tpl('tpl-profile', {
  initial: me.name[0], name: me.name, position: me.position, phone: me.phone,
  fields: [['Employee ID', me.employeeId], ['Email', me.email], ['Department', me.department], ['Position', me.position], ['Date Joined', fmt(me.joined)], ['Account Status', me.status]].map((r) => ({ label: r[0], value: r[1] || 'Not provided' })),
  prefs: [['email', 'Email me about new assignments'], ['deadline', 'Remind me about deadlines']].map((r) => ({ key: r[0], label: r[1], checked: !!me.prefs[r[0]] }))
});
async function saveProfile(e) {
  e.preventDefault(); const n = $id('pname').value.trim();
  if (!n) return say('pmsg', 'red', 'Display name cannot be empty.');
  const r = await call('employee', 'save_profile', { name: n, phone: $id('pphone').value }, 'pmsg');
  if (r) say('pmsg', 'green', 'Profile saved.');
}
async function changePw(e) {
  e.preventDefault();
  const r = await call('employee', 'change_password', { current: $id('pw1').value, new: $id('pw2').value }, 'wmsg');
  if (r) say('wmsg', 'green', 'Password changed.');
}
function setPref(k, v) { me.prefs[k] = v; api('employee', 'set_pref', { key: k, value: v }).catch(() => {}); }

/* ---------- supplier evaluation form (inside a training card) ---------- */
function evaluationFrag() {
  const c = ui.card, today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10), q = qRange(today);
  const box = document.createDocumentFragment();
  box.append(tpl('tpl-evalguide', { blocks: c.content.map((b) => ({ isH: b[0] === 'h', isP: b[0] === 'p', isUl: b[0] === 'ul', isOl: b[0] === 'ol', isWarn: b[0] === 'warn', text: typeof b[1] === 'string' ? evalT(b[1]) : '', items: Array.isArray(b[1]) ? b[1].map((t) => ({ text: evalT(t) })) : [] })) }));
  const mine = c.mine || [];
  if (mine.length) box.append(tpl('tpl-eval-mine', { mine: mine.map((m) => ({ id: m.supplierId, name: m.supplier, info: 'Evaluated ' + fmt(m.date) + ' - ' + m.score.toFixed(1) + '% - ' + m.decision,
    isPending: m.requestStatus === 'Pending', isApproved: m.requestStatus === 'Approved', isDeclined: m.requestStatus === 'Declined', canRequest: m.requestStatus === 'None' || m.requestStatus === 'Declined', requestLabel: m.requestStatus === 'Declined' ? 'Request again' : 'Request re-evaluation' })) }));
  const kc = db.courses.find((x) => x.id === ui.quiz.courseId), kt = kc && kc.cards.find((k) => k.id === ui.quiz.cardId);
  const f = tpl('tpl-evaluation', { formTitle: evalT(kt ? kt.title : 'IT Supplier & Third-Party Evaluation'), meetsLabel: '1. ' + evalT('Does the supplier meet IT requirements?') + ' *', evaluator: me.name, today, qStart: q.start, backHref: '#/courses/' + ui.quiz.courseId, periodText: q.label, suppliers: c.suppliers.map((x) => ({ id: x.id, name: x.name })),
    fields: c.fields.map((x) => ({ label: x.label, description: x.description, weightText: 'Weight ' + x.weight + '%', rname: 'r_' + x.key })) });
  const re = ui.quiz.again, s = re && c.suppliers.find((x) => x.id === re.supplierId); // "Start re-evaluation": same supplier and service, new ratings
  if (s) {
    f.querySelector('#ev-supplier').value = s.id; f.querySelector('#ev-category').value = s.category || ''; f.querySelector('#ev-person').value = s.contactPerson || '';
    f.querySelector('#ev-phone').value = s.contactNo || ''; f.querySelector('#ev-email').value = s.email || '';
    f.querySelector('[name="service"]').value = re.service; f.querySelector('[name="criticality"]').value = re.criticality;
  }
  box.append(f); return box;
}
function evalSupplier() { // fills the category and contact details of the chosen supplier
  const s = ui.card.suppliers.find((x) => x.id === $id('ev-supplier').value) || {};
  $id('ev-category').value = s.category || ''; $id('ev-person').value = s.contactPerson || ''; $id('ev-phone').value = s.contactNo || ''; $id('ev-email').value = s.email || '';
  const m = (ui.card.mine || []).find((x) => x.supplierId === s.id); $id('ev-dup').classList.toggle('hidden', !(m && m.requestStatus !== 'Approved')); // already evaluated this quarter and no approved request
}
function evalPreview() { // quick estimate only; the server calculates the official score
  const f = document.querySelector('.evalform'), el = $id('ev-preview'); let sum = 0, n = 0;
  ui.card.fields.forEach((x) => { const r = f.querySelector('input[name="r_' + x.key + '"]:checked'); if (r) { n++; sum += x.weight * Number(r.value); } });
  if (n < ui.card.fields.length) { el.textContent = 'Rate all criteria to see the estimated score.'; return; }
  const score = Math.round(sum / 5 * 10) / 10, t = ui.card.thresholds.find((x) => score >= x.min);
  el.textContent = 'Estimated overall score ' + score.toFixed(1) + '% (' + t.rating + ', ' + t.decision + '). The official score is calculated when you submit.';
}
function evalPeriod() { const d = document.querySelector('.evalform input[name="evaluationDate"]').value; $id('ev-period').value = d ? qRange(d).label : ''; }
function evalCorrective() { const r = document.querySelector('.evalform input[name="corrective"]:checked'); $id('ev-corrective').classList.toggle('hidden', !r || r.value !== 'Yes'); }
function evalRecommendation() { $id('ev-other').classList.toggle('hidden', document.querySelector('.evalform [name="recommendation"]').value !== 'Other'); }
function evalCancel() { ui.quiz.again = null; ui.quiz.stage = 'read'; render(); }
function evalAgain() { ui.quiz.again = null; ui.quiz.stage = 'form'; render(); }
function evalRedo(supplierId) { const m = ui.card.mine.find((x) => x.supplierId === supplierId); ui.quiz.again = { supplierId, service: m.service, criticality: m.criticality }; ui.quiz.stage = 'form'; render(); } // from the list of the employee's own evaluations
async function requestReeval(supplierId) { // the employee asks the supervisor for permission to evaluate a supplier again in this quarter
  const reason = prompt('Why do you need to evaluate this supplier again? (optional)'); if (reason === null) return;
  try { const r = await api('employee', 'request_reeval', { supplierId, reason }); ui.card = await api('employee', 'card', { id: ui.quiz.cardId }); await refresh(); render(); alert(r.message); }
  catch (e) { alert(e.message); }
}
function requestsView() { // the supervisor's list of re-evaluation requests
  const L = db.reevalInbox || [];
  return tpl('tpl-reeval-page', { empty: !L.length, items: L.map((r) => ({ id: r.id, name: r.employee + ' - ' + r.supplier, info: 'Requested ' + fmt(r.createdAt), reason: 'Reason: ' + r.reason, hasReason: !!r.reason,
    status: r.status === 'Used' ? 'Used' : r.status, cls: 'badge ' + (r.status === 'Approved' || r.status === 'Used' ? 'green' : r.status === 'Declined' ? 'red' : 'orange'), isPending: r.status === 'Pending' })) });
}
function decideReeval(id, decision) { return call(supApi(), 'decide_reeval', { id, decision }); }
async function submitEvaluation(e) {
  e.preventDefault();
  const fd = new FormData(e.target), g = (k) => (fd.get(k) || '').toString().trim(), ratings = {};
  ui.card.fields.forEach((f) => { ratings[f.key] = Number(fd.get('r_' + f.key) || 0); });
  const data = { id: ui.quiz.cardId, supplierId: g('supplierId'), service: g('service'), criticality: g('criticality'), evaluationDate: g('evaluationDate'), ratings, meets: g('meets'), issues: g('issues'), corrective: g('corrective'),
    recommendation: g('recommendation'), recommendationOther: g('recommendationOther'), comments: g('comments'), issueIdentified: g('issueIdentified') };
  try { await readPending; ui.quiz.evalResult = await api('employee', 'submit_evaluation', data); ui.quiz.again = null; await refresh(); try { ui.card = await api('employee', 'card', { id: ui.quiz.cardId }); } catch (e2) { /* the list of your evaluations updates next time */ } ui.quiz.stage = 'evalresult'; render();
    popup('Evaluation submitted', 'Your evaluation of ' + ui.quiz.evalResult.supplier + ' was submitted successfully (' + ui.quiz.evalResult.score.toFixed(1) + '% - ' + ui.quiz.evalResult.decision + '). The Supplier Master was updated.'); }
  catch (err) { say('everr', 'red', err.message); $id('everr').scrollIntoView(); }
}

/* ---------- Supplier Master tab for an employee with the Supplier Master access permission: only the Supplier Master (add, edit, remove suppliers). The server checks the permission too ---------- */
function supplierEvalView() {
  if (!db.suppliers) return message('Supplier Master', 'You do not have access to this tab. Ask your administrator.', '/home', 'Back to Home');
  const box = document.createDocumentFragment(), h = document.createElement('h1'); h.textContent = 'Supplier Master';
  box.append(h, supMaster()); return box;
}
// which server file answers: the admin uses admin.php; supervisors on their own pages use employee.php
const supApi = () => (me.role === 'admin' ? 'admin' : 'employee');
