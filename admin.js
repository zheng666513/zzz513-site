/* ==========================================================================
   zzz513 内容管理 · 核心
   ---------------------------------------------------------------------------
   请求封装 / 登录 / 路由 / 通用组件（弹窗、菜单、提示）/ 仪表盘
   无框架、无构建，全部原生实现
   ========================================================================== */

var API_BASE = 'https://api.zzz513.xyz';
var SITE_HOME = 'https://zzz513.xyz';

/* --------------------------------------------------------------------------
   会话令牌
   接口在 api.zzz513.xyz，页面可能在别的域名下（IQOO 那两个新域名），
   对浏览器来说是跨站请求 —— 第三方 cookie 可能被拒，光靠 cookie 会「一登录就过期」。
   所以登录时后端同时返回 token，存这里，每个请求用 Authorization 头带上。
   cookie 仍然保留，同站访问时两条通道同时有效。
   -------------------------------------------------------------------------- */
var TOKEN_KEY = 'zzz513.adminToken';

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* 隐私模式禁用 storage 时忽略 */ }
}

/* 主题预设：前后台共用同一套色板 */
/* 六种自然色，明度统一在 60%–68% 之间；不提供高饱和预设 */
var THEMES = {
  sage:  { name: '灰绿', accent: '#a3b5a0' },
  clay:  { name: '陶土', accent: '#b09280' },
  mist:  { name: '雾蓝', accent: '#93a3b0' },
  oat:   { name: '燕麦', accent: '#b8a98c' },
  lotus: { name: '藕粉', accent: '#b09a9d' },
  ink:   { name: '墨',   accent: '#8c8c86' }
};

var state = {
  session: null,
  settings: null,
  customPassword: false,
  categories: [],
  tags: [],
  pending: 0,
  view: 'dashboard'
};

var Views = {};

/* ==========================================================================
   一、工具
   ========================================================================== */

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n) {
  var v = Number(n);
  if (!isFinite(v)) return '0';
  return v.toLocaleString('zh-CN');
}

function pad(n) { return String(n).padStart(2, '0'); }

function fmtTime(ms) {
  if (!ms) return '—';
  var d = new Date(Number(ms));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function fmtDate(ms) {
  if (!ms) return '—';
  var d = new Date(Number(ms));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function todayInput() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function ago(ms) {
  var t = Number(ms) || 0;
  if (!t) return '—';
  var diff = Date.now() - t;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + ' 天前';
  return fmtDate(t);
}

function hexToRgba(hex, alpha) {
  var h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  var n = parseInt(h, 16);
  if (!isFinite(n)) return 'rgba(163,181,160,' + alpha + ')';
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
}

/** 同色系压暗，给需要对比度的文字用 */
function shadeHex(hex, k) {
  var h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  var n = parseInt(h, 16);
  if (!isFinite(n)) return '#5f7359';
  return '#' + [16, 8, 0].map(function (shift) {
    var v = Math.round(((n >> shift) & 255) * k);
    return ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2);
  }).join('');
}

/** 按扩展名给角标配色 */
var EXT_COLOR = {
  md: '#58a6ff', css: '#4dd4c0', sh: '#f0b429', json: '#c297ff', csv: '#7ee787',
  js: '#f0d049', ts: '#58a6ff', zip: '#ffa657', pdf: '#ff7b72', png: '#ff8fa3',
  jpg: '#ff8fa3', svg: '#f0b429', txt: '#9aa4b0'
};

function extColor(type) {
  return EXT_COLOR[String(type || '').toLowerCase()] || '#7c8cff';
}

/* ==========================================================================
   二、请求
   ========================================================================== */

function ApiError(message, code) {
  this.name = 'ApiError';
  this.message = message;
  this.code = code;
}

async function req(path, opt) {
  opt = opt || {};
  var init = {
    method: opt.method || 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: {}
  };
  if (opt.body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opt.body);
  }

  /* 令牌通道优先：跨站时 cookie 可能被浏览器拦掉 */
  var token = getToken();
  if (token) init.headers['authorization'] = 'Bearer ' + token;

  var res;
  try {
    res = await fetch(API_BASE + path, init);
  } catch (e) {
    throw new ApiError('连不上接口，请检查网络或稍后重试', 0);
  }

  var payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }

  if (!payload || typeof payload !== 'object') {
    throw new ApiError('接口返回格式异常（HTTP ' + res.status + '）', res.status);
  }

  if (payload.code !== 0) {
    if (res.status === 401) {
      /* 令牌失效就丢掉，避免拿着坏 token 反复撞 401 */
      setToken('');
      if (!opt.noAuthRedirect) showLogin('登录已过期，请重新登录');
    }
    throw new ApiError(payload.message || '请求失败', payload.code);
  }
  return payload.data;
}

/* 上传/下载用的原始请求（不走 JSON 包装） */
async function reqRaw(path) {
  var headers = {};
  var token = getToken();
  if (token) headers['authorization'] = 'Bearer ' + token;
  var res = await fetch(API_BASE + path, { credentials: 'include', cache: 'no-store', headers: headers });
  if (!res.ok) throw new ApiError('导出失败（HTTP ' + res.status + '）', res.status);
  return res;
}

/* ==========================================================================
   三、提示 / 弹窗 / 菜单
   ========================================================================== */

var toastTimer = null;
function toast(message, type) {
  var el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.className = 'toast'; }, 2600);
}

var activeModal = null;

function openModal(opts) {
  closeModal();
  var mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML =
    '<div class="modal-card ' + (opts.size || '') + '" role="dialog" aria-modal="true">' +
      '<div class="modal-head">' +
        '<h2>' + esc(opts.title || '') + '</h2>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-icon btn-ghost" data-close aria-label="关闭">✕</button>' +
      '</div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      (opts.footer ? '<div class="modal-foot">' + opts.footer + '</div>' : '') +
    '</div>';

  $('#modalRoot').appendChild(mask);
  activeModal = mask;

  mask.addEventListener('click', function (e) {
    if (e.target === mask || e.target.closest('[data-close]')) closeModal();
  });

  var first = mask.querySelector('input:not([type=checkbox]), textarea, select');
  if (first && !opts.noFocus) setTimeout(function () { first.focus(); }, 40);

  if (typeof opts.onMount === 'function') opts.onMount(mask);
  bindGlow(mask);
  return mask;
}

function closeModal() {
  if (activeModal && activeModal.parentNode) activeModal.parentNode.removeChild(activeModal);
  activeModal = null;
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    closeModal();
    closeMenu();
    document.body.classList.remove('nav-open');
  }
});

function confirmDialog(opts) {
  return new Promise(function (resolve) {
    var mask = openModal({
      title: opts.title || '请确认',
      size: 'narrow',
      body: '<p style="margin:0 0 4px;font-size:13.5px;color:var(--text);line-height:1.7">' + (opts.message || '') + '</p>' +
            (opts.detail ? '<div class="hint" style="margin-top:8px">' + opts.detail + '</div>' : ''),
      footer: '<div class="spacer"></div>' +
              '<button class="btn" data-close>取消</button>' +
              '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-ok>' + esc(opts.okText || '确定') + '</button>',
      noFocus: true
    });
    mask.querySelector('[data-ok]').addEventListener('click', function () {
      closeModal();
      resolve(true);
    });
    mask.addEventListener('click', function (e) {
      if (e.target === mask || e.target.closest('[data-close]')) resolve(false);
    });
  });
}

var menuEl = null;
function closeMenu() {
  if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
  menuEl = null;
}

function openMenu(anchor, items) {
  closeMenu();
  var menu = document.createElement('div');
  menu.className = 'menu';
  items.forEach(function (item) {
    if (item === '-') {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));
      return;
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = item.danger ? 'danger' : '';
    btn.innerHTML = '<span>' + esc(item.icon || '') + '</span><span>' + esc(item.label) + '</span>';
    btn.addEventListener('click', function () {
      closeMenu();
      item.onClick();
    });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  menuEl = menu;

  var r = anchor.getBoundingClientRect();
  var mw = menu.offsetWidth;
  var mh = menu.offsetHeight;
  var left = Math.min(window.innerWidth - mw - 10, Math.max(10, r.right - mw));
  var top = r.bottom + 6;
  if (top + mh > window.innerHeight - 10) top = Math.max(10, r.top - mh - 6);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  setTimeout(function () {
    document.addEventListener('click', onDocClick, { once: true });
  }, 0);

  function onDocClick(e) {
    if (menu.contains(e.target)) return;
    closeMenu();
  }
}

/* 光圈跟随：只在开启时生效，节流到一帧 */
var glowPending = null;
document.addEventListener('pointermove', function (e) {
  if (!document.body.classList.contains('glow')) return;
  if (!e.target || !e.target.closest) return;
  var target = e.target.closest('.glow-target');
  if (!target) return;
  if (glowPending) cancelAnimationFrame(glowPending);
  glowPending = requestAnimationFrame(function () {
    var r = target.getBoundingClientRect();
    target.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    target.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });
}, { passive: true });

function bindGlow(root) {
  $$('.btn, .stat, .panel', root || document).forEach(function (el) {
    el.classList.add('glow-target');
  });
}

/* ==========================================================================
   四、外观（主题色 / 毛玻璃 / 光圈）
   ========================================================================== */

function applyAppearance(settings) {
  if (!settings) return;
  var accent = settings.accent || (THEMES[settings.theme] || THEMES.sage).accent;
  var root = document.documentElement;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-soft', hexToRgba(accent, 0.14));
  root.style.setProperty('--accent-line', hexToRgba(accent, 0.5));
  root.style.setProperty('--accent-deep', shadeHex(accent, 0.66));

  document.body.classList.toggle('glass', settings.glass === '1' || settings.glass === true);
  document.body.classList.toggle('glow', settings.glow === '1' || settings.glow === true);
}

/* ==========================================================================
   五、登录 / 会话
   ========================================================================== */

function showLogin(message) {
  $('#appView').hidden = true;
  $('#loginView').hidden = false;
  if (message) $('#loginMsg').textContent = message;
  var input = $('#password');
  if (input) {
    input.value = '';
    setTimeout(function () { input.focus(); }, 60);
  }
}

async function showApp(session) {
  state.session = session;
  $('#loginView').hidden = true;
  $('#appView').hidden = false;

  $('#sideExpire').textContent = fmtDate(session.expiresAt);
  $('#sideLogin').textContent = session.lastLogin
    ? '上次登录：' + ago(session.lastLogin.createdAt)
    : '上次登录：首次登录';

  try {
    var res = await req('/api/admin/settings');
    state.settings = res.settings;
    state.customPassword = res.customPassword;
    applyAppearance(state.settings);
  } catch (e) {
    /* 设置读取失败不影响使用 */
  }

  loadBadge();
  onRoute();
}

async function loadBadge() {
  try {
    var stats = await req('/api/admin/stats');
    state.pending = stats.commentPending || 0;
    var pill = $('#navPending');
    pill.hidden = !state.pending;
    pill.textContent = state.pending;
  } catch (e) {
    /* ignore */
  }
}

async function doLogin(e) {
  if (e) e.preventDefault();
  var btn = $('#loginBtn');
  var msg = $('#loginMsg');
  var password = $('#password').value;
  if (!password) {
    msg.textContent = '请输入密码';
    return;
  }

  btn.disabled = true;
  btn.textContent = '登录中…';
  msg.textContent = '';

  try {
    var data = await req('/api/login', {
      method: 'POST',
      body: { password: password, remember: $('#remember').checked },
      noAuthRedirect: true
    });
    /* 先落 token，紧接着的会话请求就靠它 —— 跨站时 cookie 可能没被浏览器收下 */
    if (data && data.token) setToken(data.token);
    toast('登录成功');
    var session = { role: 'admin', expiresAt: data.expiresAt, lastLogin: null };
    try {
      session = await req('/api/admin/session', { noAuthRedirect: true });
    } catch (_) { /* 忽略 */ }
    await showApp(session);
  } catch (err) {
    msg.textContent = err.message || '登录失败';
    $('#password').select();
  } finally {
    btn.disabled = false;
    btn.textContent = '登录';
  }
}

async function doLogout() {
  var yes = await confirmDialog({ title: '退出登录', message: '确定要退出当前后台吗？', okText: '退出' });
  if (!yes) return;
  try { await req('/api/logout', { method: 'POST', noAuthRedirect: true }); } catch (_) { /* ignore */ }
  setToken('');
  state.session = null;
  showLogin('已退出登录');
}

/* ==========================================================================
   六、路由
   ========================================================================== */

var TITLES = {
  dashboard: '仪表盘',
  resources: '资料管理',
  files: '文件库',
  categories: '分类管理',
  tags: '标签管理',
  comments: '评论管理',
  downloads: '下载统计',
  logs: '操作日志',
  egg: '彩蛋',
  settings: '站点设置',
  backup: '备份与恢复',
  security: '账号安全'
};

function go(view) {
  if (location.hash === '#/' + view) onRoute();
  else location.hash = '#/' + view;
}

function onRoute() {
  if (!state.session) return;
  var view = (location.hash || '').replace(/^#\/?/, '') || 'dashboard';
  if (!Views[view]) view = 'dashboard';
  state.view = view;

  $$('.nav-item').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-view') === view);
  });
  $('#pageTitle').textContent = TITLES[view] || '仪表盘';
  document.body.classList.remove('nav-open');
  window.scrollTo(0, 0);

  var box = $('#view');
  box.innerHTML = '';
  Views[view](box).then(function () {
    bindGlow(box);
  }).catch(function (err) {
    console.error(err);
    box.innerHTML = emptyBlock('加载失败', err.message || '请稍后重试') +
      '<div style="text-align:center;margin-top:12px"><button class="btn" onclick="onRoute()">重新加载</button></div>';
  });
}

function emptyBlock(title, detail) {
  return '<div class="empty"><div><b>' + esc(title) + '</b></div>' +
    (detail ? '<div style="font-size:12.5px;color:var(--dim)">' + esc(detail) + '</div>' : '') + '</div>';
}

function skeletonRows(n) {
  var html = '';
  for (var i = 0; i < n; i++) {
    html += '<div class="sk-row"><div class="sk a"></div><div class="sk b"></div><div class="sk c"></div></div>';
  }
  return html;
}

/* ==========================================================================
   七、分页组件
   ========================================================================== */

function pagerHtml(total, page, pageSize) {
  var pages = Math.max(1, Math.ceil(total / pageSize));
  var list = [];
  var arr = [];
  for (var i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) arr.push(i);
    else if (arr[arr.length - 1] !== '...') arr.push('...');
  }
  arr.forEach(function (p) {
    if (p === '...') list.push('<span style="color:var(--dim);padding:0 2px">…</span>');
    else list.push('<button class="btn btn-sm' + (p === page ? ' btn-primary' : '') + '" data-page="' + p + '">' + p + '</button>');
  });

  return '<div class="pager">' +
      '<span class="info">共 <b>' + fmtNum(total) + '</b> 条 · 第 ' + page + ' / ' + pages + ' 页</span>' +
      '<div class="spacer"></div>' +
      '<select class="select" style="width:auto" data-page-size>' +
        [10, 20, 50, 100].map(function (n) {
          return '<option value="' + n + '"' + (n === pageSize ? ' selected' : '') + '>' + n + ' 条/页</option>';
        }).join('') +
      '</select>' +
      '<button class="btn btn-sm" data-page="' + Math.max(1, page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>上一页</button>' +
      list.join('') +
      '<button class="btn btn-sm" data-page="' + Math.min(pages, page + 1) + '"' + (page >= pages ? ' disabled' : '') + '>下一页</button>' +
    '</div>';
}

function bindPager(root, onGo, onChangeSize) {
  $$('[data-page]', root).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var p = Number(btn.getAttribute('data-page'));
      if (p && !btn.disabled) onGo(p);
    });
  });
  var sel = $('[data-page-size]', root);
  if (sel && onChangeSize) {
    sel.addEventListener('change', function () { onChangeSize(Number(sel.value)); });
  }
}

/* ==========================================================================
   八、仪表盘
   ========================================================================== */

Views.dashboard = async function (box) {
  box.innerHTML = '<div class="panel"><div style="padding:16px">' + skeletonRows(4) + '</div></div>';

  var data = await req('/api/admin/stats');
  var c = data.cards;

  var cards = [
    { k: '资料总数', v: c.total, d: '全部条目' },
    { k: '启用中', v: c.enabled, d: '前台可见' },
    { k: '今日下载', v: c.todayDownloads, d: 'UTC+8 当天' },
    { k: '累计下载', v: c.totalDownloads, d: '历史总和' },
    { k: '近 7 天新增', v: c.new7d, d: '新入库资料' }
  ];

  var html = '<div class="stat-grid">';
  cards.forEach(function (card) {
    html += '<div class="stat glow-target"><div class="k"><i class="mark"></i>' + card.k + '</div>' +
      '<div class="v">' + fmtNum(card.v) + '</div><div class="d">' + card.d + '</div></div>';
  });
  html += '</div>';

  html += '<div class="grid-2" style="margin-top:14px;align-items:start">' +
    '<div class="panel">' +
      '<div class="panel-head"><h2>近 30 天下载趋势</h2><span class="sub">按天统计</span>' +
        '<div class="spacer"></div><span class="sub" id="trendSum"></span></div>' +
      '<div class="chart-box"><canvas id="trendCanvas"></canvas><div class="chart-tip" id="chartTip"></div></div>' +
    '</div>' +
    '<div class="panel">' +
      '<div class="panel-head"><h2>热门资料 Top 10</h2><div class="spacer"></div>' +
        '<button class="btn btn-sm" onclick="go(\'resources\')">管理</button></div>' +
      '<div class="panel-body" id="topBox"></div>' +
    '</div>' +
  '</div>';

  html += '<div class="grid-2" style="margin-top:14px;align-items:start">' +
    '<div class="panel">' +
      '<div class="panel-head"><h2>最近操作</h2><div class="spacer"></div>' +
        '<button class="btn btn-sm" onclick="go(\'logs\')">全部</button></div>' +
      '<div class="panel-body" id="opsBox"></div>' +
    '</div>' +
    '<div class="panel">' +
      '<div class="panel-head"><h2>登录信息</h2></div>' +
      '<div class="panel-body" id="loginBox"></div>' +
    '</div>' +
  '</div>';

  box.innerHTML = html;

  /* 热门 Top 10 */
  var topBox = $('#topBox', box);
  if (!data.top.length) {
    topBox.innerHTML = emptyBlock('还没有下载数据', '有访客下载后会出现在这里');
  } else {
    var max = Math.max.apply(null, data.top.map(function (t) { return t.downloads; })) || 1;
    topBox.innerHTML = '<div class="top-list">' + data.top.map(function (t, i) {
      return '<div class="top-item">' +
        '<span class="rank">' + (i + 1) + '</span>' +
        '<div class="bar"><i style="width:' + Math.max(6, Math.round(t.downloads / max * 100)) + '%"></i>' +
          '<b title="' + esc(t.name) + '">' + esc(t.name) + '</b></div>' +
        '<span class="n">' + fmtNum(t.downloads) + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* 最近操作 */
  var opsBox = $('#opsBox', box);
  var ACTION_TEXT = {
    create: '新增', update: '修改', delete: '删除', duplicate: '复制',
    batch_enable: '批量启用', batch_disable: '批量禁用', batch_delete: '批量删除',
    rename: '重命名', merge: '合并', approve: '通过评论', hide: '隐藏评论',
    password: '改密码', restore_merge: '导入数据', restore_replace: '覆盖导入'
  };
  if (!data.recentOps.length) {
    opsBox.innerHTML = emptyBlock('还没有操作记录', '后台的增删改都会记在这里', '📝');
  } else {
    opsBox.innerHTML = '<div class="timeline">' + data.recentOps.map(function (op) {
      return '<div class="tl-item"><time>' + fmtTime(op.createdAt) + '</time>' +
        '<div class="what">' + esc(ACTION_TEXT[op.action] || op.action) + ' ' +
        (op.targetType === 'resource' ? '资料' : op.targetType === 'category' ? '分类' :
         op.targetType === 'tag' ? '标签' : op.targetType === 'comment' ? '评论' :
         op.targetType === 'settings' ? '设置' : op.targetType === 'backup' ? '备份' : '') +
        ' <em>' + esc(op.targetName || '') + '</em></div></div>';
    }).join('') + '</div>';
  }

  /* 登录信息 */
  $('#loginBox', box).innerHTML =
    '<dl class="kv">' +
      '<dt>上次登录</dt><dd>' + (data.lastLogin ? fmtTime(data.lastLogin.createdAt) + ' · ' + esc(data.lastLogin.ip || '') : '首次登录') + '</dd>' +
      '<dt>本次登录</dt><dd>' + (data.currentLogin ? fmtTime(data.currentLogin.createdAt) : '—') + '</dd>' +
      '<dt>会话到期</dt><dd>' + fmtDate(state.session && state.session.expiresAt) + '</dd>' +
      '<dt>待审评论</dt><dd>' + (data.commentPending ? '<span class="badge warn">' + data.commentPending + ' 条</span>' : '无') + '</dd>' +
    '</dl>' +
    '<div class="row" style="margin-top:12px">' +
      '<button class="btn btn-sm" onclick="go(\'security\')">账号安全</button>' +
      '<button class="btn btn-sm" onclick="go(\'settings\')">站点设置</button>' +
    '</div>';

  /* 趋势图 */
  var total = data.trend.reduce(function (s, d) { return s + d.count; }, 0);
  $('#trendSum', box).textContent = '合计 ' + fmtNum(total) + ' 次';
  drawTrend($('#trendCanvas', box), data.trend, $('#chartTip', box));
};

/* --------------------------------------------------------------------------
   原生 Canvas 折线图（不引任何图表库）
   -------------------------------------------------------------------------- */
var trendData = null;

function drawTrend(canvas, trend, tipEl) {
  if (!canvas) return;
  trendData = { trend: trend, tip: tipEl, canvas: canvas, points: [] };

  var dpr = window.devicePixelRatio || 1;
  var w = canvas.clientWidth || canvas.parentNode.clientWidth || 400;
  var h = 190;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = h + 'px';

  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  var pad = { l: 34, r: 12, t: 14, b: 24 };
  var iw = w - pad.l - pad.r;
  var ih = h - pad.t - pad.b;

  var counts = trend.map(function (d) { return d.count; });
  var max = Math.max.apply(null, counts.concat([1]));
  max = Math.ceil(max / 4) * 4 || 4;

  var styles = getComputedStyle(document.documentElement);
  var accent = (styles.getPropertyValue('--accent') || '#7c8cff').trim();
  var muted = (styles.getPropertyValue('--muted') || '#8b949e').trim();

  /* 网格与 y 轴 */
  ctx.font = '10px ' + (styles.getPropertyValue('--mono') || 'monospace');
  ctx.fillStyle = muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (var g = 0; g <= 4; g++) {
    var y = pad.t + ih - (ih * g) / 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, y + 0.5);
    ctx.lineTo(w - pad.r, y + 0.5);
    ctx.stroke();
    ctx.fillText(String(Math.round((max * g) / 4)), pad.l - 8, y);
  }

  var pts = trend.map(function (d, i) {
    var x = pad.l + (trend.length === 1 ? iw / 2 : (iw * i) / (trend.length - 1));
    var y = pad.t + ih - (d.count / max) * ih;
    return { x: x, y: y, d: d, i: i };
  });
  trendData.points = pts;

  /* 面积用一层平涂，不做渐变（渐变在禁止清单里） */
  var areaFill = hexToRgba(accent, 0.14);

  if (pts.length) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pad.t + ih);
    /* 平滑曲线：用二次贝塞尔在中点连接 */
    pts.forEach(function (p, i) {
      if (i === 0) {
        ctx.lineTo(p.x, p.y);
      } else {
        var prev = pts[i - 1];
        var cx = (prev.x + p.x) / 2;
        ctx.bezierCurveTo(cx, prev.y, cx, p.y, p.x, p.y);
      }
    });
    ctx.lineTo(pts[pts.length - 1].x, pad.t + ih);
    ctx.closePath();
    ctx.fillStyle = areaFill;
    ctx.fill();

    ctx.beginPath();
    pts.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else {
        var prev = pts[i - 1];
        var cx = (prev.x + p.x) / 2;
        ctx.bezierCurveTo(cx, prev.y, cx, p.y, p.x, p.y);
      }
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();

    /* 最后一个点加个实心圆 */
    var last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
  }

  /* x 轴标签：每 5 天 */
  ctx.fillStyle = muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '10px ' + (styles.getPropertyValue('--mono') || 'monospace');
  pts.forEach(function (p, i) {
    if (i % 5 === 0 || i === pts.length - 1) {
      var label = p.d.date.slice(5);
      ctx.fillText(label, Math.min(w - pad.r - 14, Math.max(pad.l + 14, p.x)), pad.t + ih + 7);
    }
  });

  /* 悬停：位置换算后交给 canvas mousemove（只绑定一次） */
  if (!canvas.dataset.bound) {
    canvas.dataset.bound = '1';
    canvas.addEventListener('mousemove', onTrendMove);
    canvas.addEventListener('mouseleave', function () {
      if (trendData && trendData.tip) trendData.tip.classList.remove('show');
      drawTrendHover(-1);
    });
    window.addEventListener('resize', debounce(function () {
      if (trendData && document.body.contains(trendData.canvas)) {
        drawTrend(trendData.canvas, trendData.trend, trendData.tip);
      }
    }, 200));
  }
}

function onTrendMove(e) {
  if (!trendData) return;
  var rect = trendData.canvas.getBoundingClientRect();
  var x = e.clientX - rect.left;
  var best = -1;
  var bestDist = Infinity;
  trendData.points.forEach(function (p, i) {
    var dist = Math.abs(p.x - x);
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  if (best < 0) return;

  var p = trendData.points[best];
  var tip = trendData.tip;
  if (tip) {
    tip.innerHTML = p.d.date + ' · <b>' + p.d.count + '</b> 次';
    tip.style.left = Math.min(rect.width - 110, Math.max(0, p.x - 46)) + 'px';
    tip.style.top = Math.max(0, p.y - 34) + 'px';
    tip.classList.add('show');
  }
  drawTrendHover(best);
}

/* 悬停高亮：重画整图会闪，这里只覆盖一层竖线与圆点 */
function drawTrendHover(index) {
  if (!trendData) return;
  var canvas = trendData.canvas;
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  drawTrend(canvas, trendData.trend, trendData.tip);
  if (index < 0 || !trendData.points[index]) return;
  var p = trendData.points[index];
  var styles = getComputedStyle(document.documentElement);
  var accent = (styles.getPropertyValue('--accent') || '#7c8cff').trim();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = hexToRgba(accent, 0.5);
  ctx.lineWidth = 1;
  ctx.moveTo(p.x, 14);
  ctx.lineTo(p.x, 166);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#f7f6f2';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent;
  ctx.stroke();
}

function debounce(fn, wait) {
  var timer = null;
  return function () {
    var args = arguments;
    var self = this;
    clearTimeout(timer);
    timer = setTimeout(function () { fn.apply(self, args); }, wait);
  };
}

/* ==========================================================================
   九、启动
   ========================================================================== */

function init() {
  $('#loginForm').addEventListener('submit', doLogin);
  $('#logoutBtn').addEventListener('click', doLogout);
  $('#menuBtn').addEventListener('click', function () {
    document.body.classList.toggle('nav-open');
  });
  $('#scrim').addEventListener('click', function () {
    document.body.classList.remove('nav-open');
  });

  $$('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () { go(btn.getAttribute('data-view')); });
  });

  window.addEventListener('hashchange', onRoute);

  /* 先问一下有没有有效会话 */
  req('/api/admin/session', { noAuthRedirect: true })
    .then(function (session) { return showApp(session); })
    .catch(function () { showLogin(''); });
}

document.addEventListener('DOMContentLoaded', init);
