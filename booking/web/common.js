// 两个页面共用：连接后端（或演示模式）、日期和时间的小工具
(function () {
  const cfg = window.EW_CONFIG || {};
  const DEMO = !cfg.API_URL || cfg.API_URL === 'demo';
  const base = ((document.currentScript && document.currentScript.src) || '').replace(/[^/]*$/, '');
  const TZ = 'America/Los_Angeles';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  // 演示模式：先加载模拟的 Google 服务，再加载真正的后端代码
  const ready = DEMO
    ? loadScript(base + 'demo-backend.js').then(() => loadScript(base + '../backend/Code.js'))
    : Promise.resolve();

  async function call(action, payload) {
    await ready;
    const body = JSON.stringify(Object.assign({ action: action }, payload || {}));
    let res;
    if (DEMO) {
      await new Promise(r => setTimeout(r, 200));
      res = window.EWDemo.handle(body);
    } else {
      let r;
      try {
        r = await fetch(cfg.API_URL, { method: 'POST', body: body });
      } catch (e) {
        throw new Error('Network error. Please check your connection and try again.');
      }
      if (!r.ok) throw new Error('Server error (' + r.status + ')');
      res = await r.json();
    }
    if (!res.ok) {
      const err = new Error(res.error);
      err.code = res.code;
      throw err;
    }
    return res.data;
  }

  /* 日期字符串 YYYY-MM-DD 的运算一律当作"日历上的一天"，不涉及时区 */
  const pad = n => (n < 10 ? '0' : '') + n;
  const ymd = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  function toUTC(date) {
    const p = date.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  }
  function addDays(date, n) {
    const d = toUTC(date);
    d.setUTCDate(d.getUTCDate() + n);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const weekday = date => toUTC(date).getUTCDay();
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  function shiftMonth(month, n) {
    const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1 + n;
    return (y + Math.floor(m / 12)) + '-' + pad(((m % 12) + 12) % 12 + 1);
  }
  const toMin = hm => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const ZH_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function prettyDate(date, withYear) {
    const p = date.split('-').map(Number);
    return DAYS[weekday(date)] + ', ' + MONTHS[p[1] - 1] + ' ' + p[2] + (withYear === false ? '' : ', ' + p[0]);
  }
  function prettyTime(hm) {
    const m = toMin(hm), h = Math.floor(m / 60);
    return ((h + 11) % 12 + 1) + ':' + pad(m % 60) + (h < 12 ? ' AM' : ' PM');
  }
  const monthTitle = month => MONTHS[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4);
  function zhDate(date) {
    const p = date.split('-').map(Number);
    return p[1] + '月' + p[2] + '日 ' + ZH_DAYS[weekday(date)];
  }

  /** 诊所时间（太平洋时间）→ UTC 的 Date，用于"加到日历" */
  function clinicTimeToDate(date, hm) {
    const p = date.split('-').map(Number);
    const guess = Date.UTC(p[0], p[1] - 1, p[2], Number(hm.slice(0, 2)), Number(hm.slice(3, 5)));
    const offset = t => {
      const o = {};
      new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(t)).forEach(x => { o[x.type] = x.value; });
      return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute) - t;
    };
    let t = guess - offset(guess);
    t = guess - offset(t);
    return new Date(t);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const storage = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 忽略 */ } },
    remove(k) { try { sessionStorage.removeItem(k); } catch (e) { /* 忽略 */ } }
  };

  window.EW = {
    DEMO: DEMO, TZ: TZ, ready: ready, call: call,
    pad: pad, ymd: ymd, addDays: addDays, weekday: weekday, daysInMonth: daysInMonth, shiftMonth: shiftMonth, toMin: toMin,
    prettyDate: prettyDate, prettyTime: prettyTime, monthTitle: monthTitle, zhDate: zhDate, ZH_DAYS: ZH_DAYS,
    clinicTimeToDate: clinicTimeToDate, esc: esc, storage: storage
  };
})();
