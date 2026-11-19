/* Task Management tab: every role (admin, immediate superior, employee). Nothing is stored in the browser except the Kanban / List choice.
   All tasks are read and saved by api/task.php (MySQL); the server decides who may see and change what, so the buttons here are only a convenience.
   Two subtabs: Dashboard (#/task) and Kanban & List (#/task/board). The admin has the same pages under #/admin/task.
   Kanban / List have three buttons (Personal, Daily, Weekly) and four flows: To Do, In Progress, Completed, Missing (Missing is worked out by the server from the deadlines).
   Each row of db.task.rows is ONE employee's assignment of a task, with that employee's own status and own progress on the steps (subtasks).
   Screens: templates in index.html (tpl-task-*); cards, rows and steps are built here with textContent only.
   The page asks the server for changes every 20 seconds, so a change made by someone else shows without reloading. */
const TK_STATUS = ['To Do', 'In Progress', 'Completed', 'Missing'];
const TK_ST_CLS = { 'To Do': 'tk-st-todo', 'In Progress': 'tk-st-prog', Completed: 'tk-st-done', Missing: 'tk-st-miss' };
const TK_DOT = { 'To Do': '', 'In Progress': 'prog', Completed: 'done', Missing: 'miss' };
const TK_TYPES = [['personal', 'Personal'], ['daily', 'Daily'], ['weekly', 'Weekly']];
const TK_PRI_W = { High: 3, Medium: 2, Low: 1 };
const TK_PAGE = 5; // cards shown in each flow before "Show more"
const TK_DASH = 3; // latest tasks shown in each flow on the dashboard
const tkPath = (sub) => (me.role === 'admin' ? '/admin/task' : '/task') + (sub ? '/' + sub : '');
const tkTab = () => { const p = routeParts(); return p[p[0] === 'admin' ? 2 : 1] === 'board' ? 'board' : 'dash'; };
const tkBadge = () => (db && db.task && db.task.badge ? ' (' + db.task.badge + ')' : ''); // my missing tasks, shown in the menu
function tkSavedView() { try { return localStorage.getItem('leads-task-view') === 'list' ? 'list' : 'kanban'; } catch (e) { return 'kanban'; } }
const tkFirstType = () => { if (!db || !db.task) return 'personal'; const n = (t) => db.task.rows.filter((r) => r.frequency === t && (t !== 'personal' || r.assigneeId === me.id)).length; return TK_TYPES.map((x) => x[0]).find((t) => n(t) > 0) || 'personal'; };
const tkState = () => ui.task || (ui.task = { view: tkSavedView(), type: tkFirstType(), q: '', priority: '', category: '', user: '', sort: 'newest', limit: {}, focus: '' });
const tkRow = (id) => (db && db.task ? db.task.rows.find((r) => r.id === id) : null);
const tkMine = (r) => r.assigneeId === me.id;
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null && text !== '') e.textContent = text; return e; };
const tkB = (text, cls) => h('span', 'badge ' + (cls || 'gray'), text);
const tkDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const tkStamp = (d) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const tkTime = (t) => { if (!t) return ''; const p = t.split(':').map(Number); return ((p[0] % 12) || 12) + ':' + String(p[1]).padStart(2, '0') + ' ' + (p[0] >= 12 ? 'PM' : 'AM'); };
const tkDateShort = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', db && db.task && d.slice(0, 4) === db.task.today.slice(0, 4) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const tkDueShort = (d, t) => (d ? tkDateShort(d) + (t ? ', ' + tkTime(t) : '') : 'No due date');
const tkDue = (d, t) => (d ? tkDate(d) + (t ? ', ' + tkTime(t) : '') : 'No due date');
const tkDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const tkSoon = (r) => !!r.dueDate && r.status !== 'Completed' && r.status !== 'Missing' && tkDays(db.task.today, r.dueDate) <= 2;
const tkTypeName = (t) => (TK_TYPES.find((x) => x[0] === t) || ['', 'Task'])[1];

/* ---------- navigation ---------- */
function taskHome() { ui.task = null; if (location.hash === '#' + tkPath()) render(); else go(tkPath()); return false; } // the menu link opens the Dashboard with no filters
function taskTab(tab) { const p = tkPath(tab === 'board' ? 'board' : ''); if (location.hash === '#' + p) render(); else go(p); }
function taskFocus(status) { // a dashboard card or "View all": open the board on the type that has the most tasks of that status, with that flow fully open
  const z = tkState(), n = { personal: 0, daily: 0, weekly: 0 };
  db.task.rows.forEach((r) => { if (tkMine(r) && r.status === status) n[r.frequency]++; });
  z.type = TK_TYPES.map((x) => x[0]).sort((a, b) => n[b] - n[a])[0]; z.user = ''; z.q = ''; z.priority = ''; z.category = ''; z.focus = status; z.limit[status] = 1e9;
  taskTab('board');
}
function taskLeave() { // called by render() when another page is open
  if (ui.taskTimer) { clearInterval(ui.taskTimer); ui.taskTimer = null; }
  if (ui.task) ui.task = null;
  ui.taskSub = null; ui.taskForm = null;
  const m = $id('tk-modal'); if (m) m.remove();
  const t = $id('tk-toast'); if (t) t.remove();
}
function taskStartPoll() { if (!ui.taskTimer) ui.taskTimer = setInterval(taskPoll, 20000); }
async function taskPoll() {
  if (document.hidden || $id('tk-modal') || ui.taskDrag || !db || !db.task) return;
  if (!/^#\/(admin\/)?task/.test(location.hash)) { taskLeave(); return; }
  try {
    const r = await api('task', 'list');
    if (r.task && r.task.rev !== db.task.rev && !$id('tk-modal') && !ui.taskDrag) { db.task = r.task; taskFillAll(); }
  } catch (e) { if (e.status === 401) { me = null; db = null; render(); } }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && ui.taskTimer) taskPoll(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $id('tk-modal') && !$id('confirmdlg') && !$id('popup')) taskClose(); });

/* ---------- messages after an action ---------- */
let tkToastTimer = null;
function taskToast(text, bad) {
  let t = $id('tk-toast');
  if (!t) { t = document.createElement('div'); t.id = 'tk-toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
  t.textContent = text; t.className = 'tk-toast' + (bad ? ' err' : '');
  void t.offsetWidth; t.classList.add('show');
  clearTimeout(tkToastTimer); tkToastTimer = setTimeout(() => t.classList.remove('show'), bad ? 5000 : 3000);
}
async function taskCall(action, data) { // one request to api/task.php; the answer holds the fresh task list of this person
  try { const r = await api('task', action, data); if (r.task) db.task = r.task; return r; }
  catch (e) { if (e.status === 401) { me = null; db = null; render(); } throw e; }
}

/* ---------- the page ---------- */
function taskPage() {
  if (!db.task) return message('Task Management', db.taskSetup ? 'Task Management could not be set up. In phpMyAdmin, import sql/migration_tasks.sql into the leads_training database, then reload this page.' : 'This page is not available.', me.role === 'admin' ? '/admin' : '/home', 'Back to Home');
  const T = db.task, tab = tkTab();
  const intro = me.role === 'admin' ? 'Create and assign daily and weekly tasks, and monitor the status, steps and deadlines of every employee.'
    : T.canAssign ? 'Assign daily and weekly tasks to your team and follow their steps. You can also keep your own personal tasks.'
      : 'Your tasks: the daily and weekly tasks assigned to you, and your own personal tasks.';
  const f = tpl('tpl-task-page', { intro });
  f.querySelector('#tk-t-dash').classList.toggle('on', tab === 'dash'); f.querySelector('#tk-t-board').classList.toggle('on', tab === 'board');
  const body = f.querySelector('#tk-body');
  if (tab === 'dash') body.append(tpl('tpl-task-dash'));
  else {
    body.append(tpl('tpl-task-board', { monitor: T.monitor }));
    const board = body.querySelector('#tk-board');
    board.addEventListener('click', taskBoardClick);
    board.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.tk-card, .tk-tr')) { e.preventDefault(); taskDetail(e.target.dataset.id); } });
    board.addEventListener('dragstart', (e) => {
      const c = e.target.closest && e.target.closest('.tk-card[draggable="true"]'); if (!c) return;
      ui.taskDrag = c.dataset.id; e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging');
    });
    board.addEventListener('dragend', () => { ui.taskDrag = null; board.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging')); board.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); });
    board.addEventListener('dragover', (e) => { const z = e.target.closest && e.target.closest('.tk-zone'); if (z && ui.taskDrag && z.dataset.status !== 'Missing') { e.preventDefault(); z.classList.add('over'); } });
    board.addEventListener('dragleave', (e) => { const z = e.target.closest && e.target.closest('.tk-zone'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
    board.addEventListener('drop', (e) => {
      const z = e.target.closest && e.target.closest('.tk-zone'); if (!z) return;
      e.preventDefault(); z.classList.remove('over');
      const id = ui.taskDrag || e.dataTransfer.getData('text/plain'); ui.taskDrag = null;
      if (id) taskMove(id, z.dataset.status);
    });
  }
  taskFillAll(f);
  taskStartPoll();
  return f;
}
function taskBoardClick(e) {
  const b = e.target.closest('[data-act]');
  if (b) { e.stopPropagation(); taskAct(b.dataset.act, b.dataset.id, b.dataset.st); return; }
  const c = e.target.closest('.tk-card, .tk-tr'); if (c) taskDetail(c.dataset.id);
}
function taskAct(act, id, st) {
  if (act === 'more') { const z = tkState(); z.limit[st] = (z.limit[st] || TK_PAGE) + TK_PAGE; return taskFillAll(); }
  if (act === 'all') { tkState().limit[st] = 1e9; return taskFillAll(); }
  if (act === 'less') { delete tkState().limit[st]; return taskFillAll(); }
  const r = tkRow(id); if (!r) return;
  if (act === 'view') return taskDetail(id);
  if (act === 'edit') return taskEdit(id);
  if (act === 'delete') return taskDelete(id);
  if (act === 'toggle') return taskMove(id, r.status === 'Completed' ? 'To Do' : 'Completed');
  if (act === 'advance') return taskMove(id, tkNext(r));
}
const tkNext = (r) => (r.status === 'To Do' ? 'In Progress' : r.status === 'In Progress' || r.status === 'Missing' ? 'Completed' : 'To Do');
const tkAdvTitle = (r) => (r.status === 'To Do' ? 'Move to In Progress' : r.status === 'Completed' ? 'Reopen task' : 'Mark as Completed');
const tkAdvLabel = (r) => (r.status === 'To Do' ? 'Start' : r.status === 'Completed' ? 'Reopen' : 'Complete');

/* ---------- filters, search, sort (Kanban and List) ---------- */
function taskSet(k, v) { tkState()[k] = v; taskFillAll(); }
function taskType(t) { const z = tkState(); z.type = t; z.user = ''; z.limit = {}; taskFillAll(); }
function taskReset() {
  const z = tkState(); z.q = z.priority = z.category = z.user = ''; z.sort = 'newest'; z.limit = {};
  const q = $id('tk-q'); if (q) q.value = '';
  taskFillAll();
}
function taskView(v) { tkState().view = v; try { localStorage.setItem('leads-task-view', v); } catch (e) { /* ignore */ } taskFillAll(); }
const tkTypeRows = (t) => db.task.rows.filter((r) => r.frequency === t && (t !== 'personal' || tkMine(r))); // personal tasks of other people are never shown here
const tkHasFilter = () => { const z = tkState(); return !!(z.q || z.priority || z.category || z.user); };
function tkVisible() {
  const z = tkState(), q = z.q.trim().toLowerCase();
  const list = tkTypeRows(z.type).filter((r) => (!z.user || r.assigneeId === z.user) && (!q || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
    && (!z.priority || r.priority === z.priority) && (!z.category || r.category === z.category));
  const due = (r) => (r.dueDate ? r.dueDate + ' ' + (r.dueTime || '23:59') : '9999');
  list.sort((a, b) => {
    if (z.sort === 'due') { const d = due(a).localeCompare(due(b)); if (d) return d; }
    else if (z.sort === 'priority') { const d = TK_PRI_W[b.priority] - TK_PRI_W[a.priority]; if (d) return d; }
    return Number(b.taskId) - Number(a.taskId) || Number(b.id) - Number(a.id);
  });
  return list;
}

/* ---------- drawing ---------- */
function taskFillAll(root) {
  root = root || document;
  if (root.querySelector('#tk-board')) { taskFillTypes(root); taskFillSelects(root); taskFillBoard(root); }
  else if (root.querySelector('#tk-dash')) taskFillDash(root);
}
function tkOptions(sel, first, items, value) {
  sel.replaceChildren(...[['', first]].concat(items).map((x) => { const o = document.createElement('option'); o.value = x[0]; o.textContent = x[1]; return o; }));
  sel.value = value;
}
function taskFillTypes(root) {
  const z = tkState(), T = db.task, box = root.querySelector('#tk-types');
  box.replaceChildren(...TK_TYPES.map((t) => {
    const rows = tkTypeRows(t[0]), miss = rows.filter((r) => r.status === 'Missing').length, b = h('button', 'tk-type' + (z.type === t[0] ? ' on' : ''));
    b.type = 'button'; b.onclick = () => taskType(t[0]); b.setAttribute('aria-pressed', z.type === t[0] ? 'true' : 'false');
    b.append(h('span', 'tk-type-name', t[1]), h('span', 'tk-type-n', rows.length));
    if (miss) b.append(h('span', 'tk-type-miss', miss + ' missing'));
    return b;
  }));
  const own = z.type === 'personal';
  root.querySelector('#tk-typehelp').textContent = own ? 'Your own tasks. Only you can see them.'
    : T.canAssign ? 'Daily and weekly tasks you assigned, and the ones assigned to you. Use + New Task to assign one to your team.' : 'Daily and weekly tasks assigned to you by your administrator or immediate superior.';
}
function taskFillSelects(root) {
  const z = tkState(), T = db.task, rows = tkTypeRows(z.type);
  const q = root.querySelector('#tk-q'); if (q && q !== document.activeElement) q.value = z.q;
  root.querySelector('#tk-priority').value = z.priority; root.querySelector('#tk-sort').value = z.sort;
  const cats = [...new Set(T.categories.concat(rows.map((r) => r.category)))].sort((a, b) => a.localeCompare(b));
  if (z.category && !cats.includes(z.category)) z.category = '';
  tkOptions(root.querySelector('#tk-category'), 'All categories', cats.map((c) => [c, c]), z.category);
  const us = root.querySelector('#tk-user');
  if (us) {
    us.classList.toggle('hidden', z.type === 'personal');
    const m = new Map(); rows.forEach((r) => m.set(r.assigneeId, r.assignee));
    if (z.user && !m.has(z.user)) z.user = '';
    tkOptions(us, me.role === 'admin' ? 'All employees' : 'Me and my team', [...m].sort((a, b) => a[1].localeCompare(b[1])).map((x) => [x[0], x[1] + (x[0] === me.id ? ' (me)' : '')]), z.user);
  }
}
function tkWho(r) {
  if (r.personal) return r.assigneeId === me.id ? 'Personal task' : 'Personal task of ' + r.assignee;
  return r.assigneeId === me.id ? 'Assigned by ' + r.creator : 'Assigned to ' + r.assignee + (r.creatorId === me.id ? '' : ' by ' + r.creator);
}
function tkSubLine(r) { // "2 of 5 steps" and the next step
  if (!r.subs) return null;
  const s = r.subs, box = h('div', 'tk-sub');
  const pb = h('div', 'pb tk-minipb'), fill = h('div', 'pb-fill' + (r.status === 'Missing' ? ' miss' : '')); fill.style.width = r.pct + '%'; pb.append(fill);
  box.append(h('div', 'small tk-sub-t', s.done + ' of ' + s.total + ' step' + (s.total === 1 ? '' : 's') + ' · ' + r.pct + '%'), pb);
  if (s.next) box.append(h('div', 'small muted tk-next', 'Next: ' + s.next + (s.nextDate ? ' · ' + tkDate(s.nextDate) : '')));
  return box;
}
function tkFlags(r) { // the small badges of a task
  const o = [];
  if (r.status === 'Missing') o.push(tkB(r.pastDue ? 'Past deadline' : 'Step missed', 'red'));
  if (tkSoon(r)) o.push(tkB('Due soon', 'orange'));
  if (r.lateDone) o.push(tkB('Completed late', 'orange'));
  if (r.subs && r.subs.pending && r.can.edit) o.push(tkB(r.subs.pending + ' reason' + (r.subs.pending === 1 ? '' : 's') + ' to review', 'orange'));
  else if (r.subs && r.subs.open) o.push(tkB('Step opened', 'gray'));
  return o;
}
function tkCard(r) {
  const done = r.status === 'Completed', miss = r.status === 'Missing';
  const c = h('article', 'tk-card pri-' + r.priority.toLowerCase() + (done ? ' done' : '') + (r.status === 'In Progress' ? ' prog' : '') + (miss ? ' late' : ''));
  c.tabIndex = 0; c.dataset.id = r.id; if (r.can.status) c.draggable = true;
  const top = h('div', 'tk-ctop');
  if (r.can.status) { const cb = h('input', 'tk-check'); cb.type = 'checkbox'; cb.checked = done; cb.dataset.act = 'toggle'; cb.dataset.id = r.id; cb.setAttribute('aria-label', done ? 'Reopen task' : 'Mark as completed'); top.append(cb); }
  top.append(h('div', 'tk-title', r.title)); c.append(top);
  if (r.description) c.append(h('p', 'tk-desc small muted', r.description));
  c.append(kidsOf(h('div', 'tk-badges'), [tkB(r.priority, 'tk-pri-' + r.priority.toLowerCase()), tkB(r.category, 'gray')].concat(tkFlags(r))));
  const sub = tkSubLine(r); if (sub) c.append(sub);
  if (!(r.personal && tkMine(r))) c.append(h('div', 'tk-who small muted', tkWho(r)));
  const foot = h('div', 'tk-foot'), acts = h('span', 'tk-acts');
  foot.append(h('span', 'small tk-due' + (miss ? ' tk-late' : ''), tkDueShort(r.dueDate, r.dueTime)));
  const ib = (act, label, text, cls) => { const b = h('button', 'tk-ib' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.dataset.act = act; b.dataset.id = r.id; b.title = label; b.setAttribute('aria-label', label); return b; };
  if (r.can.status) acts.append(ib('advance', tkAdvTitle(r), done ? '↺' : '›'));
  if (r.can.edit) acts.append(ib('edit', 'Edit task', '✎'));
  if (r.can.delete) acts.append(ib('delete', 'Delete task', '🗑', 'tk-del'));
  foot.append(acts); c.append(foot);
  return c;
}
function kidsOf(e, list) { list.forEach((x) => { if (x) e.append(x); }); return e; }
function tkMoreBar(st, total, shown) { // "Show more" / "Show all" / "Show less" under a flow
  const lim = tkState().limit[st] || TK_PAGE, bar = h('div', 'tk-morebar');
  const btn = (act, text) => { const b = h('button', 'linkbtn tk-more', text); b.type = 'button'; b.dataset.act = act; b.dataset.st = st; return b; };
  const left = total - shown;
  if (left > 0) { bar.append(btn('more', 'Show ' + Math.min(TK_PAGE, left) + ' more')); if (left > TK_PAGE) bar.append(btn('all', 'Show all (' + total + ')')); }
  else if (lim > TK_PAGE && total > TK_PAGE) bar.append(btn('less', 'Show less'));
  return bar.children.length ? bar : null;
}
function tkEmptyText(st) { return tkHasFilter() ? 'No matching tasks' : st === 'Missing' ? 'Nothing is missing. Good job!' : st === 'Completed' ? 'Nothing completed yet' : st === 'To Do' || st === 'In Progress' ? 'Nothing here' : ''; }
function tkColumn(st, rows) {
  const lim = tkState().limit[st] || TK_PAGE, shown = rows.slice(0, lim);
  const col = h('section', 'tk-col' + (st === 'Missing' ? ' miss' + (rows.length ? ' has' : '') : '')), head = h('div', 'tk-colhead'), zone = h('div', 'tk-zone'), nm = h('span');
  zone.dataset.status = st; nm.append(h('span', 'tk-dot ' + TK_DOT[st]), st); head.append(nm, h('span', 'tk-count', rows.length));
  if (shown.length) zone.append(...shown.map(tkCard)); else zone.append(h('div', 'tk-empty', st === 'Missing' ? tkEmptyText(st) : tkHasFilter() ? 'No matching tasks' : 'Drop tasks here'));
  col.append(head, zone); const more = tkMoreBar(st, rows.length, shown.length); if (more) col.append(more);
  return col;
}
function tkRowEl(r) {
  const miss = r.status === 'Missing', tr = h('tr', 'tk-tr' + (r.status === 'Completed' ? ' done' : '') + (miss ? ' late' : ''));
  tr.tabIndex = 0; tr.dataset.id = r.id;
  const td = (...c) => { const x = h('td'); c.forEach((y) => { if (y) x.append(y); }); return x; };
  const t = h('div'); t.append(h('div', 'tk-title', r.title)); if (!(r.personal && tkMine(r))) t.append(h('div', 'small muted', tkWho(r)));
  const sub = tkSubLine(r), flags = kidsOf(h('div', 'tk-badges'), tkFlags(r));
  const acts = h('td', 'tk-rowacts');
  const bt = (act, text, cls) => { const b = h('button', 'btn ghost tk-sm' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.dataset.act = act; b.dataset.id = r.id; return b; };
  acts.append(bt('view', 'View')); if (r.can.status) acts.append(bt('advance', tkAdvLabel(r))); if (r.can.edit) acts.append(bt('edit', 'Edit')); if (r.can.delete) acts.append(bt('delete', 'Delete', 'danger'));
  tr.append(td(t, flags.children.length ? flags : null), ...(tkState().type === 'personal' ? [] : [td(h('span', '', r.assignee + (tkMine(r) ? ' (me)' : '')))]), td(tkB(r.priority, 'tk-pri-' + r.priority.toLowerCase())), td(tkB(r.category, 'gray')),
    td(h('span', miss ? 'tk-late' : '', tkDue(r.dueDate, r.dueTime))), td(sub || h('span', 'muted small', 'No steps')), td(tkB(r.status, TK_ST_CLS[r.status])), acts);
  return tr;
}
function tkListSection(st, rows) {
  const lim = tkState().limit[st] || TK_PAGE, shown = rows.slice(0, lim);
  const sec = h('section', 'tk-lsec' + (st === 'Missing' ? ' miss' + (rows.length ? ' has' : '') : '')), head = h('div', 'tk-colhead'), nm = h('span');
  nm.append(h('span', 'tk-dot ' + TK_DOT[st]), st); head.append(nm, h('span', 'tk-count', rows.length)); sec.append(head);
  if (!shown.length) { sec.append(h('div', 'tk-empty', tkHasFilter() ? 'No matching tasks' : tkEmptyText(st))); return sec; }
  const wrap = h('div', 'card tablewrap'), table = h('table', 'tk-table'), thead = h('thead'), tr = h('tr'), body = h('tbody');
  ['Task Title', ...(tkState().type === 'personal' ? [] : ['Assigned Employee']), 'Priority', 'Category', 'Due Date & Time', 'Steps', 'Status', 'Actions'].forEach((x) => tr.append(h('th', '', x)));
  thead.append(tr); body.append(...shown.map(tkRowEl)); table.append(thead, body); wrap.append(table); sec.append(wrap);
  const more = tkMoreBar(st, rows.length, shown.length); if (more) sec.append(more);
  return sec;
}
function taskFillBoard(root) {
  root = root || document;
  const z = tkState(), box = root.querySelector('#tk-board'), list = tkVisible();
  root.querySelector('#tk-v-kanban').classList.toggle('on', z.view === 'kanban'); root.querySelector('#tk-v-list').classList.toggle('on', z.view === 'list');
  const by = (st) => list.filter((r) => r.status === st);
  if (z.view === 'list') box.replaceChildren(...TK_STATUS.map((st) => tkListSection(st, by(st))));
  else { const wrap = h('div', 'tk-board'); TK_STATUS.forEach((st) => wrap.append(tkColumn(st, by(st)))); box.replaceChildren(wrap); }
  if (z.focus) { const f = z.focus; z.focus = ''; const el = box.querySelector(z.view === 'list' ? '.tk-lsec.miss' : '.tk-zone[data-status="' + f + '"]'); if (el && el.scrollIntoView && f === 'Missing') el.scrollIntoView({ block: 'center' }); }
}

/* ---------- the dashboard ---------- */
function tkMini(r) { // a compressed task for the dashboard
  const b = h('button', 'tk-mini' + (r.status === 'Missing' ? ' late' : '')); b.type = 'button'; b.onclick = () => taskDetail(r.id);
  b.append(h('div', 'tk-title', r.title));
  const line = h('div', 'tk-minirow small'); line.append(tkB(tkTypeName(r.frequency), 'gray'), h('span', r.status === 'Missing' ? 'tk-late' : 'muted', tkDueShort(r.dueDate, r.dueTime))); b.append(line);
  if (r.subs) { const pb = h('div', 'pb tk-minipb'), f = h('div', 'pb-fill' + (r.status === 'Missing' ? ' miss' : '')); f.style.width = r.pct + '%'; pb.append(f); b.append(pb, h('div', 'small muted', r.subs.done + ' of ' + r.subs.total + ' steps' + (r.subs.next && r.status !== 'Completed' ? ' · next: ' + r.subs.next : ''))); }
  return b;
}
function tkAttention(r) { return !tkMine(r) && !r.personal && ((r.subs && r.subs.pending > 0) || r.status === 'Missing'); }
function taskFillDash(root) {
  const T = db.task, mine = T.rows.filter(tkMine), n = (st) => mine.filter((r) => r.status === st).length;
  const cards = [['To Do', 's-todo'], ['In Progress', 's-prog'], ['Completed', 's-done'], ['Missing', 's-miss']];
  root.querySelector('#tk-stats').replaceChildren(...cards.map((c) => {
    const b = h('button', 'card stat tk-stat ' + c[1]), l = h('div', 'muted small', c[0]), v = h('div', 'big', n(c[0])); b.type = 'button'; b.onclick = () => taskFocus(c[0]); b.append(l, v); return b;
  }));
  const done = n('Completed'), pct = mine.length ? Math.round(done / mine.length * 100) : 0;
  root.querySelector('#tk-pfill').style.width = pct + '%'; root.querySelector('#tk-pbar').setAttribute('aria-valuenow', pct);
  root.querySelector('#tk-ptext').textContent = pct + '% (' + done + ' of ' + mine.length + ' task' + (mine.length === 1 ? '' : 's') + ')';
  root.querySelector('#tk-dgrid').replaceChildren(...cards.map((c) => {
    const st = c[0], rows = mine.filter((r) => r.status === st).sort((a, b) => (b.touched || '').localeCompare(a.touched || '') || Number(b.id) - Number(a.id));
    const sec = h('section', 'card tk-dcol' + (st === 'Missing' ? ' miss' + (rows.length ? ' has' : '') : '')), head = h('div', 'tk-colhead'), nm = h('span');
    nm.append(h('span', 'tk-dot ' + TK_DOT[st]), st); head.append(nm); sec.append(head);
    if (rows.length) sec.append(...rows.slice(0, TK_DASH).map(tkMini)); else sec.append(h('div', 'tk-empty', st === 'Missing' ? 'Nothing is missing. Good job!' : 'No tasks here'));
    if (rows.length > TK_DASH) { const b = h('button', 'linkbtn tk-more', 'View all ' + rows.length); b.type = 'button'; b.onclick = () => taskFocus(st); sec.append(h('div', 'tk-morebar', '')); sec.lastChild.append(b); }
    return sec;
  }));
  const extra = root.querySelector('#tk-dextra'), parts = [];
  if (T.help.length) { // steps that a superior opened to the department
    const p = h('section', 'card tk-panel'); p.append(h('h3', '', 'Steps opened for you'), h('p', 'small muted', 'A teammate could not finish these steps. Take one over to complete it. You can work on that step only.'));
    T.help.forEach((x) => {
      const row = h('div', 'tk-hrow'), info = h('div'), act = h('div', 'tk-hact');
      info.append(h('div', 'tk-title', 'Step ' + x.n + ': ' + x.sub), h('div', 'small muted', x.task + ' · for ' + x.assignee + ' · planned ' + tkDate(x.date) + (x.missing ? ' (missed)' : '')));
      if (x.mine) { const b = h('button', 'btn tk-sm', 'Open my step'); b.type = 'button'; b.onclick = () => taskSteps(x.assignmentId, x.id); act.append(b); }
      else { const b = h('button', 'btn tk-sm', 'Take over'); b.type = 'button'; b.onclick = () => taskClaim(x); act.append(b); }
      row.append(info, act); p.append(row);
    });
    parts.push(p);
  }
  if (T.monitor) {
    const team = T.rows.filter((r) => !tkMine(r) && !r.personal);
    if (team.length) {
      const p = h('section', 'card tk-panel'), strip = h('div', 'tk-strip');
      p.append(h('h3', '', 'Team overview'), h('p', 'small muted', 'Daily and weekly tasks of your team (' + team.length + ' assignment' + (team.length === 1 ? '' : 's') + ').'));
      cards.forEach((c) => { const x = h('div', 'tk-chip ' + c[1]); x.append(h('b', '', team.filter((r) => r.status === c[0]).length), h('span', 'small muted', c[0])); strip.append(x); });
      p.append(strip);
      const need = team.filter(tkAttention).sort((a, b) => ((b.subs && b.subs.pending) || 0) - ((a.subs && a.subs.pending) || 0)).slice(0, 6);
      if (need.length) {
        p.append(h('h4', '', 'Needs your attention'));
        need.forEach((r) => {
          const b = h('button', 'tk-hrow tk-hbtn'), info = h('div'); b.type = 'button'; b.onclick = () => taskDetail(r.id);
          info.append(h('div', 'tk-title', r.title), h('div', 'small muted', r.assignee + ' · due ' + tkDue(r.dueDate, r.dueTime)));
          const fl = kidsOf(h('div', 'tk-badges'), tkFlags(r)); b.append(info, fl); p.append(b);
        });
      }
      parts.push(p);
    }
  }
  extra.replaceChildren(...parts);
}
async function taskClaim(x) {
  try { await taskCall('sub_claim', { asid: x.id, claim: true }); taskFillAll(); taskToast('You took over the step. You can now work on it.'); }
  catch (e) { if (me) { taskToast(e.message, true); try { const r = await taskCall('list'); void r; taskFillAll(); } catch (z) { /* ignore */ } } }
}

/* ---------- changing a status (drag and drop, check box, arrow, buttons) ---------- */
async function taskMove(id, status) {
  const r = tkRow(id); if (!r || r.status === status) return;
  if (status === 'Missing') return taskToast('Missing is set automatically when a deadline or a projected date passes.', true);
  if (!r.can.status) return taskToast(r.subs ? 'The status of this task follows its steps. Open the task and update its steps.' : 'You cannot change the status of this task.', true);
  const prev = r.status; r.status = status; taskFillAll(); // shown at once, then confirmed (or undone) by the server
  try {
    await taskCall('status', { assignmentId: id, status });
    taskFillAll();
    taskToast(status === 'Completed' ? 'Task marked as completed.' : prev === 'Completed' ? 'Task reopened.' : 'Task moved to ' + status + '.');
  } catch (e) {
    if (!me) return;
    r.status = prev; taskFillAll(); taskToast(e.message, true);
  }
}

/* ---------- delete ---------- */
async function taskDelete(id) {
  const r = tkRow(id); if (!r) return;
  if (!r.can.delete) return taskToast('You can delete only the tasks you created or assigned.', true);
  const n = r.team ? r.team.total : 1;
  const p = confirmBox({ title: 'Delete this task?', file: r.title, text: n > 1 ? 'It will be removed for all ' + n + ' employees it is assigned to, with their steps and progress. This cannot be undone.' : 'This cannot be undone.', yes: 'Delete', no: 'Cancel' });
  const y = $id('confirm-yes'); if (y) y.className = 'btn ghost danger';
  if (!(await p)) return;
  try { await taskCall('delete', { taskId: r.taskId }); taskClose(); taskFillAll(); taskToast('Task deleted.'); }
  catch (e) { if (me) taskToast(e.message, true); }
}

/* ---------- details and steps (one pop-up: the task, and the steps of this employee's assignment) ---------- */
function taskClose() { const m = $id('tk-modal'); if (m) m.remove(); ui.taskSub = null; ui.taskForm = null; }
function taskDetail(id) {
  const r = tkRow(id); if (!r) return;
  taskClose();
  ui.taskSub = { aid: r.id, rowId: r.id, data: null, open: new Set(), team: null, err: '' };
  taskModalDraw(); tkLoadSteps();
  if (r.team && r.team.total > 1) tkLoadTeam(r);
}
function taskSteps(aid, openStep) { // the steps of an assignment that is not in my list (a step a superior opened to my department)
  taskClose();
  ui.taskSub = { aid, rowId: tkRow(aid) ? aid : null, data: null, open: new Set(openStep ? [openStep] : []), team: null, err: '' };
  taskModalDraw(); tkLoadSteps();
}
async function tkLoadSteps() {
  const S = ui.taskSub; if (!S) return;
  const r = S.rowId ? tkRow(S.rowId) : null;
  if (r && !r.subs) { S.data = { subs: [], task: {}, visible: true }; return taskModalDraw(); } // a task with no steps: nothing to load
  try {
    const x = await api('task', 'subs', { assignmentId: S.aid });
    if (ui.taskSub !== S) return;
    S.data = x.data;
    if (!S.open.size) { const f = x.data.subs.find((s) => s.rawStatus !== 'Completed'); if (f) S.open.add(f.id); }
    taskModalDraw();
  } catch (e) {
    if (e.status === 401) { me = null; db = null; render(); return; }
    if (ui.taskSub === S) { S.err = e.message; taskModalDraw(); }
  }
}
async function tkLoadTeam(r) {
  const S = ui.taskSub;
  try { const x = await api('task', 'detail', { taskId: r.taskId }); if (ui.taskSub === S && S) { S.team = x.detail.assignees; taskModalDraw(); } } catch (e) { /* the list is optional */ }
}
function tkFacts(r) { // status, priority, type and category are already the badges at the top of the pop-up, so they are not repeated here
  const f = [];
  if (!r.personal) f.push(['Assigned to', r.assignee + (tkMine(r) ? ' (me)' : '')], ['Assigned by', r.creator]);
  if (r.startDate) f.push(['Start date', tkDate(r.startDate)]);
  f.push(['Due date and time', r.dueDate ? tkDue(r.dueDate, r.dueTime) + (r.status === 'Missing' && r.pastDue ? ' (deadline passed)' : tkSoon(r) ? ' (due soon)' : '') : 'No due date']);
  if (r.completedAt) f.push(['Completed on', tkStamp(r.completedAt) + (r.lateDone ? ' (after the deadline)' : '')]);
  return f;
}
function taskModalDraw() {
  const S = ui.taskSub; if (!S) return;
  const old = $id('tk-modal'), keep = old ? old.scrollTop : 0; if (old) old.remove();
  document.body.appendChild(tpl('tpl-task-modal'));
  const r = S.rowId ? tkRow(S.rowId) : null, body = $id('tk-dbody'), d = S.data;
  $id('tk-dtitle').textContent = r ? r.title : d && d.task && d.task.title ? d.task.title : 'Task steps';
  if (r) {
    body.append(kidsOf(h('div', 'tk-badges'), [tkB(r.status, TK_ST_CLS[r.status]), tkB(r.priority, 'tk-pri-' + r.priority.toLowerCase()), tkB(tkTypeName(r.frequency), 'gray'), tkB(r.category, 'gray')].concat(tkFlags(r))));
    if (r.description) body.append(h('p', 'tk-dtext', r.description));
    const kv = h('dl', 'tk-kv'); tkFacts(r).forEach((x) => kv.append(h('dt', '', x[0]), h('dd', '', x[1]))); body.append(kv, h('div', 'small muted tk-stamps', 'Created ' + tkStamp(r.createdAt) + ' · Last updated ' + tkStamp(r.updatedAt)));
    if (r.subs) { const pb = h('div', 'pb'), f = h('div', 'pb-fill' + (r.status === 'Missing' ? ' miss' : '')); f.style.width = r.pct + '%'; pb.append(f); body.append(h('div', 'small muted', 'Task progress: ' + r.subs.done + ' of ' + r.subs.total + ' steps completed (' + r.pct + '%)'), pb); }
  } else if (d && d.task && d.task.title) {
    body.append(h('p', 'small muted', 'This step of ' + d.task.assignee + '’s task was opened to your department. Due ' + tkDue(d.task.dueDate, d.task.dueTime) + '.'));
  }
  if (r && r.team && r.team.total > 1) {
    const t = h('section', 'tk-team'); t.append(h('h3', '', 'Progress by employee'), h('div', 'small muted', r.team.done + ' of ' + r.team.total + ' employees completed'));
    const pb = h('div', 'pb'), f = h('div', 'pb-fill'); f.style.width = Math.round(r.team.done / r.team.total * 100) + '%'; pb.append(f); t.append(pb);
    if (!S.team) t.append(h('div', 'small muted', 'Loading…'));
    else S.team.forEach((a) => {
      const row = h('div', 'tk-trow'), nm = h('span', '', a.name + (a.userId === me.id ? ' (me)' : '') + (a.subTotal ? ' · ' + a.subDone + '/' + a.subTotal + ' steps · ' + a.pct + '%' : ''));
      const right = h('span', 'tk-trr'); right.append(tkB(a.status, TK_ST_CLS[a.status]));
      if (a.subTotal && a.assignmentId !== S.aid && tkRow(a.assignmentId)) { const b = h('button', 'btn ghost tk-sm', 'View steps'); b.type = 'button'; b.onclick = () => taskDetail(a.assignmentId); right.append(b); }
      row.append(nm, right); t.append(row);
    });
    body.append(t);
  }
  const steps = tkStepsView(S); if (steps) body.append(steps);
  if (r) {
    const foot = h('div', 'row wrap tk-mfoot'), bt = (text, cls, fn) => { const b = h('button', 'btn ' + cls, text); b.type = 'button'; b.onclick = fn; foot.append(b); };
    const mv = async (st) => { await taskMove(r.id, st); if (ui.taskSub === S && tkRow(r.id)) taskModalDraw(); };
    if (r.can.status && r.status === 'To Do') bt('Start Task', '', () => mv('In Progress'));
    if (r.can.status && r.status !== 'Completed') bt('Mark as Completed', '', () => mv('Completed'));
    if (r.can.status && r.status === 'Completed') bt('Reopen Task', 'ghost', () => mv('To Do'));
    if (r.can.edit) bt('Edit', 'ghost', () => { taskClose(); taskEdit(r.id); });
    if (r.can.delete) bt('Delete', 'ghost danger', () => taskDelete(r.id));
    if (foot.children.length) body.append(foot);
  }
  const m = $id('tk-modal'); if (m) m.scrollTop = keep;
}
function tkStepsView(S) {
  const d = S.data, box = h('section', 'tk-steps');
  const r = S.rowId ? tkRow(S.rowId) : null;
  if (r && !r.subs) return null;
  box.append(h('h3', '', 'Steps'));
  if (S.err) { box.append(h('p', 'small tk-late', S.err)); return box; }
  if (!d) { box.append(h('p', 'small muted', 'Loading steps…')); return box; }
  if (!d.subs.length) return null;
  box.append(h('p', 'small muted', 'Do the steps in order. Finish each step on or before its projected date.'));
  d.subs.forEach((s) => box.append(tkStepCard(s, d, S)));
  return box;
}
function tkStepCard(s, d, S) {
  const open = S.open.has(s.id), st = s.status;
  const card = h('div', 'tk-step ' + TK_DOT[st] + (open ? ' open' : ''));
  const head = h('button', 'tk-sthead'); head.type = 'button'; head.setAttribute('aria-expanded', open ? 'true' : 'false');
  head.onclick = () => { if (S.open.has(s.id)) S.open.delete(s.id); else S.open.add(s.id); taskModalDraw(); };
  const left = h('span', 'tk-sleft'), right = h('span', 'tk-sright');
  left.append(h('span', 'tk-snum2', s.n), h('span', 'tk-sname', s.title));
  right.append(tkB(st, TK_ST_CLS[st]), h('span', 'small ' + (s.missing ? 'tk-late' : 'muted'), 'Planned ' + tkDate(s.date)));
  if (s.open) right.append(tkB(s.claimedBy ? 'Taken by ' + s.claimedBy : 'Open to department', 'gray'));
  if (s.reasonStatus === 'pending' && s.rawStatus !== 'Completed') right.append(tkB('Reason waiting', 'orange'));
  head.append(left, right); card.append(head);
  const pb = h('div', 'pb tk-minipb'), f = h('div', 'pb-fill' + (s.missing ? ' miss' : '')); f.style.width = s.progress + '%'; pb.append(f); card.append(pb);
  if (open) card.append(tkStepBody(s, d, S));
  return card;
}
// one request about a step; the answer holds the fresh task list and the fresh steps. fd = a FormData (progress update or reason with files).
async function tkSubCall(action, body, fd) {
  const S = ui.taskSub; if (!S) return null;
  try {
    let r;
    if (fd) {
      let res; try { res = await fetch('api/task.php?action=' + action, { method: 'POST', body: fd }); } catch (e) { throw new Error('Cannot reach the server. Check that Apache is running in XAMPP.'); }
      let j; try { j = await res.json(); } catch (e) { throw new Error('The server sent an unexpected answer. The file may be too big for the server (upload_max_filesize in php.ini).'); }
      if (!res.ok) { const er = new Error(j.error || 'Request failed'); er.status = res.status; throw er; }
      r = j; if (r.task) db.task = r.task;
    } else r = await taskCall(action, body);
    if (r.data && ui.taskSub === S) S.data = r.data;
    return r;
  } catch (e) {
    if (e.status === 401) { me = null; db = null; render(); return null; }
    taskToast(e.message, true); return null;
  }
}
const tkAfter = (r, msg) => { if (!r) return; taskModalDraw(); taskFillAll(); if (msg) taskToast(msg); };
function tkField(text, el) { const l = h('label', 'tk-f'); l.append(h('span', 'small muted', text), el); return l; }
function tkFileInput() { const f = h('input'); f.type = 'file'; f.multiple = true; f.accept = '.pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx'; return f; }
function tkAttach(fd, input) { [...input.files].forEach((f) => fd.append('files[]', f)); }
function tkFiles(list) {
  if (!list || !list.length) return null;
  const box = h('div', 'tk-files');
  list.forEach((f) => { const a = h('a', '', f.name + ' (' + Math.max(1, Math.round(f.size / 1024)) + ' KB)'); a.href = 'api/task.php?action=file&id=' + encodeURIComponent(f.id); a.target = '_blank'; a.rel = 'noopener'; box.append(a); });
  return box;
}
const TK_KIND = { progress: 'Progress update', reason: 'Reason for the missed date', status: 'Status', dependency: 'Dependency', open: 'Open to department', claim: 'Take over', review: 'Decision', date: 'Date change' };
function tkStepBody(s, d, S) {
  const body = h('div', 'tk-stbody'), c = s.can, done = s.rawStatus === 'Completed', due = d.task ? d.task.dueDate : '';
  const btn = (text, cls, fn) => { const b = h('button', 'btn ' + cls + ' tk-sm', text); b.type = 'button'; b.onclick = fn; return b; };
  const meta = h('div', 'small tk-stmeta');
  meta.append(h('div', '', 'Projected date: ' + tkDate(s.date) + (s.moved ? ' (first planned for ' + tkDate(s.plan) + ')' : '')));
  if (s.completedAt) meta.append(h('div', '', 'Completed ' + tkStamp(s.completedAt) + (s.completedBy ? ' by ' + s.completedBy : '') + (s.completedLate ? ' (after the projected date)' : '')));
  if (s.open) meta.append(h('div', '', s.claimedBy ? 'Taken over by ' + s.claimedBy + '.' : 'Opened to the other people of the department' + (s.openedBy ? ' by ' + s.openedBy : '') + '. Nobody has taken it yet.'));
  body.append(meta);
  if (s.details) body.append(h('p', 'tk-dtext small', s.details));
  // dependencies
  const dep = h('div', 'tk-deps'); dep.append(h('h4', '', 'Dependencies'));
  if (!s.deps.length) dep.append(h('p', 'small muted', 'Nothing is listed that this step waits for.'));
  s.deps.forEach((x) => {
    const row = h('label', 'check tk-dep' + (x.resolved ? ' ok' : '')), cb = h('input'); cb.type = 'checkbox'; cb.checked = x.resolved; cb.disabled = !c.deps;
    cb.onchange = async () => tkAfter(await tkSubCall('sub_dep', { asid: s.id, op: 'toggle', depId: x.id }));
    row.append(cb, h('span', '', x.label), h('small', 'muted', x.resolved ? 'resolved' : 'waiting'));
    if (c.deps) { const rm = h('button', 'tk-ib tk-del', '×'); rm.type = 'button'; rm.title = 'Remove dependency'; rm.setAttribute('aria-label', 'Remove dependency'); rm.onclick = async (e) => { e.preventDefault(); tkAfter(await tkSubCall('sub_dep', { asid: s.id, op: 'remove', depId: x.id })); }; row.append(rm); }
    dep.append(row);
  });
  if (c.deps) {
    const add = h('div', 'tk-depadd'), inp = h('input'); inp.maxLength = 200; inp.placeholder = 'Add a dependency, e.g. Budget issuance'; inp.setAttribute('aria-label', 'New dependency');
    const go1 = async () => { if (!inp.value.trim()) return; tkAfter(await tkSubCall('sub_dep', { asid: s.id, op: 'add', label: inp.value.trim() })); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go1(); } };
    add.append(inp, btn('Add', 'ghost', go1)); dep.append(add);
  }
  body.append(dep);
  // status and progress
  const acts = h('div', 'tk-stacts');
  if (done) { if (c.reopen) acts.append(btn('Reopen step', 'ghost', async () => tkAfter(await tkSubCall('sub_status', { asid: s.id, status: 'In Progress' }), 'Step reopened.'))); }
  else if (c.work) {
    if (s.rawStatus === 'To Do') acts.append(btn('Start step', 'ghost', async () => tkAfter(await tkSubCall('sub_status', { asid: s.id, status: 'In Progress' }), 'Step started.')));
    acts.append(btn('Mark step as completed', '', async () => tkAfter(await tkSubCall('sub_status', { asid: s.id, status: 'Completed' }), 'Step completed.')));
  } else if (c.waitPrev) acts.append(h('p', 'small muted', 'Finish the earlier steps first. Steps are done in order.'));
  if (acts.children.length) body.append(acts);
  if (c.work) {
    const f = h('form', 'tk-upd'), rg = h('input'), num = h('input'), note = h('textarea'), files = tkFileInput(), row = h('div', 'tk-progrow');
    rg.type = 'range'; rg.min = 0; rg.max = 100; rg.step = 5; rg.value = s.progress; num.type = 'number'; num.min = 0; num.max = 100; num.value = s.progress; num.setAttribute('aria-label', 'Progress in percent');
    rg.oninput = () => { num.value = rg.value; }; num.oninput = () => { rg.value = num.value; };
    row.append(rg, num, h('span', 'small muted', '%')); note.rows = 2; note.maxLength = 2000; note.placeholder = 'What did you do? (optional)';
    f.append(h('h4', '', 'Progress update'), row, note, tkField('Attach a file (optional): PDF, picture, Word or Excel, up to 10 MB', files));
    const sub = h('button', 'btn tk-sm', 'Save progress update'); sub.type = 'submit'; f.append(sub);
    f.onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(); fd.append('asid', s.id); fd.append('kind', 'progress'); fd.append('progress', num.value); fd.append('note', note.value.trim()); tkAttach(fd, files); sub.disabled = true; const r = await tkSubCall('sub_update', null, fd); if (!r) sub.disabled = false; tkAfter(r, 'Progress saved.'); };
    body.append(f);
  }
  // missed date: the employee explains, the superior decides
  if (s.reasonStatus !== 'none' || (s.missing && c.reason)) {
    const box = h('div', 'tk-reason'); box.append(h('h4', '', 'Missed projected date'));
    const lab = { pending: ['Waiting for review', 'orange'], valid: ['Reason accepted', 'green'], rejected: ['Reason not accepted', 'red'] }[s.reasonStatus];
    if (lab) box.append(tkB(lab[0], lab[1]));
    if (c.reason && (s.missing || s.reasonStatus === 'pending' || s.reasonStatus === 'rejected')) {
      const f = h('form', 'tk-upd'), note = h('textarea'), files = tkFileInput(); note.rows = 3; note.maxLength = 2000; note.placeholder = 'Why could this step not be finished by the projected date? (for example: sick, no budget yet)';
      f.append(note, tkField('Attach proof (optional), for example a medical certificate', files));
      const sub = h('button', 'btn ghost tk-sm', s.reasonStatus === 'pending' ? 'Send another note' : 'Send reason'); sub.type = 'submit'; f.append(sub);
      f.onsubmit = async (e) => { e.preventDefault(); if (note.value.trim().length < 5) return taskToast('Write why the step could not be finished on time.', true); const fd = new FormData(); fd.append('asid', s.id); fd.append('kind', 'reason'); fd.append('note', note.value.trim()); tkAttach(fd, files); sub.disabled = true; const r = await tkSubCall('sub_update', null, fd); if (!r) sub.disabled = false; tkAfter(r, 'Your reason was sent for review.'); };
      box.append(f);
    }
    if (c.review) {
      const f = h('form', 'tk-upd tk-review'), date = h('input'), note = h('textarea'); date.type = 'date'; date.required = true; date.min = db.task.today; if (due) date.max = due; if (due && db.task.today <= due) date.value = db.task.today;
      note.rows = 2; note.maxLength = 1000; note.placeholder = 'Note for the employee (required if you do not accept)';
      const ok = btn('Accept reason and move the date', '', async () => { if (!date.value) return taskToast('Choose the new projected date.', true); tkAfter(await tkSubCall('sub_review', { asid: s.id, decision: 'valid', date: date.value, note: note.value.trim() }), 'Reason accepted. The projected date was moved.'); });
      const no = btn('Do not accept', 'ghost danger', async () => { if (!note.value.trim()) return taskToast('Write why the reason is not accepted.', true); tkAfter(await tkSubCall('sub_review', { asid: s.id, decision: 'rejected', note: note.value.trim() }), 'The reason was not accepted.'); });
      f.append(h('b', 'small', 'Your decision'), tkField('New projected date' + (due ? ' (not after ' + tkDate(due) + ')' : ''), date), note, h('div', 'row wrap tk-mfoot', ''));
      f.lastChild.append(ok, no); f.onsubmit = (e) => e.preventDefault(); box.append(f);
    }
    body.append(box);
  }
  // superior / admin controls
  const ctl = h('div', 'tk-ctl');
  if (c.adjust) {
    const date = h('input'); date.type = 'date'; date.value = s.date; if (due) date.max = due; date.setAttribute('aria-label', 'Projected date');
    const row = h('div', 'tk-depadd'); row.append(date, btn('Change projected date', 'ghost', async () => tkAfter(await tkSubCall('sub_date', { asid: s.id, date: date.value }), 'Projected date changed.')));
    ctl.append(h('b', 'small', 'Projected date (must stay within the due date of the task)'), row);
  }
  const row2 = h('div', 'row wrap tk-stacts');
  if (c.open) row2.append(btn('Open this step to the department', 'ghost', async () => tkAfter(await tkSubCall('sub_open', { asid: s.id, open: true }), 'Step opened. The other people of the department can take it over.')));
  if (c.closeOpen) row2.append(btn('Close this step to the department', 'ghost', async () => tkAfter(await tkSubCall('sub_open', { asid: s.id, open: false }), 'Step closed.')));
  if (c.claim) row2.append(btn('Take over this step', '', async () => tkAfter(await tkSubCall('sub_claim', { asid: s.id, claim: true }), 'You took over this step.')));
  if (c.release) row2.append(btn('Give the step back', 'ghost', async () => tkAfter(await tkSubCall('sub_claim', { asid: s.id, claim: false }), 'You gave the step back.')));
  if (row2.children.length) ctl.append(row2);
  if (ctl.children.length) body.append(ctl);
  // history
  if (s.updates.length) {
    const hist = h('div', 'tk-hist'); hist.append(h('h4', '', 'History'));
    s.updates.forEach((u) => {
      const it = h('div', 'tk-hi'), top = h('div', 'small');
      top.append(h('b', '', u.who), h('span', 'muted', ' · ' + (TK_KIND[u.kind] || u.kind) + ' · ' + tkStamp(u.at) + (u.progress !== null && u.kind === 'progress' ? ' · ' + u.progress + '%' : '')));
      it.append(top); if (u.note) it.append(h('div', 'tk-dtext small', u.note)); const fl = tkFiles(u.files); if (fl) it.append(fl); hist.append(it);
    });
    body.append(hist);
  }
  return body;
}

/* ---------- create / edit form ---------- */
function taskNew() { taskOpenForm(null, [], null); }
async function taskEdit(id) {
  const r = tkRow(id); if (!r) return;
  if (!r.can.edit) return taskToast('You can edit only the tasks you created or assigned.', true);
  try {
    const cur = r.personal ? [] : (await api('task', 'detail', { taskId: r.taskId })).detail.assignees;
    const steps = r.subs ? (await api('task', 'subs', { assignmentId: r.id })).data.subs.map((s) => ({ id: s.stepId, title: s.title, date: s.plan, deps: s.planDeps, details: s.details })) : [];
    taskOpenForm(r, cur, steps);
  } catch (e) { if (me) taskToast(e.message, true); }
}
function taskOpenForm(r, current, steps) {
  taskClose();
  const T = db.task, edit = !!r, showAssign = edit ? !r.personal : T.canAssign, onBoard = tkTab() === 'board', z = tkState();
  ui.taskForm = { id: edit ? r.taskId : '', edit, personal: edit && r.personal, current, picked: new Set(current.map((a) => a.userId)) };
  const f = tpl('tpl-task-form', { heading: edit ? 'Edit Task' : 'New Task', title: edit ? r.title : '', description: edit ? r.description : '', priority: edit ? r.priority : 'Medium', category: edit ? r.category : 'General',
    startDate: edit ? r.startDate || '' : '', dueDate: edit ? r.dueDate || '' : '', dueTime: edit ? r.dueTime || '' : '', status: edit ? (r.rawStatus || r.status) : 'To Do', showAssign, showModes: showAssign && !edit, showStatus: !edit || r.personal,
    allLabel: 'Select all shown (' + T.assignable.length + ')', submit: edit ? 'Save Changes' : T.canAssign ? 'Create Task' : 'Add Task',
    cats: [...new Set(T.categories.concat(T.rows.map((x) => x.category)))].map((v) => ({ v })) });
  document.body.appendChild(f);
  if (showAssign) {
    const pre = !edit && onBoard && z.type === 'personal' ? 'self' : 'selected', radio = document.querySelector('input[name="tk-mode"][value="' + pre + '"]'); if (radio) radio.checked = true;
    const fq = edit ? r.frequency : onBoard && z.type === 'daily' ? 'daily' : 'weekly', fr = document.querySelector('input[name="tk-freq"][value="' + fq + '"]'); if (fr) fr.checked = true;
    taskPickBuild();
  }
  (steps || []).forEach((x) => taskStepAdd(x, true));
  taskMode(); taskDueChanged();
  const t = $id('tk-title'); if (t) t.focus();
}
function taskPickBuild() {
  const T = db.task, z = ui.taskForm, box = $id('tk-list'); if (!box) return;
  const ppl = T.assignable.map((p) => ({ id: p.id, name: p.name, sub: [p.position, p.department].filter(Boolean).join(' · ') }));
  z.current.forEach((a) => { if (!ppl.some((p) => p.id === a.userId)) ppl.push({ id: a.userId, name: a.name, sub: 'not in my team' }); }); // keep people already on the task even if they left the team
  box.replaceChildren(...ppl.map((p) => {
    const l = h('label', 'check'), c = h('input'), n = h('span', '', p.name), s = h('small', '', p.sub || '');
    l.dataset.name = (p.name + ' ' + (p.sub || '')).toLowerCase(); c.type = 'checkbox'; c.value = p.id; c.checked = z.picked.has(p.id);
    c.onchange = () => { if (c.checked) z.picked.add(p.id); else z.picked.delete(p.id); taskPickCount(); };
    l.append(c, n, s); return l;
  }));
  if (!ppl.length) box.append(h('div', 'tk-empty', me.role === 'admin' ? 'There are no active employees.' : 'No employees are assigned to you yet. Ask the administrator to set you as the immediate superior of your team (Admin > Employees).'));
  taskPickCount();
}
function taskPickCount() { const n = $id('tk-pickn'); if (n) n.textContent = ui.taskForm.picked.size + ' selected'; }
function taskPickFilter() {
  const q = $id('tk-pickq').value.trim().toLowerCase();
  document.querySelectorAll('#tk-list label').forEach((l) => { l.style.display = !q || l.dataset.name.includes(q) ? '' : 'none'; });
}
function taskPickAll(on) {
  document.querySelectorAll('#tk-list label').forEach((l) => { if (l.style.display === 'none') return; const c = l.querySelector('input'); c.checked = on; if (on) ui.taskForm.picked.add(c.value); else ui.taskForm.picked.delete(c.value); });
  taskPickCount();
}
const taskModeVal = () => { const c = document.querySelector('input[name="tk-mode"]:checked'); return c ? c.value : ui.taskForm.personal ? 'self' : ui.taskForm.edit ? 'selected' : 'self'; };
function taskMode() {
  const m = taskModeVal(), z = ui.taskForm, pick = $id('tk-pick'), all = $id('tk-allbox'), tb = $id('tk-typebox'), help = $id('tk-modehelp');
  if (pick) pick.classList.toggle('hidden', m !== 'selected');
  if (tb) tb.classList.toggle('hidden', m === 'self');
  if (all) {
    all.classList.toggle('hidden', m !== 'all');
    if (m === 'all') {
      const chips = h('div', 'tk-chips'); chips.append(...db.task.assignable.map((p) => h('span', 'badge gray', p.name)));
      all.replaceChildren(h('div', 'small', db.task.assignable.length + ' employee' + (db.task.assignable.length === 1 ? '' : 's') + ' will receive this task:'), chips);
    }
  }
  if (help) help.textContent = m === 'all' ? 'Everybody in the list is given the task, and each person has their own status and progress. You see only the people under you.' : m === 'self' ? 'A personal task is visible only to you.'
    : z.edit ? 'Employees you remove are told the task was reassigned. Employees you add receive it as a new task.' : 'Each selected employee gets their own copy of the task with their own status and progress.';
  tkFormSync();
}
function tkFormSync() { // the Status field is only for a personal task without steps (the status of a task with steps follows its steps)
  const lab = $id('tk-statuslabel'); if (!lab) return;
  lab.classList.toggle('hidden', taskModeVal() !== 'self' || document.querySelectorAll('#tk-steps-edit .tk-srow').length > 0);
}
function taskDueChanged() { const due = $id('tk-due').value; document.querySelectorAll('#tk-steps-edit .tk-s-date').forEach((d) => { if (due) d.max = due; else d.removeAttribute('max'); }); }

/* the steps (subtasks) editor */
function tkStepRenumber() { document.querySelectorAll('#tk-steps-edit .tk-srow').forEach((row, i) => { row.querySelector('.tk-snum').textContent = i + 1; }); }
function taskStepAdd(x, quiet) {
  x = x && x.title !== undefined ? x : { id: '', title: '', date: '', deps: '', details: '' };
  const box = $id('tk-steps-edit'), row = h('div', 'tk-srow'); row.dataset.sid = x.id || '';
  const title = h('input', 'tk-s-title'), date = h('input', 'tk-s-date'), deps = h('textarea', 'tk-s-deps'), det = h('input', 'tk-s-det');
  title.maxLength = 160; title.placeholder = 'Step title, e.g. Gather concerns of the sites'; title.value = x.title; title.setAttribute('aria-label', 'Step title');
  date.type = 'date'; date.value = x.date || ''; date.setAttribute('aria-label', 'Projected date of the step');
  deps.rows = 2; deps.placeholder = 'e.g. Budget issuance'; deps.value = x.deps || ''; deps.setAttribute('aria-label', 'Dependencies');
  det.maxLength = 1000; det.placeholder = 'Details (optional)'; det.value = x.details || ''; det.setAttribute('aria-label', 'Step details');
  const ctl = h('div', 'tk-sctl'), ib = (t, label, fn) => { const b = h('button', 'tk-ib', t); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.onclick = fn; return b; };
  ctl.append(ib('↑', 'Move step up', () => { const p = row.previousElementSibling; if (p) { box.insertBefore(row, p); tkStepRenumber(); } }), ib('↓', 'Move step down', () => { const n = row.nextElementSibling; if (n) { box.insertBefore(n, row); tkStepRenumber(); } }),
    ib('🗑', 'Remove step', () => { row.remove(); tkStepRenumber(); tkFormSync(); }));
  ctl.lastChild.classList.add('tk-del');
  const main = h('div', 'tk-smain'), two = h('div', 'tk-s2'); two.append(tkField('Projected date', date), tkField('Depends on (one per line)', deps)); main.append(title, two, det);
  row.append(h('span', 'tk-snum'), main, ctl); box.append(row); tkStepRenumber(); taskDueChanged(); tkFormSync();
  if (!quiet) title.focus();
}
function tkStepsRead() { return [...document.querySelectorAll('#tk-steps-edit .tk-srow')].map((row) => ({ id: row.dataset.sid || 0, title: row.querySelector('.tk-s-title').value.trim(), date: row.querySelector('.tk-s-date').value, deps: row.querySelector('.tk-s-deps').value, details: row.querySelector('.tk-s-det').value.trim() })); }

async function taskSave(e) {
  e.preventDefault();
  const z = ui.taskForm, v = (id) => $id(id).value.trim(), btn = $id('tk-submit');
  const body = { id: z.id, title: v('tk-title'), description: v('tk-desc'), priority: $id('tk-pri').value, category: v('tk-cat'), startDate: $id('tk-start').value, dueDate: $id('tk-due').value, dueTime: $id('tk-time').value };
  const err = (t) => { say('tk-err', 'red', t); };
  if (!body.title) { err('Enter a task title.'); $id('tk-title').focus(); return; }
  if (body.dueTime && !body.dueDate) return err('Choose a due date for the due time.');
  if (body.startDate && body.dueDate && body.startDate > body.dueDate) return err('The due date cannot be before the start date.');
  const steps = tkStepsRead();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i], n = i + 1;
    if (!s.title) return err('Enter a title for step ' + n + ', or remove the step.');
    if (!s.date) return err('Choose the projected date of step ' + n + '.');
    if (!body.dueDate) return err('Choose the due date of the task first. Every step must be planned on or before it.');
    if (s.date > body.dueDate) return err('The projected date of step ' + n + ' (' + tkDate(s.date) + ') cannot be after the due date of the task (' + tkDate(body.dueDate) + ').');
    if (body.startDate && s.date < body.startDate) return err('The projected date of step ' + n + ' cannot be before the start date of the task.');
  }
  body.subtasks = steps;
  const m = taskModeVal(), canPick = !!$id('tk-pick');
  if (m === 'self' && !steps.length) { const st = $id('tk-st'); if (st) body.status = st.value; }
  if (canPick) {
    body.mode = m;
    if (m !== 'self') { const fr = document.querySelector('input[name="tk-freq"]:checked'); body.frequency = fr ? fr.value : 'weekly'; }
    if (z.edit || m === 'selected') body.assignees = [...z.picked];
    if (m === 'selected' && !body.assignees.length) return err('Choose at least one employee.');
    if (m === 'all' && !db.task.assignable.length) return err('There are no employees to assign this task to.');
  } else if (!z.edit) body.mode = 'self';
  btn.disabled = true;
  try {
    const r = await taskCall('save', body);
    taskClose(); taskFillAll();
    taskToast(z.edit ? 'Task updated.' : r.count > 1 ? 'Task assigned to ' + r.count + ' employees.' : body.mode && body.mode !== 'self' ? 'Task created and assigned.' : 'Task created.');
  } catch (x) { if (!me) return; btn.disabled = false; err(x.message); }
}
