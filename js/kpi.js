/* KPI Matrix: positions, KRAs, KPIs, results, the KPI Calculation Assistant, SLA criteria and the guide.
   Only the admin (Admin > KPI Matrix) and immediate heads / supervisors (top menu > KPI Matrix) can open it.
   The screens are templates in index.html. Every number is calculated by the server (api/kpi_lib.php), this file only shows it. */
const KPI_TABS = [['dash', 'Dashboard & Compute'], ['setup', 'Setup'], ['sla', 'SLA'], ['guide', 'Guide']];
const KPI_BAND_CLS = { strong: 'green', partial: 'orange', missed: 'red', none: 'gray' };
const KPI_FILL_CLS = { strong: 'f-strong', partial: 'f-partial', missed: 'f-missed', none: '' };
const KPI_STATUS_CLS = { Met: 'green', Partial: 'orange', Missed: 'red' };
const kn = (v) => (v === null || v === undefined ? '-' : String(Math.round(v * 100) / 100));
const f1 = (v) => (v === null || v === undefined ? '-' : Number(v).toFixed(1) + '%');
const kpiHome = () => (me.role === 'admin' ? '/admin' : '/home');
const kpiCloseForm = (name) => { const el = document.querySelector('[data-slot="' + name + '"]'); if (el) el.replaceChildren(); };
const kpiTargetText = (i) => (i.direction === 'lower' ? '≤ ' : '') + Number(i.target).toFixed(1) + (i.unit && i.unit !== '%' ? ' ' + i.unit : '%');

function kpiSel() { // the position that is open (the first one if none was chosen yet)
  const list = db.kpi.positions; if (!list.length) { ui.kpiPos = null; return null; }
  let p = list.find((x) => x.id === ui.kpiPos); if (!p) { p = list[0]; ui.kpiPos = p.id; }
  return p;
}
function kpiYearSel() { if (!db.kpi.years.includes(Number(ui.kpiYear))) ui.kpiYear = db.kpi.currentYear; return Number(ui.kpiYear); }
const kpiCalc = (p) => p.calc[String(kpiYearSel())];

/* ---------- the page: year, position chips, tabs ---------- */
function kpiPage() {
  const k = db.kpi;
  if (!k) return message('KPI Matrix', db.kpiSetup ? 'The KPI Matrix database needs to be set up. In phpMyAdmin, import migration_kpi.sql (first time only) and then migration_kpi_v2.sql, and reload this page.' : 'Only the administrator and immediate heads / supervisors can open this page.', kpiHome(), 'Back');
  const tab = KPI_TABS.some((t) => t[0] === ui.kpiTab) ? ui.kpiTab : 'dash', p = kpiSel(), year = kpiYearSel();
  const f = tpl('tpl-kpi-page', {
    due: k.review.due, dueTitle: 'Yearly KPI review for ' + k.review.year + '.', dueText: 'Check the positions, KRAs, KPI targets and weights, enter the results, then mark the review as done.',
    years: k.years.map((y) => ({ v: y })), positions: k.positions.map((x) => ({ id: x.id, name: x.name, cls: p && p.id === x.id ? 'on' : '' })), hasPos: !!k.positions.length,
    tabs: KPI_TABS.map((t) => ({ key: t[0], label: t[1], cls: tab === t[0] ? 'on' : '' }))
  });
  f.querySelector('#kpi-year').value = year;
  if (ui.kpiQuick) { const q = ui.kpiQuick; ui.kpiQuick = null; setTimeout(() => kpiRunQuick(q), 0); } // Add position / KRA / KPI chosen from the top menu
  slot(f, 'body', tab === 'sla' ? kpiSla() : tab === 'guide' ? kpiGuide() : !p ? tpl('tpl-kpi-empty') : tab === 'setup' ? kpiSetup(p) : kpiDash(p));
  return f;
}
function kpiTab(t) { kpiCalcClose(); ui.kpiTab = t; render(); }
function kpiPick(id) { kpiCalcClose(); ui.kpiPos = id; ui.kpiScale = null; render(); }
function kpiYear(y) { kpiCalcClose(); ui.kpiYear = Number(y); render(); }
const kpiReviewDone = () => call('kpi', 'complete_review', {});

/* ---------- positions ---------- */
function kpiPositionForm(id) {
  const p = id ? db.kpi.positions.find((x) => x.id === id) : null;
  slot(document, 'pform', tpl('tpl-kpi-position-form', { id: id || '', name: p ? p.name : '' })); $id('kp-name').focus();
}
const kpiRenamePosition = () => kpiPositionForm(ui.kpiPos);
async function kpiSavePosition(e, id) {
  e.preventDefault(); const name = $id('kp-name').value.trim();
  if (!name) return say('kperr', 'red', 'Enter the position name.');
  const r = await call('kpi', 'save_position', { id, name }, 'kperr');
  if (r && r.id) { ui.kpiPos = r.id; ui.kpiScale = null; render(); }
}
function kpiDeletePosition() {
  const p = kpiSel(); if (!p) return;
  if (!confirm('Delete the position "' + p.name + '"?\n\nAll its KRAs, KPIs, saved results (every year) and its partial-credit scale will be permanently deleted. This cannot be undone.')) return;
  ui.kpiPos = null; ui.kpiScale = null; call('kpi', 'delete_position', { id: p.id });
}

/* ---------- dashboard and compute: the matrix of the ITD-KPI sheet ---------- */
function kpiDash(p) {
  const c = kpiCalc(p), year = kpiYearSel(), empty = !c.kras.length, noKpi = c.kras.filter((k) => !k.active).map((k) => 'KRA ' + k.no);
  const warn = [c.allocated !== 100 && !empty ? 'The KRA weights add up to ' + kn(c.allocated) + '%, not 100%. The overall performance is calculated on the weight that is allocated.' : '', noKpi.length ? noKpi.join(', ') + (noKpi.length > 1 ? ' have' : ' has') + ' no active KPI, so that weight cannot be earned.' : ''].filter(Boolean).join(' ');
  const rows = [];
  c.kras.forEach((k) => {
    rows.push({ isKra: true, cls: 'mx-kra-row', no: k.no, name: k.name, meta: 'KRA weight ' + f1(k.weight) + ' · ' + f1(k.earned) + ' earned', bandLabel: k.band.label, bandCls: KPI_BAND_CLS[k.band.key], note: k.active ? '' : 'This KRA has no active KPIs, so its weight cannot be earned.' });
    k.kpis.forEach((i, n) => rows.push({ isKpi: true, id: i.id, cls: 'mx-kpi' + (i.active ? '' : ' muted'), no: k.no + '.' + (n + 1), name: i.name, sla: i.slaText ? 'SLA: ' + i.slaText : '', evidence: i.evidence ? 'Evidence: ' + i.evidence : '',
      target: kpiTargetText(i), weight: i.active ? f1(i.weight) : '-', actualText: i.actual === null ? '-' : kn(i.actual) + (i.unit && i.unit !== '%' ? ' ' + i.unit : '%'), locked: !i.active,
      reached: i.ratio === null ? '-' : i.status === 'Met' ? '100%' : i.ratio.toFixed(1) + '%', earned: i.active ? f1(i.earned) : '-', status: i.status, statusCls: KPI_STATUS_CLS[i.status] || 'gray' }));
    rows.push({ isSub: true, cls: 'mx-sub', name: 'Subtotal', weight: f1(k.kpis.reduce((t, i) => t + (i.active ? i.weight : 0), 0)), earned: f1(k.earned), status: k.band.label, statusCls: KPI_BAND_CLS[k.band.key] });
  });
  if (!empty) rows.push({ isSub: true, cls: 'mx-total', name: 'TOTAL', weight: f1(c.allocated), earned: f1(c.earned), status: c.band.label, statusCls: KPI_BAND_CLS[c.band.key] });
  return tpl('tpl-kpi-dash', {
    stats: [
      { label: 'Total Weight Allocated', value: f1(c.allocated), sub: c.allocated === 100 ? 'Target: 100.0% Framework' : c.allocated < 100 ? f1(100 - c.allocated) + ' still to allocate' : 'Must not be more than 100%', cls: '' },
      { label: 'Active KPIs', value: String(c.activeKpis), sub: c.kras.length + ' KRA(s) · ' + c.measured + ' / ' + c.activeKpis + ' with results (' + year + ')', cls: '' },
      { label: 'Overall Performance', value: f1(c.pct), sub: 'Weighted Achievement Score · ' + kn(c.earned) + ' of ' + kn(c.allocated) + ' pts', cls: 'kh-hi' }],
    bandLabel: c.band.label, bandText: c.band.text, bandCls: KPI_BAND_CLS[c.band.key], fillCls: KPI_FILL_CLS[c.band.key], pct: Math.min(100, c.pct), warn, empty, emptyText: 'This position has no KRAs yet. Open the Setup tab to add its KRAs and KPIs.', rows,
    how: ['Each KPI earns 100% of its KPI weight when its target is met. Below the target it earns nothing, unless the position has an approved partial-credit scale (Setup tab).',
      'The weight of a KRA is shared equally between its KPIs, unless a KPI has its own KPI Weight (only when management approved a different weighting).',
      'Overall performance = total earned points ÷ total weight allocated × 100.',
      'KPIs without a result count as 0 until a result is applied. Press the calculator button next to a KPI to compute its result with the KPI Calculation Assistant.'].map((t) => ({ t }))
  });
}
async function kpiSaveResults(e) {
  e.preventDefault(); const p = kpiSel(), results = {};
  document.querySelectorAll('#kpi-results .kpi-in').forEach((el) => { if (!el.disabled) results[el.dataset.kpi] = el.value.trim(); });
  const r = await call('kpi', 'save_results', { positionId: p.id, year: kpiYearSel(), results }, 'kresmsg');
  if (r) say('kresmsg', 'green', 'Results saved. The scores above were calculated again.');
}

/* ---------- KPI Calculation Assistant ---------- */
let kc = null; // the KPI that is open in the assistant: { id, model, target, direction }
const kcNum = (id) => { const el = $id(id); if (!el || el.value.trim() === '') return null; const v = Number(el.value); return isNaN(v) ? null : v; };
function kpiFind(id) {
  const p = kpiSel(); if (!p) return null;
  for (const k of kpiCalc(p).kras) { const i = k.kpis.find((x) => x.id === id); if (i) return { k, i }; }
  return null;
}
const kpiOrder = () => kpiCalc(kpiSel()).kras.flatMap((k) => k.kpis.filter((x) => x.active)); // the order the "Apply & Next KPI" button follows
function kpiCalcOpen(id) {
  const f = kpiFind(id); if (!f || !f.i.active) return;
  kpiCalcClose();
  const { k, i } = f;
  kc = { id, model: 'ratio', target: i.target, direction: i.direction };
  const root = document.createElement('div'); root.id = 'kc-root';
  root.appendChild(tpl('tpl-kpi-calc', { subtitle: k.name + ' • Target: ' + Number(i.target).toFixed(1) + '% • Weight: ' + Number(i.weight).toFixed(1) + '%', name: i.name }));
  document.body.appendChild(root); document.body.classList.add('kc-open');
  $id('kc-den').value = 100; $id('kc-up-total').value = 720; $id('kc-cs-max').value = 5;
  if (i.actual !== null) { $id('kc-num').value = i.actual; $id('kc-direct').value = i.actual; $id('kc-slider').value = i.actual; }
  kcModel('ratio'); $id('kc-num').focus();
}
function kpiCalcClose() {
  const r = $id('kc-root'); if (r) r.remove();
  document.body.classList.remove('kc-open'); kc = null;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && kc) kpiCalcClose(); });
window.addEventListener('hashchange', kpiCalcClose);

function kcModel(m) {
  kc.model = m;
  document.querySelectorAll('#kc-root .kc-model').forEach((b) => { const on = b.dataset.m === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  ['ratio', 'uptime', 'csat', 'direct'].forEach((x) => $id('kc-p-' + x).classList.toggle('hidden', x !== m));
  kcUpdate();
}
function kcPreset(a, b) { // fills the boxes of the open model
  const ids = { ratio: ['kc-num', 'kc-den'], uptime: ['kc-up-total', 'kc-up-down'], csat: ['kc-cs-rating', 'kc-cs-max'], direct: ['kc-direct'] }[kc.model];
  $id(ids[0]).value = a; if (ids[1]) $id(ids[1]).value = b;
  if (kc.model === 'direct') $id('kc-slider').value = a;
  kcUpdate();
}
function kcSlide(v) { $id('kc-direct').value = v; kcUpdate(); }
function kcDirectType() { const v = kcNum('kc-direct'); $id('kc-slider').value = v === null ? 0 : v; kcUpdate(); }
function kcCompute() { // { raw } is the share between 0 and 1, or { raw: null, err } when the boxes are empty or not valid
  const m = kc.model;
  if (m === 'ratio') {
    const a = kcNum('kc-num'), d = kcNum('kc-den'); if (a === null || d === null) return { raw: null };
    if (!(d > 0)) return { raw: null, err: 'The denominator must be more than 0.' };
    if (a < 0 || a > d) return { raw: null, err: 'The numerator must be between 0 and the denominator.' };
    return { raw: a / d };
  }
  if (m === 'uptime') {
    const t = kcNum('kc-up-total'), d = kcNum('kc-up-down'); if (t === null || d === null) return { raw: null };
    if (!(t > 0)) return { raw: null, err: 'The total hours must be more than 0.' };
    if (d < 0 || d > t) return { raw: null, err: 'The downtime must be between 0 and the total hours.' };
    return { raw: (t - d) / t };
  }
  if (m === 'csat') {
    const r = kcNum('kc-cs-rating'), x = kcNum('kc-cs-max'); if (r === null || x === null) return { raw: null };
    if (!(x > 0)) return { raw: null, err: 'The maximum rating must be more than 0.' };
    if (r < 0 || r > x) return { raw: null, err: 'The rating must be between 0 and the maximum rating.' };
    return { raw: r / x };
  }
  const v = kcNum('kc-direct'); if (v === null) return { raw: null };
  if (v < 0 || v > 100) return { raw: null, err: 'The result must be between 0 and 100.' };
  return { raw: v / 100 };
}
function kcUpdate() { // runs on every key press: the score recalculates by itself
  if (!kc) return;
  const r = kcCompute(), t = Number(kc.target), score = $id('kc-score'), verdict = $id('kc-verdict');
  $id('kc-hint').textContent = r.err || ''; $id('kc-target').textContent = 'Target is ' + t.toFixed(1) + '%';
  $id('kc-apply').disabled = $id('kc-next').disabled = r.raw === null;
  if (r.raw === null) { score.textContent = '--'; $id('kc-raw').textContent = ''; verdict.textContent = ''; verdict.className = ''; return; }
  const s = Math.round(r.raw * 10000) / 100, ok = kc.direction === 'lower' ? s <= t : s >= t;
  score.textContent = s.toFixed(2) + '%'; $id('kc-raw').textContent = '(raw: ' + r.raw.toFixed(4) + ')';
  verdict.textContent = '• ' + (ok ? 'Meets Target Objective' : 'Below Target Objective'); verdict.className = ok ? 'kc-ok' : 'kc-bad';
}
async function kcApply(next) {
  if (!kc) return;
  const r = kcCompute(); if (r.raw === null) { $id('kc-hint').textContent = r.err || 'Enter the values first.'; return; }
  const order = kpiOrder(), at = order.findIndex((x) => x.id === kc.id), nextId = at >= 0 && order[at + 1] ? order[at + 1].id : null;
  const done = await call('kpi', 'save_result', { kpiId: kc.id, year: kpiYearSel(), actual: Math.round(r.raw * 10000) / 100 }, 'kc-err');
  if (!me) { kpiCalcClose(); return; }
  if (!done) return;
  if (next && nextId) kpiCalcOpen(nextId); else kpiCalcClose();
}

/* ---------- setup: KRAs, KPIs, partial-credit scale ---------- */
function kpiSetup(p) {
  const c = kpiCalc(p), d = kpiScaleDraft(p);
  const f = tpl('tpl-kpi-setup', {
    posName: p.name, posInfo: c.kras.length + ' KRA(s) · ' + c.totalKpis + ' KPI(s) · weight allocated ' + kn(c.allocated) + '% of 100%', noKras: !c.kras.length,
    kras: c.kras.map((k) => ({ id: k.id, no: k.no, name: k.name, weightText: 'KRA weight ' + f1(k.weight), note: k.kpis.length ? k.active + ' active of ' + k.kpis.length + ' KPI(s)' : '', noKpis: !k.kpis.length,
      kpis: k.kpis.map((i, n) => ({ id: i.id, kra: k.id, no: k.no + '.' + (n + 1), name: i.name, sla: i.slaText ? 'SLA: ' + i.slaText : '', target: kpiTargetText(i), inactive: !i.active,
        weight: i.active ? f1(i.weight) + (i.customWeight !== null ? '' : ' (shared)') : '-' })) }))
  });
  slot(f, 'scale', tpl('tpl-kpi-scale', { rows: d.rows.map((r, i) => ({ i, min: r.min, credit: r.credit })), noRows: !d.rows.length, isOpen: d.rows.length > 0 }));
  return f;
}
function kpiKraForm(id) {
  const c = kpiCalc(kpiSel()), k = id ? c.kras.find((x) => x.id === id) : null, used = c.allocated - (k ? k.weight : 0);
  slot(document, 'kform', tpl('tpl-kpi-kra-form', { id: id || '', heading: k ? 'Edit KRA' : 'New KRA', no: k ? k.no : Math.max(0, ...c.kras.map((x) => x.no)) + 1, name: k ? k.name : '', weight: k ? k.weight : '',
    hint: 'The other KRAs use ' + kn(used) + '%, so this KRA can have up to ' + kn(100 - used) + '%. All KRA weights of a position should add up to 100%.' }));
  $id('kr-weight').max = Math.max(0, 100 - used); $id('kr-name').focus();
}
// a weight can never go over what is left: the KRA weights of a position add up to at most 100%, the KPI weights of a KRA to at most the KRA weight
function kpiCap(input) {
  const m = Number(input.max); if (input.value !== '' && Number(input.value) > m) { input.value = m > 0 ? m : ''; say('kkerr', 'red', 'The total cannot go over ' + kn(Number(input.dataset.limit) || m) + '%. The weight was lowered to what is left (' + kn(m) + '%).'); }
}
function kpiSaveKra(e, id) {
  e.preventDefault(); const name = $id('kr-name').value.trim(), w = $id('kr-weight').value;
  if (!name) return say('kkerr', 'red', 'Enter the KRA name.');
  if (w === '' || !(Number(w) > 0)) return say('kkerr', 'red', 'Enter the KRA weight (more than 0).');
  call('kpi', 'save_kra', { positionId: kpiSel().id, id, kraNo: $id('kr-no').value, name, weight: w }, 'kkerr');
}
function kpiDeleteKra(id) {
  const k = kpiCalc(kpiSel()).kras.find((x) => x.id === id); if (!k) return;
  if (confirm('Delete KRA ' + k.no + ': ' + k.name + '?\n\nIts ' + k.kpis.length + ' KPI(s) and their saved results (every year) will be permanently deleted. This cannot be undone.')) call('kpi', 'delete_kra', { id });
}
// the top menu: KPI Matrix > Add position / Add KRA / Add KPI
function kpiQuick(kind) {
  ui.kpiQuick = kind; if (kind !== 'position') ui.kpiTab = 'setup';
  const path = me.role === 'admin' ? '/admin/kpi' : '/kpi'; if (location.hash === '#' + path) render(); else go(path);
  return false;
}
function kpiRunQuick(kind) {
  const p = kpiSel(), toForm = () => { const s = document.querySelector('[data-slot="kform"],[data-slot="pform"]'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  if (kind === 'position') { kpiPositionForm(); return toForm(); }
  if (!p) { popup('Add a position first', 'A KRA belongs to a position, so create the position first.'); return kpiPositionForm(); }
  if (kind === 'kra') { kpiKraForm(); return toForm(); }
  const kras = kpiCalc(p).kras;
  if (!kras.length) { popup('Add a KRA first', 'A KPI belongs to a KRA, so add the KRA first.'); kpiKraForm(); return toForm(); }
  kpiKpiForm(kras[0].id); toForm();
}
function kpiKpiForm(kraId, id) {
  const allKras = kpiCalc(kpiSel()).kras, kra = allKras.find((x) => x.id === kraId), k = id ? kra.kpis.find((x) => x.id === id) : null;
  const own = kra.kpis.filter((x) => x.active && x.customWeight !== null && x.id !== id).reduce((t, x) => t + x.customWeight, 0);
  slot(document, 'kform', tpl('tpl-kpi-form', { pickKra: !id && allKras.length > 1, kraOpts: allKras.map((x) => ({ id: x.id, label: 'KRA ' + x.no + ': ' + x.name })), id: id || '', kra: kraId, heading: (k ? 'Edit KPI' : 'New KPI') + ' in KRA ' + kra.no + ': ' + kra.name, name: k ? k.name : '', target: k ? k.target : '', customWeight: k && k.customWeight !== null ? k.customWeight : '',
    hint: 'KRA weight ' + f1(kra.weight) + '.' + (own ? ' KPIs that have their own weight already use ' + f1(own) + '.' : '') + ' Leave the KPI Weight empty to share the rest of the KRA weight equally between its KPIs.' }));
  if ($id('kk-kra')) $id('kk-kra').value = kraId;
  $id('kk-weight').max = Math.max(0, kra.weight - own); $id('kk-name').focus();
}
function kpiSaveKpi(e, id, kraId) {
  e.preventDefault();
  const v = { id, kraId, name: $id('kk-name').value.trim(), target: $id('kk-target').value.trim(), customWeight: $id('kk-weight').value.trim() };
  if (!v.name) return say('kkerr', 'red', 'Enter the Specific KPI.');
  if (v.target === '' || isNaN(Number(v.target))) return say('kkerr', 'red', 'Enter the target as a number.');
  call('kpi', 'save_kpi', v, 'kkerr');
}
function kpiDeleteKpi(id) {
  let name = ''; kpiCalc(kpiSel()).kras.forEach((k) => k.kpis.forEach((i) => { if (i.id === id) name = i.name; }));
  if (confirm('Delete the KPI "' + name + '"?\n\nIts saved results (every year) will be permanently deleted. This cannot be undone.')) call('kpi', 'delete_kpi', { id });
}
/* the partial-credit scale is edited as a draft (ui.kpiScale); what was typed is read back from the page before every redraw */
function kpiScaleDraft(p) { if (!ui.kpiScale || ui.kpiScale.pos !== p.id) ui.kpiScale = { pos: p.id, rows: p.scale.map((r) => ({ min: r.min, credit: r.credit })) }; return ui.kpiScale; }
function kpiCollectScale() { if (!$id('kpi-scale') || !ui.kpiScale) return; ui.kpiScale.rows = [...document.querySelectorAll('#kpi-scale .scrow')].map((b) => ({ min: b.querySelector('[data-f="min"]').value, credit: b.querySelector('[data-f="credit"]').value })); }
function kpiAddScaleRow() { kpiCollectScale(); ui.kpiScale.rows.push({ min: '', credit: '' }); render(); }
function kpiDelScaleRow(i) { kpiCollectScale(); ui.kpiScale.rows.splice(Number(i), 1); render(); }
async function kpiSaveScale(e) {
  e.preventDefault(); kpiCollectScale();
  const p = kpiSel(), rows = ui.kpiScale.rows.filter((r) => String(r.min) !== '' || String(r.credit) !== '');
  ui.kpiScale = null; // after a successful save the page is drawn again from the saved data
  const r = await call('kpi', 'save_scale', { positionId: p.id, rows }, 'ksmsg');
  if (r) say('ksmsg', 'green', 'Scale saved. The scores were calculated again.');
  else ui.kpiScale = { pos: p.id, rows }; // keep what was typed so it can be corrected
}

/* ---------- SLA criteria: add, edit, remove a priority ---------- */
const KPI_SLA_CLS = { Critical: 'red', High: 'orange', Medium: 'blue', Low: 'gray' };
function kpiSla() {
  const f = tpl('tpl-kpi-sla');
  slot(f, 'slatable', tableFrag('', ['Priority', 'Description', 'Examples', 'First Response', 'Resolution Target', '', ''],
    db.kpi.sla.map((r) => [bd(r.priority, KPI_SLA_CLS[r.priority] || 'gray'), { v: r.description }, { v: r.examples }, { v: r.firstResponse }, { v: r.resolution }, { btn: 'Edit', act: 'kpiSlaForm', id: r.priority }, { btn: 'Remove', act: 'kpiSlaDelete', id: r.priority }]),
    'When a KPI is linked to an SLA priority, the SLA target is shown next to it in the matrix. Removing a priority also removes that link from the KPIs that used it.'));
  return f;
}
function kpiSlaForm(priority) { // with a priority name: edit it. Without: add a new one
  const r = priority ? db.kpi.sla.find((x) => x.priority === priority) : null; if (priority && !r) return;
  slot(document, 'slaform', tpl('tpl-kpi-sla-form', { original: r ? r.priority : '', heading: r ? 'Edit SLA priority: ' + r.priority : 'New SLA priority', priority: r ? r.priority : '', description: r ? r.description : '', examples: r ? r.examples : '', firstResponse: r ? r.firstResponse : '', resolution: r ? r.resolution : '' }));
  $id('ks-name').focus();
}
function kpiSaveSla(e, original) {
  e.preventDefault();
  const v = { original: original || '', priority: $id('ks-name').value.trim(), description: $id('ks-desc').value.trim(), examples: $id('ks-examples').value.trim(), firstResponse: $id('ks-first').value.trim(), resolution: $id('ks-resolution').value.trim() };
  if (!v.priority) return say('kserr', 'red', 'Enter the priority name.');
  if (!v.firstResponse || !v.resolution) return say('kserr', 'red', 'Enter the first response and the resolution target.');
  call('kpi', 'save_sla', v, 'kserr');
}
function kpiSlaDelete(priority) {
  if (confirm('Remove the SLA priority "' + priority + '"?\n\nKPIs that are linked to it keep their data but lose the SLA link. This cannot be undone.')) call('kpi', 'delete_sla', { priority });
}

/* ---------- guide (the ICT KPI Management Guide 2026 and how this tab works) ---------- */
const KPI_GUIDE = {
  rows: [
    ['Purpose', 'Provide a consistent, measurable KPI framework for IT roles and management reporting.'],
    ['Scoring principle', 'KRA weight determines the importance of each area. KPI weights within each KRA are equally distributed unless management approves a different weighting.'],
    ['Target achievement', '100% of KPI weight is earned when the target/standard is achieved. Management may use an approved partial-credit scale for results below target.'],
    ['Evidence', 'Use ticketing records, monitoring reports, PM checklists, project documents, asset records, change logs, survey results, and approved reports.'],
    ['SLA exclusions', 'Pause/exclude SLA measurement only for documented user dependency, vendor/ISP dependency, procurement, management approval, approved maintenance, or other conditions defined in the SLA.'],
    ['Management review', 'Review KPI definitions and targets quarterly; adjust only through documented approval to preserve fairness and year-to-year comparability.']
  ],
  bands: [['90–100%', 'Target achieved / strong performance against agreed KPI'], ['80–89%', 'Partially achieved; improvement action may be required'], ['Below 80%', 'Target materially missed; root-cause and corrective action required']],
  controls: ['Do not use \'zero incidents\' as a general performance measure where incidents can occur despite proper controls. Measure controllable behavior, response, recovery, documentation, and root-cause actions.',
    'Separate IT-controlled availability from ISP/vendor/external outages so employees are measured on factors they can reasonably control.',
    'For customer complaints, use validated/substantiated complaints rather than an absolute \'zero complaints\' target.'],
  steps: ['Add a position with the + Add position button (for example IT KPI, IT Technical Support KPI, or IT Support Specialist KPI).',
    'Open the Setup tab. Add the KRAs of the position with their number, name and weight. The weights of all KRAs of a position should add up to 100%.',
    'Add the Specific KPIs of each KRA with their target (%). The KRA weight is shared equally between its KPIs unless you type a KPI Weight that management approved.',
    'Edit a KPI to change its name, weight or target, or delete it to remove it and its results.',
    'Open the Dashboard & Compute tab and choose the year. Press the calculator button next to a KPI to open the KPI Calculation Assistant: pick a formula model (Ratio %, Uptime, CSAT Survey or Direct / Preset), enter the numbers, then press Apply to Spreadsheet, or Apply & Next KPI to continue with the next KPI. You can also type the actual result in the box and press Save results & compute.',
    'If management approved a partial-credit scale, add it at the bottom of the Setup tab.',
    'Use the SLA tab to add, edit or remove SLA priorities and their first response and resolution targets.',
    'Every year the administrator and every immediate head / supervisor receive a notification to do the KPI review. Press Mark review done when it is finished.']
};
function kpiGuide() {
  return tpl('tpl-kpi-guide', { rows: KPI_GUIDE.rows.map((r) => ({ k: r[0], v: r[1] })), bands: KPI_GUIDE.bands.map((r) => ({ k: r[0], v: r[1] })), controls: KPI_GUIDE.controls.map((t) => ({ t })), steps: KPI_GUIDE.steps.map((t) => ({ t })) });
}
