(function () {
  'use strict';
  const C = NoticeCore, $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
  const STORE = 'nta_data_v1', PREFS = 'nta_preferences_v2', DRAFT = 'nta_draft_v2';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => `<img src="assets/icons/${name}.svg" alt="" loading="lazy">`;
  const prio = { low: '低', mid: '中', high: '高', urgent: '紧急' }, statuses = { todo: '待办', doing: '进行中', done: '已完成', over: '已逾期' };
  let state = C.empty(), persistedRaw = null, corruptedRaw = null, storageBlocked = false, conflict = false, view = 'calendar', pending = null, editingId = null, undoState = null;
  let cursor = new Date(), limit = 60, filters = { q: '', cat: '', prio: '', owner: '', time: '', source: '' }, libQ = '', toastTimer, draftTimer;
  let prefs = { theme: 'light', campus: true, motion: true, trail: true };
  const now = () => new Date(), sameDay = (a, b) => C.dateKey(a) === C.dateKey(b);
  function friendlyDate(a) {
    if (!a.due) return '时间待定';
    const d = new Date(a.due), day = C.dateKey(d), today = C.dateKey(now());
    const date = day === today ? '今天' : `${d.getMonth() + 1}月${d.getDate()}日`;
    return date + (a.allDay ? ' · 当天截止' : ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  }
  function toast(message, undo = false) {
    clearTimeout(toastTimer); $('#toastText').textContent = message; $('#toast').hidden = false; $('#undoButton').hidden = !undo;
    if (!undo) toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
  }
  function storageWarning(message) {
    $('#storageWarning').textContent = message; $('#storageWarning').hidden = false; $('#saveStatus').textContent = '尚未保存';
  }
  function load() {
    try {
      persistedRaw = localStorage.getItem(STORE);
      if (persistedRaw) {
        if (persistedRaw.length > C.LIMITS.file) throw Error('已存数据过大');
        state = C.normalize(JSON.parse(persistedRaw));
      }
    } catch (e) {
      if (persistedRaw) { corruptedRaw = persistedRaw; storageBlocked = true; $('#recoveryDownload').hidden = false; storageWarning('原有数据格式异常，已保留原始内容且未覆盖。请在“备份与设置”下载原始存储，再决定是否清理。'); }
      else storageWarning('浏览器暂时无法读取本机存储。新增内容可能仅保留到关闭页面，请及时下载备份。');
    }
    try { const p = JSON.parse(localStorage.getItem(PREFS) || '{}'); if (p && typeof p === 'object') { for (const key of ['campus', 'motion', 'trail']) if (typeof p[key] === 'boolean') prefs[key] = p[key]; if (['light', 'dark', 'system'].includes(p.theme)) prefs.theme = p.theme; } const draft = localStorage.getItem(DRAFT); if (draft && draft.length <= C.LIMITS.input) $('#rawInput').value = draft; } catch (_) { /* 不影响清单 */ }
  }
  function commit(next, message, canUndo = true, clearCorrupt = false) {
    if (storageBlocked && !clearCorrupt) { toast('先下载原始存储，再在设置中清理异常数据'); return false; }
    try {
      if (conflict || localStorage.getItem(STORE) !== persistedRaw) { conflict = true; $('#syncWarning').hidden = false; toast('另一个页面已更新数据，请先读取最新数据'); return false; }
    } catch (_) { /* 无存储权限时仍允许临时编辑，并明确提示 */ }
    let clean; try { clean = C.normalize(next); } catch (e) { toast('未保存：' + e.message); return false; }
    const serialized = JSON.stringify(clean);
    if (new TextEncoder().encode(serialized).length > C.LIMITS.file) { toast('数据已超过 2MB，请备份并清理部分记录'); return false; }
    const before = state; let saved = false;
    try { localStorage.setItem(STORE, serialized); persistedRaw = serialized; saved = true; } catch (_) { storageWarning('本机保存失败，当前改动仅保留在此页面。请立即下载 JSON 备份，关闭页面可能丢失改动。'); }
    state = clean; undoState = canUndo ? before : null;
    if (clearCorrupt) { storageBlocked = false; if (saved) $('#storageWarning').hidden = true; }
    if (saved) { $('#saveStatus').textContent = '已保存到本机'; if (!storageBlocked) $('#storageWarning').hidden = true; }
    render(); toast(message + (saved ? '' : '（尚未保存，请备份）'), canUndo); return true;
  }
  function mutate(fn, message) { const next = structuredClone(state); fn(next); return commit(next, message); }
  function showDialog(id) { const d = $(id); if (!d.open) d.showModal(); }
  function closeDialog(d) { if (d.id === 'helpDialog') $('#tutorialVideo').pause(); d.close(); }
  function applyPrefs(save = true) {
    const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'; document.documentElement.dataset.campus = prefs.campus ? 'on' : 'off';
    document.documentElement.dataset.motion = prefs.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'on' : 'off';
    document.documentElement.dataset.trail = prefs.trail ? 'on' : 'off';
    $('#themeSelect').value = prefs.theme; $('#campusToggle').checked = prefs.campus; $('#motionToggle').checked = prefs.motion; $('#trailToggle').checked = prefs.trail;
    $$('[data-theme-choice]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === prefs.theme)));
    if (save) try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (_) { toast('外观暂时无法保存，下次打开可能恢复默认'); }
    document.dispatchEvent(new Event('notice:appearance'));
  }
  const sorted = list => list.slice().sort((a, b) => (a.due ? new Date(a.due).getTime() : Infinity) - (b.due ? new Date(b.due).getTime() : Infinity) || a.text.localeCompare(b.text, 'zh'));
  function row(a, compact = false) {
    const st = C.effective(a), done = st === 'done';
    return `<div class="task-row ${done ? 'is-done' : ''}" data-id="${esc(a.id)}"><button class="task-check ${done ? 'checked' : ''}" data-complete="${esc(a.id)}" aria-label="${done ? '重新打开' : '完成'}：${esc(a.text)}">${done ? icon('check') : ''}</button><button class="task-body" data-edit="${esc(a.id)}"><span class="task-title">${esc(a.text)}</span><span class="task-info ${st === 'over' ? 'overdue' : ''}">${icon('clock')}${esc(friendlyDate(a))}${a.demo ? '<span class="demo-label">示例</span>' : ''}</span></button>${compact ? '' : `<span class="category-chip">${esc(a.cat)}</span>`}<button class="icon-button task-menu" data-edit="${esc(a.id)}" aria-label="编辑：${esc(a.text)}">${icon('more-horizontal')}</button></div>`;
  }
  function empty(message = '还没有待办，先整理一条通知吧。') { return `<div class="empty-state">${icon('calendar')}<p>${esc(message)}</p><button class="text-button" data-command="focusInput">写下第一条通知 ${icon('arrow-right')}</button></div>`; }
  function renderAside() {
    const todo = sorted(state.actions.filter(a => a.status !== 'done'));
    $('#pendingCount').textContent = `(${todo.length})`;
    $('#nextTask').innerHTML = todo.length ? `<button class="next-task" data-edit="${esc(todo[0].id)}"><span class="next-icon">${icon('file-text')}</span><span><b>${esc(todo[0].text)}</b><small class="${C.effective(todo[0]) === 'over' ? 'overdue' : ''}">${esc(friendlyDate(todo[0]))}</small></span>${icon('chevron-right')}</button>` : '<div class="quiet-note">暂时没有要赶的事。<br>留一点时间给自己。</div>';
    $('#upcomingList').innerHTML = todo.slice(0, 3).map(a => row(a, true)).join('') || '<p class="muted aside-empty">新通知整理后，会出现在这里。</p>';
    $('#undatedCount').textContent = state.actions.filter(a => !a.due && a.status !== 'done').length;
  }
  function weekStart(d) { const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); start.setDate(start.getDate() - (start.getDay() || 7) + 1); return start; }
  function renderCalendar() {
    const start = weekStart(cursor), days = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12)), end = days[6];
    $('#calendarTitle').textContent = `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`;
    $('#calendarRange').textContent = `${start.getMonth() + 1}月${start.getDate()}日 — ${end.getMonth() + 1}月${end.getDate()}日`;
    const groups = new Map(); state.actions.forEach(a => { if (a.due) { const key = C.dateKey(a.due); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(a); } });
    const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    $('#weekGrid').innerHTML = days.map((d, i) => {
      const isToday = sameDay(d, now()), items = sorted(groups.get(C.dateKey(d)) || []);
      return `<section class="week-day ${isToday ? 'today' : ''}" aria-label="${esc(C.dateKey(d))}"><header class="day-heading"><span>${isToday ? '今天' : weekdays[i]}</span><b>${d.getDate()}</b></header><div class="day-tasks">${items.slice(0, 8).map(a => `<button class="calendar-event cat-${C.CATS.indexOf(a.cat)} ${a.status === 'done' ? 'event-done' : ''} ${C.effective(a) === 'over' ? 'event-overdue' : ''}" data-edit="${esc(a.id)}" title="${esc(a.text)}"><span>${esc(a.text)}</span><small>${a.allDay ? '当天截止' : esc(C.localInput(a.due).slice(11))}${a.demo ? ' · 示例' : ''}</small></button>`).join('')}${items.length > 8 ? `<button class="text-button" data-command="showBoard">还有 ${items.length - 8} 项</button>` : ''}${!items.length ? '<span class="day-empty">暂无安排</span>' : ''}</div></section>`;
    }).join('');
    if (innerWidth <= 600) requestAnimationFrame(() => { const today = $('#weekGrid .today'); if (today) { const scroll = $('.calendar-scroll'); scroll.scrollLeft = Math.max(0, today.offsetLeft - $('#weekGrid').offsetLeft - scroll.clientWidth / 2 + today.clientWidth / 2); } });
  }
  function renderToday() {
    const unfinished = sorted(state.actions.filter(a => a.status !== 'done'));
    const urgent = unfinished.filter(a => a.due && (new Date(a.due) < now() || sameDay(a.due, now()))), next = unfinished.filter(a => !urgent.includes(a));
    $('#todayList').innerHTML = !unfinished.length ? empty() : `<div class="list-section"><h3>需要处理 <span>${urgent.length}</span></h3>${urgent.slice(0, limit).map(a => row(a)).join('') || '<p class="quiet-note">今天没有临期或逾期的事。</p>'}</div><div class="list-section"><h3>接下来 <span>${next.length}</span></h3>${next.slice(0, limit).map(a => row(a)).join('') || '<p class="muted">都已安排好。</p>'}</div>${Math.max(urgent.length, next.length) > limit ? '<button class="small-button" data-command="more">再显示 60 项</button>' : ''}`;
  }
  function matches(a) {
    if (filters.source && a.srcNotifId !== filters.source) return false;
    if (filters.q && ![a.text, a.note, a.owner].join(' ').toLowerCase().includes(filters.q.toLowerCase())) return false;
    if (filters.cat && a.cat !== filters.cat || filters.prio && a.priority !== filters.prio || filters.owner && a.owner !== filters.owner) return false;
    if (filters.time === 'none' && a.due || filters.time === 'over' && C.effective(a) !== 'over' || filters.time === 'today' && (!a.due || !sameDay(a.due, now()))) return false;
    if (filters.time === 'week') { const end = now(); end.setDate(end.getDate() + 7); if (!a.due || new Date(a.due) < now() || new Date(a.due) > end) return false; }
    return true;
  }
  function renderBoard() {
    const list = sorted(state.actions.filter(matches));
    const source = state.notifications.find(n => n.id === filters.source);
    $('#filterSummary').textContent = (source ? `来源：${source.title} · ` : '') + `显示 ${list.length} / ${state.actions.length} 项`;
    $('#board').innerHTML = Object.entries(statuses).map(([key, label]) => {
      const group = list.filter(a => C.effective(a) === key);
      return `<section class="board-column" data-status="${key}"><h3><i class="status-dot status-${key}"></i>${label}<span>${group.length}</span></h3><div class="board-items">${group.slice(0, limit).map(a => `<article class="board-task" draggable="${key !== 'over'}" data-id="${esc(a.id)}"><button class="board-task-title" data-edit="${esc(a.id)}">${esc(a.text)}</button><p class="task-info ${key === 'over' ? 'overdue' : ''}">${esc(friendlyDate(a))}</p><div class="board-task-foot"><span class="category-chip">${esc(a.cat)}</span><span>${esc(a.owner)} · ${prio[a.priority]}</span></div><div class="board-task-actions"><button class="text-button" data-complete="${esc(a.id)}">${a.status === 'done' ? '重新打开' : '完成'}</button><button class="text-button" data-edit="${esc(a.id)}">编辑</button></div></article>`).join('') || '<p class="column-empty">暂无待办</p>'}${group.length > limit ? '<button class="text-button" data-command="more">显示更多</button>' : ''}</div></section>`;
    }).join('');
    const owner = $('#fOwner').value;
    $('#fOwner').innerHTML = '<option value="">全部负责人</option>' + [...new Set(state.actions.map(a => a.owner))].map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join(''); $('#fOwner').value = owner;
  }
  function renderLibrary() {
    const q = libQ.toLowerCase(), list = state.notifications.filter(n => !q || (n.raw + n.title).toLowerCase().includes(q));
    const counts = new Map(); state.actions.forEach(a => { const value = counts.get(a.srcNotifId) || [0, 0]; value[0]++; if (a.status === 'done') value[1]++; counts.set(a.srcNotifId, value); });
    $('#notificationList').innerHTML = list.length ? list.slice(0, limit).map(n => { const [all, done] = counts.get(n.id) || [0, 0]; return `<article class="notice-item"><div class="notice-title"><h3>${esc(n.title)}</h3><span class="category-chip">${esc(n.category)}${n.demo ? ' · 示例' : ''}</span></div><p class="muted">已完成 ${done} / ${all} 项</p><details><summary>展开原文</summary><pre>${esc(n.raw)}</pre></details><div class="notice-actions"><button class="text-button" data-source="${esc(n.id)}">查看关联待办</button><button class="text-button danger-text" data-delete-notice="${esc(n.id)}">删除通知</button></div></article>`; }).join('') + (list.length > limit ? '<button class="small-button" data-command="more">显示更多</button>' : '') : empty(q ? '没有找到匹配的通知。' : '通知原文会在确认保存后留在这里。');
  }
  function renderStats() {
    const total = state.actions.length, done = state.actions.filter(a => a.status === 'done').length, over = state.actions.filter(a => C.effective(a) === 'over').length;
    $('#statsContent').innerHTML = `<div class="stats-summary"><div><strong>${total}</strong><span>全部待办</span></div><div><strong>${done}</strong><span>已完成</span></div><div><strong>${over}</strong><span>已逾期</span></div></div><label class="progress-label">完成进度 <b>${total ? Math.round(done / total * 100) : 0}%</b><progress value="${done}" max="${Math.max(total, 1)}"></progress></label><h3 class="stats-subtitle">类别分布</h3>${C.CATS.map(cat => { const n = state.actions.filter(a => a.cat === cat).length; return n ? `<div class="stat-row"><span>${cat}</span><progress value="${n}" max="${Math.max(total, 1)}"></progress><b>${n}</b></div>` : ''; }).join('') || '<p class="quiet-note">开始添加后，就能看到自己的进度。</p>'}`;
  }
  function render() {
    renderAside(); ({ calendar: renderCalendar, today: renderToday, board: renderBoard, library: renderLibrary, stats: renderStats })[view]();
  }
  function switchView(next) {
    if (!['calendar', 'today', 'board', 'library', 'stats'].includes(next)) return;
    view = next; limit = 60; $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
    $$('[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'); }); render();
  }
  function getDate(date, time) {
    if (!date && time) throw Error('填写时刻前，请先选择日期');
    if (!date) return { due: null, allDay: false };
    const v = date + 'T' + (time || '23:59') + (time ? ':00' : ':59');
    const fake = C.normalize({ notifications: [], actions: [{ id: 'check', text: 'date', due: v, allDay: !time }] });
    return { due: fake.actions[0].due, allDay: !time };
  }
  async function parse() {
    if ($('#btnParse').disabled) return;
    const button = $('#btnParse'); button.disabled = true; button.classList.add('busy'); button.querySelector('span').textContent = '正在整理';
    try {
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      pending = C.parseNotice($('#rawInput').value);
      if (state.notifications.some(n => n.raw === pending.raw)) { toast('这条通知已经整理过，可在通知库查看'); return; }
      $('#previewItems').innerHTML = pending.actions.map((a, i) => `<section class="preview-item" data-index="${i}"><label class="preview-select"><input type="checkbox" checked aria-label="保留第 ${i + 1} 项"><b>待办 ${i + 1}</b><small>原文第 ${a.sourceLine} 行</small></label><label class="field">内容<textarea class="preview-text" rows="2" maxlength="2000">${esc(a.text)}</textarea></label><div class="form-grid"><label class="field">日期<input class="preview-date" type="date" min="1900-01-01" max="2200-12-31" value="${a.due ? C.dateKey(a.due) : ''}"></label><label class="field">时刻（可选）<input class="preview-time" type="time" value="${a.due && !a.allDay ? C.localInput(a.due).slice(11) : ''}"></label></div><p class="date-hint">${esc(a.dateHint || '日期已识别，请核对原文')}</p></section>`).join('');
      $('#parseWarnings').textContent = pending.warnings.join('；'); showDialog('#previewDialog');
    } catch (e) { toast(e.message); } finally { button.disabled = false; button.classList.remove('busy'); button.querySelector('span').textContent = '整理待办'; }
  }
  function confirmParse() {
    if (!pending) return;
    if (state.notifications.some(n => n.raw === pending.raw)) { toast('这条通知已经保存'); return; }
    try {
      const nid = C.uid(), acts = $$('#previewItems .preview-item').filter(el => el.querySelector('input[type=checkbox]').checked).map(el => {
        const base = pending.actions[+el.dataset.index], date = getDate(el.querySelector('.preview-date').value, el.querySelector('.preview-time').value);
        const value = el.querySelector('.preview-text').value.trim(); if (!value) throw Error('请填写保留项的内容');
        return { ...base, text: value, ...date, srcNotifId: nid };
      });
      if (!acts.length) throw Error('至少保留一项待办');
      const n = { id: nid, title: pending.title, raw: pending.raw, category: pending.category, dateReceived: now().toISOString(), demo: pending.raw === sampleText() };
      acts.forEach(a => { a.demo = n.demo; });
      if (mutate(s => { s.notifications.push(n); s.actions.push(...acts); }, `已加入 ${acts.length} 项待办`)) { $('#rawInput').value = ''; saveDraft(); closeDialog($('#previewDialog')); pending = null; cursor = acts.find(a => a.due) ? new Date(acts.find(a => a.due).due) : now(); render(); }
    } catch (e) { toast(e.message); }
  }
  function openEdit(a = null) {
    editingId = a?.id || null; $('#editForm').reset(); $('#editTitle').textContent = a ? '编辑待办' : '添加待办'; $('#edText').value = a?.text || ''; $('#edDate').value = a?.due ? C.dateKey(a.due) : ''; $('#edTime').value = a?.due && !a.allDay ? C.localInput(a.due).slice(11) : ''; $('#edStatus').value = a?.status || 'todo'; $('#edPrio').value = a?.priority || 'mid'; $('#edCat').value = a?.cat || '其他'; $('#edOwner').value = a?.owner || '我'; $('#edNote').value = a?.note || ''; $('#editError').textContent = ''; $('#deleteAction').hidden = !a;
    const source = state.notifications.find(n => n.id === a?.srcNotifId); $('#sourceDetails').open = false; $('#sourceDetails').hidden = !source; $('#sourceText').textContent = source?.raw || ''; $('#sourceLine').textContent = a?.sourceLine ? `来源：${source?.title || ''}，原文第 ${a.sourceLine} 行` : '来源：' + (source?.title || '手动添加'); showDialog('#editDialog');
  }
  function saveEdit(e) {
    e.preventDefault();
    try {
      const base = state.actions.find(a => a.id === editingId) || { id: C.uid(), srcNotifId: null };
      const action = { ...base, text: $('#edText').value.trim(), ...getDate($('#edDate').value, $('#edTime').value), priority: $('#edPrio').value, status: $('#edStatus').value, cat: $('#edCat').value, owner: $('#edOwner').value.trim() || '我', note: $('#edNote').value.trim(), dateHint: '日期由你手动确认' };
      if (!action.text) throw Error('请写下要做的事');
      if (mutate(s => { const i = s.actions.findIndex(a => a.id === editingId); if (i >= 0) s.actions[i] = action; else s.actions.push(action); }, editingId ? '待办已更新' : '待办已添加')) closeDialog($('#editDialog'));
    } catch (err) { $('#editError').textContent = err.message; }
  }
  function complete(id) { mutate(s => { const a = s.actions.find(x => x.id === id); if (a) a.status = a.status === 'done' ? 'todo' : 'done'; }, '状态已更新'); }
  function download(name, content, type = 'application/json;charset=utf-8') { const blob = new Blob([content], { type }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  function sampleText() { return '老师说周五前提交实验报告。\n明天下午三点参加小组讨论，记得准备进度汇报。\n后天上午十点确认志愿活动报名。'; }
  function sample() { if ($('#rawInput').value.trim() && $('#rawInput').value !== sampleText() && !confirm('用示例替换输入框内容？已有清单不会改变。')) return; $$('dialog[open]').forEach(closeDialog); $('#rawInput').value = sampleText(); saveDraft(); $('#rawInput').focus(); toast('示例已填入，点击“整理待办”体验，不会自动加入清单'); }
  function saveDraft() { $('#charCount').textContent = `${$('#rawInput').value.length} / 20000`; clearTimeout(draftTimer); draftTimer = setTimeout(() => { try { localStorage.setItem(DRAFT, $('#rawInput').value); } catch (_) { /* 草稿失败不影响已存任务 */ } }, 300); }
  function clearFilters() { filters = { q: '', cat: '', prio: '', owner: '', time: '', source: '' }; $('#searchInput').value = ''; ['Cat', 'Prio', 'Owner', 'Time'].forEach(k => { $('#f' + k).value = ''; }); }
  const commands = {
    help: () => { const v = $('#tutorialVideo'); if (!v.poster) v.poster = 'assets/tutorial-poster.jpg'; showDialog('#helpDialog'); }, settings: () => showDialog('#settingsDialog'), appearance: () => { showDialog('#settingsDialog'); $('#appearanceSettings').scrollIntoView({ block: 'nearest' }); }, add: () => openEdit(), sample,
    showBoard: () => switchView('board'), focusInput: () => { $('#rawInput').focus(); $('#rawInput').scrollIntoView({ block: 'center', behavior: 'smooth' }); },
    more: () => { limit += 60; render(); }, undated: () => { clearFilters(); filters.time = 'none'; $('#fTime').value = 'none'; switchView('board'); $('#filterOptions').hidden = false; $('#filterToggle').setAttribute('aria-expanded', 'true'); }, clearFilters: () => { clearFilters(); renderBoard(); },
    exportJSON: () => { download('通知不漏办-完整备份.json', JSON.stringify(state, null, 2)); toast('已下载完整备份，包含通知原文'); },
    csv: () => { download('通知不漏办-行动清单.csv', C.toCSV(state), 'text/csv;charset=utf-8'); toast('已导出全部清单 CSV'); },
    ics: () => { const n = state.actions.filter(a => a.due && a.status !== 'done').length; if (!n) return toast('还没有带截止时间的未完成待办'); download('通知不漏办-截止日程.ics', C.toICS(state), 'text/calendar;charset=utf-8'); toast(`已导出 ${n} 项日程，请在系统日历中导入并设置提醒`); },
    importJSON: () => $('#fileInput').click(), clearDemo: () => { if (!state.actions.some(a => a.demo) && !state.notifications.some(n => n.demo)) return toast('当前没有示例数据'); mutate(s => { const ids = new Set(s.notifications.filter(n => n.demo).map(n => n.id)); s.notifications = s.notifications.filter(n => !n.demo); s.actions = s.actions.filter(a => !a.demo && !ids.has(a.srcNotifId)); }, '示例已移除'); },
    clearAll: () => { if (confirm('清空当前浏览器中的全部通知与待办？建议先下载备份。')) commit(C.empty(), '数据已清空，可撤销', true, true); },
    reloadData: () => { if (undoState && !confirm('读取最新数据后，本页撤销记录将清除，是否继续？')) return; state = C.empty(); conflict = false; storageBlocked = false; corruptedRaw = null; $('#storageWarning').hidden = true; $('#recoveryDownload').hidden = true; load(); undoState = null; $('#syncWarning').hidden = true; render(); toast('已读取最新清单'); }
  };
  document.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-close')) return closeDialog(t.closest('dialog'));
    if (t.dataset.command) return commands[t.dataset.command]?.();
    if (t.dataset.view) return switchView(t.dataset.view);
    if (t.dataset.themeChoice) { prefs.theme = t.dataset.themeChoice; return applyPrefs(); }
    if (t.dataset.complete) return complete(t.dataset.complete);
    if (t.dataset.edit) return openEdit(state.actions.find(a => a.id === t.dataset.edit));
    if (t.dataset.source) { clearFilters(); filters.source = t.dataset.source; switchView('board'); return; }
    if (t.dataset.deleteNotice && confirm('删除这条通知及其关联待办？')) mutate(s => { s.notifications = s.notifications.filter(n => n.id !== t.dataset.deleteNotice); s.actions = s.actions.filter(a => a.srcNotifId !== t.dataset.deleteNotice); }, '通知与关联待办已删除');
  });
  $('#btnParse').addEventListener('click', parse); $('#confirmParse').addEventListener('click', confirmParse); $('#editForm').addEventListener('submit', saveEdit);
  $('#deleteAction').addEventListener('click', () => { if (confirm('删除这项待办？')) { if (mutate(s => { s.actions = s.actions.filter(a => a.id !== editingId); }, '待办已删除')) closeDialog($('#editDialog')); } });
  $('#undoButton').addEventListener('click', () => { if (undoState) commit(undoState, '已撤销上一次修改', false, storageBlocked); });
  $('#dismissToast').addEventListener('click', () => { $('#toast').hidden = true; });
  $('#rawInput').addEventListener('input', saveDraft);
  $('#filterToggle').addEventListener('click', () => { const el = $('#filterOptions'); el.hidden = !el.hidden; $('#filterToggle').setAttribute('aria-expanded', String(!el.hidden)); });
  let searchTimer; $('#searchInput').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { filters.q = e.target.value; limit = 60; renderBoard(); }, 100); });
  for (const [suffix, key] of [['Cat', 'cat'], ['Prio', 'prio'], ['Owner', 'owner'], ['Time', 'time']]) $('#f' + suffix).addEventListener('change', e => { filters[key] = e.target.value; limit = 60; renderBoard(); });
  $('#libSearch').addEventListener('input', e => { libQ = e.target.value; renderLibrary(); });
  $('#calPrev').addEventListener('click', () => { cursor.setDate(cursor.getDate() - 7); renderCalendar(); }); $('#calNext').addEventListener('click', () => { cursor.setDate(cursor.getDate() + 7); renderCalendar(); }); $('#calToday').addEventListener('click', () => { cursor = now(); renderCalendar(); });
  $('#themeSelect').addEventListener('change', e => { prefs.theme = e.target.value; applyPrefs(); });
  for (const [selector, key] of [['#campusToggle', 'campus'], ['#motionToggle', 'motion'], ['#trailToggle', 'trail']]) $(selector).addEventListener('change', e => { prefs[key] = e.target.checked; applyPrefs(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyPrefs(false)); matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => applyPrefs(false));
  $('#recoveryDownload').addEventListener('click', () => { if (corruptedRaw) download('通知不漏办-原始存储恢复.json', corruptedRaw); });
  $('#fileInput').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    if (file.size > C.LIMITS.file) return toast('文件超过 2MB，请分批导入');
    try { const data = C.normalize(JSON.parse(await file.text())), next = C.merge(state, data), added = next.actions.length - state.actions.length; if (!confirm(`备份检查通过：新增 ${added} 项待办、${next.notifications.length - state.notifications.length} 条通知。相同编号保留当前记录，是否合并？`)) return; commit(next, `已导入 ${added} 项待办`); } catch (err) { toast('导入失败，已有数据未改动：' + err.message); }
  });
  $('#playTutorial').addEventListener('click', async () => { const v = $('#tutorialVideo'); if (!v.getAttribute('src')) v.src = v.dataset.videoSrc; try { await v.play(); $('#playTutorial').hidden = true; $('#videoError').hidden = true; } catch (err) { if (err.name !== 'AbortError') $('#videoError').hidden = false; } });
  $('#helpDialog').addEventListener('close', () => $('#tutorialVideo').pause());
  $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog(d); } }));
  let dragId = null;
  $('#board').addEventListener('dragstart', e => { const a = e.target.closest('[draggable=true]'); if (a) { dragId = a.dataset.id; e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } });
  $('#board').addEventListener('dragover', e => { const col = e.target.closest('[data-status]'); if (dragId && col && col.dataset.status !== 'over') { e.preventDefault(); col.classList.add('drag-over'); } });
  $('#board').addEventListener('dragleave', e => e.target.closest('[data-status]')?.classList.remove('drag-over'));
  $('#board').addEventListener('drop', e => { e.preventDefault(); $$('.drag-over').forEach(el => el.classList.remove('drag-over')); const status = e.target.closest('[data-status]')?.dataset.status; if (dragId && ['todo', 'doing', 'done'].includes(status)) mutate(s => { const a = s.actions.find(a => a.id === dragId); if (a) a.status = status; }, '状态已更新'); dragId = null; });
  $('#board').addEventListener('dragend', () => { dragId = null; $$('.drag-over').forEach(el => el.classList.remove('drag-over')); });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && document.activeElement === $('#rawInput')) { e.preventDefault(); parse(); } });
  window.addEventListener('storage', e => { if (e.key === STORE && e.newValue !== persistedRaw) { conflict = true; $('#syncWarning').hidden = false; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) $('#tutorialVideo').pause(); else render(); });
  setInterval(() => { if (!document.hidden && !$$('dialog[open]').length) render(); }, 60000);
  $('#fCat').innerHTML = '<option value="">全部类别</option>' + C.CATS.map(c => `<option>${c}</option>`).join(''); $('#edCat').innerHTML = C.CATS.map(c => `<option>${c}</option>`).join('');
  load(); applyPrefs(false); saveDraft(); switchView('calendar');
  $('#greetingDate').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now()) + ' · 给校园生活，留一点从容';
  $('#bootLoader').hidden = true;
  if (new URLSearchParams(location.search).get('view') === 'guide') commands.help();
  // 测试与离线工具通过纯数据接口读取，不向页面注入命令或远程请求。
  window.NoticeApp = Object.freeze({ snapshot: () => structuredClone(state), status: () => ({ view, conflict, storageBlocked, records: state.actions.length }) });
})();
