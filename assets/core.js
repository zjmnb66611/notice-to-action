/* 通知不漏办：纯数据逻辑，可在浏览器与 Node 中运行。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NoticeCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const CATS = ['活动', '会议', '考试', '报名', '材料提交', '缴费', '值班', '公示', '其他'];
  const PRIORITIES = ['low', 'mid', 'high', 'urgent'];
  const LIMITS = Object.freeze({ input: 20000, records: 2000, file: 2 * 1024 * 1024, field: 2000 });
  const pad = n => String(n).padStart(2, '0');
  const uid = () => 'n' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
  const dateKey = v => { const d = new Date(v); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const localInput = v => { const d = new Date(v); return `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const empty = () => ({ schemaVersion: 2, notifications: [], actions: [] });
  const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  function text(v, max = LIMITS.field, required = false) {
    if (v == null && !required) return '';
    if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw Error('文字字段缺失、类型不符或过长');
    return v.trim();
  }
  function id(v, optional = false) {
    if (optional && (v == null || v === '')) return null;
    if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(v)) throw Error('记录编号无效');
    return v;
  }
  function iso(v) {
    if (v == null || v === '') return null;
    if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)?$/.test(v)) throw Error('日期格式无效');
    const d = new Date(v), m = v.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/);
    if (!Number.isFinite(d.getTime()) || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > new Date(+m[1], +m[2], 0).getDate() || +m[4] > 23 || +m[5] > 59 || +(m[6] || 0) > 59 || d.getFullYear() < 1900 || d.getFullYear() > 2200) throw Error('日期超出有效范围');
    return d.toISOString();
  }
  function choice(v, values, fallback) {
    if (v == null || v === '') return fallback;
    if (!values.includes(v)) throw Error('状态、类别或优先级无效');
    return v;
  }
  function normalize(data) {
    if (!plain(data) || !Array.isArray(data.notifications) || !Array.isArray(data.actions)) throw Error('请选择本工具导出的 JSON 备份');
    if (data.schemaVersion != null && ![1, 2].includes(data.schemaVersion)) throw Error('备份版本暂不支持');
    if (data.actions.length + data.notifications.length > LIMITS.records) throw Error('备份最多包含 2000 条记录');
    const ns = new Set(), as = new Set();
    const notifications = data.notifications.map(n => {
      if (!plain(n)) throw Error('通知记录无效');
      const nid = id(n.id); if (ns.has(nid)) throw Error('通知编号重复'); ns.add(nid);
      return { id: nid, title: text(n.title, 200, true), raw: text(n.raw, LIMITS.input), category: choice(n.category, CATS, '其他'), due: iso(n.due), location: text(n.location, 300), organizer: text(n.organizer, 200), priority: choice(n.priority, PRIORITIES, 'mid'), dateReceived: iso(n.dateReceived), demo: n.demo === true };
    });
    const actions = data.actions.map(a => {
      if (!plain(a)) throw Error('待办记录无效');
      const aid = id(a.id); if (as.has(aid)) throw Error('待办编号重复'); as.add(aid);
      const status = choice(a.status, ['todo', 'doing', 'done', 'over'], 'todo');
      return { id: aid, text: text(a.text, LIMITS.field, true), due: iso(a.due), allDay: a.allDay === true, priority: choice(a.priority, PRIORITIES, 'mid'), status: status === 'over' ? 'todo' : status, cat: choice(a.cat, CATS, '其他'), owner: text(a.owner, 100) || '我', note: text(a.note), srcNotifId: id(a.srcNotifId, true), sourceLine: Number.isSafeInteger(a.sourceLine) && a.sourceLine > 0 && a.sourceLine <= LIMITS.input ? a.sourceLine : null, dateHint: text(a.dateHint, 300), demo: a.demo === true };
    });
    actions.forEach(a => { if (a.srcNotifId && !ns.has(a.srcNotifId)) throw Error('待办引用了不存在的通知，请检查备份完整性'); });
    return { schemaVersion: 2, notifications, actions };
  }
  function merge(current, incoming) {
    const a = normalize(current), b = normalize(incoming);
    const ns = new Set(a.notifications.map(n => n.id)), ids = new Set(a.actions.map(n => n.id));
    b.notifications.forEach(n => { if (!ns.has(n.id)) a.notifications.push(n); });
    b.actions.forEach(n => { if (!ids.has(n.id)) a.actions.push(n); });
    return normalize(a);
  }
  function effective(a, now = new Date()) { return a.status !== 'done' && a.due && new Date(a.due) < now ? 'over' : a.status; }
  function number(s) {
    if (/^\d+$/.test(s)) return +s;
    const map = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (s === '十') return 10;
    if (s.includes('十')) { const [a, b] = s.split('十'); return (a ? map[a] : 1) * 10 + (b ? map[b] : 0); }
    return map[s];
  }
  function parseDate(value, now = new Date()) {
    const s = value.trim(); let match, y = now.getFullYear(), mo = now.getMonth() + 1, day = now.getDate(), found = false, hint = '', explicitYear = false;
    const addDays = n => { const d = new Date(y, mo - 1, day + n, 12); y = d.getFullYear(); mo = d.getMonth() + 1; day = d.getDate(); found = true; };
    if ((match = s.match(/(?:(20\d{2})[年/.-])?(\d{1,2})[月/.-](\d{1,2})(?:日|号)?/))) {
      if (match[1]) { y = +match[1]; explicitYear = true; }
      mo = +match[2]; day = +match[3]; found = true;
      if (!explicitYear) hint = `原文未写年份，按 ${y} 年识别，请核对`;
    } else if ((match = s.match(/(本周|这周|下周|周|星期)([一二三四五六日天])/))) {
      const target = '日一二三四五六'.indexOf(match[2] === '天' ? '日' : match[2]);
      let delta = target - now.getDay();
      if (match[1] === '下周') delta = (target || 7) - (now.getDay() || 7) + 7;
      else if (['周', '星期'].includes(match[1]) && delta < 0) delta += 7;
      addDays(delta);
    } else if (/后天/.test(s)) addDays(2);
    else if (/明天|明日/.test(s)) addDays(1);
    else if (/今天|今日|今晚/.test(s)) addDays(0);
    else if ((match = s.match(/([\d一二两三四五六七八九十]+)天(?:内|后)/))) { const n = number(match[1]); if (n >= 0 && n <= 90) addDays(n); }
    else if ((match = s.match(/(\d{1,2})[日号]/))) { day = +match[1]; found = true; hint = '原文未写月份，按本月识别，请核对'; }
    if (!found) return { due: null, allDay: false, hint: /下周|月底|尽快|稍后|周末|晚点/.test(s) ? '时间不明确，请补充具体日期' : '未写日期，可稍后补充' };
    let hour = 23, minute = 59, known = false;
    if ((match = s.match(/(\d{1,2})[:：](\d{2})/))) { hour = +match[1]; minute = +match[2]; known = true; }
    else if ((match = s.match(/([\d零〇一二两三四五六七八九十]+)[点时](?:([\d零〇一二两三四五六七八九十]+)分?|半)?/))) { hour = number(match[1]); minute = match[0].endsWith('半') ? 30 : (match[2] ? number(match[2]) : 0); known = true; }
    if (known && /下午|晚上|傍晚|晚\d|晚[一二三四五六七八九十]|今晚/.test(s) && hour < 12) hour += 12;
    if (known && /中午/.test(s) && hour < 11) hour += 12;
    if (known && /凌晨|早上|上午/.test(s) && hour === 12) hour = 0;
    const d = new Date(y, mo - 1, day, hour, minute, known ? 0 : 59);
    if (mo < 1 || mo > 12 || day < 1 || d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day || hour > 23 || minute > 59 || !Number.isFinite(d.getTime())) return { due: null, allDay: false, hint: '原文日期或时刻无效，请手动确认' };
    return { due: d.toISOString(), allDay: !known, hint: [hint, !known ? '未写时刻，按当天截止展示' : '', d < now ? '识别时间已过去，请核对' : ''].filter(Boolean).join('；') };
  }
  const keywords = { '会议': /会议|组会|班会|例会|开会|讨论|汇报/, '考试': /考试|测验|答辩|体测|面试/, '缴费': /缴费|交费|缴纳|教材费/, '报名': /报名|预约|申请|注册/, '材料提交': /提交|上交|报告|交.{0,5}材料|上传/, '值班': /值班|执勤|排班/, '活动': /活动|比赛|讲座|志愿|参赛|社团/, '公示': /公示|公告/ };
  function category(s) { return Object.keys(keywords).find(k => keywords[k].test(s)) || '其他'; }
  function parseNotice(raw, now = new Date()) {
    if (typeof raw !== 'string' || !raw.trim()) throw Error('先写一句话，或粘贴通知内容');
    if (raw.length > LIMITS.input) throw Error('单次最多整理 20000 字');
    const lines = raw.trim().split(/\r?\n/); const title = lines.find(l => l.trim())?.trim().slice(0, 100) || '新通知';
    const pieces = lines.flatMap((line, i) => line.split(/[。；;，,]+/).map(s => ({ s: s.trim(), line: i + 1 }))).filter(x => x.s);
    const actionVerb = /报名|提交|上交|交.{0,5}报告|填写|参加|出席|缴费|领取|确认|回复|准备|打印|上传|预约|签到|登记|整理|汇总|递交|申报|携带|带.{0,6}材料|发送|反馈|完成|办理|开会|组会|讨论|汇报|值班|记得|别忘|要去|要交/;
    let selected = pieces.filter(x => actionVerb.test(x.s) && !/^关于.{2,50}(通知|公告|安排)$/.test(x.s));
    if (!selected.length) selected = pieces.slice(0, 1);
    const seen = new Set();
    const actions = selected.filter(x => { if (seen.has(x.s)) return false; seen.add(x.s); return true; }).slice(0, 60).map(x => {
      const d = parseDate(x.s, now);
      const location = x.s.match(/(?:地点[：:]|在)([^，。；\n]{2,28}?(?:教室|办公室|报告厅|会议室|实验室|活动中心|操场|楼|室|厅|馆))(?:[开展举行参加开会]|$)/)?.[1] || '';
      return { id: uid(), text: x.s.replace(/^(?:老师说|请大家|请同学们|请|记得|别忘了)[：:\s]*/, '').slice(0, LIMITS.field), due: d.due, allDay: d.allDay, dateHint: d.hint, priority: /紧急|立即|加急/.test(x.s) ? 'urgent' : /务必|重要/.test(x.s) ? 'high' : 'mid', status: 'todo', cat: category(x.s), owner: '我', note: location ? '地点：' + location : '', srcNotifId: null, sourceLine: x.line, demo: false };
    });
    return { title, category: category(raw), raw: raw.trim(), actions, warnings: selected.length > 60 ? ['本次只整理前 60 项，请分批处理剩余内容'] : [] };
  }
  function csvCell(v) {
    let s = String(v ?? '');
    if (/^[\s\u0000-\u001f\u007f\ufeff]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function toCSV(state) {
    const s = normalize(state), ns = new Map(s.notifications.map(n => [n.id, n]));
    return '\uFEFF' + [['待办内容', '类别', '优先级', '负责人', '状态', '截止时间', '备注', '来源通知'], ...s.actions.map(a => [a.text, a.cat, a.priority, a.owner, effective(a), a.due ? localInput(a.due) : '', a.note, ns.get(a.srcNotifId)?.title || '手动添加'])].map(r => r.map(csvCell).join(',')).join('\r\n');
  }
  const icsEscape = v => String(v ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  function fold(line) {
    const result = []; let chunk = '', count = 0;
    for (const c of line) { const n = new TextEncoder().encode(c).length; if (count + n > 73) { result.push(chunk); chunk = ' '; count = 1; } chunk += c; count += n; }
    result.push(chunk); return result.join('\r\n');
  }
  function toICS(state, now = new Date()) {
    const s = normalize(state); const stamp = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NoticeToAction//Campus Planner 2//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    s.actions.filter(a => a.due && a.status !== 'done').forEach(a => {
      lines.push('BEGIN:VEVENT', 'UID:' + a.id + '@notice-to-action', 'DTSTAMP:' + stamp(now));
      if (a.allDay) { const d = new Date(a.due), end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); lines.push('DTSTART;VALUE=DATE:' + dateKey(d).replace(/-/g, ''), 'DTEND;VALUE=DATE:' + dateKey(end).replace(/-/g, '')); }
      else { const start = new Date(a.due); lines.push('DTSTART:' + stamp(start), 'DTEND:' + stamp(new Date(start.getTime() + 15 * 60000))); }
      lines.push('SUMMARY:' + icsEscape(a.text), 'DESCRIPTION:' + icsEscape(['截止待办；示意占用15分钟，并非原文活动时长。', a.note, a.dateHint].filter(Boolean).join('\n')), 'TRANSP:TRANSPARENT', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR'); return lines.map(fold).join('\r\n') + '\r\n';
  }
  return { CATS, PRIORITIES, LIMITS, uid, dateKey, localInput, empty, normalize, merge, effective, parseDate, parseNotice, csvCell, toCSV, toICS };
});
