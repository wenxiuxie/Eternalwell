/**
 * EternaWell Medicine 预约系统（测试原型）— 后端
 *
 * 用法：把本文件全部内容粘贴到 Google Apps Script 的 Code.gs，运行一次 setup()，
 * 再"部署 → 新建部署 → 网页应用"（执行身份：我；谁可以访问：任何人）。详见《部署与测试说明.md》。
 *
 * 数据放在哪：
 *   预约         → 专用 Google 日历"EternaWell 预约"里的事件（医生手机上的 Google 日历直接能看到）
 *   不可预约时段 → 脚本属性，按月分块（blk_2027-01）
 *   设置、密码   → 脚本属性
 *
 * 同一份文件也被网页的"演示模式"加载（web/demo-backend.js 模拟了 Google 的接口），所以这里不要在顶层调用 Google 服务。
 */

const TZ = 'America/Los_Angeles';
const CALENDAR_NAME = 'EternaWell 预约';
const DEFAULT_PASSWORD = 'eternawell-test';

const WORKDAY = [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }];
const DEFAULT_SETTINGS = {
  clinicName: 'EternaWell Medicine',
  clinicPhone: '206-507-2504',
  clinicAddress: '2700 Richards Rd, Suite 204A, Bellevue, WA 98005',
  bookingPageUrl: '',
  notifyEmail: '',
  weeklyHours: { 0: [], 1: WORKDAY, 2: WORKDAY, 3: WORKDAY, 4: WORKDAY, 5: [{ start: '09:00', end: '13:00' }], 6: [] },
  visitTypes: [
    { id: 'consult', name: 'Free 20-Minute Consultation', duration: 20, mode: 'in-person', active: true,
      description: 'A no-cost first conversation about your symptoms and goals. Prefer video? Choose Telehealth Visit instead, or tell us when we confirm.' },
    { id: 'new', name: 'New Patient Consultation', duration: 60, mode: 'in-person', active: true,
      description: 'Your first visit. We review your health history, symptoms and goals, and discuss lab testing options.' },
    { id: 'follow', name: 'Follow-up Visit', duration: 30, mode: 'in-person', active: true,
      description: 'For established patients to review results and adjust treatment.' },
    { id: 'tele', name: 'Telehealth Visit', duration: 30, mode: 'telehealth', active: true,
      description: 'A secure video visit from home. We will email you the video link before your visit.' }
  ],
  slotStep: 30,
  buffer: 10,
  minNoticeHours: 12,
  maxAdvanceDays: 90,
  cancelNoticeHours: 24,
  usePrimaryCalendar: false
};

const PUBLIC_ROUTES = {
  config: apiConfig,
  availability: apiAvailability,
  book: apiBook,
  getBooking: apiGetBooking,
  cancel: apiCancel,
  reschedule: apiReschedule,
  login: apiLogin
};
const ADMIN_ROUTES = {
  adminData: apiAdminData,
  saveSettings: apiSaveSettings,
  changePassword: apiChangePassword,
  addBlock: apiAddBlock,
  removeBlock: apiRemoveBlock,
  updateBlock: apiUpdateBlock,
  adminMove: apiAdminMove,
  previewImport: apiPreviewImport,
  importBlocks: apiImportBlocks,
  adminCancel: apiAdminCancel,
  adminBook: apiAdminBook,
  clearTestData: apiClearTestData
};

class UserError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'USER';
  }
}

/* ───────────── 入口 ───────────── */

function doGet() {
  return out({ ok: true, data: 'EternaWell booking API is running.' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, error: 'Bad request' });
  }
  try {
    ensureInit();
    let fn = PUBLIC_ROUTES[req.action];
    if (!fn) {
      fn = ADMIN_ROUTES[req.action];
      if (fn) requireAdmin(req.token);
    }
    if (!fn) throw new UserError('Unknown action: ' + req.action);
    return out({ ok: true, data: fn(req) });
  } catch (err) {
    if (err instanceof UserError) return out({ ok: false, error: err.message, code: err.code });
    console.error(err && err.stack || err);
    return out({ ok: false, error: 'Server error: ' + (err && err.message || err) });
  }
}

/** 在 Apps Script 编辑器里手动运行一次：创建日历、写入默认设置、触发授权 */
function setup() {
  ensureInit();
  const cal = bookingCalendar();
  if (!props().getProperty('settings')) props().setProperty('settings', JSON.stringify(DEFAULT_SETTINGS));
  MailApp.getRemainingDailyQuota();
  console.log('完成。预约日历：' + cal.getName() + '；后台初始密码：' + DEFAULT_PASSWORD + '（登录后请在"设置"里修改）');
}

/** 忘记后台密码时手动运行：恢复成初始密码 */
function resetAdminPassword() {
  setPassword(DEFAULT_PASSWORD);
  console.log('后台密码已恢复为：' + DEFAULT_PASSWORD);
}

/* ───────────── 病人这边 ───────────── */

function apiConfig() {
  const s = getSettings();
  return {
    clinicName: s.clinicName,
    clinicPhone: s.clinicPhone,
    clinicAddress: s.clinicAddress,
    timezone: TZ,
    today: todayStr(),
    maxAdvanceDays: s.maxAdvanceDays,
    minNoticeHours: s.minNoticeHours,
    cancelNoticeHours: s.cancelNoticeHours,
    visitTypes: s.visitTypes.filter(v => v.active).map(v => ({
      id: v.id, name: v.name, duration: v.duration, mode: v.mode, description: v.description
    }))
  };
}

function apiAvailability(req) {
  const s = getSettings();
  // 允许查已停用的类型：病人改期时，原预约的类型可能已被停用
  const type = findType(s, req.typeId, true);
  if (!type) throw new UserError('Please choose a visit type.');
  checkRange(req.from, req.to, 62);
  return { days: computeSlots(type, req.from, req.to, s) };
}

function apiBook(req) {
  if (req.company) throw new UserError('Unable to complete this booking.'); // 隐藏的防机器人字段
  const s = getSettings();
  const type = findType(s, req.typeId);
  if (!isDate(req.date) || !isTime(req.time)) throw new UserError('Please choose a date and time.');
  const p = cleanPatient(req, true);
  if (!req.consent) throw new UserError('Please agree to the privacy notice to continue.');
  throttle(p.email);
  return withLock(() => {
    const slots = computeSlots(type, req.date, req.date, s)[req.date] || [];
    if (slots.indexOf(req.time) < 0) {
      throw new UserError('Sorry, that time is no longer available. Please choose another time.', 'TAKEN');
    }
    const b = createBooking(type, req.date, req.time, p, 'online');
    log('网站新预约：' + b.date + ' ' + b.time + ' ' + b.name + '（' + b.typeName + '）');
    notifyBooked(b, s, true);
    return publicSummary(b, s);
  });
}

function apiGetBooking(req) {
  const s = getSettings();
  return publicSummary(loadBooking(req.id, req.token).b, s);
}

function apiCancel(req) {
  const s = getSettings();
  return withLock(() => {
    const found = loadBooking(req.id, req.token);
    if (!canChange(found.b, s)) throw new UserError(tooLateMessage(s), 'TOO_LATE');
    removeBooking(found);
    log('病人取消预约：' + found.b.date + ' ' + found.b.time + ' ' + found.b.name);
    notifyCancelled(found.b, s, 'patient', '');
    return { cancelled: true };
  });
}

function apiReschedule(req) {
  const s = getSettings();
  if (!isDate(req.date) || !isTime(req.time)) throw new UserError('Please choose a date and time.');
  return withLock(() => {
    const found = loadBooking(req.id, req.token);
    const old = found.b;
    if (!canChange(old, s)) throw new UserError(tooLateMessage(s), 'TOO_LATE');
    const type = findType(s, old.typeId, true) || { id: old.typeId, name: old.typeName, duration: old.duration, mode: old.mode };
    const slots = computeSlots(type, req.date, req.date, s, found.ev.getId())[req.date] || [];
    if (slots.indexOf(req.time) < 0) {
      throw new UserError('Sorry, that time is no longer available. Please choose another time.', 'TAKEN');
    }
    const start = parseDT(req.date, req.time);
    found.ev.setTime(start, new Date(start.getTime() + type.duration * 60000));
    const b = bookingFromEvent(found.ev);
    log('病人改期：' + b.name + ' ' + old.date + ' ' + old.time + ' → ' + b.date + ' ' + b.time);
    notifyRescheduled(b, old, s);
    return publicSummary(b, s);
  });
}

/* ───────────── 医生后台 ───────────── */

function apiLogin(req) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('login_fails') || 0);
  if (fails >= 5) throw new UserError('密码错误次数太多，请 10 分钟后再试');
  if (!checkPassword(String(req.password || ''))) {
    cache.put('login_fails', String(fails + 1), 600);
    throw new UserError('密码不对');
  }
  cache.remove('login_fails');
  return { token: makeToken() };
}

function apiAdminData(req) {
  checkRange(req.from, req.to, 200);
  return {
    settings: getSettings(),
    bookings: listBookings(req.from, req.to),
    blocks: getBlocks(req.from, req.to),
    log: JSON.parse(props().getProperty('log') || '[]'),
    owner: Session.getEffectiveUser().getEmail(),
    calendarName: bookingCalendar().getName(),
    today: todayStr(),
    timezone: TZ
  };
}

function apiSaveSettings(req) {
  const s = cleanSettings(req.settings || {});
  props().setProperty('settings', JSON.stringify(s));
  log('修改了设置');
  return getSettings();
}

function apiChangePassword(req) {
  if (!checkPassword(String(req.oldPassword || ''))) throw new UserError('原密码不对');
  const pw = String(req.newPassword || '');
  if (pw.length < 8) throw new UserError('新密码至少 8 位');
  setPassword(pw);
  log('修改了后台密码');
  return { token: makeToken() };
}

/** 设不可预约：一天（date）或连续多天（dates，只能全天） */
function apiAddBlock(req) {
  const dates = Array.isArray(req.dates) ? req.dates : [req.date];
  if (!dates.length || dates.length > 62) throw new UserError('一次最多设 62 天');
  const blocks = dates.map(d => cleanBlock(Object.assign({}, req, { date: d }), '手动'));
  return withLock(() => {
    blocks.forEach(b => {
      b.id = 'k' + randomCode(10);
      b.src = 'manual';
      const month = b.date.slice(0, 7);
      const list = getBlocksMonth(month);
      list.push(b);
      setBlocksMonth(month, list);
    });
    const b = blocks[0];
    log('设为不可预约：' + b.date + (blocks.length > 1 ? ' 起 ' + blocks.length + ' 天' : '') +
      (b.start ? ' ' + b.start + '–' + b.end : ' 全天') + (b.note ? '（' + b.note + '）' : ''));
    return { blocks: blocks, conflicts: conflictsWith(blocks) };
  });
}

/** 在日历上拖动/拉长不可预约时段 */
function apiUpdateBlock(req) {
  if (!isDate(req.date)) throw new UserError('日期不对');
  return withLock(() => {
    const oldList = getBlocksMonth(req.date.slice(0, 7));
    const old = oldList.filter(b => b.id === req.id)[0];
    if (!old) throw new UserError('这条不可预约记录已经不存在了');
    const b = cleanBlock({ date: req.newDate, start: req.start, end: req.end, note: req.note == null ? old.note : req.note }, '修改');
    b.id = old.id;
    b.src = old.src;
    setBlocksMonth(req.date.slice(0, 7), oldList.filter(x => x.id !== req.id));
    const month = b.date.slice(0, 7);
    const list = getBlocksMonth(month);
    list.push(b);
    setBlocksMonth(month, list);
    log('修改不可预约：' + old.date + ' → ' + b.date + (b.start ? ' ' + b.start + '–' + b.end : ' 全天'));
    return { block: b, conflicts: conflictsWith([b]) };
  });
}

/** 医生在日历上拖动预约改时间（可同时改时长），不受出诊时间限制，只检查冲突 */
function apiAdminMove(req) {
  const s = getSettings();
  if (!isDate(req.date) || !isTime(req.time)) throw new UserError('日期时间不对');
  return withLock(() => {
    const rec = readRecord(req.id);
    const ev = rec && bookingCalendar().getEventById(rec.eventId);
    if (!ev) throw new UserError('这个预约已经不存在了（可能已在 Google 日历里删除）');
    const old = bookingFromEvent(ev);
    const duration = req.duration ? Number(req.duration) : old.duration;
    if (!(duration >= 5 && duration <= 480)) throw new UserError('时长要在 5–480 分钟之间');
    const start = parseDT(req.date, req.time).getTime();
    const end = start + duration * 60000;
    const clash = busyIntervals(req.date, req.date, Object.assign({}, s, { buffer: 0 }), ev.getId())
      .some(iv => start < iv.e && end > iv.s);
    if (clash && !req.force) throw new UserError('新时间和其他预约或不可预约时段冲突。', 'CONFLICT');
    ev.setTime(new Date(start), new Date(end));
    const b = bookingFromEvent(ev);
    b.token = rec.token;
    log('诊所改期：' + b.name + ' ' + old.date + ' ' + old.time + ' → ' + b.date + ' ' + b.time);
    if (req.notify && b.email) notifyRescheduled(b, old, s, 'clinic');
    return b;
  });
}

function apiRemoveBlock(req) {
  if (!isDate(req.date)) throw new UserError('日期不对');
  return withLock(() => {
    const month = req.date.slice(0, 7);
    const list = getBlocksMonth(month);
    const left = list.filter(b => b.id !== req.id);
    if (left.length === list.length) throw new UserError('这条不可预约记录已经不存在了');
    setBlocksMonth(month, left);
    log('恢复可预约：' + req.date);
    return { removed: true };
  });
}

function apiPreviewImport(req) {
  const today = todayStr();
  const all = cleanEntries(req.entries);
  const entries = all.filter(e => e.date >= today);
  let replaced = 0;
  allBlockMonths().forEach(m => {
    replaced += getBlocksMonth(m).filter(b => b.src === 'excel' && b.date >= today).length;
  });
  return {
    count: entries.length,
    ignoredPast: all.length - entries.length,
    replaced: replaced,
    from: entries.length ? entries[0].date : '',
    to: entries.length ? entries[entries.length - 1].date : '',
    conflicts: conflictsWith(entries)
  };
}

function apiImportBlocks(req) {
  const today = todayStr();
  const entries = cleanEntries(req.entries).filter(e => e.date >= today);
  return withLock(() => {
    const byMonth = {};
    let removed = 0;
    allBlockMonths().forEach(m => {
      const list = getBlocksMonth(m);
      byMonth[m] = list.filter(b => !(b.src === 'excel' && b.date >= today));
      removed += list.length - byMonth[m].length;
    });
    entries.forEach(e => {
      const m = e.date.slice(0, 7);
      (byMonth[m] = byMonth[m] || []).push({ id: 'x' + randomCode(10), date: e.date, start: e.start, end: e.end, note: e.note, src: 'excel' });
    });
    const toSet = {};
    Object.keys(byMonth).forEach(m => {
      if (byMonth[m].length) toSet['blk_' + m] = JSON.stringify(sortBlocks(byMonth[m]));
      else props().deleteProperty('blk_' + m);
    });
    props().setProperties(toSet);
    log('导入排班表：新增 ' + entries.length + ' 条，替换旧的 ' + removed + ' 条');
    return { added: entries.length, removed: removed };
  });
}

function apiAdminCancel(req) {
  const s = getSettings();
  return withLock(() => {
    const rec = readRecord(req.id);
    const ev = rec && bookingCalendar().getEventById(rec.eventId);
    if (!ev) throw new UserError('这个预约已经不存在了（可能已在 Google 日历里删除）');
    const found = { b: bookingFromEvent(ev), ev: ev, rec: rec };
    removeBooking(found);
    log('诊所取消预约：' + found.b.date + ' ' + found.b.time + ' ' + found.b.name);
    if (req.notify) notifyCancelled(found.b, s, 'clinic', String(req.reason || ''));
    return { cancelled: true };
  });
}

function apiAdminBook(req) {
  const s = getSettings();
  const type = findType(s, req.typeId, true);
  if (!type) throw new UserError('看诊类型不存在');
  if (!isDate(req.date) || !isTime(req.time)) throw new UserError('请选日期和时间');
  const p = cleanPatient(req, false);
  return withLock(() => {
    const start = parseDT(req.date, req.time).getTime();
    const end = start + type.duration * 60000;
    const clash = busyIntervals(req.date, req.date, Object.assign({}, s, { buffer: 0 }))
      .some(iv => start < iv.e && end > iv.s);
    if (clash && !req.force) throw new UserError('这个时间和已有预约或不可预约时段冲突。确定要约，请勾选"允许冲突"。', 'CONFLICT');
    const b = createBooking(type, req.date, req.time, p, 'clinic');
    log('诊所代约：' + b.date + ' ' + b.time + ' ' + b.name + '（' + b.typeName + '）');
    if (req.notify && p.email) notifyBooked(b, s, false);
    return b;
  });
}

function apiClearTestData() {
  return withLock(() => {
    const cal = bookingCalendar();
    const from = new Date(Date.now() - 400 * 86400000), to = new Date(Date.now() + 800 * 86400000);
    let n = 0;
    cal.getEvents(from, to).forEach(ev => {
      if (ev.getTag('ew_id')) { ev.deleteEvent(); n++; }
    });
    props().getKeys().forEach(k => {
      if (k.indexOf('bk_') === 0 || k.indexOf('blk_') === 0) props().deleteProperty(k);
    });
    props().setProperty('log', '[]');
    log('清空测试数据：删除 ' + n + ' 个预约和全部不可预约记录');
    return { deletedBookings: n };
  });
}

/* ───────────── 可约时间计算 ───────────── */

/** 返回 { '2026-11-03': ['09:00', '09:30', ...], ... }，只含有空位的日子 */
function computeSlots(type, from, to, s, excludeEventId) {
  const today = todayStr();
  const lastDay = addDays(today, s.maxAdvanceDays);
  if (from < today) from = today;
  if (to > lastDay) to = lastDay;
  const result = {};
  if (from > to) return result;

  const earliest = Date.now() + s.minNoticeHours * 3600000;
  const busy = busyIntervals(from, to, s, excludeEventId);
  for (let d = from; d <= to; d = addDays(d, 1)) {
    // 从中午往前后推算，避开凌晨 2 点的夏令时切换
    const noon = parseDT(d, '12:00').getTime();
    const slots = [];
    (s.weeklyHours[weekday(d)] || []).forEach(iv => {
      for (let m = toMin(iv.start); m + type.duration <= toMin(iv.end); m += s.slotStep) {
        const start = noon + (m - 720) * 60000;
        const end = start + type.duration * 60000;
        if (start < earliest) continue;
        if (busy.some(b => start < b.e && end > b.s)) continue;
        slots.push(toHM(m));
      }
    });
    if (slots.length) result[d] = slots;
  }
  return result;
}

/** 所有占用时段：预约日历的事件、医生个人日历（可选）、不可预约时段。前后加缓冲时间 */
function busyIntervals(from, to, s, excludeEventId) {
  const start = parseDT(from, '00:00'), end = parseDT(addDays(to, 1), '00:00');
  const buf = s.buffer * 60000;
  const list = [];
  const cals = [bookingCalendar()];
  if (s.usePrimaryCalendar) cals.push(CalendarApp.getDefaultCalendar());
  cals.forEach(cal => cal.getEvents(start, end).forEach(ev => {
    if (excludeEventId && ev.getId() === excludeEventId) return;
    if (ev.isAllDayEvent()) list.push(dayInterval(fmt(ev.getStartTime(), 'yyyy-MM-dd'), fmt(new Date(ev.getEndTime().getTime() - 1), 'yyyy-MM-dd')));
    else list.push({ s: ev.getStartTime().getTime() - buf, e: ev.getEndTime().getTime() + buf });
  }));
  getBlocks(from, to).forEach(b => list.push(blockInterval(b, buf)));
  return list;
}

function blockInterval(b, buf) {
  if (!b.start) return dayInterval(b.date, b.date);
  return { s: parseDT(b.date, b.start).getTime() - buf, e: parseDT(b.date, b.end).getTime() + buf };
}

function dayInterval(firstDay, lastDay) {
  return { s: parseDT(firstDay, '00:00').getTime(), e: parseDT(addDays(lastDay, 1), '00:00').getTime() };
}

/** 哪些已有预约落在这些不可预约时段里（提醒医生，不会自动取消） */
function conflictsWith(blocks) {
  if (!blocks.length) return [];
  const dates = blocks.map(b => b.date).sort();
  const ivs = blocks.map(b => blockInterval(b, 0));
  return listBookings(dates[0], dates[dates.length - 1]).filter(b => {
    if (b.external) return false;
    const s = parseDT(b.date, b.time).getTime(), e = s + b.duration * 60000;
    return ivs.some(iv => s < iv.e && e > iv.s);
  });
}

/* ───────────── 预约记录 ───────────── */

function createBooking(type, date, time, p, source) {
  const start = parseDT(date, time);
  const end = new Date(start.getTime() + type.duration * 60000);
  let id;
  do { id = 'EW' + randomCode(6); } while (props().getProperty('bk_' + id));
  const token = Utilities.getUuid().replace(/-/g, '');
  const ev = bookingCalendar().createEvent(type.name + ' — ' + p.name, start, end, {
    description: [
      '预约编号：' + id,
      '看诊类型：' + type.name + '（' + type.duration + ' 分钟，' + (type.mode === 'telehealth' ? '远程视频' : '到诊所') + '）',
      '病人：' + p.name,
      '电话：' + (p.phone || '—'),
      '邮箱：' + (p.email || '—'),
      '来源：' + (source === 'online' ? '网站预约' : '诊所代约')
    ].join('\n')
  });
  const tags = { ew_id: id, ew_type: type.id, ew_typename: type.name, ew_mode: type.mode,
    ew_name: p.name, ew_phone: p.phone, ew_email: p.email, ew_source: source };
  Object.keys(tags).forEach(k => ev.setTag(k, tags[k] || ''));
  props().setProperty('bk_' + id, JSON.stringify({ eventId: ev.getId(), token: token }));
  const b = bookingFromEvent(ev);
  b.token = token;
  return b;
}

function bookingFromEvent(ev) {
  const start = ev.getStartTime(), end = ev.getEndTime();
  const id = ev.getTag('ew_id') || '';
  return {
    id: id,
    eventId: ev.getId(),
    external: !id,
    title: ev.getTitle(),
    typeId: ev.getTag('ew_type') || '',
    typeName: ev.getTag('ew_typename') || ev.getTitle(),
    mode: ev.getTag('ew_mode') || '',
    name: ev.getTag('ew_name') || '',
    phone: ev.getTag('ew_phone') || '',
    email: ev.getTag('ew_email') || '',
    source: ev.getTag('ew_source') || '',
    allDay: ev.isAllDayEvent(),
    date: fmt(start, 'yyyy-MM-dd'),
    time: ev.isAllDayEvent() ? '' : fmt(start, 'HH:mm'),
    end: ev.isAllDayEvent() ? '' : fmt(end, 'HH:mm'),
    duration: Math.round((end.getTime() - start.getTime()) / 60000)
  };
}

function listBookings(from, to) {
  const start = parseDT(from, '00:00'), end = parseDT(addDays(to, 1), '00:00');
  return bookingCalendar().getEvents(start, end)
    .map(bookingFromEvent)
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
}

function readRecord(id) {
  const raw = props().getProperty('bk_' + String(id || ''));
  return raw ? JSON.parse(raw) : null;
}

function loadBooking(id, token) {
  const rec = readRecord(id);
  const notFound = new UserError('We could not find this appointment. It may have been cancelled.', 'NOT_FOUND');
  if (!rec || rec.token !== String(token || '')) throw notFound;
  const ev = bookingCalendar().getEventById(rec.eventId);
  if (!ev) {
    props().deleteProperty('bk_' + id);
    throw notFound;
  }
  const b = bookingFromEvent(ev);
  b.token = rec.token;
  return { b: b, ev: ev, rec: rec };
}

function removeBooking(found) {
  found.ev.deleteEvent();
  props().deleteProperty('bk_' + found.b.id);
}

function canChange(b, s) {
  return parseDT(b.date, b.time).getTime() - Date.now() >= s.cancelNoticeHours * 3600000;
}

function tooLateMessage(s) {
  return 'Appointments can’t be changed online within ' + s.cancelNoticeHours + ' hours of the visit. Please call us at ' + s.clinicPhone + '.';
}

function publicSummary(b, s) {
  return {
    id: b.id,
    token: b.token,
    typeId: b.typeId,
    typeName: b.typeName,
    mode: b.mode,
    date: b.date,
    time: b.time,
    end: b.end,
    duration: b.duration,
    name: b.name,
    email: b.email,
    phone: b.phone,
    canChange: canChange(b, s),
    cancelNoticeHours: s.cancelNoticeHours,
    clinicPhone: s.clinicPhone,
    clinicAddress: s.clinicAddress
  };
}

/* ───────────── 不可预约时段 ───────────── */

function getBlocksMonth(month) {
  return JSON.parse(props().getProperty('blk_' + month) || '[]');
}

function setBlocksMonth(month, list) {
  if (list.length) props().setProperty('blk_' + month, JSON.stringify(sortBlocks(list)));
  else props().deleteProperty('blk_' + month);
}

function getBlocks(from, to) {
  const list = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = nextMonth(m)) {
    getBlocksMonth(m).forEach(b => { if (b.date >= from && b.date <= to) list.push(b); });
  }
  return sortBlocks(list);
}

function allBlockMonths() {
  return props().getKeys().filter(k => k.indexOf('blk_') === 0).map(k => k.slice(4));
}

function sortBlocks(list) {
  return list.sort((a, b) => (a.date + (a.start || '') < b.date + (b.start || '') ? -1 : 1));
}

function cleanBlock(e, label) {
  const date = String(e.date || '');
  const start = e.start ? String(e.start) : '';
  const end = e.end ? String(e.end) : '';
  if (!isDate(date)) throw new UserError(label + '：日期格式不对（' + date + '）');
  if (start || end) {
    if (!isTime(start) || !isTime(end)) throw new UserError(label + '：' + date + ' 的时间格式不对');
    if (start >= end) throw new UserError(label + '：' + date + ' 的结束时间要晚于开始时间');
  }
  return { date: date, start: start || null, end: end || null, note: String(e.note || '').slice(0, 60) };
}

function cleanEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new UserError('排班表里没有读到日期');
  if (entries.length > 1000) throw new UserError('一次最多导入 1000 行');
  const seen = {};
  const list = [];
  entries.forEach((e, i) => {
    const b = cleanBlock(e, '第 ' + (i + 1) + ' 行');
    const key = b.date + b.start + b.end;
    if (!seen[key]) { seen[key] = true; list.push(b); }
  });
  return sortBlocks(list);
}

/* ───────────── 设置 ───────────── */

function getSettings() {
  const raw = props().getProperty('settings');
  return Object.assign({}, DEFAULT_SETTINGS, raw ? JSON.parse(raw) : {});
}

function cleanSettings(x) {
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const num = (v, min, max, label) => {
    const n = Number(v);
    if (!isFinite(n) || n < min || n > max || Math.round(n) !== n) throw new UserError(label + '要在 ' + min + '–' + max + ' 之间');
    return n;
  };
  const s = {
    clinicName: str(x.clinicName, 80) || DEFAULT_SETTINGS.clinicName,
    clinicPhone: str(x.clinicPhone, 30),
    clinicAddress: str(x.clinicAddress, 160),
    bookingPageUrl: str(x.bookingPageUrl, 300),
    notifyEmail: str(x.notifyEmail, 120),
    slotStep: num(x.slotStep, 5, 120, '时间间隔'),
    buffer: num(x.buffer, 0, 120, '缓冲时间'),
    minNoticeHours: num(x.minNoticeHours, 0, 720, '最少提前小时数'),
    maxAdvanceDays: num(x.maxAdvanceDays, 1, 400, '最远可约天数'),
    cancelNoticeHours: num(x.cancelNoticeHours, 0, 720, '取消/改期截止小时数'),
    usePrimaryCalendar: !!x.usePrimaryCalendar,
    weeklyHours: {},
    visitTypes: []
  };
  if (s.notifyEmail && !isEmail(s.notifyEmail)) throw new UserError('通知邮箱格式不对');
  if (s.bookingPageUrl && !/^https?:\/\//.test(s.bookingPageUrl)) throw new UserError('预约页网址要以 http:// 或 https:// 开头');

  const wh = x.weeklyHours || {};
  for (let d = 0; d < 7; d++) {
    const list = (wh[d] || []).map(iv => ({ start: String(iv.start), end: String(iv.end) }));
    list.forEach(iv => {
      if (!isTime(iv.start) || !isTime(iv.end) || iv.start >= iv.end) throw new UserError('出诊时间有一段填得不对（' + iv.start + '–' + iv.end + '）');
    });
    list.sort((a, b) => (a.start < b.start ? -1 : 1));
    for (let i = 1; i < list.length; i++) {
      if (list[i].start < list[i - 1].end) throw new UserError('同一天的出诊时间段有重叠');
    }
    s.weeklyHours[d] = list;
  }

  const ids = {};
  (x.visitTypes || []).forEach(v => {
    const t = {
      id: str(v.id, 20),
      name: str(v.name, 80),
      duration: num(v.duration, 5, 480, '看诊时长'),
      mode: v.mode === 'telehealth' ? 'telehealth' : 'in-person',
      description: str(v.description, 300),
      active: v.active !== false
    };
    if (!/^[a-z0-9_-]+$/.test(t.id) || ids[t.id]) throw new UserError('看诊类型编号重复或格式不对：' + t.id);
    if (!t.name) throw new UserError('看诊类型要有名称');
    ids[t.id] = true;
    s.visitTypes.push(t);
  });
  if (!s.visitTypes.some(v => v.active)) throw new UserError('至少要开放一种看诊类型');
  return s;
}

function findType(s, id, includeInactive) {
  const t = s.visitTypes.filter(v => v.id === id && (includeInactive || v.active))[0];
  if (!t && !includeInactive) throw new UserError('Please choose a visit type.');
  return t || null;
}

/* ───────────── 邮件 ───────────── */

function notifyBooked(b, s, alsoDoctor) {
  if (b.email) {
    sendMail(b.email, 'Your appointment is confirmed — ' + s.clinicName,
      emailHtml(s, 'Your appointment is confirmed', 'Hi ' + b.name + ', thank you for booking with us.', b, true),
      [icsFile(b, s)]);
  }
  if (alsoDoctor) {
    sendMail(doctorEmail(s), '新预约：' + zhWhen(b) + ' ' + b.name, doctorText('有新的网站预约', b), []);
  }
}

function notifyCancelled(b, s, by, reason) {
  if (b.email) {
    const intro = by === 'clinic'
      ? 'Hi ' + b.name + ', we’re sorry — the clinic had to cancel your appointment.' + (reason ? ' Reason: ' + reason : '') + ' Please book a new time or call us.'
      : 'Hi ' + b.name + ', your appointment has been cancelled as requested.';
    sendMail(b.email, 'Your appointment has been cancelled — ' + s.clinicName,
      emailHtml(s, 'Appointment cancelled', intro, b, false), []);
  }
  if (by === 'patient') {
    sendMail(doctorEmail(s), '预约已取消：' + zhWhen(b) + ' ' + b.name, doctorText('病人在网上取消了预约', b), []);
  }
}

function notifyRescheduled(b, old, s, by) {
  if (b.email) {
    sendMail(b.email, 'Your appointment has been rescheduled — ' + s.clinicName,
      emailHtml(s, 'Your appointment has been rescheduled',
        'Hi ' + b.name + ', ' + (by === 'clinic' ? 'the clinic has moved your appointment' : 'your appointment has moved') +
        ' from ' + prettyDate(old.date) + ' at ' + prettyTime(old.time) + ' to the new time below.' +
        (by === 'clinic' ? ' If this time doesn’t work for you, please call us or use the link below.' : ''), b, true),
      [icsFile(b, s)]);
  }
  if (by === 'clinic') return;
  sendMail(doctorEmail(s), '预约改期：' + b.name + ' ' + zhWhen(old) + ' → ' + zhWhen(b),
    doctorText('病人在网上改了预约时间（原来是 ' + zhWhen(old) + '）', b), []);
}

function sendMail(to, subject, body, attachments) {
  const isHtml = body.charAt(0) === '<';
  try {
    MailApp.sendEmail({
      to: to,
      subject: subject,
      name: getSettings().clinicName,
      htmlBody: isHtml ? body : undefined,
      body: isHtml ? subject : body,
      attachments: attachments
    });
  } catch (err) {
    log('邮件没发出去（' + to + '）：' + err.message);
  }
}

function doctorEmail(s) {
  return s.notifyEmail || Session.getEffectiveUser().getEmail();
}

function doctorText(title, b) {
  return [
    title,
    '',
    '时间：' + zhWhen(b) + '–' + b.end,
    '类型：' + b.typeName + (b.mode === 'telehealth' ? '（远程视频）' : '（到诊所）'),
    '病人：' + b.name,
    '电话：' + (b.phone || '—'),
    '邮箱：' + (b.email || '—'),
    '预约编号：' + b.id
  ].join('\n');
}

function emailHtml(s, title, intro, b, showManage) {
  const where = b.mode === 'telehealth'
    ? 'Telehealth video visit — we will email you a secure link before your visit.'
    : s.clinicAddress;
  const rows = [
    ['Visit', b.typeName + ' (' + b.duration + ' min)'],
    ['When', prettyDate(b.date) + ', ' + prettyTime(b.time) + ' – ' + prettyTime(b.end) + ' Pacific Time'],
    ['Where', where],
    ['Confirmation #', b.id]
  ];
  let manage = '';
  if (showManage) {
    const link = s.bookingPageUrl && b.token
      ? s.bookingPageUrl + (s.bookingPageUrl.indexOf('?') < 0 ? '?' : '&') + 'b=' + encodeURIComponent(b.id) + '&t=' + encodeURIComponent(b.token)
      : '';
    manage = '<p style="margin:20px 0 0">Need to change or cancel? ' +
      (link ? '<a href="' + escHtml(link) + '" style="color:#0B6477;font-weight:600">Manage your appointment online</a> or call ' : 'Please call ') +
      '<a href="tel:' + escHtml(s.clinicPhone) + '" style="color:#0B6477">' + escHtml(s.clinicPhone) + '</a>' +
      ' at least ' + s.cancelNoticeHours + ' hours before your visit.</p>' +
      '<p style="margin:12px 0 0;color:#4A6670;font-size:14px">For your privacy, please don’t send medical details by email. We will send you a secure intake form before your first visit.</p>';
  }
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#12313A;max-width:560px;margin:0 auto;padding:24px;font-size:16px;line-height:1.5">' +
    '<p style="margin:0 0 4px;font-weight:700;color:#0B6477">' + escHtml(s.clinicName) + '</p>' +
    '<h1 style="font-size:22px;margin:0 0 16px">' + escHtml(title) + '</h1>' +
    '<p style="margin:0 0 16px">' + escHtml(intro) + '</p>' +
    '<table role="presentation" style="border-collapse:collapse;width:100%">' +
    rows.map(r => '<tr><td style="padding:8px 12px 8px 0;color:#4A6670;vertical-align:top;white-space:nowrap">' + r[0] +
      '</td><td style="padding:8px 0;font-weight:600">' + escHtml(r[1]) + '</td></tr>').join('') +
    '</table>' + manage +
    '<p style="margin:24px 0 0;color:#4A6670;font-size:14px">' + escHtml(s.clinicName) + ' · ' + escHtml(s.clinicAddress) + ' · ' + escHtml(s.clinicPhone) + '</p>' +
    '</div>';
}

function icsFile(b, s) {
  const start = parseDT(b.date, b.time), end = parseDT(b.date, b.end);
  const z = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = t => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EternaWell Medicine//Booking//EN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + b.id + '@eternawell-booking',
    'DTSTAMP:' + z(new Date()),
    'DTSTART:' + z(start),
    'DTEND:' + z(end),
    'SUMMARY:' + esc(b.typeName + ' — ' + s.clinicName),
    'LOCATION:' + esc(b.mode === 'telehealth' ? 'Telehealth video visit' : s.clinicAddress),
    'DESCRIPTION:' + esc('Confirmation #' + b.id + '. To change or cancel, call ' + s.clinicPhone + '.'),
    'END:VEVENT', 'END:VCALENDAR'
  ];
  return Utilities.newBlob(lines.join('\r\n'), 'text/calendar', 'appointment.ics');
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ZH_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function prettyDate(date) {
  const p = date.split('-').map(Number);
  return DAY_NAMES[weekday(date)] + ', ' + MONTH_NAMES[p[1] - 1] + ' ' + p[2] + ', ' + p[0];
}

function prettyTime(hm) {
  const m = toMin(hm), h = Math.floor(m / 60);
  return ((h + 11) % 12 + 1) + ':' + pad(m % 60) + (h < 12 ? ' AM' : ' PM');
}

function zhWhen(b) {
  return b.date + '（' + ZH_DAYS[weekday(b.date)] + '）' + b.time;
}

/* ───────────── 后台登录 ───────────── */

function ensureInit() {
  if (!props().getProperty('secret')) props().setProperty('secret', Utilities.getUuid() + Utilities.getUuid());
  if (!props().getProperty('pw_hash')) setPassword(DEFAULT_PASSWORD);
}

function setPassword(pw) {
  const salt = Utilities.getUuid();
  props().setProperties({ pw_salt: salt, pw_hash: hash(salt + pw) });
  props().setProperty('secret', Utilities.getUuid() + Utilities.getUuid()); // 改密码后旧的登录全部失效
}

function checkPassword(pw) {
  return hash(props().getProperty('pw_salt') + pw) === props().getProperty('pw_hash');
}

function hash(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

function makeToken() {
  const exp = String(Date.now() + 12 * 3600000);
  return exp + '.' + sign(exp);
}

function sign(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, props().getProperty('secret')));
}

function requireAdmin(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || Number(parts[0]) < Date.now() || sign(parts[0]) !== parts[1]) {
    throw new UserError('登录已过期，请重新登录', 'AUTH');
  }
}

/* ───────────── 小工具 ───────────── */

let _calendar = null;
function bookingCalendar() {
  if (_calendar) return _calendar;
  const id = props().getProperty('calendarId');
  let cal = id ? CalendarApp.getCalendarById(id) : null;
  if (!cal) {
    cal = CalendarApp.createCalendar(CALENDAR_NAME, { timeZone: TZ });
    props().setProperty('calendarId', cal.getId());
  }
  return (_calendar = cal);
}

function props() {
  return PropertiesService.getScriptProperties();
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function log(msg) {
  const list = JSON.parse(props().getProperty('log') || '[]');
  list.unshift({ at: fmt(new Date(), 'yyyy-MM-dd HH:mm'), msg: msg });
  props().setProperty('log', JSON.stringify(list.slice(0, 60)));
}

function throttle(email) {
  const cache = CacheService.getScriptCache();
  const key = 'th_' + email;
  const n = Number(cache.get(key) || 0);
  if (n >= 5) throw new UserError('Too many booking attempts. Please call us at ' + getSettings().clinicPhone + '.');
  cache.put(key, String(n + 1), 3600);
}

function cleanPatient(req, strict) {
  const name = String(req.name || '').trim().replace(/\s+/g, ' ');
  const phone = String(req.phone || '').trim();
  const email = String(req.email || '').trim().toLowerCase();
  const digits = phone.replace(/\D/g, '');
  if (name.length < 2 || name.length > 80) throw new UserError(strict ? 'Please enter your full name.' : '请填写病人姓名');
  if ((strict || phone) && (digits.length < 10 || digits.length > 15)) {
    throw new UserError(strict ? 'Please enter a valid phone number, including area code.' : '电话号码不对（要带区号）');
  }
  if ((strict || email) && (!isEmail(email) || email.length > 120)) {
    throw new UserError(strict ? 'Please enter a valid email address.' : '邮箱格式不对');
  }
  if (!phone && !email) throw new UserError('电话和邮箱至少填一个');
  return { name: name, phone: phone, email: email };
}

function checkRange(from, to, maxDays) {
  if (!isDate(from) || !isDate(to) || from > to) throw new UserError('Bad date range');
  if (addDays(from, maxDays) < to) throw new UserError('Date range too long');
}

function randomCode(len) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function parseDT(date, time) {
  return Utilities.parseDate(date + ' ' + time, TZ, 'yyyy-MM-dd HH:mm');
}

function fmt(d, pattern) {
  return Utilities.formatDate(d, TZ, pattern);
}

function todayStr() {
  return fmt(new Date(), 'yyyy-MM-dd');
}

function addDays(date, n) {
  return fmt(new Date(parseDT(date, '12:00').getTime() + n * 86400000), 'yyyy-MM-dd');
}

function nextMonth(m) {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
  return mo === 12 ? (y + 1) + '-01' : y + '-' + pad(mo + 1);
}

/** 0 = 周日 … 6 = 周六 */
function weekday(date) {
  return Number(fmt(parseDT(date, '12:00'), 'u')) % 7;
}

function toMin(hm) {
  const p = String(hm).split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

function toHM(min) {
  return pad(Math.floor(min / 60)) + ':' + pad(min % 60);
}

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function isDate(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
}

function isTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
