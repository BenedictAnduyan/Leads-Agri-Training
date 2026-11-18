/* Task Management tab: every role (admin, immediate superior, employee). Nothing is stored in the browser except the Board / List choice.
   All tasks are read and saved by api/task.php (MySQL tables tasks and task_assignments); the server decides who may see and change what.
   Screens are templates in index.html (tpl-task-*). The page asks the server for changes every 20 seconds, so a status changed by an employee
   shows on the supervisor's and the administrator's page without reloading.
   Each row of db.task.rows is ONE employee's assignment of a task, with that employee's own status. */
const TK_STATUS = ['To Do', 'In Progress', 'Completed'];
const TK_ST_CLS = { 'To Do': 'tk-st-todo', 'In Progress': 'tk-st-prog', Completed: 'tk-st-done' };
const TK_PRI_W = { High: 3, Medium: 2, Low: 1 };
const tkPath = () => (me.role === 'admin' ? '/admin/task' : '/task');
const tkBadge = () => (db && db.task && db.task.badge ? ' (' + db.task.badge + ')' : ''); // my overdue tasks, shown in the menu
function tkSavedView() { try { return localStorage.getItem('leads-task-view') === 'list' ? 'list' : 'kanban'; } catch (e) { return 'kanban'; } }
const tkState = () => ui.task || (ui.task = { view: tkSavedView(), q: '', status: '', priority: '', category: '', user: '', sort: 'newest' });
const tkRow = (id) => (db && db.task ? db.task.rows.find((r) => r.id === id) : null);
const tkDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const tkStamp = (d) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const tkDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const tkLate = (r) => !!r.dueDate && r.status !== 'Completed' && r.dueDate < db.task.today; // overdue is worked out from the due date, never stored
const tkSoon = (r) => !!r.dueDate && r.status !== 'Completed' && !tkLate(r) && tkDays(db.task.today, r.dueDate) <= 2;

/* ---------- navigation ---------- */
function taskHome() { ui.task = null; if (location.hash === '#' + tkPath()) render(); else go(tkPath()); return false; } // the menu link always starts with no filters
function taskLeave() { // called by render() when another page is open
  if (ui.taskTimer) { clearInterval(ui.taskTimer); ui.taskTimer = null; }
  if (ui.task) ui.task = null;
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
  const T = db.task;
  const intro = me.role === 'admin' ? 'Create and assign tasks, and monitor the status, priority and deadlines of every employee.'
    : T.canAssign ? 'Assign tasks to your team and follow their progress. You can also keep your own personal tasks.'
      : 'Your tasks: the ones assigned to you and your own personal tasks.';
  const f = tpl('tpl-task-page', { monitor: T.monitor, intro });
  taskFillAll(f);
  const board = f.querySelector('#tk-board');
  board.addEventListener('click', taskBoardClick);
  board.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.tk-card, .tk-tr')) { e.preventDefault(); taskDetail(e.target.dataset.id); } });
  board.addEventListener('dragstart', (e) => {
    const c = e.target.closest && e.target.closest('.tk-card[draggable="true"]'); if (!c) return;
    ui.taskDrag = c.dataset.id; e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging');
  });
  board.addEventListener('dragend', () => { ui.taskDrag = null; board.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging')); board.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); });
  board.addEventListener('dragover', (e) => { const z = e.target.closest && e.target.closest('.tk-zone'); if (z && ui.taskDrag) { e.preventDefault(); z.classList.add('over'); } });
  board.addEventListener('dragleave', (e) => { const z = e.target.closest && e.target.closest('.tk-zone'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
  board.addEventListener('drop', (e) => {
    const z = e.target.closest && e.target.closest('.tk-zone'); if (!z) return;
    e.preventDefault(); z.classList.remove('over');
    const id = ui.taskDrag || e.dataTransfer.getData('text/plain'); ui.taskDrag = null;
    if (id) taskMove(id, z.dataset.status);
  });
  taskStartPoll();
  return f;
}
function taskBoardClick(e) {
  const b = e.target.closest('[data-act]');
  if (b) { e.stopPropagation(); taskAct(b.dataset.act, b.dataset.id); return; }
  const c = e.target.closest('.tk-card, .tk-tr'); if (c) taskDetail(c.dataset.id);
}
function taskAct(act, id) {
  const r = tkRow(id); if (!r) return;
  if (act === 'view') return taskDetail(id);
  if (act === 'edit') return taskEdit(id);
  if (act === 'delete') return taskDelete(id);
  if (act === 'toggle') return taskMove(id, r.status === 'Completed' ? 'To Do' : 'Completed');
  if (act === 'advance') return taskMove(id, tkNext(r));
}
const tkNext = (r) => (r.status === 'To Do' ? 'In Progress' : r.status === 'In Progress' ? 'Completed' : 'To Do');
const tkAdvTitle = (r) => (r.status === 'To Do' ? 'Move to In Progress' : r.status === 'In Progress' ? 'Mark as Completed' : 'Reopen task');

/* ---------- filters, search, sort ---------- */
function taskSet(k, v) { tkState()[k] = v; taskFillAll(); }
function taskReset() {
  const z = tkState(); z.q = z.status = z.priority = z.category = z.user = ''; z.sort = 'newest';
  const q = $id('tk-q'); if (q) q.value = '';
  taskFillAll();
}
function taskView(v) { tkState().view = v; try { localStorage.setItem('leads-task-view', v); } catch (e) { /* ignore */ } taskFillAll(); }
function taskStat(key) { // the summary cards also work as filters
  const z = tkState();
  if (key === 'all') { z.status = ''; z.priority = ''; }
  else if (key === 'High') { z.priority = z.priority === 'High' ? '' : 'High'; z.status = ''; }
  else { z.status = z.status === key ? '' : key; z.priority = ''; }
  taskFillAll();
}
const tkScope = () => { const z = tkState(); return db.task.rows.filter((r) => !z.user || r.assigneeId === z.user); }; // the employee filter also limits the numbers on the cards
function tkVisible() {
  const z = tkState(), q = z.q.trim().toLowerCase();
  const list = tkScope().filter((r) => (!q || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
    && (!z.status || (z.status === 'Overdue' ? tkLate(r) : r.status === z.status)) && (!z.priority || r.priority === z.priority) && (!z.category || r.category === z.category));
  const num = (r) => Number(r.id);
  list.sort((a, b) => {
    if (z.sort === 'due') { if (!a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1; if (a.dueDate !== b.dueDate) return (a.dueDate || '') < (b.dueDate || '') ? -1 : 1; }
    else if (z.sort === 'priority') { const d = TK_PRI_W[b.priority] - TK_PRI_W[a.priority]; if (d) return d; }
    return Number(b.taskId) - Number(a.taskId) || num(b) - num(a);
  });
  return list;
}

/* ---------- drawing: cards, progress bar, selects, board / list ---------- */
function taskFillAll(root) {
  root = root || document;
  if (!root.querySelector('#tk-board')) return;
  taskFillSelects(root); taskFillStats(root); taskFillBoard(root);
}
function tkOptions(sel, first, items, value) {
  sel.replaceChildren(...[['', first]].concat(items).map((x) => { const o = document.createElement('option'); o.value = x[0]; o.textContent = x[1]; return o; }));
  sel.value = value;
}
function taskFillSelects(root) {
  const z = tkState(), T = db.task;
  const q = root.querySelector('#tk-q'); if (q && q !== document.activeElement) q.value = z.q;
  root.querySelector('#tk-status').value = z.status; root.querySelector('#tk-priority').value = z.priority; root.querySelector('#tk-sort').value = z.sort;
  const cats = [...new Set(T.categories.concat(T.rows.map((r) => r.category)))].sort((a, b) => a.localeCompare(b));
  if (z.category && !cats.includes(z.category)) z.category = '';
  tkOptions(root.querySelector('#tk-category'), 'All categories', cats.map((c) => [c, c]), z.category);
  const us = root.querySelector('#tk-user');
  if (us) {
    const m = new Map(); T.rows.forEach((r) => m.set(r.assigneeId, r.assignee));
    if (z.user && !m.has(z.user)) z.user = '';
    tkOptions(us, T.canAssign && me.role === 'admin' ? 'All employees' : 'Me and my team', [...m].sort((a, b) => a[1].localeCompare(b[1])).map((x) => [x[0], x[1] + (x[0] === me.id ? ' (me)' : '')]), z.user);
  }
}
function taskFillStats(root) {
  const z = tkState(), R = tkScope(), n = (f) => R.filter(f).length;
  const total = R.length, done = n((r) => r.status === 'Completed'), late = n(tkLate);
  const cards = [['all', 'Total Tasks', total, 's-all', !z.status && !z.priority], ['To Do', 'To Do', n((r) => r.status === 'To Do'), 's-todo', z.status === 'To Do'],
    ['In Progress', 'In Progress', n((r) => r.status === 'In Progress'), 's-prog', z.status === 'In Progress'], ['Completed', 'Completed', done, 's-done', z.status === 'Completed'], ['High', 'High Priority', n((r) => r.priority === 'High'), 's-high', z.priority === 'High']];
  root.querySelector('#tk-stats').replaceChildren(...cards.map((c) => {
    const b = document.createElement('button'), l = document.createElement('div'), v = document.createElement('div');
    b.type = 'button'; b.className = 'card stat tk-stat ' + c[3] + (c[4] ? ' on' : ''); b.onclick = () => taskStat(c[0]);
    l.className = 'muted small'; l.textContent = c[1]; v.className = 'big'; v.textContent = c[2]; b.append(l, v); return b;
  }));
  const pct = total ? Math.round(done / total * 100) : 0;
  root.querySelector('#tk-pfill').style.width = pct + '%'; root.querySelector('#tk-pbar').setAttribute('aria-valuenow', pct);
  root.querySelector('#tk-ptext').textContent = pct + '% (' + done + ' of ' + total + ' task' + (total === 1 ? '' : 's') + ')' + (late ? ' · ' + late + ' overdue' : '');
}
function tkWho(r) {
  if (r.personal) return r.assigneeId === me.id ? 'Personal task' : 'Personal task of ' + r.assignee;
  return r.assigneeId === me.id ? 'Assigned by ' + r.creator : 'Assigned to ' + r.assignee + (r.creatorId === me.id ? '' : ' by ' + r.creator);
}
function tkData(r) {
  const late = tkLate(r), done = r.status === 'Completed';
  return { id: r.id, title: r.title, description: r.description, hasDesc: !!r.description, priority: r.priority, priCls: 'tk-pri-' + r.priority.toLowerCase(), category: r.category,
    late, soon: tkSoon(r), who: tkWho(r), assignee: r.assignee + (r.assigneeId === me.id ? ' (me)' : ''), due: r.dueDate ? tkDate(r.dueDate) : 'No due date', dueCls: late ? 'tk-late' : '',
    canStatus: r.can.status, canEdit: r.can.edit, canDelete: r.can.delete, drag: r.can.status ? 'true' : false, checked: done, toggleLabel: done ? 'Reopen task' : 'Mark as completed',
    advTitle: tkAdvTitle(r), advIcon: r.status === 'Completed' ? '↺' : '›', advLabel: r.status === 'To Do' ? 'Start' : r.status === 'In Progress' ? 'Complete' : 'Reopen',
    status: r.status, stCls: TK_ST_CLS[r.status], cls: 'pri-' + r.priority.toLowerCase() + (done ? ' done' : '') + (r.status === 'In Progress' ? ' prog' : '') + (late ? ' late' : '') };
}
function taskFillBoard(root) {
  root = root || document;
  const z = tkState(), box = root.querySelector('#tk-board'), list = tkVisible();
  root.querySelector('#tk-v-kanban').classList.toggle('on', z.view === 'kanban'); root.querySelector('#tk-v-list').classList.toggle('on', z.view === 'list');
  if (z.view === 'list') {
    const t = tpl('tpl-task-list'), body = t.querySelector('#tk-rows');
    if (list.length) body.replaceChildren(...list.map((r) => tpl('tpl-task-row', tkData(r))));
    else { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 8; td.className = 'tk-empty'; td.textContent = tkEmptyText(); tr.append(td); body.append(tr); }
    box.replaceChildren(t); return;
  }
  const wrap = document.createElement('div'); wrap.className = 'tk-board';
  [['To Do', ''], ['In Progress', 'prog'], ['Completed', 'done']].forEach((c) => {
    const col = document.createElement('section'), head = document.createElement('div'), zone = document.createElement('div'), mine = list.filter((r) => r.status === c[0]);
    col.className = 'tk-col'; head.className = 'tk-colhead'; zone.className = 'tk-zone'; zone.dataset.status = c[0];
    const nm = document.createElement('span'), dot = document.createElement('span'), cnt = document.createElement('span');
    dot.className = 'tk-dot ' + c[1]; nm.append(dot, c[0]); cnt.className = 'tk-count'; cnt.textContent = mine.length; head.append(nm, cnt);
    if (mine.length) zone.append(...mine.map((r) => tpl('tpl-task-card', tkData(r))));
    else { const e = document.createElement('div'); e.className = 'tk-empty'; e.textContent = tkHasFilter() ? 'No matching tasks' : 'Drop tasks here'; zone.append(e); }
    col.append(head, zone); wrap.append(col);
  });
  box.replaceChildren(wrap);
}
const tkHasFilter = () => { const z = tkState(); return !!(z.q || z.status || z.priority || z.category || z.user); };
const tkEmptyText = () => (tkHasFilter() ? 'No matching tasks. Try Reset Filters.' : 'No tasks yet. Press + New Task to add one.');

/* ---------- changing a status (drag and drop, check box, arrow, buttons) ---------- */
async function taskMove(id, status) {
  const r = tkRow(id); if (!r || r.status === status) return;
  if (!r.can.status) return taskToast('You cannot change the status of this task.', true);
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

/* ---------- details ---------- */
function taskClose() { const m = $id('tk-modal'); if (m) m.remove(); }
function taskDetail(id) {
  const r = tkRow(id); if (!r) return;
  taskClose();
  const facts = [['Assigned to', r.assignee + (r.assigneeId === me.id ? ' (me)' : '')], ['Assigned by', r.personal ? 'Personal task (own task)' : r.creator], ['Category', r.category], ['Priority', r.priority],
    ['Start date', r.startDate ? tkDate(r.startDate) : '-'], ['Due date', r.dueDate ? tkDate(r.dueDate) + (tkLate(r) ? ' (overdue)' : tkSoon(r) ? ' (due soon)' : '') : '-'], ['Status', r.status]];
  if (r.completedAt) facts.push(['Completed on', tkStamp(r.completedAt)]);
  facts.push(['Created', tkStamp(r.createdAt)], ['Last updated', tkStamp(r.updatedAt)]);
  const d = tkData(r), team = r.team;
  const f = tpl('tpl-task-detail', { ...d, facts: facts.map((x) => ({ k: x[0], v: x[1] })), hasTeam: !!team && team.total > 1,
    teamText: team ? team.done + ' of ' + team.total + ' employees completed' : '', teamPct: team && team.total ? Math.round(team.done / team.total * 100) : 0,
    canStart: r.can.status && r.status === 'To Do', canComplete: r.can.status && r.status !== 'Completed', canReopen: r.can.status && r.status === 'Completed' });
  document.body.appendChild(f);
  if (team && team.total > 1) {
    api('task', 'detail', { taskId: r.taskId }).then((x) => {
      const box = $id('tk-team'); if (!box || !$id('tk-dtitle')) return;
      box.className = ''; box.replaceChildren(...x.detail.assignees.map((a) => tpl('tpl-task-trow', { name: a.name + (a.userId === me.id ? ' (me)' : ''), status: a.status, stCls: TK_ST_CLS[a.status] })));
    }).catch(() => { const box = $id('tk-team'); if (box) box.textContent = 'Could not load the list.'; });
  }
}
async function taskDetailAct(btn) {
  const id = btn.dataset.id, a = btn.dataset.act;
  if (a === 'edit') { taskClose(); return taskEdit(id); }
  if (a === 'delete') return taskDelete(id);
  await taskMove(id, a === 'start' ? 'In Progress' : a === 'complete' ? 'Completed' : 'To Do');
  if ($id('tk-modal') && tkRow(id)) taskDetail(id);
}

/* ---------- create / edit form ---------- */
function taskNew() { taskOpenForm(null, []); }
async function taskEdit(id) {
  const r = tkRow(id); if (!r) return;
  if (!r.can.edit) return taskToast('You can edit only the tasks you created or assigned.', true);
  if (r.personal) return taskOpenForm(r, []);
  try { const x = await api('task', 'detail', { taskId: r.taskId }); taskOpenForm(r, x.detail.assignees); }
  catch (e) { if (me) taskToast(e.message, true); }
}
function taskOpenForm(r, current) {
  taskClose();
  const T = db.task, edit = !!r, showAssign = edit ? !r.personal : T.canAssign;
  ui.taskForm = { id: edit ? r.taskId : '', edit, personal: edit && r.personal, current, picked: new Set(current.map((a) => a.userId)) };
  const f = tpl('tpl-task-form', { heading: edit ? 'Edit Task' : 'New Task', title: edit ? r.title : '', description: edit ? r.description : '', priority: edit ? r.priority : 'Medium', category: edit ? r.category : 'General',
    startDate: edit ? r.startDate || '' : '', dueDate: edit ? r.dueDate || '' : '', status: edit ? r.status : 'To Do', showAssign, showModes: showAssign && !edit, showStatus: !edit || r.personal,
    allLabel: (me.role === 'admin' ? 'All employees' : 'All employees in my team') + ' (' + T.assignable.length + ')', submit: edit ? 'Save Changes' : T.canAssign ? 'Create Task' : 'Add Task',
    cats: [...new Set(T.categories.concat(T.rows.map((x) => x.category)))].map((v) => ({ v })) });
  document.body.appendChild(f);
  if (showAssign) {
    const radio = document.querySelector('input[name="tk-mode"][value="selected"]'); if (radio) radio.checked = true;
    taskPickBuild(); taskMode();
  }
  const t = $id('tk-title'); if (t) t.focus();
}
function taskPickBuild() {
  const T = db.task, z = ui.taskForm, box = $id('tk-list'); if (!box) return;
  const ppl = T.assignable.map((p) => ({ id: p.id, name: p.name, sub: p.department }));
  z.current.forEach((a) => { if (!ppl.some((p) => p.id === a.userId)) ppl.push({ id: a.userId, name: a.name, sub: 'not in my team' }); }); // keep people already on the task even if they left the team
  box.replaceChildren(...ppl.map((p) => {
    const l = document.createElement('label'), c = document.createElement('input'), n = document.createElement('span'), s = document.createElement('small');
    l.className = 'check'; l.dataset.name = (p.name + ' ' + (p.sub || '')).toLowerCase();
    c.type = 'checkbox'; c.value = p.id; c.checked = z.picked.has(p.id);
    c.onchange = () => { if (c.checked) z.picked.add(p.id); else z.picked.delete(p.id); taskPickCount(); };
    n.textContent = p.name; s.textContent = p.sub || ''; l.append(c, n, s); return l;
  }));
  if (!ppl.length) { const e = document.createElement('div'); e.className = 'tk-empty'; e.textContent = me.role === 'admin' ? 'There are no active employees.' : 'No employees are assigned to you yet. Ask the administrator to set you as the immediate superior of your team (Admin > Employees).'; box.append(e); }
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
const taskModeVal = () => { const c = document.querySelector('input[name="tk-mode"]:checked'); return c ? c.value : ui.taskForm.edit ? 'selected' : 'self'; };
function taskMode() {
  const m = taskModeVal(), pick = $id('tk-pick'), help = $id('tk-modehelp'); if (!pick) return;
  pick.classList.toggle('hidden', m !== 'selected');
  help.textContent = m === 'all' ? 'One task is created for every employee in the list, and each person has their own status and progress.' : m === 'self' ? 'A personal task is visible only to you.'
    : ui.taskForm.edit ? 'Employees you remove are told the task was reassigned. Employees you add receive it as a new task.' : 'Each selected employee gets their own copy of the task with their own status and progress.';
}
async function taskSave(e) {
  e.preventDefault();
  const z = ui.taskForm, v = (id) => $id(id).value.trim(), btn = $id('tk-submit');
  const body = { id: z.id, title: v('tk-title'), description: v('tk-desc'), priority: $id('tk-pri').value, category: v('tk-cat'), startDate: $id('tk-start').value, dueDate: $id('tk-due').value };
  const st = $id('tk-st'); if (st) body.status = st.value;
  const err = (t) => { say('tk-err', 'red', t); };
  if (!body.title) { err('Enter a task title.'); $id('tk-title').focus(); return; }
  if (body.startDate && body.dueDate && body.startDate > body.dueDate) return err('The due date cannot be before the start date.');
  const canPick = !!$id('tk-pick');
  if (canPick) {
    const m = taskModeVal(); body.mode = m;
    if (z.edit) body.assignees = [...z.picked]; else if (m === 'selected') body.assignees = [...z.picked];
    if ((m === 'selected') && !(body.assignees || []).length) return err('Choose at least one employee.');
    if (m === 'all' && !db.task.assignable.length) return err('There are no employees to assign this task to.');
  } else if (!z.edit) body.mode = 'self';
  btn.disabled = true;
  try {
    const r = await taskCall('save', body);
    taskClose(); taskFillAll();
    taskToast(z.edit ? 'Task updated.' : r.count > 1 ? 'Task assigned to ' + r.count + ' employees.' : body.mode && body.mode !== 'self' ? 'Task created and assigned.' : 'Task created.');
  } catch (x) { if (!me) return; btn.disabled = false; err(x.message); }
}

/* ---------- delete ---------- */
async function taskDelete(id) {
  const r = tkRow(id); if (!r) return;
  if (!r.can.delete) return taskToast('You can delete only the tasks you created or assigned.', true);
  const n = r.team ? r.team.total : 1;
  const p = confirmBox({ title: 'Delete this task?', file: r.title, text: n > 1 ? 'It will be removed for all ' + n + ' employees it is assigned to, with their progress. This cannot be undone.' : 'This cannot be undone.', yes: 'Delete', no: 'Cancel' });
  const y = $id('confirm-yes'); if (y) y.className = 'btn ghost danger';
  if (!(await p)) return;
  try { await taskCall('delete', { taskId: r.taskId }); taskClose(); taskFillAll(); taskToast('Task deleted.'); }
  catch (e) { if (me) taskToast(e.message, true); }
}
