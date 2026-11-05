/**
 * 演示模式：在浏览器里模拟 Google Apps Script 的服务（日历、脚本属性、邮件……），
 * 让 backend/Code.js 不连 Google 也能原样运行。数据存在本浏览器的 localStorage，邮件进"演示邮箱"不会真的发出。
 * 自动化测试（test/run-tests.js）也用这份模拟。
 */
(function (root) {
  const PREFIX = 'ewdemo:';
  const memory = {};
  const store = {
    get(k) {
      try { if (root.localStorage) return root.localStorage.getItem(PREFIX + k); } catch (e) { /* 隐私模式等 */ }
      return k in memory ? memory[k] : null;
    },
    set(k, v) {
      try { if (root.localStorage) { root.localStorage.setItem(PREFIX + k, v); return; } } catch (e) { /* 退回内存 */ }
      memory[k] = v;
    },
    remove(k) {
      try { if (root.localStorage) root.localStorage.removeItem(PREFIX + k); } catch (e) { /* 忽略 */ }
      delete memory[k];
    },
    keys() {
      const list = Object.keys(memory);
      try {
        if (root.localStorage) {
          for (let i = 0; i < root.localStorage.length; i++) {
            const k = root.localStorage.key(i);
            if (k.indexOf(PREFIX) === 0) list.push(k.slice(PREFIX.length));
          }
        }
      } catch (e) { /* 忽略 */ }
      return list;
    },
    json(k, fallback) {
      const raw = this.get(k);
      return raw ? JSON.parse(raw) : fallback;
    }
  };

  /* ── 脚本属性 ── */
  const P = 'prop:';
  const scriptProps = {
    getProperty: k => store.get(P + k),
    setProperty(k, v) { store.set(P + k, String(v)); return this; },
    setProperties(obj) { Object.keys(obj).forEach(k => store.set(P + k, String(obj[k]))); return this; },
    deleteProperty(k) { store.remove(P + k); return this; },
    getKeys: () => store.keys().filter(k => k.indexOf(P) === 0).map(k => k.slice(P.length))
  };
  root.PropertiesService = { getScriptProperties: () => scriptProps };

  /* ── 缓存、锁 ── */
  const cache = {};
  root.CacheService = {
    getScriptCache: () => ({
      get: k => (cache[k] && cache[k].exp > Date.now() ? cache[k].v : null),
      put: (k, v, sec) => { cache[k] = { v: v, exp: Date.now() + (sec || 600) * 1000 }; },
      remove: k => { delete cache[k]; }
    })
  };
  root.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };

  /* ── 时区换算（Utilities.formatDate / parseDate 只实现 Code.js 用到的格式） ── */
  const dtfCache = {};
  function partsIn(date, tz) {
    const f = dtfCache[tz] || (dtfCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }));
    const o = {};
    f.formatToParts(date).forEach(p => { o[p.type] = p.value; });
    return o;
  }
  function offsetMs(t, tz) {
    const p = partsIn(new Date(t), tz);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
  }
  const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

  function bytesToB64(bytes) {
    let s = '';
    bytes.forEach(b => { s += String.fromCharCode(b & 255); });
    return root.btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
  }
  function fakeHash(text) {
    // 演示用的非加密哈希，只为让流程跑通
    const out = [];
    for (let r = 0; r < 32; r++) {
      let h = 2166136261 ^ r;
      for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
      out.push(h & 255);
    }
    return out;
  }

  root.Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    formatDate(date, tz, pattern) {
      const p = partsIn(date, tz);
      return pattern.replace(/yyyy|MM|dd|HH|mm|ss|u/g, t => ({
        yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second, u: String(WD[p.weekday])
      }[t]));
    },
    parseDate(str, tz) {
      const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(str);
      if (!m) throw new Error('parseDate: unsupported ' + str);
      const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
      let t = guess - offsetMs(guess, tz);
      const again = guess - offsetMs(t, tz);
      if (again !== t) t = again;
      return new Date(t);
    },
    getUuid() {
      if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      });
    },
    computeDigest: (alg, text) => fakeHash(String(text)),
    computeHmacSha256Signature: (text, key) => fakeHash(key + '|' + text),
    base64EncodeWebSafe: bytesToB64,
    newBlob: (data, type, name) => ({ data: data, type: type, name: name })
  };

  /* ── 日历 ── */
  function loadEvents() { return store.json('events', []); }
  function saveEvents(list) { store.set('events', JSON.stringify(list)); }

  function makeEvent(id) {
    const find = () => loadEvents().filter(e => e.id === id)[0];
    const update = fn => {
      const list = loadEvents();
      list.forEach(e => { if (e.id === id) fn(e); });
      saveEvents(list);
    };
    return {
      getId: () => id,
      getTitle: () => find().title,
      getDescription: () => find().description || '',
      getStartTime: () => new Date(find().start),
      getEndTime: () => new Date(find().end),
      isAllDayEvent: () => !!find().allDay,
      getTag: k => { const v = find().tags[k]; return v == null ? null : v; },
      setTag(k, v) { update(e => { e.tags[k] = String(v); }); return this; },
      setTime(s, e2) { update(e => { e.start = s.getTime(); e.end = e2.getTime(); }); return this; },
      deleteEvent: () => saveEvents(loadEvents().filter(e => e.id !== id))
    };
  }

  function makeCalendar(cal) {
    return {
      getId: () => cal.id,
      getName: () => cal.name,
      getEvents(start, end) {
        return loadEvents()
          .filter(e => e.calId === cal.id && e.start < end.getTime() && e.end > start.getTime())
          .sort((a, b) => a.start - b.start)
          .map(e => makeEvent(e.id));
      },
      getEventById(id) {
        return loadEvents().some(e => e.id === id && e.calId === cal.id) ? makeEvent(id) : null;
      },
      createEvent(title, start, end, opts) {
        const id = 'ev_' + Math.random().toString(36).slice(2, 12) + '@demo';
        const list = loadEvents();
        list.push({ id: id, calId: cal.id, title: title, start: start.getTime(), end: end.getTime(),
          description: (opts && opts.description) || '', tags: {} });
        saveEvents(list);
        return makeEvent(id);
      }
    };
  }

  root.CalendarApp = {
    getCalendarById(id) {
      const cal = store.json('calendars', []).filter(c => c.id === id)[0];
      return cal ? makeCalendar(cal) : null;
    },
    createCalendar(name) {
      const cal = { id: 'cal_' + Math.random().toString(36).slice(2, 10), name: name };
      const list = store.json('calendars', []);
      list.push(cal);
      store.set('calendars', JSON.stringify(list));
      return makeCalendar(cal);
    },
    getDefaultCalendar: () => makeCalendar({ id: 'primary', name: '医生的个人日历（演示）' })
  };

  /* ── 邮件、身份、输出 ── */
  root.MailApp = {
    sendEmail(msg) {
      const box = store.json('outbox', []);
      box.unshift({
        at: new Date().toISOString(), to: msg.to, subject: msg.subject,
        html: msg.htmlBody || '', text: msg.htmlBody ? '' : msg.body,
        attachments: (msg.attachments || []).map(a => a.name)
      });
      store.set('outbox', JSON.stringify(box.slice(0, 50)));
    },
    getRemainingDailyQuota: () => 100
  };
  root.Session = { getEffectiveUser: () => ({ getEmail: () => 'doctor@example.com（演示）' }) };
  root.ContentService = {
    MimeType: { JSON: 'JSON' },
    createTextOutput: text => ({ content: text, setMimeType() { return this; } })
  };

  root.EWDemo = {
    handle(body) {
      return JSON.parse(root.doPost({ postData: { contents: body } }).content);
    },
    outbox: () => store.json('outbox', []),
    clearOutbox: () => store.set('outbox', '[]'),
    /** 演示用：在"医生个人日历"里放一个事件，用来试"同时避开个人日历"这个开关 */
    addPrimaryEvent(title, start, end) {
      const list = loadEvents();
      list.push({ id: 'ev_p' + Math.random().toString(36).slice(2, 10), calId: 'primary', title: title,
        start: start.getTime(), end: end.getTime(), description: '', tags: {} });
      saveEvents(list);
    },
    resetAll() {
      store.keys().forEach(k => store.remove(k));
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
