(() => {
    'use strict';

    const STORAGE_KEYS = {
        TASKS: 'taskflow_tasks_v2',
        INIT: 'taskflow_initialized_v2',
        VIEW: 'taskflow_view_v2',
        THEME: 'taskflow_theme_v2'
    };

    const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };

    const offsetDate = (days) => {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
    };

    const SAMPLE_TASKS = [
        {
            id: 't-101',
            title: 'Design system token audit',
            description: 'Review color contrast ratios and spacing tokens across light and dark themes.',
            status: 'in-progress',
            priority: 'high',
            tag: 'Design',
            dueDate: offsetDate(1),
            createdAt: Date.now() - 40000
        },
        {
            id: 't-102',
            title: 'Implement drag-and-drop board persistence',
            description: 'Ensure column transitions save immediately to local storage with zero flicker.',
            status: 'done',
            priority: 'medium',
            tag: 'Development',
            dueDate: offsetDate(-1),
            createdAt: Date.now() - 30000
        },
        {
            id: 't-103',
            title: 'Prepare sprint retrospective notes',
            description: 'Gather velocity metrics and highlight key blockers from the last two weeks.',
            status: 'todo',
            priority: 'medium',
            tag: 'Work',
            dueDate: offsetDate(3),
            createdAt: Date.now() - 20000
        },
        {
            id: 't-104',
            title: 'Patch authentication timeout bug',
            description: 'Investigate session refresh token expiration on mobile browsers.',
            status: 'todo',
            priority: 'high',
            tag: 'Urgent',
            dueDate: offsetDate(-2),
            createdAt: Date.now() - 10000
        },
        {
            id: 't-105',
            title: 'Book annual dental checkup',
            description: 'Call clinic before Friday to schedule a morning appointment.',
            status: 'todo',
            priority: 'low',
            tag: 'Personal',
            dueDate: offsetDate(7),
            createdAt: Date.now()
        }
    ];

    // Application State
    let tasks = [];
    let currentView = localStorage.getItem(STORAGE_KEYS.VIEW) || 'kanban';
    let currentTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
    let filters = {
        search: '',
        status: 'all',
        priority: 'all',
        tag: 'all',
        sort: 'newest'
    };
    let lastDeleted = null;
    let toastTimer = null;

    // Cached DOM Elements
    const dom = {
        workspace: document.getElementById('workspace'),
        taskModal: document.getElementById('taskModal'),
        taskForm: document.getElementById('taskForm'),
        searchInput: document.getElementById('searchInput'),
        statusFilter: document.getElementById('statusFilter'),
        priorityFilter: document.getElementById('priorityFilter'),
        tagFilter: document.getElementById('tagFilter'),
        sortSelect: document.getElementById('sortSelect'),
        toast: document.getElementById('toast'),
        toastMessage: document.getElementById('toastMessage'),
        undoDeleteBtn: document.getElementById('undoDeleteBtn')
    };

    // ==========================================================================
    // Persistence & Theme
    // ==========================================================================
    function loadTasks() {
        const initialized = localStorage.getItem(STORAGE_KEYS.INIT);
        if (!initialized) {
            tasks = [...SAMPLE_TASKS];
            localStorage.setItem(STORAGE_KEYS.INIT, 'true');
            saveTasks();
        } else {
            try {
                tasks = JSON.parse(localStorage.getItem(STORAGE_KEYS.TASKS)) || [];
            } catch {
                tasks = [];
            }
        }
    }

    function saveTasks() {
        localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
    }

    function applyTheme(theme) {
        currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(STORAGE_KEYS.THEME, theme);

        const label = document.getElementById('themeLabel');
        const icon = document.getElementById('themeIcon');

        if (theme === 'dark') {
            label.textContent = 'Light';
            icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
        } else {
            label.textContent = 'Dark';
            icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
        }
    }

    // ==========================================================================
    // Utilities & Filtering
    // ==========================================================================
    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function isOverdue(task) {
        if (!task.dueDate || task.status === 'done') return false;
        const today = new Date().toISOString().split('T')[0];
        return task.dueDate < today;
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'No due date';
        const [y, m, d] = dateStr.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function getFilteredAndSortedTasks() {
        const query = filters.search.trim().toLowerCase();

        const filtered = tasks.filter((task) => {
            const matchesSearch =
                !query ||
                task.title.toLowerCase().includes(query) ||
                (task.description && task.description.toLowerCase().includes(query));
            const matchesStatus = filters.status === 'all' || task.status === filters.status;
            const matchesPriority = filters.priority === 'all' || task.priority === filters.priority;
            const matchesTag = filters.tag === 'all' || task.tag === filters.tag;

            return matchesSearch && matchesStatus && matchesPriority && matchesTag;
        });

        return filtered.sort((a, b) => {
            if (filters.sort === 'due-asc') {
                if (!a.dueDate && !b.dueDate) return 0;
                if (!a.dueDate) return 1;
                if (!b.dueDate) return -1;
                return a.dueDate.localeCompare(b.dueDate);
            }
            if (filters.sort === 'priority-desc') {
                return (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0);
            }
            return (b.createdAt || 0) - (a.createdAt || 0);
        });
    }

    // ==========================================================================
    // Stats & Progress Bar
    // ==========================================================================
    function updateDashboardMetrics() {
        const total = tasks.length;
        const todo = tasks.filter((t) => t.status === 'todo').length;
        const inProgress = tasks.filter((t) => t.status === 'in-progress').length;
        const done = tasks.filter((t) => t.status === 'done').length;
        const high = tasks.filter((t) => t.priority === 'high').length;

        document.getElementById('statTotal').textContent = total;
        document.getElementById('statTodo').textContent = todo;
        document.getElementById('statProgress').textContent = inProgress;
        document.getElementById('statDone').textContent = done;
        document.getElementById('statHigh').textContent = high;

        const pct = total ? Math.round((done / total) * 100) : 0;
        document.getElementById('progressFill').style.width = `${pct}%`;
        document.getElementById('progressText').textContent = `${pct}% (${done} of ${total} tasks)`;
        document.getElementById('progressBar').setAttribute('aria-valuenow', String(pct));

        document.querySelectorAll('.stat-card').forEach((card) => {
            const type = card.dataset.statFilter;
            let active = false;
            if (type === 'all' && filters.status === 'all' && filters.priority === 'all') active = true;
            if (type === `status:${filters.status}`) active = true;
            if (type === `priority:${filters.priority}`) active = true;
            card.classList.toggle('active-stat', active);
        });
    }

    // ==========================================================================
    // Renderers
    // ==========================================================================
    function renderCardHTML(task) {
        const overdue = isOverdue(task);
        const nextStatusLabel =
            task.status === 'todo' ? 'Move to In Progress' : task.status === 'in-progress' ? 'Mark Complete' : 'Reopen Task';

        return `
      <article class="task-card ${task.status === 'done' ? 'is-done' : ''}" draggable="true" data-id="${task.id}">
        <div class="task-card-top">
          <input type="checkbox" class="task-checkbox" ${task.status === 'done' ? 'checked' : ''} data-action="toggle" data-id="${task.id}" aria-label="Toggle task completion" />
          <div class="task-title">${escapeHTML(task.title)}</div>
        </div>
        ${task.description ? `<p class="task-desc">${escapeHTML(task.description)}</p>` : ''}
        <div class="task-badges">
          <span class="badge badge-priority-${task.priority}">${task.priority}</span>
          <span class="badge badge-tag">${escapeHTML(task.tag)}</span>
          ${overdue ? `<span class="badge badge-overdue">Overdue</span>` : ''}
        </div>
        <div class="task-footer">
          <span class="due-date ${overdue ? 'overdue' : ''}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            ${formatDate(task.dueDate)}
          </span>
          <div class="task-actions">
            <button class="icon-btn" data-action="advance" data-id="${task.id}" title="${nextStatusLabel}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
            <button class="icon-btn" data-action="edit" data-id="${task.id}" title="Edit task">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="icon-btn delete" data-action="delete" data-id="${task.id}" title="Delete task">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      </article>
    `;
    }

    function renderKanban(filtered) {
        const columns = [
            { key: 'todo', label: 'To Do', color: 'var(--text-muted)' },
            { key: 'in-progress', label: 'In Progress', color: 'var(--info)' },
            { key: 'done', label: 'Completed', color: 'var(--success)' }
        ];

        dom.workspace.innerHTML = `
      <div class="kanban-board">
        ${columns
                .map((col) => {
                    const colTasks = filtered.filter((t) => t.status === col.key);
                    return `
              <section class="kanban-column">
                <div class="column-header">
                  <div class="column-title-wrap">
                    <span class="stat-dot" style="background: ${col.color};"></span>
                    <span>${col.label}</span>
                  </div>
                  <span class="column-count">${colTasks.length}</span>
                </div>
                <div class="kanban-dropzone" data-status="${col.key}">
                  ${colTasks.length ? colTasks.map(renderCardHTML).join('') : `<div class="empty-state">Drop tasks here</div>`}
                </div>
              </section>
            `;
                })
                .join('')}
      </div>
    `;

        bindDragAndDrop();
    }

    function renderList(filtered) {
        const statusLabels = {
            todo: 'To Do',
            'in-progress': 'In Progress',
            done: 'Completed'
        };

        dom.workspace.innerHTML = `
      <div class="list-view-wrap">
        <table>
          <thead>
            <tr>
              <th style="width: 40px;"></th>
              <th>Task</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Tag</th>
              <th>Due Date</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length
                ? filtered
                    .map((task) => {
                        const overdue = isOverdue(task);
                        return `
                        <tr>
                          <td>
                            <input type="checkbox" class="task-checkbox" ${task.status === 'done' ? 'checked' : ''} data-action="toggle" data-id="${task.id}" />
                          </td>
                          <td>
                            <div style="font-weight: 600; ${task.status === 'done' ? 'text-decoration: line-through; color: var(--text-muted);' : ''}">
                              ${escapeHTML(task.title)}
                            </div>
                            ${task.description ? `<div style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHTML(task.description)}</div>` : ''}
                          </td>
                          <td><span class="status-pill status-${task.status}">${statusLabels[task.status]}</span></td>
                          <td><span class="badge badge-priority-${task.priority}">${task.priority}</span></td>
                          <td><span class="badge badge-tag">${escapeHTML(task.tag)}</span></td>
                          <td>
                            <span class="due-date ${overdue ? 'overdue' : ''}">
                              ${formatDate(task.dueDate)} ${overdue ? '(Overdue)' : ''}
                            </span>
                          </td>
                          <td style="text-align: right; white-space: nowrap;">
                            <button class="icon-btn" data-action="advance" data-id="${task.id}" title="Advance status">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="9 18 15 12 9 6"></polyline>
                              </svg>
                            </button>
                            <button class="icon-btn" data-action="edit" data-id="${task.id}" title="Edit task">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                              </svg>
                            </button>
                            <button class="icon-btn delete" data-action="delete" data-id="${task.id}" title="Delete task">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                              </svg>
                            </button>
                          </td>
                        </tr>
                      `;
                    })
                    .join('')
                : `<tr><td colspan="7" class="empty-state">No matching tasks found.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;
    }

    function render() {
        updateDashboardMetrics();
        const visibleTasks = getFilteredAndSortedTasks();
        document.getElementById('kanbanViewBtn').classList.toggle('active', currentView === 'kanban');
        document.getElementById('listViewBtn').classList.toggle('active', currentView === 'list');

        if (currentView === 'kanban') {
            renderKanban(visibleTasks);
        } else {
            renderList(visibleTasks);
        }
    }

    // ==========================================================================
    // Drag & Drop Controller
    // ==========================================================================
    function bindDragAndDrop() {
        document.querySelectorAll('.task-card').forEach((card) => {
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', card.dataset.id);
                card.classList.add('dragging');
            });

            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
            });
        });

        document.querySelectorAll('.kanban-dropzone').forEach((zone) => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                zone.classList.add('drag-over');
            });

            zone.addEventListener('dragleave', () => {
                zone.classList.remove('drag-over');
            });

            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                const id = e.dataTransfer.getData('text/plain');
                const newStatus = zone.dataset.status;
                const task = tasks.find((t) => t.id === id);

                if (task && task.status !== newStatus) {
                    task.status = newStatus;
                    saveTasks();
                    render();
                }
            });
        });
    }

    // ==========================================================================
    // Modal, Toast & JSON Backup/Restore
    // ==========================================================================
    function openModal(task = null) {
        document.getElementById('modalTitle').textContent = task ? 'Edit Task' : 'New Task';
        document.getElementById('taskId').value = task ? task.id : '';
        document.getElementById('taskTitle').value = task ? task.title : '';
        document.getElementById('taskDesc').value = task ? task.description || '' : '';
        document.getElementById('taskStatus').value = task ? task.status : 'todo';
        document.getElementById('taskPriority').value = task ? task.priority : 'medium';
        document.getElementById('taskTag').value = task ? task.tag : 'Work';
        document.getElementById('taskDueDate').value = task ? task.dueDate || '' : '';

        dom.taskModal.classList.add('open');
        setTimeout(() => document.getElementById('taskTitle').focus(), 30);
    }

    function closeModal() {
        dom.taskModal.classList.remove('open');
        dom.taskForm.reset();
    }

    function showNotification(message, allowUndo = false) {
        clearTimeout(toastTimer);
        dom.toastMessage.textContent = message;
        dom.undoDeleteBtn.style.display = allowUndo ? 'inline-block' : 'none';
        dom.toast.classList.add('show');

        toastTimer = setTimeout(() => {
            dom.toast.classList.remove('show');
            lastDeleted = null;
        }, 5000);
    }

    function deleteTask(id) {
        const index = tasks.findIndex((t) => t.id === id);
        if (index === -1) return;
        const [removed] = tasks.splice(index, 1);
        lastDeleted = { task: removed, index };
        saveTasks();
        render();
        showNotification('Task deleted', true);
    }

    function exportTasksJSON() {
        const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `taskflow-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification('Exported tasks to JSON');
    }

    function importTasksJSON(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                if (!Array.isArray(parsed)) throw new Error('Invalid format');
                tasks = parsed.filter((item) => item && typeof item.title === 'string');
                saveTasks();
                render();
                showNotification(`Imported ${tasks.length} tasks`);
            } catch {
                showNotification('Invalid JSON backup file');
            }
        };
        reader.readAsText(file);
    }

    // ==========================================================================
    // Event Bindings
    // ==========================================================================
    function bindEvents() {
        document.getElementById('themeToggle').addEventListener('click', () => {
            applyTheme(currentTheme === 'light' ? 'dark' : 'light');
        });

        document.getElementById('exportBtn').addEventListener('click', exportTasksJSON);
        document.getElementById('importInput').addEventListener('change', (e) => {
            importTasksJSON(e.target.files[0]);
            e.target.value = '';
        });

        document.getElementById('openNewTaskBtn').addEventListener('click', () => openModal());
        document.getElementById('closeModalBtn').addEventListener('click', closeModal);
        document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

        dom.taskModal.addEventListener('click', (e) => {
            if (e.target === dom.taskModal) closeModal();
        });

        dom.taskForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('taskId').value;
            const payload = {
                title: document.getElementById('taskTitle').value.trim(),
                description: document.getElementById('taskDesc').value.trim(),
                status: document.getElementById('taskStatus').value,
                priority: document.getElementById('taskPriority').value,
                tag: document.getElementById('taskTag').value,
                dueDate: document.getElementById('taskDueDate').value
            };

            if (!payload.title) return;

            if (id) {
                const existing = tasks.find((t) => t.id === id);
                if (existing) Object.assign(existing, payload);
            } else {
                tasks.unshift({
                    id: 't-' + Date.now(),
                    createdAt: Date.now(),
                    ...payload
                });
            }

            saveTasks();
            closeModal();
            render();
        });

        dom.workspace.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const { action, id } = target.dataset;
            const task = tasks.find((t) => t.id === id);
            if (!task) return;

            if (action === 'toggle') {
                task.status = task.status === 'done' ? 'todo' : 'done';
                saveTasks();
                render();
            } else if (action === 'advance') {
                const order = ['todo', 'in-progress', 'done'];
                task.status = order[(order.indexOf(task.status) + 1) % order.length];
                saveTasks();
                render();
            } else if (action === 'edit') {
                openModal(task);
            } else if (action === 'delete') {
                deleteTask(id);
            }
        });

        dom.undoDeleteBtn.addEventListener('click', () => {
            if (!lastDeleted) return;
            tasks.splice(lastDeleted.index, 0, lastDeleted.task);
            lastDeleted = null;
            clearTimeout(toastTimer);
            dom.toast.classList.remove('show');
            saveTasks();
            render();
        });

        dom.searchInput.addEventListener('input', (e) => {
            filters.search = e.target.value;
            render();
        });

        dom.statusFilter.addEventListener('change', (e) => {
            filters.status = e.target.value;
            render();
        });

        dom.priorityFilter.addEventListener('change', (e) => {
            filters.priority = e.target.value;
            render();
        });

        dom.tagFilter.addEventListener('change', (e) => {
            filters.tag = e.target.value;
            render();
        });

        dom.sortSelect.addEventListener('change', (e) => {
            filters.sort = e.target.value;
            render();
        });

        document.getElementById('resetFiltersBtn').addEventListener('click', () => {
            filters = { search: '', status: 'all', priority: 'all', tag: 'all', sort: 'newest' };
            dom.searchInput.value = '';
            dom.statusFilter.value = 'all';
            dom.priorityFilter.value = 'all';
            dom.tagFilter.value = 'all';
            dom.sortSelect.value = 'newest';
            render();
        });

        document.querySelectorAll('.stat-card').forEach((card) => {
            card.addEventListener('click', () => {
                const type = card.dataset.statFilter;
                if (type === 'all') {
                    filters.status = 'all';
                    filters.priority = 'all';
                } else if (type.startsWith('status:')) {
                    const val = type.split(':')[1];
                    filters.status = filters.status === val ? 'all' : val;
                    filters.priority = 'all';
                } else if (type.startsWith('priority:')) {
                    const val = type.split(':')[1];
                    filters.priority = filters.priority === val ? 'all' : val;
                    filters.status = 'all';
                }
                dom.statusFilter.value = filters.status;
                dom.priorityFilter.value = filters.priority;
                render();
            });
        });

        document.querySelectorAll('.view-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                currentView = btn.dataset.view;
                localStorage.setItem(STORAGE_KEYS.VIEW, currentView);
                render();
            });
        });

        document.addEventListener('keydown', (e) => {
            const tag = document.activeElement.tagName;
            const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);

            if (e.key === 'Escape' && dom.taskModal.classList.contains('open')) {
                closeModal();
            } else if (!isTyping && (e.key === 'n' || e.key === 'N') && !dom.taskModal.classList.contains('open')) {
                e.preventDefault();
                openModal();
            } else if (!isTyping && e.key === '/' && !dom.taskModal.classList.contains('open')) {
                e.preventDefault();
                dom.searchInput.focus();
            }
        });
    }

    // Initialize Application
    applyTheme(currentTheme);
    loadTasks();
    bindEvents();
    render();
})();