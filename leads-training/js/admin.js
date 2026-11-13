/* Admin area. The screens are templates in index.html; every change is saved by api/admin.php. */
const emps = () => db.users.filter((u) => u.role !== 'admin'); // employees and immediate superiors
const ROLE_LABEL = { admin: 'Admin', employee: 'Employee', superior: 'Immediate Superior' };
const pairs = () => db.assignments.map((a) => ({ a, course: db.courses.find((c) => c.id === a.courseId) })).filter((x) => x.course).map((x) => ({ ...x, info: courseInfo(x.a.employeeId, x.course) }));
const theCourse = () => db.courses.find((x) => x.id === ui.cid);

function adminFrag(sec) {
  const views = { '': adminDashboard, analytics: adminDashboard, employees: adminEmployees, departments: adminDepartments, addcourse: adminAddCourse, courses: adminCourses, assignments: adminAssignments, suppliers: adminSuppliers, kpi: kpiPage, rfc: rfcPage, itp: itpPage, support: adminSupport };
  const page = views[sec] ? views[sec]() : message('Page not found', 'This admin page does not exist.', '/admin', 'Back to Dashboard');
  return adminLayout(sec, page);
}
// The admin chrome (sidebar and top bar) around any page. The admin also takes courses inside it (see render() in app.js).
function adminLayout(sec, page) {
  const openReq = db.requests.filter((r) => r.status === 'Open').length, st = ui.stab || 'dashboard';
  const lk = (k, label, on, onclick) => ({ href: '#/admin/' + k, label, cls: on ? 'active' : '', onclick });
  const supOn = (t) => sec === 'suppliers' && st === t;
  const item = (o) => ({ hasSub: !!(o.sub && o.sub.length), sub: o.sub || [], ...o });
  const actions = [
    item({ key: 'supEval', ...lk('suppliers', 'Supplier Evaluation', sec === 'suppliers' && (st === 'dashboard' || st === 'responses'), "return supGo('dashboard')"),
      sub: [lk('suppliers', 'Evaluation Form', supOn('form'), "return supGo('form')"), lk('suppliers', 'Corrective Action Requests', supOn('corrective'), "return supGo('corrective')"), lk('suppliers', 'Evaluation Report', supOn('calculator'), "return supGo('calculator')"), lk('suppliers', 'Supplier Master', supOn('master'), "return supGo('master')"),
        lk('suppliers', 'Criteria Master', supOn('criteria'), "return supGo('criteria')"), lk('suppliers', 'Re-evaluation Requests', supOn('reevals'), "return supGo('reevals')")] }),
    item({ key: 'kpi', ...lk('kpi', 'KPI Matrix', sec === 'kpi'), sub: [lk('kpi', 'Add position', false, "return kpiQuick('position')"), lk('kpi', 'Add KRA', false, "return kpiQuick('kra')"), lk('kpi', 'Add KPI', false, "return kpiQuick('kpi')")] }),
    item(rfcNavItem(lk, sec)),
    item(lk('itp', 'IT Procurement Requisition' + itpBadge(), sec === 'itp', 'return itpHome()')),
  ];
  const settings = [
    item({ key: 'setup', ...lk('employees', 'Setup', sec === 'employees' || sec === 'departments' || sec === 'addcourse'), sub: [lk('employees', 'Employees', sec === 'employees'), lk('departments', 'Departments', sec === 'departments'), lk('addcourse', 'Add Course', sec === 'addcourse')] }),
    item(lk('support', 'Support' + (openReq ? ' (' + openReq + ')' : ''), sec === 'support'))];
  const dash = { isLink: true, ...lk('', 'Dashboard', sec === '' || sec === 'analytics') }, crs = { isLink: true, ...lk('courses', 'Courses', sec === 'courses' || sec === 'training') };
  const actMenu = { isMenu: true, label: 'Actions', cls: actions.some((x) => x.cls || x.sub.some((y) => y.cls)) ? 'active' : '', children: actions };
  const top = [dash, actMenu, crs]; // Dashboard, Actions, Courses
  const side = [dash, crs, ...sideModel([{ label: 'Actions', key: 'actions', children: actions }, { label: 'Settings', key: 'settings', children: settings }])];
  const L = tpl('tpl-admin-layout', { isAdmin: true, shellCls: '', name: me.name, initial: me.name[0], ...notesData(), links: top, slinks: side, openReq, supportLabel: 'Support Requests' + (openReq ? ' (' + openReq + ')' : '') });
  slot(L, 'page', page); L.querySelector('.admin').classList.toggle('collapsed', !sideOpen()); return L;
}
// the pages of Supplier Evaluation that are in the Actions menu open from there
function supGo(tab) {
  ui.stab = tab; ui.supDetail = null; ui.crit = null;
  if (location.hash === '#/admin/suppliers') render(); else go('/admin/suppliers');
  return false;
}
// The sidebar slides in and out. On a wide screen the choice is remembered; on a phone it starts closed.
function sideOpen() {
  if (window.innerWidth < 900) return false;
  try { const v = localStorage.getItem('leads-side'); if (v === 'open' || v === 'closed') return v === 'open'; } catch (e) { /* ignore */ }
  return true;
}
function toggleSide() {
  const a = document.querySelector('.admin'); if (!a) return;
  const closed = !a.classList.contains('collapsed'); a.classList.toggle('collapsed', closed);
  if (window.innerWidth >= 900) { try { localStorage.setItem('leads-side', closed ? 'closed' : 'open'); } catch (e) { /* ignore */ } }
}

function adminDashboard() {
  const p = pairs(), at = db.attempts.filter((x) => x.employeeId !== me.id), passedN = at.filter((x) => x.passed).length;
  const comp = p.filter((x) => x.info.status === 'Completed').length, inprog = p.filter((x) => x.info.status === 'In Progress').length;
  const overdue = p.filter((x) => x.a.deadline && new Date(x.a.deadline + 'T23:59:59') < new Date() && x.info.status !== 'Completed').length;
  const avg = at.length ? Math.round(at.reduce((s, x) => s + x.percentage, 0) / at.length) : 0;
  return tpl('tpl-admin-dashboard', {
    stats: [['Total Employees', emps().length], ['Active Employees', emps().filter((u) => u.status === 'Active').length], ['Total Courses', db.courses.length], ['Completed Courses', comp], ['Courses In Progress', inprog], ['Overdue Training', overdue]].map((s) => ({ label: s[0], value: s[1] })),
    bars: [['Course completion rate', p.length ? Math.round(comp / p.length * 100) : 0], ['Average quiz score', avg], ['Pass rate', at.length ? Math.round(passedN / at.length * 100) : 0], ['Fail rate', at.length ? Math.round((at.length - passedN) / at.length * 100) : 0]].map((b) => ({ label: b[0], value: b[1], valueText: b[1] + '%' })),
    footer: 'Failed attempts: ' + (at.length - passedN) + ' · Completed cards: ' + Object.values(db.progress).filter((x) => x.passed).length + ' · Overdue courses: ' + overdue,
    activity: db.activity.slice(0, 8).map((a) => ({ text: a.text, date: fmt(a.at) })), hasActivity: db.activity.length > 0, noActivity: !db.activity.length
  });
}
function clearActivity() { if (confirm('Clear all recent activity? This cannot be undone.')) call('admin', 'clear_activity', {}); }

/* ----- employees ----- */
function adminEmployees() {
  const f = tpl('tpl-admin-employees', { rows: db.users.map((u) => ({ id: u.id, name: u.name, email: u.email, employeeId: u.employeeId, department: u.department || '-', supervisor: ((db.users.find((x) => x.id === u.supervisorId) || {}).name) || '-', role: ROLE_LABEL[u.role] || u.role, ...badgeOf(u.status), toggleLabel: u.status === 'Active' ? 'Deactivate' : 'Activate', canRemove: u.id !== me.id })) });
  if (ui.sel) slot(f, 'eprog', empProgress(ui.sel)); return f;
}
function toggleEmp(id) { call('admin', 'toggle_employee', { id }); }
function removeEmp(id) {
  const u = db.users.find((x) => x.id === id); if (!u) return;
  if (!confirm('Remove the account of ' + u.name + '?\n\nTheir course progress, quiz attempts, notifications, support requests and supplier evaluations will be permanently deleted. This cannot be undone. (To keep the history, use Deactivate instead.)')) return;
  if (ui.sel === id) ui.sel = null;
  call('admin', 'delete_employee', { id });
}
function empForm(id) {
  const u = db.users.find((x) => x.id === id) || { name: '', employeeId: '', email: '', department: '', position: '', role: 'employee' };
  slot(document, 'eform', tpl('tpl-emp-form', { id: id || '', isNew: !id, departments: db.departments.map((d) => ({ name: d.name })), noDepartments: !db.departments.length, supervisors: db.users.filter((x) => x.role === 'superior' && x.id !== id).map((x) => ({ id: x.id, name: x.name + (x.department ? ' (' + x.department + ')' : '') })), name: u.name, employeeId: u.employeeId, email: u.email, department: u.department, position: u.position, role: u.role }));
  $id('e-supervisorId').value = u.supervisorId || '';
  $id('e-department').value = u.department || ''; // a select: its value is set after the options exist
}
const closeEmpForm = () => document.querySelector('[data-slot="eform"]').replaceChildren();
function saveEmp(e, id) {
  e.preventDefault(); const v = { id }; ['name', 'employeeId', 'email', 'department', 'position', 'role'].forEach((k) => { v[k] = $id('e-' + k).value.trim(); });
  v.supervisorId = $id('e-supervisorId').value;
  if (!v.department) return say('eerr', 'red', 'Select a department.');
  v.password = $id('e-password').value; // not trimmed; empty on an existing account keeps the current password
  if (!v.name || !v.email || !v.employeeId) return say('eerr', 'red', 'Name, email and employee ID are required.');
  if (!id && v.password.length < 8) return say('eerr', 'red', 'Enter a password of at least 8 characters for the new account.');
  if (id && v.password && v.password.length < 8) return say('eerr', 'red', 'The new password must have at least 8 characters.');
  call('admin', 'save_employee', v, 'eerr').then((r) => { if (r && !id) permForm(r.id, true); }); // a new account goes straight to step 2: its permissions
}
function viewEmp(id) { ui.sel = id; slot(document, 'eprog', empProgress(id)); document.querySelector('[data-slot="eprog"]').scrollIntoView(); }
function empProgress(id) {
  const u = db.users.find((x) => x.id === id), rows = pairs().filter((x) => x.a.employeeId === id);
  return tpl('tpl-emp-progress', {
    title: (u ? u.name : '') + ': course progress', none: !rows.length,
    courses: rows.map((x) => ({
      title: courseTitle(x.course, id), ...badgeOf(x.info.status), pct: x.info.pct,
      summary: x.info.pct + '% · ' + x.info.done + '/' + x.info.total + ' cards · Current: ' + (x.info.current ? 'Card ' + (x.info.currentIdx + 1) : 'None') + ' · Deadline ' + fmt(x.a.deadline),
      cards: x.course.cards.map((c, i) => {
        const p = prog(id, c.id);
        return { head: 'Card ' + (i + 1) + ': ' + evalText(x.course, c.title, id), state: ' · ' + (p && p.passed ? 'Passed' : p && p.failed ? 'Failed' : p ? 'In progress' : 'Not started') + ' · Best ' + (p && p.best != null ? p.best : '-') + '%',
          attempts: db.attempts.filter((t) => t.employeeId === id && t.cardId === c.id).map((t) => ({ text: 'Attempt ' + t.attemptNumber + ': ' + t.score + '/' + t.totalQuestions + ' · ' + (t.passed ? 'Passed' : 'Failed') + ' · ' + fmt(t.completedAt) })) };
      })
    }))
  });
}

/* ----- courses, cards, questions ----- */
// Courses (every course except the supplier evaluation form) and Supplier Evaluation > Evaluation Form use the same page
function adminCourses() { return courseAdminPage(false); }
function adminEvalForm() { return courseAdminPage(true); }
function adminAddCourse() { return tpl('tpl-admin-addcourse'); }
function courseAdminPage(evalOnly) {
  const list = db.courses.filter((x) => isEvalCourse(x) === evalOnly);
  if (ui.cid && !list.some((x) => x.id === ui.cid)) { ui.cid = null; ui.draft = null; ui.pv = null; ui.ce = false; }
  if (evalOnly && !ui.cid && list.length) ui.cid = list[0].id;
  const c = theCourse();
  const f = tpl('tpl-admin-courses', { pageTitle: evalOnly ? 'Evaluation Form' : 'Courses', isEmpty: !list.length, emptyText: evalOnly ? 'There is no evaluation form yet.' : 'There are no courses yet. Add one in Settings > Setup > Add Course.', courses: list.map((x) => ({ id: x.id, title: x.title, count: x.cards.length + ' cards', ...badgeOf(x.status), cls: ui.cid === x.id ? 'sel' : '' })) });
  if (c) {
    const info = courseInfo(me.id, c), canTake = c.status === 'Published' && c.cards.length > 0; // the admin answers courses like an employee
    const d = tpl('tpl-course-detail', { title: c.title, status: c.status, noDraft: !ui.draft, canTake, cantTake: c.status !== 'Published', takeHref: '#/courses/' + c.id,
      takeLabel: info.status === 'Completed' ? 'View course' : info.status === 'Not Started' ? 'Start course' : 'Continue course', mine: 'Your progress: ' + info.pct + '% · ' + info.done + '/' + info.total + ' cards', cards: c.cards.map((k, i) => ({ i, head: (i + 1) + '. ' + evalText(c, k.title, null), type: k.type.toUpperCase(), meta: k.questions.length + ' questions · pass at ' + k.passing + '%',
      viewLabel: ui.pv === k.id ? 'Hide' : 'View', isOpen: ui.pv === k.id,
      blocks: ui.pv === k.id ? (k.content || []).map((b) => pvBlock(c, b)) : [],
      qs: ui.pv === k.id ? k.questions.map((q, n) => ({ text: (n + 1) + '. ' + q.text, explanation: 'Explanation: ' + q.explanation, opts: q.options.map((o, j) => ({ t: o + (j === q.answer ? '   ✓ correct answer' : ''), cls: j === q.answer ? 'ok' : '' })) })) : [] })) });
    if (ui.ce) slot(d, 'cedit', tpl('tpl-course-edit', { title: c.title, description: c.description, category: c.category, duration: c.duration, deadline: c.deadline || '' }));
    if (ui.draft) slot(d, 'cform', cardFormFrag());
    slot(f, 'detail', d);
  }
  return f;
}
function selCourse(id) { ui.cid = id; ui.draft = null; ui.pv = null; ui.ce = false; render(); }
// read-only preview of a card (learning material, videos and the quiz with its correct answers) for the admin: nothing is recorded as progress
function togglePreview(i) { const k = theCourse().cards[Number(i)]; ui.pv = ui.pv === k.id ? null : k.id; render(); }
function pvBlock(c, b) {
  const media = b[0] === 'video' || b[0] === 'image';
  return { isH: b[0] === 'h', isP: b[0] === 'p', isUl: b[0] === 'ul', isOl: b[0] === 'ol', isWarn: b[0] === 'warn', isVideo: b[0] === 'video', isImg: b[0] === 'image',
    src: media ? b[1] : undefined, cap: media ? (b[2] || '') : '', text: (!media && typeof b[1] === 'string') ? evalText(c, b[1], null) : '',
    items: Array.isArray(b[1]) ? b[1].map((t) => ({ text: evalText(c, t, null) })) : [] };
}
async function addCourse(e) {
  e.preventDefault(); const v = {}; ['title', 'description', 'category', 'duration', 'deadline'].forEach((k) => { v[k] = $id('nc-' + k).value.trim(); });
  if (!v.title || !v.description) return say('cerr', 'red', 'Course name and description are required.');
  const r = await call('admin', 'add_course', v, 'cerr');
  if (r) { ui.cid = r.id; ui.draft = null; popup('Course created', 'The course "' + v.title + '" was created. Open it in the Courses tab to add its training cards and publish it.'); go('/admin/courses'); }
}
function setStatus(s) { call('admin', 'set_course_status', { id: ui.cid, status: s }); }
function moveCard(i, d) { call('admin', 'move_card', { id: theCourse().cards[Number(i)].id, dir: d }); }
function delCourse() {
  const c = theCourse(); if (!c) return;
  const n = db.assignments.filter((a) => a.courseId === c.id).length, ev = c.cards.some((k) => k.kind === 'evaluation');
  if (!confirm('Delete the course "' + c.title + '"?\n\nIts ' + c.cards.length + ' card(s), quizzes, ' + n + ' assignment(s), and all employee progress and quiz attempts for it will be permanently deleted. This cannot be undone.' + (ev ? '\n\nThis course contains the supplier evaluation form. Employees will not be able to submit evaluations until a new one is created.' : ''))) return;
  ui.cid = null; ui.draft = null;
  call('admin', 'delete_course', { id: c.id });
}
function delCard(i) { if (confirm('Delete this card and its quiz?')) call('admin', 'delete_card', { id: theCourse().cards[Number(i)].id }); }
const newQ = () => ({ text: '', options: ['', '', '', ''], answer: 0, explanation: '' });
function newCard() { ui.draft = { title: '', type: 'SOP', passing: 100, text: '', questions: [newQ()] }; render(); }
// edit a card: the material is turned back into text (see parseMaterial), the questions keep their ids so they are updated in place
function editCard(i) {
  const k = theCourse().cards[Number(i)]; ui.pv = null;
  ui.draft = { id: k.id, kind: k.kind, title: k.title, type: k.type, passing: k.passing, text: materialToText(k.content || []),
    questions: (k.questions || []).map((q) => ({ id: q.id, text: q.text, options: [0, 1, 2, 3].map((j) => q.options[j] || ''), answer: q.answer, explanation: q.explanation })) };
  render(); setTimeout(() => { const f = $id('cardform'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
}
function materialToText(blocks) {
  return blocks.map((b) => b[0] === 'h' ? '# ' + b[1] : b[0] === 'warn' ? '! ' + b[1] : b[0] === 'ul' ? b[1].map((t) => '- ' + t).join('\n') : b[0] === 'ol' ? b[1].map((t, n) => (n + 1) + '. ' + t).join('\n')
    : (b[0] === 'video' || b[0] === 'image') ? '[' + b[0] + '] ' + b[1] + (b[2] ? ' | ' + b[2] : '') : b[1]).join('\n\n');
}
function toggleCourseEdit() { ui.ce = !ui.ce; render(); }
async function saveCourseEdit(e) {
  e.preventDefault(); const v = { id: ui.cid }; ['title', 'description', 'category', 'duration', 'deadline'].forEach((k) => { v[k] = $id('ce-' + k).value.trim(); });
  if (!v.title || !v.description) return say('ceerr', 'red', 'Course name and description are required.');
  const r = await call('admin', 'update_course', v, 'ceerr');
  if (r) { ui.ce = false; render(); popup('Course updated', 'The course details were saved successfully.'); }
}
function cardFormFrag() {
  const d = ui.draft;
  return tpl('tpl-card-form', { heading: d.id ? 'Edit training card' : 'New training card', saveLabel: d.id ? 'Save changes' : 'Save card', showQs: d.kind !== 'evaluation', title: d.title, type: d.type, passing: d.passing, text: d.text,
    questions: d.questions.map((q, i) => ({ i, heading: 'Question ' + (i + 1), text: q.text, o0: q.options[0], o1: q.options[1], o2: q.options[2], o3: q.options[3], answer: q.answer, explanation: q.explanation })) });
}
function collect() { // copy what the admin typed into ui.draft before the form is redrawn
  const d = ui.draft; if (!d || !$id('cardform')) return;
  d.title = $id('d-title').value; d.type = $id('d-type').value; d.passing = $id('d-pass').value; d.text = $id('d-text').value;
  d.questions = [...document.querySelectorAll('#cardform .qbox')].map((b, ix) => { const g = (k) => b.querySelector('[data-f="' + k + '"]').value; return { id: (d.questions[ix] || {}).id, text: g('text'), options: [g('o0'), g('o1'), g('o2'), g('o3')], answer: g('answer'), explanation: g('explanation') }; });
}
function addQ() { collect(); ui.draft.questions.push(newQ()); render(); }
function delQ(i) { if (confirm('Delete this question?')) { collect(); ui.draft.questions.splice(Number(i), 1); render(); } }
function cancelCard() { ui.draft = null; render(); }
function parseMaterial(t) { // blocks are separated by a blank line: "# Heading", "- bullet" lines, "1. numbered" lines, "! important note", "[video] path | caption", "[image] path | caption", or a plain paragraph
  return t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^\[(video|image)\]\s*([^|\n]+?)\s*(?:\|\s*([\s\S]*))?$/);
    if (m) return [m[1], m[2], (m[3] || '').trim()];
    if (s.startsWith('# ')) return ['h', s.slice(2)];
    if (s.startsWith('! ')) return ['warn', s.slice(2)];
    const L = s.split('\n');
    if (L.every((l) => l.startsWith('- '))) return ['ul', L.map((l) => l.slice(2))];
    if (L.every((l, i) => l.startsWith((i + 1) + '. '))) return ['ol', L.map((l, i) => l.slice(String(i + 1).length + 2))];
    return ['p', s];
  });
}
async function saveCard(e) {
  e.preventDefault(); collect(); const d = ui.draft, isEval = d.kind === 'evaluation';
  // options C and D may stay empty (a two-option question is True/False); empty options at the end are dropped
  const qs = isEval ? [] : d.questions.map((q) => { const o = q.options.map((x) => x.trim()); while (o.length > 2 && !o[o.length - 1]) o.pop(); return { id: q.id, text: q.text.trim(), options: o, answer: Number(q.answer), explanation: q.explanation.trim() }; });
  const bad = !d.title.trim() || !d.text.trim() || (!isEval && !qs.length) || qs.some((q) => !q.text || !q.explanation || q.options.some((o) => !o) || q.answer >= q.options.length);
  if (bad) return say('derr', 'red', 'Fill in the title, the material, and every question, its options (C and D are optional), the correct answer and the explanation.');
  const body = { title: d.title.trim(), type: d.type, passing: Number(d.passing) || 100, content: parseMaterial(d.text), questions: qs };
  const r = await call('admin', d.id ? 'update_card' : 'add_card', d.id ? { id: d.id, ...body } : { courseId: ui.cid, ...body }, 'derr');
  if (r) { const edited = !!d.id; ui.draft = null; render(); popup(edited ? 'Card updated' : 'Card added', 'The card "' + body.title + '" was saved successfully.'); }
}

/* ----- assignments ----- */
function adminAssignments() {
  return tpl('tpl-admin-assign', {
    courses: db.courses.filter((c) => c.status === 'Published').map((c) => ({ id: c.id, title: c.title })),
    rows: db.assignments.map((a) => ({ id: a.id, employee: (db.users.find((u) => u.id === a.employeeId) || {}).name, course: (() => { const c = db.courses.find((x) => x.id === a.courseId); return c ? courseTitle(c, a.employeeId) : ''; })(), deadline: fmt(a.deadline) }))
  });
}
function assignTarget() {
  const t = $id('as-t').value, list = emps().filter((u) => u.status === 'Active');
  if (t === 'all') return document.querySelector('[data-slot="target"]').replaceChildren();
  slot(document, 'target', tpl('tpl-assign-target', { label: t === 'department' ? 'Department' : 'Employee', options: t === 'department' ? db.departments.map((d) => ({ value: d.name, text: d.name })) : list.map((u) => ({ value: u.id, text: u.name })) }));
}
async function assign(e) {
  e.preventDefault(); const cid = $id('as-c').value, t = $id('as-t').value, x = $id('as-x') ? $id('as-x').value : '', dl = $id('as-d').value;
  if (!cid) return say('amsg', 'red', 'Choose a course.');
  if (t !== 'all' && !x) return say('amsg', 'red', 'Choose who to assign the course to.');
  const r = await call('admin', 'assign', { courseId: cid, target: t, value: x, deadline: dl }, 'amsg');
  if (r) say('amsg', r.count ? 'green' : 'orange', r.count ? 'Assigned to ' + r.count + ' employee(s).' : 'Everyone selected already has this course (duplicate assignments are not allowed).');
}
function removeAssign(id) { if (confirm('Remove this assignment?')) call('admin', 'remove_assignment', { id }); }

/* ----- supplier evaluation: dashboard, responses, calculator, supplier master, criteria master ----- */
const DEC_CLS = { 'Preferred Supplier': 'green', Approved: 'blue', Conditional: 'orange', 'Not Recommended': 'red' };
const RATE_CLS = { Excellent: 'green', Good: 'blue', Acceptable: 'orange', Poor: 'red' };
const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const bd = (txt, cls) => ({ v: txt, cls: 'badge ' + (cls || 'gray') });
const tableFrag = (title, cols, rows, note) => tpl('tpl-table', { title, note, cols: cols.map((v) => ({ v })), rows: rows.map((cells) => ({ cells })), empty: !rows.length, emptyText: 'No data yet.' });
const tableAction = (el) => window[el.dataset.act](el.dataset.id);

/* ---------- Print: a print window styled like the website, in light or dark mode (also "Save as PDF") ---------- */
let printJob = null;
// fields: the options the person can pick before printing (they start with what is on screen); rowsFn(values) gives the rows; build(theme, values) prints them
function openPrint(title, fields, rowsFn, build) {
  let theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  try { theme = localStorage.getItem('leads-print-theme') || theme; } catch (e) { /* ignore */ }
  printJob = { fields, rowsFn, build, theme };
  document.body.appendChild(tpl('tpl-print', { title: 'Print: ' + title }));
  const box = $id('pfields');
  fields.forEach((f) => {
    const lab = document.createElement('label'); lab.className = 'pf'; lab.append(f.label);
    let el;
    if (f.type === 'date') { el = document.createElement('input'); el.type = 'date'; el.value = f.value || ''; }
    else { el = document.createElement('select'); f.options.forEach((o) => { const op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; el.appendChild(op); }); el.value = f.value || ''; }
    el.id = 'pf-' + f.key; el.onchange = printCount; el.oninput = printCount; lab.append(el); box.append(lab);
  });
  pickPrintTheme(theme); printCount();
}
const printValues = () => { const v = {}; printJob.fields.forEach((f) => { v[f.key] = $id('pf-' + f.key).value; }); return v; };
function printCount() { const n = printJob.rowsFn(printValues()).length; $id('pcount').textContent = n + ' row' + (n === 1 ? '' : 's') + ' will be printed.'; }
function printResetFields() { printJob.fields.forEach((f) => { $id('pf-' + f.key).value = ''; }); printCount(); }
function pickPrintTheme(t) {
  if (!printJob) return; printJob.theme = t; try { localStorage.setItem('leads-print-theme', t); } catch (e) { /* ignore */ }
  ['light', 'dark'].forEach((k) => { const b = $id('pt-' + k); if (b) b.classList.toggle('on', k === t); });
}
function closePrint() { const d = $id('printdlg'); if (d) d.remove(); }
function runPrint() { const j = printJob, v = printValues(); closePrint(); if (j) j.build(j.theme, v); }
function printReport(title, notes, headers, rows, theme) {
  const dark = theme === 'dark';
  const P = dark ? { bg: '#0b0e0d', card: '#151a18', alt: '#1b221f', tx: '#e9efeb', mu: '#9aa8a0', bd: '#2a322e', p: '#2bd47d', thbg: '#12301f', thtx: '#5eeaa0', y: '#ffc933', green: ['#07934a', '#ffffff'], blue: ['#12301f', '#5eeaa0'], orange: ['#3a2a14', '#ffa94d'], red: ['#3b1a17', '#ff6b5e'], gray: ['#232b27', '#9aa8a0'] }
    : { bg: '#f5f6f5', card: '#ffffff', alt: '#f3f9f5', tx: '#15191c', mu: '#5f6a65', bd: '#e2e6e3', p: '#00853e', thbg: '#e6f3ec', thtx: '#006b32', y: '#fcb913', green: ['#00853e', '#ffffff'], blue: ['#e6f3ec', '#00642e'], orange: ['#fdf0e1', '#b54708'], red: ['#fdebe9', '#b42318'], gray: ['#eef0ee', '#48524d'] };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cell = (c) => (c && typeof c === 'object') ? '<span class="b ' + esc(c.c || 'gray') + '">' + esc(c.t) + '</span>' : esc(c);
  const css = ['@page{size:A4 landscape;margin:10mm}', '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    'html,body{margin:0;background:' + P.bg + '}body{font:12px/1.45 Inter,"Segoe UI",Arial,sans-serif;color:' + P.tx + '}',
    '.sheet{background:' + P.card + ';border:1px solid ' + P.bd + ';border-top:4px solid ' + P.y + ';border-radius:10px;padding:14px 16px}',
    '.top{display:flex;align-items:center;gap:12px;border-bottom:2px solid ' + P.p + ';padding-bottom:10px;margin-bottom:10px}.logo{height:38px}',
    '.brand{font-size:10.5px;font-weight:700;letter-spacing:.08em;color:' + P.p + '}h1{font-size:21px;margin:1px 0 0}',
    '.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 6px}.chip{background:' + P.thbg + ';color:' + P.thtx + ';border-radius:999px;padding:2px 10px;font-size:10.5px;font-weight:600}',
    '.meta{color:' + P.mu + ';font-size:10.5px;margin:0 0 10px}',
    'table{width:100%;border-collapse:collapse;border:1px solid ' + P.bd + ';border-radius:8px}th,td{border-bottom:1px solid ' + P.bd + ';padding:6px 8px;text-align:left;vertical-align:middle;overflow-wrap:break-word}',
    'th{background:' + P.thbg + ';color:' + P.thtx + ';font-size:10px;text-transform:uppercase;letter-spacing:.04em}thead{display:table-header-group}tr{page-break-inside:avoid}tbody tr:nth-child(even) td{background:' + P.alt + '}',
    '.b{display:inline-block;padding:1px 9px;border-radius:999px;font-size:10.5px;font-weight:600}',
    ['green', 'blue', 'orange', 'red', 'gray'].map((k) => '.b.' + k + '{background:' + P[k][0] + ';color:' + P[k][1] + '}').join(''),
    '.foot{margin-top:10px;color:' + P.mu + ';font-size:10px;display:flex;justify-content:space-between}'].join('\n');
  const logo = new URL('img/logo.png', location.href).href;
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + css + '</style></head><body><div class="sheet">'
    + '<div class="top"><img class="logo" src="' + esc(logo) + '" alt="" onerror="this.remove()"><div><div class="brand">LEADS TRAINING</div><h1>' + esc(title) + '</h1></div></div>'
    + '<div class="chips">' + notes.filter(Boolean).map((n) => '<span class="chip">' + esc(n) + '</span>').join('') + '</div>'
    + '<p class="meta">Printed by ' + esc(me.name) + ' on ' + esc(new Date().toLocaleString()) + ' &nbsp;|&nbsp; ' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + '</p>'
    + '<table><thead><tr>' + headers.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>'
    + (rows.length ? rows.map((r) => '<tr>' + r.map((c) => '<td>' + cell(c) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + headers.length + '">No data to print.</td></tr>')
    + '</tbody></table><div class="foot"><span>Leads Agri | Leads Training</span><span>' + (dark ? 'Dark' : 'Light') + ' print</span></div></div></body></html>';
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(fr);
  const w = fr.contentWindow; w.document.open(); w.document.write(html); w.document.close(); w.onafterprint = () => fr.remove();
  setTimeout(() => { w.focus(); w.print(); }, 500);
}
const corrCell = (e) => (e.corrective === 'Yes' ? (e.correctiveStatus === 'Resolved' ? { t: 'Solved', c: 'green' } : { t: 'Pending', c: 'orange' }) : '-');
const RESP_SORTS = { old: 'oldest first', high: 'highest score first', low: 'lowest score first' };
// the responses after the filters of v (user, cat, rating, decision, corr, from, to, sort)
function respApply(v) {
  const cat = (v.cat || '').toLowerCase(), day = (e) => String(e.evaluationDate || '').slice(0, 10);
  const L = (db.evaluations || []).filter((e) => (!v.user || e.evaluatorId === v.user) && (!cat || (e.category || '').trim().toLowerCase() === cat) && (!v.rating || e.rating === v.rating)
    && (!v.decision || e.decision === v.decision) && (!v.corr || respCorrKey(e) === v.corr) && (!v.from || day(e) >= v.from) && (!v.to || day(e) <= v.to)).slice().reverse(); // newest first
  if (v.sort === 'old') L.reverse(); else if (v.sort === 'high') L.sort((a, b) => b.score - a.score); else if (v.sort === 'low') L.sort((a, b) => a.score - b.score);
  return L;
}
function respNotes(v) {
  const who = (db.evaluations || []).find((e) => e.evaluatorId === v.user);
  const n = [v.user && who ? 'Evaluator: ' + who.evaluator : '', v.cat ? 'Category: ' + v.cat : '', v.rating ? 'Rating: ' + v.rating : '', v.decision ? 'Decision: ' + v.decision : '',
    v.corr ? 'Corrective action: ' + ({ pending: 'Pending', solved: 'Solved', none: 'Not required' }[v.corr]) : '', v.from ? 'From: ' + fmt(v.from) : '', v.to ? 'To: ' + fmt(v.to) : '', v.sort ? 'Sorted: ' + RESP_SORTS[v.sort] : ''].filter(Boolean);
  return n.length ? n : ['All responses'];
}
function printResponses() {
  const all = db.evaluations || [], people = [], seen = {}, cats = [];
  all.forEach((e) => { if (!people.some((p) => p.id === e.evaluatorId)) people.push({ id: e.evaluatorId, name: e.evaluator }); const c = (e.category || '').trim(); if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; cats.push(c); } });
  cats.sort((a, b) => a.localeCompare(b));
  const fields = [
    { key: 'user', label: 'Evaluator', options: [['', 'All employees'], ...people.map((p) => [p.id, p.name])], value: ui.respUser || '' },
    { key: 'cat', label: 'Category', options: [['', 'All categories'], ...cats.map((c) => [c, c])], value: ui.respCat || '' },
    { key: 'rating', label: 'Rating', options: [['', 'All ratings'], ...Object.keys(RATE_CLS).map((r) => [r, r])], value: ui.respRating || '' },
    { key: 'decision', label: 'Decision', options: [['', 'All decisions'], ...Object.keys(DEC_CLS).map((d) => [d, d])], value: ui.respDecision || '' },
    { key: 'corr', label: 'Corrective action', options: [['', 'All'], ['pending', 'Pending'], ['solved', 'Solved'], ['none', 'Not required']], value: ui.respCorr || '' },
    { key: 'sort', label: 'Sort by', options: [['', 'Newest first'], ['old', 'Oldest first'], ['high', 'Highest score first'], ['low', 'Lowest score first']], value: ui.respSort || '' },
    { key: 'from', label: 'Evaluation date from', type: 'date', value: '' }, { key: 'to', label: 'Evaluation date to', type: 'date', value: '' }];
  openPrint('Evaluation Responses', fields, respApply, (theme, v) => printReport('Evaluation Responses', respNotes(v),
    ['Timestamp', 'Supplier Name', 'Category', 'Evaluator', 'Evaluation Date', 'Overall Score', 'Rating', 'Decision', 'Recommendation', 'Corrective Action'],
    respApply(v).map((e) => [new Date(e.timestamp).toLocaleString(), e.supplier, e.category, e.evaluator, fmt(e.evaluationDate), e.score.toFixed(1) + '%', { t: e.rating, c: RATE_CLS[e.rating] }, { t: e.decision, c: DEC_CLS[e.decision] }, e.recommendation, corrCell(e)]), theme));
}
// the suppliers after the filters of v (cat, status, dept, due, sort)
function supApply(v) {
  const cat = (v.cat || '').toLowerCase(), today = new Date().toISOString().slice(0, 10);
  let L = (db.suppliers || []).filter((s) => (!cat || (s.category || '').trim().toLowerCase() === cat) && (!v.status || s.status === v.status)
    && (!v.dept || (v.dept === '__none' ? !s.department : (s.department || '') === v.dept))
    && (!v.due || (v.due === 'never' ? !s.lastEvaluation : !!s.nextEvaluation && qRange(s.nextEvaluation).end < today)));
  if (v.sort) L = L.slice().sort((a, b) => { const x = a.score, y = b.score; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return v.sort === 'high' ? y - x : x - y; });
  return L;
}
function printSuppliers() {
  const all = db.suppliers || [], today = new Date().toISOString().slice(0, 10), seen = {}, cats = [], depts = [];
  all.forEach((s) => { const c = (s.category || '').trim(); if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; cats.push(c); } if (s.department && !depts.includes(s.department)) depts.push(s.department); });
  cats.sort((a, b) => a.localeCompare(b)); depts.sort((a, b) => a.localeCompare(b));
  const fields = [
    { key: 'cat', label: 'Category', options: [['', 'All categories'], ...cats.map((c) => [c, c])], value: ui.supCat || '' },
    { key: 'status', label: 'Status', options: [['', 'All statuses'], ...SUP_STATUSES.map((x) => [x, x])], value: ui.supStatus || '' },
    { key: 'dept', label: 'Department', options: [['', 'All departments'], ['__none', 'Suppliers for all departments'], ...depts.map((d) => [d, d])], value: '' },
    { key: 'due', label: 'Evaluation', options: [['', 'All'], ['overdue', 'Overdue'], ['never', 'Not yet evaluated']], value: '' },
    { key: 'sort', label: 'Current score', options: [['', 'Default order'], ['high', 'Highest score first'], ['low', 'Lowest score first']], value: ui.supSort || '' }];
  const notes = (v) => [v.cat ? 'Category: ' + v.cat : 'All categories', v.status ? 'Status: ' + v.status : 'All statuses', v.dept ? 'Department: ' + (v.dept === '__none' ? 'all departments' : v.dept) : '', v.due ? (v.due === 'never' ? 'Not yet evaluated' : 'Overdue evaluations') : '', v.sort ? (v.sort === 'high' ? 'Highest score first' : 'Lowest score first') : ''];
  openPrint('Supplier Master', fields, supApply, (theme, v) => printReport('Supplier Master', notes(v),
    ['Supplier ID', 'Supplier Name', 'TIN', 'Physical Address', 'Category', 'Department', 'Contact Person', 'Contact No.', 'Email', 'Status', 'Current Score', 'Last Evaluation', 'Next Evaluation'],
    supApply(v).map((s) => { const nq = s.nextEvaluation ? qRange(s.nextEvaluation) : null; return [s.code, s.name, s.tin || '-', s.address || '-', s.category, s.department || 'All departments', s.contactPerson || '-', s.contactNo || '-', s.email || '-',
      { t: s.status, c: DEC_CLS[s.status === 'Preferred' ? 'Preferred Supplier' : s.status] || 'gray' }, s.score == null ? '-' : s.score.toFixed(1) + '%', s.lastEvaluation ? fmt(s.lastEvaluation) : '-', nq ? nq.label + (nq.end < today ? ' (Overdue)' : '') : '-']; }), theme));
}

function latestEvals() { // the most recent evaluation of each supplier
  const m = {};
  db.evaluations.forEach((e) => { const c = m[e.supplierId]; if (!c || e.evaluationDate > c.evaluationDate || (e.evaluationDate === c.evaluationDate && Number(e.id) > Number(c.id))) m[e.supplierId] = e; });
  return m;
}
function adminSuppliers() {
  const tab = ui.stab || 'dashboard', tabs = [['dashboard', 'Dashboard'], ['responses', 'Evaluation Responses'], ['form', 'Evaluation Form'], ['corrective', 'Corrective Action Requests']]; // the other pages are in the Actions menu
  const f = tpl('tpl-admin-suppliers', { tabs: tabs.map((t) => ({ key: t[0], label: t[1], cls: tab === t[0] ? 'on' : '' })) });
  slot(f, 'body', { dashboard: supDashboard, responses: supResponses, form: adminEvalForm, corrective: supCorrective, calculator: supCalculator, master: supMaster, criteria: supCriteria, reevals: supReevals }[tab]()); return f;
}
function supReevals() {
  const L = db.reevals || [], st = (r) => (r.status === 'Pending' ? 'orange' : r.status === 'Declined' ? 'red' : 'green');
  return tableFrag('Re-evaluation Requests', ['Employee', 'Supplier', 'Supervisor', 'Reason', 'Requested', 'Status', '', ''],
    L.map((r) => [{ v: r.employee }, { v: r.supplier }, { v: r.supervisor || 'None (admin decides)' }, { v: r.reason || '-' }, { v: fmt(r.createdAt) }, bd(r.status, st(r)),
      r.status === 'Pending' ? { btn: 'Approve', act: 'approveReeval', id: r.id } : { v: '' }, r.status === 'Pending' ? { btn: 'Decline', act: 'declineReeval', id: r.id } : { v: '' }]),
    'An approved request lets the employee submit one more evaluation of that supplier in the same quarter.');
}
// plain functions (not const), because the table buttons find them by name on window
function approveReeval(id) { return decideReeval(id, 'Approved'); }
function declineReeval(id) { return decideReeval(id, 'Declined'); }
function supTab(t) { ui.stab = t; ui.supDetail = null; ui.crit = null; render(); }
function supDashboard() {
  const sup = db.suppliers, lat = latestEvals(), L = sup.filter((s) => lat[s.id]).map((s) => ({ s, e: lat[s.id] })), n = L.length;
  const avg = n ? L.reduce((t, x) => t + x.e.score, 0) / n : 0, pref = L.filter((x) => x.e.decision === 'Preferred Supplier').length, openCA = db.evaluations.filter((e) => e.corrective === 'Yes' && e.correctiveStatus !== 'Resolved').length, // corrective actions that are not resolved yet
    alerts = L.filter((x) => x.e.decision === 'Conditional' || x.e.decision === 'Not Recommended').length + openCA;
  const box = document.createDocumentFragment(), act = {}; db.thresholds.forEach((t) => { act[t.decision] = t.action; });
  box.append(tpl('tpl-stats', { stats: [['Total Evaluated Suppliers', n], ['Average Performance Score', avg.toFixed(1) + '%'], ['Preferred Vendor Ratio', (n ? pref / n * 100 : 0).toFixed(1) + '%'], ['Action Required Alerts', alerts]].map((x) => ({ label: x[0], value: x[1] })) }));
  // everything that is counted in Action Required Alerts, so the admin can open it
  const todo = [...L.filter((x) => x.e.decision === 'Conditional' || x.e.decision === 'Not Recommended').map((x) => ({ e: x.e, why: bd(x.e.decision, DEC_CLS[x.e.decision]) })),
    ...db.evaluations.filter((e) => e.corrective === 'Yes' && e.correctiveStatus !== 'Resolved').map((e) => ({ e, why: bd('Pending corrective action', 'orange') }))];
  box.append(tableFrag('Action Required (' + todo.length + ')', ['Supplier', 'Reason', 'Evaluated by', 'Evaluation Date', 'Score', ''],
    todo.map((x) => [{ v: x.e.supplier }, x.why, { v: x.e.evaluator }, { v: fmt(x.e.evaluationDate) }, { v: x.e.score.toFixed(1) + '%' }, { btn: 'View', act: 'openResponse', id: x.e.id }]),
    'Suppliers whose latest evaluation is Conditional or Not Recommended, and corrective actions that are not solved yet. Click View to open the evaluation and its corrective action form.'));
  box.append(tableFrag('Supplier Performance Overview & Multi-Criteria Audit', ['Supplier Name', 'Overall Score', 'Rating', 'Decision Status', 'Recommended Action'],
    L.map((x) => [{ v: x.s.name }, { v: x.e.score.toFixed(1) + '%' }, bd(x.e.rating, RATE_CLS[x.e.rating]), bd(x.e.decision, DEC_CLS[x.e.decision]), { v: act[x.e.decision] }]),
    'Based on the latest evaluation of each supplier.'));
  box.append(tableFrag('Vendor Classification Breakdown & Decision Thresholds', ['Decision / Classification', 'Score Threshold', 'Rating Definition', 'Supplier Count', 'Portfolio Share', 'Procurement Action Guideline'],
    db.thresholds.map((t) => { const c = L.filter((x) => x.e.decision === t.decision).length; return [bd(t.decision, DEC_CLS[t.decision]), { v: t.range }, { v: t.definition }, { v: c }, { v: (n ? c / n * 100 : 0).toFixed(1) + '%' }, { v: t.guideline }]; })));
  return box;
}
function respClear() { ['respUser', 'respCat', 'respRating', 'respDecision', 'respCorr', 'respSort'].forEach((k) => { ui[k] = ''; }); ui.supOpen = {}; render(); }
const respCorrKey = (e) => (e.corrective === 'Yes' ? (e.correctiveStatus === 'Resolved' ? 'solved' : 'pending') : 'none');
function supResponses() {
  const box = document.createDocumentFragment(), all = db.evaluations || [], people = [], seen = {}, cats = [];
  all.forEach((e) => { if (!people.some((p) => p.id === e.evaluatorId)) people.push({ id: e.evaluatorId, name: e.evaluator }); const c = (e.category || '').trim(); if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; cats.push(c); } });
  cats.sort((a, b) => a.localeCompare(b));
  if (ui.respUser && !people.some((p) => p.id === ui.respUser)) ui.respUser = '';
  const person = people.find((p) => p.id === ui.respUser), cat = (ui.respCat || '').toLowerCase();
  const L = respApply({ user: ui.respUser, cat: ui.respCat, rating: ui.respRating, decision: ui.respDecision, corr: ui.respCorr, sort: ui.respSort });
  ui.respShown = L; ui.respPerson = person ? person.name : '';
  const active = !!(ui.respUser || ui.respCat || ui.respRating || ui.respDecision || ui.respCorr || ui.respSort);
  const head = supEl('div', 'row between wrap supbar'), filters = supEl('div', 'row wrap supfilters');
  filters.append(
    supSelect('Evaluator', 'respUser', [['', 'All employees'], ...people.map((p) => [p.id, p.name])], ui.respUser || ''),
    supSelect('Category', 'respCat', [['', 'All categories'], ...cats.map((c) => [c, c])], ui.respCat || ''),
    supSelect('Rating', 'respRating', [['', 'All ratings'], ...Object.keys(RATE_CLS).map((r) => [r, r])], ui.respRating || ''),
    supSelect('Decision', 'respDecision', [['', 'All decisions'], ...Object.keys(DEC_CLS).map((d) => [d, d])], ui.respDecision || ''),
    supSelect('Corrective action', 'respCorr', [['', 'All'], ['pending', 'Pending'], ['solved', 'Solved'], ['none', 'Not required']], ui.respCorr || ''),
    supSelect('Sort by', 'respSort', [['', 'Newest first'], ['old', 'Oldest first'], ['high', 'Highest score first'], ['low', 'Lowest score first']], ui.respSort || ''));
  if (active) { const c = supEl('button', 'btn ghost', 'Clear filters'); c.onclick = respClear; filters.append(c); }
  if (person) { const d = supEl('button', 'btn ghost', 'Delete all responses by ' + person.name); d.onclick = deleteUserEvaluations; filters.append(d); }
  const pr = supEl('button', 'btn', 'Print'); pr.onclick = printResponses; filters.append(pr);
  head.append(supEl('h2', '', 'Evaluation Responses'), filters);
  box.append(head, supEl('p', 'small muted', 'Showing ' + L.length + ' of ' + all.length + ' response(s).'));
  box.append(tableFrag('', ['Timestamp', 'Supplier Name', 'Category', 'Evaluator', 'Evaluation Date', 'Overall Score', 'Rating', 'Decision', 'Recommendation', 'Corrective Action', '', ''],
    L.map((e) => [{ v: new Date(e.timestamp).toLocaleString() }, { v: e.supplier }, { v: e.category }, { v: e.evaluator }, { v: fmt(e.evaluationDate) }, { v: e.score.toFixed(1) + '%' }, bd(e.rating, RATE_CLS[e.rating]), bd(e.decision, DEC_CLS[e.decision]), { v: e.recommendation },
      e.corrective === 'Yes' ? bd(e.correctiveStatus === 'Resolved' ? 'Solved' : 'Pending', e.correctiveStatus === 'Resolved' ? 'green' : 'orange') : { v: '-' },
      { btn: 'View', act: 'viewResponse', id: e.id }, { btn: 'Delete', act: 'deleteEvaluation', id: e.id }])));
  return respDetail(box);
}
function respDetail(box) { // the details of one response and, when corrective action is needed, the form for it
  const e = db.evaluations.find((x) => x.id === ui.supDetail);
  if (e) {
    const F = [['Timestamp', new Date(e.timestamp).toLocaleString()], ['Supplier Name', e.supplier], ['Service / Product Provided', e.service], ['Supplier Category', e.category], ['Supplier Criticality', e.criticality], ['Evaluation Date', fmt(e.evaluationDate)], ['Evaluator', e.evaluator],
      ...e.ratings.map((r) => [r.name + ' (' + r.weight + '%)', r.rating + ' / 5']), [deptText('Does the supplier meet IT requirements?', (db.users.find((x) => x.id === e.evaluatorId) || {}).department || ''), e.meets], ['Were there significant issues?', e.issues], ['Is corrective action required?', e.corrective], ['Recommendation', e.recommendation], ['Evaluator Comments', e.comments],
      ['Issue Identified and Corrective Action Needed', e.issueIdentified || '-'], ['Immediate Head / Supervisor', e.supervisor || '-'], ['Supplier Response / Commitment', e.supplierResponse || '-'], ['Target Completion Date', e.targetDate ? fmt(e.targetDate) : '-'], ['Responsible Person', e.responsiblePerson || '-'], ['Follow-up Required', e.followUp || '-'], ['Corrective Action Status', e.corrective === 'Yes' ? (e.correctiveStatus === 'Resolved' ? 'Solved' : 'Pending') : '-'],
      ['Overall Score', e.score.toFixed(1) + '%'], ['Rating', e.rating], ['Decision', e.decision]];
    box.append(tpl('tpl-detail-list', { title: 'Response details', fields: F.map((r) => ({ label: r[0], value: r[1] })) }));
    if (e.corrective === 'Yes') // the employee said corrective action is required, so the admin fills in the rest
      box.append(tpl('tpl-corrective-form', { id: e.id, response: e.supplierResponse || '', target: e.targetDate || '', person: e.responsiblePerson || '', follow: e.followUp || '', status: e.correctiveStatus || 'Open' }));
  }
  return box;
}
// Supplier Evaluation > Corrective Action Requests: every evaluation that needs corrective action, with how long it has been waiting
function supCorrective() {
  const box = document.createDocumentFragment(), all = (db.evaluations || []).filter((e) => e.corrective === 'Yes');
  const pend = (e) => e.correctiveStatus !== 'Resolved', L = all.slice().sort((a, b) => (pend(b) - pend(a)) || (new Date(a.timestamp) - new Date(b.timestamp)));
  box.append(supEl('h2', '', 'Corrective Action Requests'), supEl('p', 'small muted', all.filter(pend).length + ' pending of ' + all.length + ' request(s). The longest waiting come first.'));
  box.append(tableFrag('', ['Supplier', 'Evaluated by', 'Immediate superior', 'Evaluation date', 'Status', 'Pending for', ''],
    L.map((e) => { const mins = (Date.now() - new Date(e.timestamp).getTime()) / 60000;
      return [{ v: e.supplier }, { v: e.evaluator }, { v: e.supervisor || '-' }, { v: fmt(e.evaluationDate) }, bd(pend(e) ? 'Pending' : 'Solved', pend(e) ? 'orange' : 'green'),
        pend(e) ? bd(pendFor(e.timestamp), mins < 1440 ? 'blue' : mins < 4320 ? 'orange' : 'red') : { v: 'Solved' }, { btn: 'View', act: 'viewResponse', id: e.id }]; })));
  return respDetail(box);
}
// permissions of an employee / immediate superior: a checkbox for every published course and evaluation form (new ones appear by themselves)
function permForm(id, isNew) {
  const u = db.users.find((x) => x.id === id); if (!u) return;
  if (u.role === 'admin') return popup('Admin account', 'The admin already has access to everything.');
  const mine = db.assignments.filter((a) => a.employeeId === id).map((a) => a.courseId);
  const items = db.courses.filter((c) => c.status === 'Published').map((c) => ({ cid: c.id, title: c.title.replace(/^IT\s+/i, ''), kind: isEvalCourse(c) ? 'Evaluation form' : 'Course', desc: [c.category, c.duration].filter(Boolean).join(' · ') || ' ' }));
  slot(document, 'eperm', tpl('tpl-emp-perm', { id, heading: (isNew ? 'Step 2 of 2: ' : '') + 'Set permissions for ' + u.name + ' (' + (ROLE_LABEL[u.role] || u.role) + ')',
    intro: 'Tick what this ' + (u.role === 'superior' ? 'immediate superior' : 'employee') + ' is allowed to answer. Courses and evaluation forms you publish later appear in this list automatically.', items, empty: !items.length }));
  document.querySelectorAll('#permform input[type=checkbox]').forEach((cb) => { cb.checked = mine.includes(cb.dataset.course); });
  const s = document.querySelector('[data-slot="eperm"]'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const closePerm = () => { const s = document.querySelector('[data-slot="eperm"]'); if (s) s.replaceChildren(); };
const permAll = (on) => document.querySelectorAll('#permform input[type=checkbox]').forEach((cb) => { cb.checked = on; });
async function savePerms(e, id) {
  e.preventDefault(); const ids = [...document.querySelectorAll('#permform input[type=checkbox]:checked')].map((c) => c.dataset.course), u = db.users.find((x) => x.id === id);
  const r = await call('admin', 'set_permissions', { employeeId: id, courseIds: ids }, 'perr');
  if (r) popup('Permissions saved', 'The permissions of ' + (u ? u.name : 'the account') + ' were saved: ' + ids.length + ' selected (' + r.added + ' added, ' + r.removed + ' removed).');
}
function saveCorrective(ev, id) {
  ev.preventDefault();
  const v = { id, supplierResponse: $id('ca-response').value.trim(), targetDate: $id('ca-target').value, responsiblePerson: $id('ca-person').value.trim(), followUp: $id('ca-follow').value, status: $id('ca-status').value };
  if (!v.targetDate || !v.responsiblePerson || !v.followUp) return say('caerr', 'red', 'Fill in the target completion date, responsible person and follow-up.');
  const src = me.role === 'admin' ? (db.evaluations || []).find((x) => x.id === id) : (db.corrective || []).find((x) => x.id === id), name = src ? src.supplier : 'this supplier';
  return call(me.role === 'admin' ? 'admin' : 'employee', 'save_corrective', v, 'caerr').then((r) => {
    if (!r) return;
    say('caerr', 'green', 'Corrective action saved.');
    popup(v.status === 'Resolved' ? 'Corrective action marked as solved' : 'Corrective action saved', 'The corrective action for ' + name + ' was saved successfully' + (v.status === 'Resolved' ? ' and marked as solved.' : ' and is still pending.'));
  });
}
function respFilter(id) { ui.respUser = id; ui.supDetail = null; render(); }
function deleteEvaluation(id) {
  if (confirm('Delete this evaluation? The supplier score and evaluation dates will be recalculated from the evaluations that are left.')) return call('admin', 'delete_evaluation', { id });
}
function deleteUserEvaluations() {
  const p = db.evaluations.find((e) => e.evaluatorId === ui.respUser); if (!p) return;
  if (confirm('Delete ALL evaluations submitted by ' + p.evaluator + '? Supplier scores and dates will be recalculated.')) return call('admin', 'delete_user_evaluations', { userId: ui.respUser }).then(() => { ui.respUser = ''; render(); });
}
function viewResponse(id) { ui.supDetail = id; render(); }
function openResponse(id) { ui.stab = 'responses'; ui.supDetail = id; ui.crit = null; render(); const h = [...document.querySelectorAll('h2')].find((x) => x.textContent === 'Response details'); if (h) h.scrollIntoView(); } // from the dashboard's Action Required list
function supCalculator() {
  const lat = latestEvals(), L = db.suppliers.filter((s) => lat[s.id]);
  return tableFrag('Evaluation Report', ['Supplier', ...db.criteria.map((c) => c.name + ' (' + c.weight + '%)'), 'Overall Score', 'Rating', 'Decision'],
    L.map((s) => { const e = lat[s.id]; return [{ v: s.name }, ...db.criteria.map((c) => { const r = e.ratings.find((x) => x.criterionId === c.id); return { v: r ? r.rating : '-' }; }), { v: e.score.toFixed(1) + '%' }, bd(e.rating, RATE_CLS[e.rating]), bd(e.decision, DEC_CLS[e.decision])]; }),
    'Overall score = sum of (weight x rating) divided by 5. Ratings are the latest evaluation of each supplier. A "-" means that criterion was not part of that evaluation. The overall score is the one saved when the evaluation was submitted.');
}
const ownSup = (s) => me.role === 'admin' || (!!s.department && s.department.toLowerCase() === (me.department || '').toLowerCase()); // an employee changes only the suppliers of their own department
/* ---------- Supplier Master: filters on the top right, short table, and a View button that expands each supplier ---------- */
const SUP_STATUSES = ['Under Review', 'Preferred', 'Approved', 'Conditional', 'Not Recommended'];
function supFilterSet(key, value) { ui[key] = value; ui.supOpen = {}; render(); }
function supFilterClear() { ui.supCat = ''; ui.supStatus = ''; ui.supSort = ''; ui.supOpen = {}; render(); }
function supToggle(id) { // opens or closes the full details of one supplier without redrawing the page
  ui.supOpen = ui.supOpen || {}; ui.supOpen[id] = !ui.supOpen[id];
  const d = document.querySelector('tr[data-sup-detail="' + id + '"]'), b = document.querySelector('button[data-sup-view="' + id + '"]');
  if (d) d.classList.toggle('hidden', !ui.supOpen[id]);
  if (b) b.textContent = ui.supOpen[id] ? 'Hide' : 'View';
}
function supEl(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
function supBadge(b) { return supEl('span', b.cls, b.v); }
function supSelect(label, key, options, current) { // one dropdown filter
  const l = supEl('label', 'supfilter'), sel = document.createElement('select');
  options.forEach((o) => { const op = supEl('option', '', o[1]); op.value = o[0]; if (o[0] === current) op.selected = true; sel.append(op); });
  sel.onchange = () => supFilterSet(key, sel.value);
  l.append(supEl('span', 'small muted', label), sel); return l;
}

/* ---------- Excel export / import of the Supplier Master (SheetJS) ---------- */

const SUP_XL = ['Supplier ID', 'Supplier Name', 'Category', 'Department', 'Contact Person', 'Contact No.', 'Email', 'TIN', 'Physical Address', 'Status', 'Current Score', 'Last Evaluation', 'Next Evaluation'];
const xlMissing = () => popup('The Excel library is not loaded', 'The Excel library (SheetJS) could not be loaded. Check the internet connection, or save xlsx.full.min.js in the js folder of the website.', 'error');

function exportSuppliers() {

  if (!window.XLSX) return xlMissing();
  const L = ui.supShown || [], today = new Date().toISOString().slice(0, 10);
  if (!L.length) return popup('Nothing to export', 'There are no suppliers to export. Clear the filters or add a supplier first.');
  const rows = L.map((s) => { const nq = s.nextEvaluation ? qRange(s.nextEvaluation) : null; return {
    'Supplier ID': s.code, 'Supplier Name': s.name, 'Category': s.category, 'Department': s.department || '', 'Contact Person': s.contactPerson || '', 'Contact No.': s.contactNo || '', 'Email': s.email || '', 'TIN': s.tin || '', 'Physical Address': s.address || '',
    'Status': s.status, 'Current Score': s.score == null ? '' : Number(s.score.toFixed(1)), 'Last Evaluation': s.lastEvaluation ? fmt(s.lastEvaluation) : '', 'Next Evaluation': nq ? nq.label + (nq.end < today ? ' (Overdue)' : '') : '' }; });
  const ws = XLSX.utils.json_to_sheet(rows, { header: SUP_XL }), wb = XLSX.utils.book_new();
  ws['!cols'] = [12, 30, 20, 20, 22, 16, 28, 20, 40, 16, 14, 16, 30].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'Supplier Master'); XLSX.writeFile(wb, 'Supplier_Master_' + today + '.xlsx');

}

/* ----- template for the import: the same six columns the import reads ----- */
const SUP_TPL = ['Supplier Name', 'Category', 'Department', 'Contact Person', 'Contact No.', 'Email', 'TIN', 'Physical Address'];
const SUP_TPL_ROWS = 1000; // the import accepts at most 1000 rows at a time
function downloadSupplierTemplate() {
  if (!window.XLSX) return xlMissing();
  const isAdmin = me.role === 'admin', depts = isAdmin ? (db.departments || []).map((d) => d.name) : [me.department].filter(Boolean);
  // sheet 1 = the sheet that the import reads. The Contact No. column is text, so a number that starts with 0 keeps its zero.
  const ws = XLSX.utils.aoa_to_sheet([SUP_TPL]);
  for (let r = 2; r <= SUP_TPL_ROWS + 1; r++) { ws['E' + r] = { t: 's', v: '', z: '@' }; ws['G' + r] = { t: 's', v: '', z: '@' }; } // Contact No. and TIN are text, so a number that starts with 0 keeps its zero
  ws['!ref'] = 'A1:H' + (SUP_TPL_ROWS + 1);
  ws['!cols'] = [30, 22, 22, 22, 18, 30, 22, 45].map((w) => ({ wch: w }));
  // sheet 2 = how to fill the template (the import ignores it)
  const help = [
    ['How to use this template'], [''],
    ['1', 'Type one supplier per row in the "Suppliers" sheet, starting on row 2. Do not rename, move or delete the column names in row 1.'],
    ['2', 'Supplier Name is required. Category, Department, Contact Person, Contact No., Email, TIN and Physical Address can be left empty, but please fill them in when you can.'],
    ['3', isAdmin ? 'Department must be written exactly as it appears in the list below. Leave it empty if the supplier is for all departments.' : 'Your suppliers are saved under your own department (' + (me.department || 'not set') + '), so the Department column can be left empty.'],
    ['4', 'Email must be a valid address, for example name@company.com.'],
    ['5', 'The Contact No. and TIN columns are already set to text, so numbers that start with 0 keep their zero. Write the TIN as it is on the BIR registration, for example 123-456-789-000.'],
    ['6', 'If a Supplier Name already exists in the Supplier Master, that supplier is updated and empty cells keep the current value. The other rows are added as new suppliers.'],
    ['7', 'Save the file as .xlsx, then click Import Excel in the Supplier Master and choose the file. Do not add more than ' + SUP_TPL_ROWS + ' suppliers at a time.'],
    ['8', 'Attachment 2303 and Extra Document/s cannot be imported from Excel. After the import, click Edit on a supplier in the Supplier Master to upload them.'],
    [''], ['Example of one row'], SUP_TPL, ['Sample Supplier Inc.', 'IT Hardware', depts[0] || '', 'Juan Dela Cruz', '09171234567', 'juan@example.com', '123-456-789-000', '123 Rizal Street, Barangay Poblacion, Calamba City, Laguna'],
    [''], [isAdmin ? 'Departments you can use' : 'Your department'], ...(depts.length ? depts.map((d) => [d]) : [['(no departments yet)']])
  ];
  const wh = XLSX.utils.aoa_to_sheet(help);
  wh['!cols'] = [{ wch: 30 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 30 }, { wch: 22 }, { wch: 45 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Suppliers'); XLSX.utils.book_append_sheet(wb, wh, 'Instructions');
  XLSX.writeFile(wb, 'Supplier_Import_Template.xlsx');
}

/* ----- import ----- */
const contactWho = () => (me && me.role === 'admin' ? 'the system developer' : 'your administrator');
const importHelp = () => 'If the error still occurs, please contact ' + contactWho() + '.';
// every problem with the file itself (not readable, wrong columns, no rows) ends here
const invalidFile = (why) => popup('Invalid file format', (why || 'The file that you uploaded is either invalid, empty, or does not follow the Supplier Master template.') + '\n\nPlease download the template, fill in your supplier details, and upload it again. ' + importHelp(), 'error');

function importSuppliers(inp) {
  const file = inp.files && inp.files[0]; inp.value = ''; if (!file) return;
  if (!window.XLSX) return xlMissing();
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return invalidFile('The file "' + file.name + '" is not an Excel file. Only .xlsx, .xls and .csv files can be imported.');
  const rd = new FileReader();
  rd.onerror = () => invalidFile();
  rd.onload = async (ev) => {
    const norm = (k) => String(k).toLowerCase().replace(/[^a-z]/g, ''), pick = (r, names) => { for (const k of Object.keys(r)) if (names.includes(norm(k))) return String(r[k]).trim(); return ''; };
    const NAME_KEYS = ['suppliername', 'name', 'supplier'];
    let sheet;
    try {
      const wb = XLSX.read(ev.target.result, { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) return invalidFile();
      const head = (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })[0] || []).map(norm);
      if (!head.some((h) => NAME_KEYS.includes(h))) return invalidFile('The first row of the file does not have the column "Supplier Name", so it does not follow the Supplier Master template.');
      sheet = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    } catch (e) { return invalidFile(); }
    const data = sheet.map((r, i) => ({ row: i + 2, code: pick(r, ['supplierid', 'suppliercode', 'id', 'code']), name: pick(r, NAME_KEYS), category: pick(r, ['category']), department: pick(r, ['department']),
      contactPerson: pick(r, ['contactperson', 'contact']), contactNo: pick(r, ['contactno', 'contactnumber', 'phone', 'mobile']), email: pick(r, ['email', 'emailaddress']), tin: pick(r, ['tin', 'tinnumber', 'taxidentificationnumber', 'taxid']), address: pick(r, ['physicaladdress', 'address', 'supplieraddress', 'businessaddress']) })).filter((r) => r.code || r.name || r.category || r.email);
    if (!data.length) return invalidFile('The file has the right columns, but it has no supplier rows.');
    // how many rows will update an existing supplier (the server makes the real decision)
    const known = db.suppliers || [], low = (v) => String(v || '').toLowerCase();
    const upd = data.filter((r) => known.some((s) => (r.code && low(s.code) === low(r.code)) || (r.name && low(s.name) === low(r.name)))).length;
    const ok = await confirmBox({
      title: 'Import suppliers?', file: file.name,
      stats: [[data.length, data.length === 1 ? 'row found' : 'rows found'], [data.length - upd, 'to be added'], [upd, 'to be updated']],
      text: 'A row whose Supplier ID or Supplier Name already exists updates that supplier, and empty cells keep the current value. All other rows are added as new suppliers.',
      yes: 'Import', no: 'Cancel'
    });
    if (!ok) return;
    let r;
    try { r = await api('admin', 'import_suppliers', { rows: data }); await refresh(); render(); }
    catch (e) {
      if (e.status === 401) { me = null; db = null; render(); return; }
      return popup('Import failed', e.message + '\n\nNo supplier was imported. ' + importHelp(), 'error');
    }
    const did = (r.added || 0) + (r.updated || 0) > 0;
    popup(did ? 'Import finished' : 'Nothing was imported', r.added + ' added, ' + r.updated + ' updated, ' + r.skipped + ' skipped.' + (r.errors && r.errors.length ? '\n\n' + r.errors.slice(0, 8).join('\n') + (r.errors.length > 8 ? '\n…and ' + (r.errors.length - 8) + ' more.' : '') : ''), did ? undefined : 'error');
  };
  rd.readAsArrayBuffer(file);
}
function supMaster() {
  const box = document.createDocumentFragment(), today = new Date().toISOString().slice(0, 10), all = db.suppliers || [];
  box.append(tpl('tpl-sup-bar'));
  ui.supOpen = ui.supOpen || {};
  // categories of the table, without duplicates (capital letters and extra spaces do not make a new category)
  const seen = {}, cats = [];
  all.forEach((s) => { const c = (s.category || '').trim(), k = c.toLowerCase(); if (c && !seen[k]) { seen[k] = c; cats.push(c); } });
  cats.sort((a, b) => a.localeCompare(b));
  if (ui.supCat && !seen[ui.supCat.toLowerCase()]) ui.supCat = '';
  const cat = (ui.supCat || '').toLowerCase();
  let L = all.filter((s) => (!cat || (s.category || '').trim().toLowerCase() === cat) && (!ui.supStatus || s.status === ui.supStatus));
  if (ui.supSort) L = L.slice().sort((a, b) => { // suppliers without a score always stay at the bottom
    const x = a.score, y = b.score; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return ui.supSort === 'high' ? y - x : x - y;
  });
  ui.supShown = L; // what is shown after the filters: the Print button prints exactly this
  const active = !!(ui.supCat || ui.supStatus || ui.supSort);
  // title on the left, filters on the top right (outside the table)
  const head = supEl('div', 'row between wrap supbar'), filters = supEl('div', 'row wrap supfilters');
  filters.append(
    supSelect('Category', 'supCat', [['', 'All categories'], ...cats.map((c) => [c, c])], ui.supCat || ''),
    supSelect('Status', 'supStatus', [['', 'All statuses'], ...SUP_STATUSES.map((x) => [x, x])], ui.supStatus || ''),
    supSelect('Current score', 'supSort', [['', 'Default order'], ['high', 'Highest score first'], ['low', 'Lowest score first']], ui.supSort || ''));
  if (active) { const c = supEl('button', 'btn ghost', 'Clear filters'); c.onclick = supFilterClear; filters.append(c); }
  const pr = supEl('button', 'btn', 'Print'); pr.onclick = printSuppliers; filters.append(pr);
  head.append(supEl('h2', '', 'Supplier Master'), filters);
  box.append(head, supEl('p', 'small muted', 'Showing ' + L.length + ' of ' + all.length + ' supplier' + (all.length === 1 ? '' : 's') + '. Click View to see the physical address, contact details, status, current score and attachments.'));
  // the table
  const card = supEl('div', 'card tablewrap'), table = document.createElement('table'), thead = document.createElement('thead'), hr = document.createElement('tr'), tb = document.createElement('tbody');
  ['Supplier ID', 'Supplier Name', 'TIN', 'Category', 'Last Evaluation', 'Next Evaluation (fixed quarter)', ''].forEach((h) => hr.append(supEl('th', '', h)));
  thead.append(hr); table.append(thead, tb); card.append(table);
  L.forEach((s) => {
    const nq = s.nextEvaluation ? qRange(s.nextEvaluation) : null, late = nq && nq.end < today, open = !!ui.supOpen[s.id];
    const tr = document.createElement('tr');
    tr.append(supEl('td', '', s.code), supEl('td', '', s.name), supEl('td', '', s.tin || '-'), supEl('td', '', s.category), supEl('td', '', s.lastEvaluation ? fmt(s.lastEvaluation) : '-'));
    const tdNext = supEl('td'); if (late) tdNext.append(supBadge(bd(nq.label + ' (Overdue)', 'orange'))); else tdNext.textContent = nq ? nq.label : '-';
    const tdAct = supEl('td', 'supactions'), view = supEl('button', 'btn ghost', open ? 'Hide' : 'View');
    view.dataset.supView = s.id; view.onclick = () => supToggle(s.id); tdAct.append(view);
    if (ownSup(s)) { const ed = supEl('button', 'btn ghost', 'Edit'), rm = supEl('button', 'btn ghost', 'Remove'); ed.onclick = () => supplierForm(s.id); rm.onclick = () => deleteSupplier(s.id); tdAct.append(ed, rm); }
    tr.append(tdNext, tdAct); tb.append(tr);
    // the expanded part: the details that are not in the short table
    const dr = document.createElement('tr'), dt = supEl('td', 'supdetail'), inner = document.createElement('table'), ih = document.createElement('tr'), iv = document.createElement('tr');
    dr.dataset.supDetail = s.id; if (!open) dr.className = 'hidden'; dt.colSpan = 7;
    ['Physical Address', 'Contact Person', 'Contact No.', 'Email', 'Status', 'Current Score', 'Attachment 2303', 'Extra Document/s'].forEach((h) => ih.append(supEl('th', '', h)));
    const tdSt = supEl('td'); tdSt.append(supBadge(bd(s.status, DEC_CLS[s.status === 'Preferred' ? 'Preferred Supplier' : s.status])));
    iv.append(supEl('td', '', s.address || '-'), supEl('td', '', s.contactPerson || '-'), supEl('td', '', s.contactNo || '-'), supEl('td', '', s.email || '-'), tdSt, supEl('td', '', s.score == null ? '-' : s.score.toFixed(1) + '%'), supFilesCell(s, '2303'), supFilesCell(s, 'extra'));
    const ithead = document.createElement('thead'), itbody = document.createElement('tbody'); ithead.append(ih); itbody.append(iv); inner.append(ithead, itbody);
    dt.append(inner); dr.append(dt); tb.append(dr);
  });
  box.append(card);
  if (!L.length) box.append(supEl('p', 'card muted', all.length ? 'No suppliers match the selected filters.' : 'No data yet.'));
  return box;
}
/* ---------- the supplier form: in the Supplier Master tab, or in a large pop-up window (Request for Check > Vendor / Payee information > Add supplier) ---------- */
const SUP_FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx', SUP_FILE_MAX = 10 * 1024 * 1024; // the server checks the same limits
const supFileUrl = (id) => 'api/supplier_files.php?action=download&id=' + encodeURIComponent(id);
const supSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
function supFileLink(a) { const l = supEl('a', 'supfile', a.name); l.href = supFileUrl(a.id); l.target = '_blank'; l.rel = 'noopener'; l.title = a.name + ' (' + supSize(a.size) + ')'; return l; }
function supFilesCell(s, kind) { // the files of one kind, as links, in the details of the Supplier Master table
  const td = supEl('td', 'supfiles'), L = (s.attachments || []).filter((a) => a.kind === kind);
  if (!L.length) td.textContent = '-'; else L.forEach((a) => td.append(supFileLink(a)));
  return td;
}
function supplierForm(id, opts) {
  opts = opts || {};
  const s = (id && db.suppliers.find((x) => x.id === id)) || { name: opts.name || '', category: '', contactPerson: '', contactNo: '', email: '', tin: '', address: '', department: '', attachments: [] };
  const depts = db.departments.map((d) => ({ v: d.name }));
  ui.supForm = { id: id || '', modal: !!opts.modal, onSaved: opts.onSaved || null, remove: {} };
  const f = tpl('tpl-sup-form', { id: id || '', heading: id ? 'Edit supplier' : 'Add supplier', depts, name: s.name, category: s.category, contactPerson: s.contactPerson, contactNo: s.contactNo, email: s.email, tin: s.tin || '', address: s.address || '', canPickDept: me.role === 'admin', myDeptNote: me.department ? 'This supplier is added to your department: ' + me.department + '. Only people of your department see it in the evaluation form.' : 'Your account has no department yet. Ask your administrator to set it before you add suppliers.' });
  const old = $id('sup-modal'); if (old) old.remove();
  if (opts.modal) {
    const ov = supEl('div', 'popup-overlay sup-overlay'), box = supEl('div', 'sup-modal'); ov.id = 'sup-modal'; box.append(f); ov.append(box); document.body.appendChild(ov);
  } else slot(document, 'sform', f);
  if ($id('s-department')) $id('s-department').value = s.department || '';
  // the files that are already saved: each has a Remove button (the removal happens when Save is clicked)
  (s.attachments || []).forEach((a) => {
    const row = supEl('div', 'supatt-row'), rm = supEl('button', 'btn ghost danger sm', 'Remove'); rm.type = 'button';
    row.append(supFileLink(a), supEl('span', 'small muted', supSize(a.size)), rm);
    rm.onclick = () => { const on = !ui.supForm.remove[a.id]; ui.supForm.remove[a.id] = on; row.classList.toggle('removed', on); rm.textContent = on ? 'Undo' : 'Remove'; };
    $id(a.kind === '2303' ? 's-att2303-cur' : 's-extra-cur').append(row);
  });
  if ((s.attachments || []).some((a) => a.kind === '2303')) $id('s-att2303-hint').textContent = 'A file is already saved. Choosing a new file replaces it.';
  supAddExtra();
  $id('s-name').focus();
}
function supAddExtra() { // one more upload box for Extra Document/s
  const row = supEl('div', 'supatt-row'), inp = document.createElement('input'), x = supEl('button', 'btn ghost danger sm', '✕');
  inp.type = 'file'; inp.accept = SUP_FILE_ACCEPT; x.type = 'button'; x.setAttribute('aria-label', 'Remove this upload box'); x.onclick = () => row.remove();
  row.append(inp, x); $id('s-extra-new').append(row);
}
function closeSupplierForm() {
  const m = $id('sup-modal'); if (m) m.remove();
  const sl = document.querySelector('[data-slot="sform"]'); if (sl) sl.replaceChildren();
  ui.supForm = null;
}
async function supUpload(supplierId, kind, file) { // one file goes to the server at a time
  const fd = new FormData(); fd.append('supplierId', supplierId); fd.append('kind', kind); fd.append('file', file);
  let res, json;
  try { res = await fetch('api/supplier_files.php?action=upload', { method: 'POST', body: fd }); }
  catch (e) { throw new Error('Cannot reach the server while uploading "' + file.name + '".'); }
  try { json = await res.json(); }
  catch (e) { throw new Error('The file "' + file.name + '" could not be uploaded. It may be bigger than the server allows (see upload_max_filesize in php.ini).'); }
  if (!res.ok) throw new Error(json.error || 'The file "' + file.name + '" could not be uploaded.');
  return json;
}
function deleteSupplier(id) {
  const s = db.suppliers.find((x) => x.id === id); if (!s) return;
  const n = (db.evaluations || []).filter((e) => e.supplierId === id).length;
  if (!confirm('Remove the supplier "' + s.name + '"?' + (n ? '\n\nIts ' + n + ' evaluation(s) will be permanently deleted too.' : '') + '\n\nAny re-evaluation requests for this supplier are deleted as well. This cannot be undone.')) return;
  ui.supDetail = null;
  call('admin', 'delete_supplier', { id });
}
async function saveSupplier(e, id) {
  e.preventDefault(); const v = { id }; ['name', 'category', 'contactPerson', 'contactNo', 'email', 'department', 'tin', 'address'].forEach((k) => { const el = $id('s-' + k); v[k] = el ? el.value.trim() : ''; });
  if (!v.name) return say('serr', 'red', 'Enter the supplier name.');
  const files = [], one = $id('s-att2303').files[0];
  if (one) files.push({ kind: '2303', file: one });
  document.querySelectorAll('#s-extra-new input[type="file"]').forEach((i) => { if (i.files[0]) files.push({ kind: 'extra', file: i.files[0] }); });
  const big = files.find((x) => x.file.size > SUP_FILE_MAX);
  if (big) return say('serr', 'red', 'The file "' + big.file.name + '" is too big. Each file can be 10 MB at most.');
  const btn = e.target.querySelector('button:not([type="button"])'); if (btn) { btn.disabled = true; btn.textContent = files.length ? 'Saving and uploading...' : 'Saving...'; }
  const form = ui.supForm || { remove: {} }, problems = [];
  let r;
  try { r = await api('admin', 'save_supplier', v); }
  catch (err) {
    if (err.status === 401) { me = null; db = null; render(); return; }
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    return say('serr', 'red', err.message);
  }
  const supId = id || r.id;
  for (const rid of Object.keys(form.remove).filter((k) => form.remove[k])) { try { await api('supplier_files', 'delete', { id: rid }); } catch (err) { problems.push(err.message); } }
  for (const x of files) { try { await supUpload(supId, x.kind, x.file); } catch (err) { problems.push(err.message); } }
  const cb = form.onSaved, wasModal = form.modal;
  await refresh(); closeSupplierForm();
  const sup = (db.suppliers || []).find((x) => x.id === String(supId));
  if (cb && sup) cb(sup);
  render();
  if (problems.length) popup('Supplier saved, but not every file was uploaded', '"' + v.name + '" was saved.\n\n' + problems.join('\n') + '\n\nClick Edit on the supplier to upload the missing file again.', 'error');
  else if (wasModal) popup('Supplier added', '"' + v.name + '" was added to the Supplier Master and is now selected in the form.');
}
/* The criteria are edited as a draft (ui.crit). What the admin typed is read back from the page before every redraw. */
const critSum = (list) => list.reduce((t, c) => t + (Number(c.weight) || 0), 0);
const critTotalText = (list) => { const t = critSum(list); return t === 100 ? 'Total weight: 100% ✓' : t > 100 ? 'Total weight: ' + t + '% - over by ' + (t - 100) + '%. The total cannot go over 100%.' : 'Total weight: ' + t + '% - ' + (100 - t) + '% left to reach 100%.'; };
const critMax = (list, i) => Math.max(0, 100 - list.reduce((t, c, n) => t + (n === i ? 0 : Number(c.weight) || 0), 0)); // the most this criterion can take
function supCriteria() {
  if (!ui.crit) ui.crit = db.criteria.map((c) => ({ id: c.id, name: c.name, purpose: c.purpose, weight: c.weight }));
  const t = critSum(ui.crit);
  return tpl('tpl-criteria-form', { rows: ui.crit.map((c, i) => ({ i, no: (i + 1) + '.', id: c.id, name: c.name, purpose: c.purpose, weight: c.weight, max: critMax(ui.crit, i) })), totalText: critTotalText(ui.crit), totalCls: t === 100 ? 'ok' : t > 100 ? 'bad' : '', addOff: t >= 100, saveOff: t !== 100 });
}
function collectCrit() {
  if (!$id('criteriaform')) return;
  ui.crit = [...document.querySelectorAll('#criteriaform .cbox')].map((b) => { const g = (k) => b.querySelector('[data-f="' + k + '"]').value; return { id: b.dataset.id || '', name: g('name'), purpose: g('purpose'), weight: g('weight') }; });
}
// runs on every keystroke in a weight box: the total can never go over 100%, so a weight that is too big is cut down to what is left
function critTotal(input) {
  collectCrit();
  const boxes = [...document.querySelectorAll('#criteriaform .cbox')];
  let cut = false;
  if (input) { const i = boxes.indexOf(input.closest('.cbox')), m = critMax(ui.crit, i); if (Number(input.value) > m) { input.value = m || ''; ui.crit[i].weight = m || ''; cut = true; } }
  const t = critSum(ui.crit), el = $id('cm-total');
  el.textContent = (cut ? 'The total cannot go over 100%, so the weight was lowered to what is left. ' : '') + critTotalText(ui.crit);
  el.className = t === 100 ? 'ok' : t > 100 ? 'bad' : '';
  $id('cm-add').disabled = t >= 100; $id('cm-save').disabled = t !== 100;
  boxes.forEach((b, i) => { b.querySelector('[data-f="weight"]').max = critMax(ui.crit, i); });
}
function addCriterion() {
  collectCrit();
  if (critSum(ui.crit) >= 100) return say('cmerr', 'red', 'The total is already 100%. Lower the weight of another criterion first, then add the new one.');
  ui.crit.push({ id: '', name: '', purpose: '', weight: '' }); render();
}
function delCriterion(i) { if (confirm('Remove this criterion? Evaluations already submitted keep their saved ratings.')) { collectCrit(); ui.crit.splice(Number(i), 1); render(); } }
async function saveCriteria(e) {
  e.preventDefault(); collectCrit();
  if (critSum(ui.crit) !== 100) return say('cmerr', 'red', 'The weights must add up to exactly 100%. They add up to ' + critSum(ui.crit) + '% now.');
  const list = ui.crit.map((c) => ({ id: c.id, name: c.name.trim(), purpose: c.purpose.trim(), weight: c.weight }));
  ui.crit = null; // after a successful save the page is drawn again from the saved data
  const r = await call('admin', 'save_criteria', { criteria: list }, 'cmerr');
  if (r) say('cmerr', 'green', 'Criteria saved.');
  else ui.crit = list.map((c) => ({ ...c })); // keep what was typed so it can be corrected
}

/* ----- support requests sent by employees ----- */
function adminSupport() {
  const f = ui.sfilter || 'All', list = db.requests.filter((r) => f === 'All' || r.status === f);
  return tpl('tpl-admin-support', {
    tabs: ['All', 'Open', 'Resolved'].map((t) => ({ key: t, label: t + (t === 'All' ? '' : ' (' + db.requests.filter((r) => r.status === t).length + ')'), cls: f === t ? 'on' : '' })),
    empty: !list.length, emptyText: 'No support requests here.',
    requests: list.map((r) => ({ id: r.id, subject: r.subject, message: r.message, from: r.name + ' · ' + r.email + ' · ' + new Date(r.createdAt).toLocaleString(),
      statusLabel: r.status === 'Resolved' ? '✓ Resolved' : '● Open', statusCls: r.status === 'Resolved' ? 'green' : 'blue',
      nextStatus: r.status === 'Resolved' ? 'Open' : 'Resolved', toggleLabel: r.status === 'Resolved' ? 'Reopen' : 'Mark as resolved' }))
  });
}
function supFilter(t) { ui.sfilter = t; render(); }
function setRequestStatus(id, status) { return call('admin', 'set_request_status', { id, status }); }
function deleteRequest(id) { if (confirm('Delete this support request?')) return call('admin', 'delete_request', { id }); }

/* ----- departments (the list used by the employee form, the supplier form and course assignment) ----- */
function adminDepartments() {
  const f = tpl('tpl-admin-departments');
  slot(f, 'dlist', tableFrag('Department list', ['Department', 'Employees', 'Suppliers', '', ''],
    db.departments.map((d) => [{ v: d.name }, { v: d.employees }, { v: d.suppliers }, { btn: 'Rename', act: 'deptForm', id: d.id }, { btn: 'Delete', act: 'deleteDepartment', id: d.id }]),
    db.departments.length ? 'Deleting a department removes it from its employees (they keep their accounts). Suppliers in it become available to all departments.' : 'There are no departments yet. Click Add department.'));
  return f;
}
function deptForm(id) {
  const d = db.departments.find((x) => x.id === id) || { name: '' };
  slot(document, 'dform', tpl('tpl-dept-form', { id: id || '', name: d.name }));
  $id('dept-name').focus();
}
const closeDeptForm = () => document.querySelector('[data-slot="dform"]').replaceChildren();
function saveDepartment(e, id) {
  e.preventDefault(); const name = $id('dept-name').value.trim();
  if (!name) return say('dept-err', 'red', 'Enter the department name.');
  call('admin', 'save_department', { id, name }, 'dept-err');
}
function deleteDepartment(id) {
  const d = db.departments.find((x) => x.id === id); if (!d) return;
  let msg = 'Delete the department "' + d.name + '"?';
  if (d.employees) msg += '\n\nWarning: ' + d.employees + ' employee(s) in this department will be removed from it. They will have no department until you assign a new one.';
  if (d.suppliers) msg += '\n\n' + d.suppliers + ' supplier(s) assigned to this department will become available to all departments.';
  if (confirm(msg)) call('admin', 'delete_department', { id });
}
