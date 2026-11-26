/* ==========================================================================
   zzz513.xyz · 前台逻辑
   零依赖、无构建。所有渲染走字符串拼接 + 统一转义，避免 XSS。
   ========================================================================== */

var API_BASE = 'https://api.zzz513.xyz';

var site = null;
var files = [];
var view = { q: '', cat: '全部', tag: '' };
var cmt = { scope: '', page: 1, items: [], captchaToken: '', loading: false };

/* ==========================================================================
   工具
   ========================================================================== */

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtNum(n) {
  var v = Number(n);
  return isFinite(v) ? v.toLocaleString('zh-CN') : '0';
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function ago(ms) {
  var diff = Date.now() - Number(ms || 0);
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + ' 天前';
  var d = new Date(Number(ms));
  return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}

function shortDate(v) {
  if (!v) return '';
  var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v).slice(0, 10);
  return Number(m[2]) + ' 月 ' + Number(m[3]) + ' 日';
}

function hexToRgba(hex, a) {
  var h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  var n = parseInt(h, 16);
  if (!isFinite(n)) return 'rgba(163,181,160,' + a + ')';
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/** 把点缀色调深，用于需要 4.5:1 对比度的文字 */
function shade(hex, k) {
  var h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  var n = parseInt(h, 16);
  if (!isFinite(n)) return '#5f7359';
  var r = Math.round(((n >> 16) & 255) * k);
  var g = Math.round(((n >> 8) & 255) * k);
  var b = Math.round((n & 255) * k);
  return '#' + [r, g, b].map(function (x) {
    return ('0' + Math.max(0, Math.min(255, x)).toString(16)).slice(-2);
  }).join('');
}

function api(path, opt) {
  opt = opt || {};
  var init = { method: opt.method || 'GET', cache: 'no-store', headers: {} };
  if (opt.body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opt.body);
  }
  return fetch(API_BASE + path, init).then(function (res) {
    return res.json().catch(function () { return null; }).then(function (payload) {
      if (!payload || typeof payload !== 'object') throw new Error('接口返回异常（' + res.status + '）');
      if (payload.code !== 0) throw new Error(payload.message || '请求失败');
      return payload.data;
    });
  });
}

function errText(err) {
  var msg = (err && err.message) ? err.message : String(err);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    if (location.protocol === 'file:') {
      return { title: '请求被浏览器拦住了', detail: '这是直接双击打开本地文件导致的跨域限制。部署到 https://zzz513.xyz 再访问就正常。' };
    }
    return { title: '连不上接口', detail: '接口 ' + API_BASE + ' 没有响应，或者当前来源不在白名单里。' };
  }
  return { title: '没加载出来', detail: msg };
}

var toastTimer = null;
function toast(message, type) {
  var el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.className = 'toast'; }, 2600);
}

/* ==========================================================================
   光圈：靠近可点区域时浮起一块柔光
   实心圆 + blur，不用渐变；触摸设备和 reduce 下直接关掉
   ========================================================================== */

var halo = document.getElementById('halo');
var haloOn = false;
var haloRaf = 0;
var haloX = 0;
var haloY = 0;
var haloIdle = true;

function haloMove(e) {
  if (!haloOn) return;
  haloX = e.clientX;
  haloY = e.clientY;
  if (haloRaf) return;
  haloRaf = requestAnimationFrame(function () {
    haloRaf = 0;
    var zones = document.querySelectorAll('.halo-zone');
    var bestD = 1e9;
    for (var i = 0; i < zones.length; i += 1) {
      var r = zones[i].getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.bottom < -80 || r.top > innerHeight + 80) continue;
      var dx = Math.max(r.left - haloX, 0, haloX - r.right);
      var dy = Math.max(r.top - haloY, 0, haloY - r.bottom);
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) bestD = d;
    }
    if (bestD < 96) {
      halo.style.transform = 'translate3d(' + haloX + 'px,' + haloY + 'px,0)';
      halo.style.opacity = (0.34 * (1 - bestD / 96) + 0.08).toFixed(3);
      haloIdle = false;
    } else if (!haloIdle) {
      halo.style.opacity = '0';
      haloIdle = true;
    }
  });
}

function haloOff() {
  if (!halo) return;
  halo.style.opacity = '0';
  haloIdle = true;
}

function initHalo() {
  if (!halo) return;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || calm) return;
  haloOn = true;
  document.addEventListener('pointermove', haloMove, { passive: true });
  document.addEventListener('pointerleave', haloOff, { passive: true });
  window.addEventListener('scroll', haloOff, { passive: true });
}

/* ==========================================================================
   站点设置
   ========================================================================== */

function applySite(data) {
  site = data;
  var s = data.site || {};
  var t = data.theme || {};
  var root = document.documentElement;

  /* 点缀色：一个颜色带出一整套语气，深浅两级都用它算 */
  siteAccent = /^#[0-9a-f]{6}$/i.test(String(t.accent || '')) ? t.accent : '#a3b5a0';
  applyAccentForSkin();

  document.body.classList.toggle('glass', !!t.glass);
  document.body.classList.toggle('glow', !!t.glow);

  /* 文案 */
  var title = s.title || '青野';
  document.title = title;
  document.getElementById('siteTitle').textContent = title;

  var hero = document.getElementById('heroLine');
  if (s.heroLine) hero.textContent = s.heroLine;

  var lede = document.getElementById('siteSubtitle');
  if (s.subtitle) lede.textContent = s.subtitle;
  else lede.hidden = true;

  var bio = document.getElementById('siteBio');
  if (s.bio) { bio.textContent = s.bio; bio.hidden = false; }
  else bio.hidden = true;

  /* 页眉右上的 bilibili 工具入口：后台「站点设置」里可以关掉 */
  var biliTool = document.querySelector('.mast-link--tool');
  if (biliTool) biliTool.style.display = s.biliToolEnabled === false ? 'none' : '';

  /* 头像：没有就退回半个字，不做贴图占位 */
  var mark = document.getElementById('avatar');
  if (s.avatar) {
    mark.innerHTML = '<img src="' + esc(s.avatar) + '" alt="' + esc(title) + '">';
    mark.hidden = false;
  } else {
    /* 没头像就不放占位方块，报头只留名字 */
    mark.hidden = true;
  }

  /* SEO */
  document.querySelector('meta[name="theme-color"]').setAttribute('content', '#f7f6f2');
  if (s.metaDescription) {
    document.querySelector('meta[name="description"]').setAttribute('content', s.metaDescription);
    document.querySelector('meta[property="og:description"]').setAttribute('content', s.metaDescription);
  }
  if (s.metaKeywords) document.querySelector('meta[name="keywords"]').setAttribute('content', s.metaKeywords);
  document.querySelector('meta[property="og:title"]').setAttribute('content', title);
  if (s.ogImage) {
    var og = document.querySelector('meta[property="og:image"]') || document.createElement('meta');
    og.setAttribute('property', 'og:image');
    og.setAttribute('content', s.ogImage);
    if (!og.parentNode) document.head.appendChild(og);
  }

  var footText = document.getElementById('footText');
  if (footText && s.footer) footText.textContent = s.footer;

  document.getElementById('mastYear').textContent = String(new Date().getFullYear());

  /* 访客没自己选过，就跟随后台的默认皮肤 */
  if (!localSkin()) applySkin((t.skin === 'paper' ? 'paper' : 'night'), false);

  applyBackground(t);
  renderTabs();
  renderLinks(data.social || []);

  var c = data.comments || {};
  var section = document.getElementById('commentSection');
  section.hidden = !c.enabled;
  if (c.enabled) {
    buildCommentScopes();
    loadComments(true);
    refreshCaptcha();
  }
}

function applyBackground(t) {
  /* 访客自己换了背景，就不要再拿站点设置盖掉 */
  if (hasUserBg()) return;

  var layer = document.getElementById('bgLayer');
  var root = document.documentElement;
  layer.innerHTML = '';
  /* 先撤掉，后面真放了背景再加回来 */
  document.body.classList.remove('has-bg');

  var url = String(t.bgUrl || '').trim();
  var mask = Number(t.bgMask);
  root.style.setProperty('--mask', String(isFinite(mask) ? Math.max(0.4, Math.min(1, mask)) : 0.86) );

  if (!url || t.bgType === 'none' || !/^https?:\/\//i.test(url)) {
    root.style.setProperty('--bg-blur', '0px');
    return;
  }

  /* 有背景才盖蒙版：.bg::after 靠这个类显形，夜景层也会让位 */
  document.body.classList.add('has-bg');

  root.style.setProperty('--bg-blur', Math.max(0, Math.min(16, Number(t.bgBlur) || 0)) + 'px');

  if (t.bgType === 'video') {
    var video = document.createElement('video');
    video.src = url;
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    layer.appendChild(video);
    video.play().catch(function () { /* autoplay 被拦时留首帧 */ });
  } else {
    /* 用 background 而不是 <img>：只有 background 能同时控制
       焦点（position）、裁切方式（size）和平铺（repeat） */
    var fit = t.bgFit === 'contain' || t.bgFit === 'tile' ? t.bgFit : 'cover';
    var px = clampNum(t.bgPosX, 0, 100, 50);
    var py = clampNum(t.bgPosY, 0, 100, 50);
    var sc = clampNum(t.bgScale, 100, 300, 100);

    var photo = document.createElement('div');
    photo.className = 'bg-photo';
    photo.style.setProperty('--bg-image', 'url("' + url.replace(/"/g, '%22') + '")');
    photo.style.setProperty('--bg-pos', px + '% ' + py + '%');

    if (fit === 'tile') {
      /* 平铺：单张宽度占容器的 sc% */
      photo.style.setProperty('--bg-size', sc + '% auto');
      photo.style.setProperty('--bg-repeat', 'repeat');
    } else {
      photo.style.setProperty('--bg-size', fit);
      photo.style.setProperty('--bg-repeat', 'no-repeat');
      /* 铺满/完整显示时用 transform 放大，永远不会露底 */
      photo.style.setProperty('--bg-zoom', String(sc / 100));
    }

    layer.appendChild(photo);
  }
}

/** 把一个可能是字符串的数字收进区间 */
function clampNum(v, min, max, dft) {
  var n = Number(v);
  if (!isFinite(n)) return dft;
  return Math.min(max, Math.max(min, n));
}

/* ==========================================================================
   分类：一行文字
   ========================================================================== */

function renderTabs() {
  var box = document.getElementById('catTabs');
  var cats = (site && site.categories) || [];

  var counts = {};
  files.forEach(function (f) { counts[f.category] = (counts[f.category] || 0) + 1; });

  var html = '<button class="tab halo-zone' + (view.cat === '全部' && !view.tag ? ' active' : '') +
    '" data-cat="全部">全部<span class="n">' + files.length + '</span></button>';

  cats.forEach(function (c) {
    if (!counts[c.name]) return;
    html += '<button class="tab halo-zone' + (view.cat === c.name ? ' active' : '') + '" data-cat="' + esc(c.name) + '">' +
      esc(c.name) + '<span class="n">' + counts[c.name] + '</span></button>';
  });

  /* 分类表里删掉、但资料还挂着的分类，也要能筛 */
  Object.keys(counts).forEach(function (name) {
    var known = cats.some(function (c) { return c.name === name; });
    if (!known) {
      html += '<button class="tab halo-zone' + (view.cat === name ? ' active' : '') + '" data-cat="' + esc(name) + '">' +
        esc(name) + '<span class="n">' + counts[name] + '</span></button>';
    }
  });

  if (view.tag) {
    html += '<button class="tab halo-zone active" data-cleartag="1"># ' + esc(view.tag) + ' · 取消</button>';
  }

  box.innerHTML = html;

  Array.prototype.forEach.call(box.querySelectorAll('[data-cat]'), function (btn) {
    btn.addEventListener('click', function () {
      view.cat = btn.getAttribute('data-cat');
      view.tag = '';
      renderTabs();
      renderFiles();
    });
  });
  var clearTag = box.querySelector('[data-cleartag]');
  if (clearTag) clearTag.addEventListener('click', function () {
    view.tag = '';
    renderTabs();
    renderFiles();
  });
}

/* ==========================================================================
   目录式列表
   ========================================================================== */

function skeleton(n) {
  var html = '';
  for (var i = 0; i < n; i += 1) {
    html += '<div class="sk-row">' +
      '<span class="sk sk-idx"></span>' +
      '<span><span class="sk sk-a" style="display:block"></span>' +
      '<span class="sk sk-b" style="display:block"></span></span>' +
      '</div>';
  }
  return html;
}

function matches(f) {
  if (view.cat !== '全部' && f.category !== view.cat) return false;
  if (view.tag) {
    var has = (f.tags || []).some(function (t) { return t.name === view.tag; });
    if (!has) return false;
  }
  var q = view.q.trim().toLowerCase();
  if (!q) return true;
  var hay = [f.name, f.category, f.summary, (f.tags || []).map(function (t) { return t.name; }).join(' ')]
    .join(' ').toLowerCase();
  return hay.indexOf(q) !== -1;
}

function entryRow(f, index) {
  var showDl = !site || site.theme.showDownloads !== false;
  var showSize = !site || site.theme.showSize !== false;

  var meta = [];
  if (f.category) meta.push('<span>' + esc(f.category) + '</span>');
  if (showSize) meta.push('<span>' + esc(f.size || '—') + '</span>');
  if (f.date) meta.push('<span class="hide-xs">' + esc(shortDate(f.date)) + '</span>');
  if (showDl) meta.push('<span' + (meta.length ? '' : '') + ' data-dlcount="' + Number(f.id) + '">下载 ' +
    '<span class="num">' + fmtNum(f.downloads) + '</span> 次</span>');

  var sep = '<i aria-hidden="true">·</i>';
  var html = [];
  meta.forEach(function (item, i) {
    if (i) html.push(sep);
    html.push(item);
  });

  (f.tags || []).slice(0, 2).forEach(function (t) {
    html.push('<span class="tag" data-tag="' + esc(t.name) + '">' + esc(t.name) + '</span>');
  });

  html.push('<button class="entry-cmt halo-zone" data-cmt="' + Number(f.id) + '">留言</button>');

  return '<article class="entry halo-zone" id="r' + Number(f.id) + '">' +
      '<span class="idx" aria-hidden="true">' + pad2(index + 1) + '</span>' +
      '<div class="entry-main">' +
        '<a class="entry-name" href="' + API_BASE + '/api/resources/' + Number(f.id) + '/download"' +
          ' target="_blank" rel="noopener" data-download="' + Number(f.id) + '"' +
          ' title="' + esc(f.name) + '">' + esc(f.name) + '</a>' +
        '<div class="entry-meta">' + html.join('') + '</div>' +
      '</div>' +
      '<span class="entry-go" aria-hidden="true">↗</span>' +
    '</article>';
}

function renderFiles() {
  var box = document.getElementById('fileList');
  var countEl = document.getElementById('fileCount');
  var list = files.filter(matches);

  if (!files.length) {
    countEl.textContent = '';
    box.innerHTML = '<div class="state"><strong>抽屉还是空的</strong>' +
      '还没往里放东西。等两天再来看看。</div>';
    return;
  }

  if (!list.length) {
    countEl.textContent = '0 份';
    var q = view.q.trim();
    box.innerHTML = '<div class="state"><strong>' +
      (q ? '「' + esc(q) + '」没有匹配的资料。' : '这个分类下暂时没有东西。') +
      '</strong>' +
      (q ? '换一个词，或者试试「CSS」「工具」这类更短的说法。' : '换一个分类看看。') +
      '<br><button class="link-btn" id="resetFilter">清空筛选</button></div>';
    var reset = document.getElementById('resetFilter');
    if (reset) reset.addEventListener('click', function () {
      view = { q: '', cat: '全部', tag: '' };
      document.getElementById('searchInput').value = '';
      document.getElementById('searchClear').hidden = true;
      renderTabs();
      renderFiles();
    });
    return;
  }

  countEl.textContent = (view.q || view.cat !== '全部' || view.tag ? '筛出 ' : '共 ') + list.length + ' 份';
  box.innerHTML = list.map(entryRow).join('');
}

/* ==========================================================================
   列表交互
   ========================================================================== */

function bindFileEvents() {
  var list = document.getElementById('fileList');

  list.addEventListener('click', function (e) {
    var tag = e.target.closest('[data-tag]');
    if (tag) {
      view.tag = tag.getAttribute('data-tag');
      view.cat = '全部';
      renderTabs();
      renderFiles();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    var cmtBtn = e.target.closest('[data-cmt]');
    if (cmtBtn) {
      var id = cmtBtn.getAttribute('data-cmt');
      var scope = document.getElementById('cmtScope');
      if (scope) {
        scope.value = id;
        cmt.scope = id;
        cmt.page = 1;
        loadComments(true);
        document.getElementById('commentSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('cmtText').focus({ preventScroll: true });
      }
      return;
    }

    var dl = e.target.closest('[data-download]');
    if (dl) {
      /* 跳转交给浏览器，这里只做乐观 +1，不拦不 await */
      var dlId = dl.getAttribute('data-download');
      var counter = document.querySelector('[data-dlcount="' + dlId + '"] .num');
      if (counter) {
        var current = Number(String(counter.textContent).replace(/[^\d]/g, '')) || 0;
        counter.textContent = fmtNum(current + 1);
      }
    }
  });

  var input = document.getElementById('searchInput');
  var clear = document.getElementById('searchClear');
  var timer = null;

  input.addEventListener('input', function () {
    clear.hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(function () {
      view.q = input.value;
      renderFiles();
    }, 120);
  });

  clear.addEventListener('click', function () {
    input.value = '';
    clear.hidden = true;
    view.q = '';
    renderFiles();
    input.focus();
  });
}

/* ==========================================================================
   留言
   ========================================================================== */

function buildCommentScopes() {
  var sel = document.getElementById('cmtScope');
  if (!sel) return;

  var html = '<option value="">全部留言</option>';
  files.forEach(function (f) {
    html += '<option value="' + f.id + '">' + esc(f.name) + '</option>';
  });
  sel.innerHTML = html;
  sel.value = cmt.scope;

  if (sel.dataset.bound) return;
  sel.dataset.bound = '1';
  sel.addEventListener('change', function () {
    cmt.scope = sel.value;
    cmt.page = 1;
    loadComments(true);
  });
}

/** 先整体转义，再把链接换成「详情」—— 任何标签都只是文字 */
function renderCommentText(text) {
  var html = esc(text);
  return html.replace(/https?:\/\/[^\s<>"']+/gi, function (url) {
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer nofollow">详情</a>';
  });
}

function loadComments(reset) {
  if (cmt.loading) return;
  if (reset) { cmt.page = 1; cmt.items = []; }

  var box = document.getElementById('cmtList');
  var countEl = document.getElementById('commentCount');
  if (!box) return;
  cmt.loading = true;

  if (reset) box.innerHTML = skeleton(2);

  var qs = '?limit=50';
  qs += cmt.scope === '' ? '&resourceId=all' : '&resourceId=' + encodeURIComponent(cmt.scope);

  api('/api/comments' + qs).then(function (data) {
    cmt.items = data.items || [];
    countEl.textContent = cmt.items.length ? cmt.items.length + ' 条' : '';

    if (!cmt.items.length) {
      box.innerHTML = '<div class="state">还没有人留言。你可以是第一个，也可以继续沉默。</div>';
      return;
    }

    var names = {};
    files.forEach(function (f) { names[f.id] = f.name; });

    box.innerHTML = cmt.items.map(function (c) {
      return '<article class="note">' +
        '<div class="note-head">' +
          '<b>' + esc(c.nickname || '匿名') + '</b>' +
          '<time>' + ago(c.createdAt) + '</time>' +
          (c.resourceId && names[c.resourceId] ? '<span class="on">· ' + esc(names[c.resourceId]) + '</span>' : '') +
        '</div>' +
        '<p class="note-text">' + renderCommentText(c.content) + '</p>' +
      '</article>';
    }).join('');
  }).catch(function (err) {
    box.innerHTML = '<div class="state"><strong>留言没加载出来</strong>' + esc(err.message) + '</div>';
  }).then(function () {
    cmt.loading = false;
  });
}

function refreshCaptcha() {
  var q = document.getElementById('capQuestion');
  if (!q) return;
  q.textContent = '…';
  api('/api/comments/captcha').then(function (data) {
    cmt.captchaToken = data.token;
    q.textContent = data.question;
  }).catch(function () {
    q.textContent = '加载失败';
    cmt.captchaToken = '';
  });
}

function submitComment(e) {
  e.preventDefault();
  var btn = document.getElementById('cmtSubmit');
  var text = document.getElementById('cmtText');
  var answer = document.getElementById('capAnswer').value.trim();

  if (!text.value.trim()) { toast('先写点什么', 'err'); text.focus(); return; }
  if (!answer) { toast('算一下验证码', 'err'); document.getElementById('capAnswer').focus(); return; }
  if (!cmt.captchaToken) { toast('验证码还没加载好，点「换一题」', 'err'); return; }

  btn.disabled = true;
  btn.textContent = '提交中';

  api('/api/comments', {
    method: 'POST',
    body: {
      resourceId: cmt.scope || null,
      nickname: document.getElementById('cmtName').value,
      contact: document.getElementById('cmtContact').value,
      content: text.value,
      captchaToken: cmt.captchaToken,
      captchaAnswer: answer
    }
  }).then(function () {
    toast('留上了', 'ok');
    text.value = '';
    document.getElementById('capAnswer').value = '';
    refreshCaptcha();
    loadComments(true);
  }).catch(function (err) {
    toast(err.message || '没发出去', 'err');
    refreshCaptcha();
    document.getElementById('capAnswer').value = '';
  }).then(function () {
    btn.disabled = false;
    btn.textContent = '留一句';
  });
}

/* ==========================================================================
   找到我
   ========================================================================== */

function renderLinks(list) {
  var box = document.getElementById('linkList');
  if (!box) return;

  var section = document.getElementById('linksSection');
  if (!list.length) {
    if (section) section.hidden = true;
    return;
  }
  if (section) section.hidden = false;

  var parts = [];
  list.forEach(function (l, i) {
    if (i) parts.push('<span class="slash" aria-hidden="true">／</span>');
    var external = /^https?:/i.test(l.url || '');
    var target = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    parts.push('<a class="contact halo-zone" href="' + esc(l.url) + '"' + target + '>' + esc(l.name) + '</a>');
  });
  box.innerHTML = parts.join('');
}

/* ==========================================================================
   启动
   ========================================================================== */


/* ==========================================================================
   右下角彩蛋
   91 按钮：比例和目标站都由后端抽签 + 记账，见 /api/egg/pick
   ========================================================================== */

/* 全屏夜景和这扇小窗共用一套种子随机 */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


function initCorner() {
  var btn = document.getElementById('btn91');
  if (btn) {
    /* 比例和站点都由后端决定，抽完顺手记一笔，账才对得上 */
    var busy = false;
    btn.addEventListener('click', function () {
      if (busy) return;
      busy = true;
      btn.disabled = true;

      /* 先开空窗：等接口回来再跳，才不会被当成弹窗拦掉 */
      var win = window.open('about:blank', '_blank');

      api('/api/egg/pick').then(function (d) {
        var url = d && d.url;
        if (!url) throw new Error('empty');
        if (win) { try { win.location.replace(url); } catch (e) { win.location.href = url; } }
        else location.href = url;
        toast('抽中了：' + (d.label || '某个站'), 'ok');
      }).catch(function () {
        /* 接口挂了也不能让按钮变哑巴，本地兜底 60/40 */
        var c = (site && site.egg) || {};
        var ua = (c.a && c.a.url) || '';
        var ub = (c.b && c.b.url) || '';
        var pick = Math.random() < 0.6 ? ua : ub;
        pick = pick || ua || ub;
        if (pick) {
          if (win) { try { win.location.replace(pick); } catch (e) { win.location.href = pick; } }
          else location.href = pick;
          toast('接口没应声，按老规矩抽了一次', 'err');
        } else if (win) {
          win.close();
          toast('两个站都没配地址', 'err');
        }
      }).then(function () {
        busy = false;
        btn.disabled = false;
      });
    });
  }
}


/* ==========================================================================
   深夜皮肤 / 全屏夜景 / 访客自带背景
   全部只在浏览器里：不上传、不进数据库，换台设备就回到默认。
   ========================================================================== */

var SKIN_KEY = 'zzz513.skin';
var SKY = { scene: null, raf: 0, last: 0, calm: false, on: false };
var userBg = { url: '', name: '', kind: '' };
var siteAccent = '#a3b5a0';

/** 深夜皮肤自带霓虹色，纸白才跟随后台设的点缀色 */
function applyAccentForSkin() {
  var root = document.documentElement;
  var night = root.dataset.skin === 'night';
  if (night) {
    root.style.removeProperty('--sage');
    root.style.removeProperty('--sage-deep');
    root.style.removeProperty('--sage-soft');
    return;
  }
  root.style.setProperty('--sage', siteAccent);
  root.style.setProperty('--sage-deep', shade(siteAccent, 0.66));
  root.style.setProperty('--sage-soft', hexToRgba(siteAccent, 0.14));
}
var siteAccent = '#a3b5a0';

/** 深夜皮肤自带霓虹色，纸白才跟随后台设的点缀色 */
function applyAccentForSkin() {
  var root = document.documentElement;
  var night = root.dataset.skin === 'night';
  if (night) {
    root.style.removeProperty('--sage');
    root.style.removeProperty('--sage-deep');
    root.style.removeProperty('--sage-soft');
    return;
  }
  root.style.setProperty('--sage', siteAccent);
  root.style.setProperty('--sage-deep', shade(siteAccent, 0.66));
  root.style.setProperty('--sage-soft', hexToRgba(siteAccent, 0.14));
}

function localSkin() {
  try {
    var v = localStorage.getItem(SKIN_KEY);
    return v === 'paper' || v === 'night' ? v : '';
  } catch (e) {
    return '';
  }
}

function hasUserBg() {
  return !!userBg.url;
}

function applySkin(skin, remember) {
  var next = skin === 'paper' ? 'paper' : 'night';
  document.documentElement.dataset.skin = next;

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'night' ? '#05070c' : '#f7f6f2');

  if (remember) {
    try { localStorage.setItem(SKIN_KEY, next); } catch (e) { /* 隐私模式下写不进去就算了 */ }
  }

  applyAccentForSkin();

  applyAccentForSkin();

  var seg = document.getElementById('skinSeg');
  if (seg) {
    Array.prototype.forEach.call(seg.querySelectorAll('[data-skin]'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-skin') === next);
    });
  }

  /* 自带背景时不画夜景，省一份 GPU */
  if (next === 'night' && !hasUserBg()) startSky();
  else stopSky();

  if (hasUserBg()) applyMaskForSkin();
}

function applyMaskForSkin() {
  var night = document.documentElement.dataset.skin === 'night';
  /* 照片可能是亮的：夜间压更暗、纸白洗更白，正文才站得住 */
  document.documentElement.style.setProperty('--mask', night ? '0.66' : '0.74');
}

/* ---------------- 全屏夜景 ---------------- */

function buildSky(w, h) {
  var rand = mulberry32(9137);
  var scene = { w: w, h: h, stars: [], far: [], near: [], rain: [], signs: [] };

  /* 楼群全部贴底，文字所在的中间区域保持纯暗 */
  for (var i = 0; i < Math.round(w / 18); i += 1) {
    scene.stars.push({
      x: rand() * w,
      y: rand() * h * 0.52,
      r: rand() < 0.86 ? 0.7 : 1.4,
      a: 0.08 + rand() * 0.26
    });
  }

  /* 远景楼矮而密，中景楼稍高，一起压在最下面，别爬到正文腰上 */
  var x = -40;
  while (x < w + 40) {
    var bw = 24 + rand() * 44;
    scene.far.push({ x: x, bw: bw, bh: 22 + rand() * Math.min(64, h * 0.07) });
    x += bw + rand() * 4;
  }

  var palette = ['#35e0ff', '#ff3fb4', '#ffb454', '#9df0ff'];
  x = -60;
  while (x < w + 60) {
    var nw = 44 + rand() * 66;
    var nh = 55 + rand() * Math.min(150, h * 0.185);
    var b = { x: x, bw: nw, bh: nh, win: [], ant: rand() < 0.24 ? 14 + rand() * 30 : 0 };
    var cols = Math.max(1, Math.floor((nw - 16) / 18));
    var rows = Math.max(1, Math.floor((nh - 18) / 20));
    for (var c = 0; c < cols; c += 1) {
      for (var r = 0; r < rows; r += 1) {
        if (rand() > 0.64) {
          b.win.push({
            x: x + 10 + c * 18,
            y: h - nh + 12 + r * 20,
            lit: 0.12 + rand() * 0.36,
            seed: rand() * 100,
            color: palette[Math.floor(rand() * palette.length)]
          });
        }
      }
    }
    scene.near.push(b);
    x += nw + rand() * 11;
  }

  var n = w > 900 ? 120 : 55;
  for (var d = 0; d < n; d += 1) {
    scene.rain.push({
      x: rand() * w,
      y: rand() * h,
      len: 7 + rand() * 15,
      v: 220 + rand() * 300,
      a: 0.03 + rand() * 0.075
    });
  }

  /* 招牌挂在楼顶，不悬空 */
  var tall = scene.near.slice().sort(function (a, b) { return b.bh - a.bh; });
  scene.signs = [
    { x: Math.round(tall[0].x + tall[0].bw * 0.32), y: h - tall[0].bh + 18, w: 4, h: 46, c: '#ff3fb4' },
    { x: Math.round(tall[1].x + tall[1].bw * 0.6), y: h - tall[1].bh + 26, w: 3, h: 58, c: '#35e0ff' }
  ];

  return scene;
}

function drawSky(ctx, sc, t) {
  var w = sc.w;
  var h = sc.h;
  var i;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#04060b';
  ctx.fillRect(0, 0, w, h);

  /* 城市底座的光雾：一条条 1.5px 细带自下而上递减，堆出过渡
     （不用渐变：细带 alpha 差极小，看不出分层，但也没有色块的硬边） */
  var gy0 = h * 0.66;
  var steps = 72;
  var band = (h - gy0) / steps;
  for (i = 0; i < steps; i += 1) {
    var p = i / (steps - 1);
    var a = Math.pow(p, 2.1) * 0.24;
    ctx.fillStyle = 'rgba(' + Math.round(9 + p * 9) + ',' +
      Math.round(19 + p * 13) + ',' + Math.round(42 + p * 12) + ',' + a.toFixed(4) + ')';
    ctx.fillRect(0, gy0 + i * band, w, band + 1);
  }

  for (i = 0; i < sc.stars.length; i += 1) {
    ctx.fillStyle = 'rgba(206, 228, 255,' + sc.stars[i].a + ')';
    ctx.fillRect(sc.stars[i].x, sc.stars[i].y, sc.stars[i].r, sc.stars[i].r);
  }

  for (i = 0; i < sc.far.length; i += 1) {
    var f = sc.far[i];
    /* 远景比近景亮一点点，只作为后面一层灰影 */
    ctx.fillStyle = '#080c14';
    ctx.fillRect(f.x, h - f.bh, f.bw, f.bh);
  }

  for (i = 0; i < sc.near.length; i += 1) {
    var b = sc.near[i];
    var top = h - b.bh;
    /* 近景压到近黑：剪影靠底部光雾托出来，而不是靠自身发亮 */
    ctx.fillStyle = '#010306';
    ctx.fillRect(b.x, top, b.bw, b.bh);
    ctx.fillStyle = 'rgba(120, 200, 240, .10)';
    ctx.fillRect(b.x, top, b.bw, 1);

    if (b.ant) {
      ctx.fillStyle = '#03060c';
      ctx.fillRect(b.x + b.bw / 2 - 0.8, top - b.ant, 1.6, b.ant);
      ctx.fillStyle = 'rgba(255, 63, 180,' + (0.2 + 0.45 * Math.abs(Math.sin(t / 1.9 + i))) + ')';
      ctx.fillRect(b.x + b.bw / 2 - 1.3, top - b.ant - 3, 2.6, 2.6);
    }
  }

  for (i = 0; i < sc.near.length; i += 1) {
    var bb = sc.near[i];
    for (var k = 0; k < bb.win.length; k += 1) {
      var win = bb.win[k];
      var amp = win.seed % 1 > 0.5 ? 1 : 0.6 + 0.4 * Math.sin(t * 0.6 + win.seed);
      ctx.globalAlpha = Math.max(0.06, win.lit * amp);
      ctx.fillStyle = win.color;
      ctx.fillRect(win.x, win.y, 3, 5);
    }
  }
  ctx.globalAlpha = 1;

  /* 霓虹灯箱：小、贴在楼上，不跟正文抢 */
  for (i = 0; i < sc.signs.length; i += 1) {
    var sg = sc.signs[i];
    var pulse = 0.55 + 0.35 * Math.sin(t * (1 + i * 0.5) + i);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.shadowColor = sg.c;
    ctx.shadowBlur = 16;
    ctx.fillStyle = sg.c;
    ctx.fillRect(sg.x, sg.y, sg.w, sg.h);
    ctx.restore();
  }

  for (i = 0; i < sc.rain.length; i += 1) {
    var r = sc.rain[i];
    ctx.strokeStyle = 'rgba(170, 205, 255,' + r.a + ')';
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x - r.len * 0.22, r.y + r.len);
    ctx.stroke();
  }

  /* 压一层暗，让整幅画退到正文后面去 */
  ctx.fillStyle = 'rgba(4, 6, 11, .22)';
  ctx.fillRect(0, 0, w, h);
}

function sizeSky() {
  var cv = document.getElementById('sky');
  if (!cv) return null;
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  var w = window.innerWidth;
  var h = window.innerHeight;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  var ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx: ctx, w: w, h: h };
}

function skyFrame(ts) {
  var cv = document.getElementById('sky');
  if (!cv || !SKY.scene) return;

  if (!SKY.last) SKY.last = ts;
  var dt = Math.min(0.06, (ts - SKY.last) / 1000);
  SKY.last = ts;

  if (!SKY.calm) {
    for (var i = 0; i < SKY.scene.rain.length; i += 1) {
      var r = SKY.scene.rain[i];
      r.y += r.v * dt;
      r.x -= r.v * dt * 0.22;
      if (r.y > SKY.scene.h) {
        r.y = -20;
        r.x = Math.random() * SKY.scene.w;
      }
    }
  }

  SKY.t = (SKY.t || 0) + (SKY.calm ? 0 : dt);
  drawSky(cv.getContext('2d'), SKY.scene, SKY.t);

  if (!SKY.calm) SKY.raf = requestAnimationFrame(skyFrame);
  else SKY.on = false;
}

function startSky() {
  if (SKY.on) return;
  var sized = sizeSky();
  if (!sized) return;

  SKY.calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth < 900;
  SKY.scene = buildSky(sized.w, sized.h);
  SKY.last = 0;
  SKY.t = 0;

  if (SKY.calm) {
    drawSky(sized.ctx, SKY.scene, 0);
    return;
  }

  SKY.on = true;
  SKY.raf = requestAnimationFrame(skyFrame);
}

function stopSky() {
  cancelAnimationFrame(SKY.raf);
  SKY.on = false;
}

/* ---------------- 访客自带背景（IndexedDB） ---------------- */

function bgDb() {
  return new Promise(function (resolve, reject) {
    if (!window.indexedDB) return reject(new Error('浏览器不支持本地存储'));
    var open = indexedDB.open('zzz513-bg', 1);
    open.onupgradeneeded = function () {
      if (!open.result.objectStoreNames.contains('files')) open.result.createObjectStore('files');
    };
    open.onsuccess = function () { resolve(open.result); };
    open.onerror = function () { reject(open.error); };
  });
}

function bgGet() {
  return bgDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('files', 'readonly');
      var rq = tx.objectStore('files').get('bg');
      rq.onsuccess = function () { resolve(rq.result || null); };
      rq.onerror = function () { reject(rq.error); };
    });
  });
}

function bgPut(rec) {
  return bgDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(rec, 'bg');
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

function bgDel() {
  return bgDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete('bg');
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { resolve(false); };
    });
  });
}

function renderUserBg(rec) {
  var layer = document.getElementById('bgLayer');
  if (!layer) return;

  if (userBg.url) URL.revokeObjectURL(userBg.url);
  userBg = { url: '', name: '', kind: '' };

  if (!rec || !rec.blob) {
    layer.innerHTML = '';
    document.body.classList.remove('has-bg');
    applyMaskForSkin();
    if (site) applyBackground(site.theme || {});
    if (document.documentElement.dataset.skin === 'night') startSky();
    setBgNote('');
    return;
  }

  var url = URL.createObjectURL(rec.blob);
  userBg = { url: url, name: rec.name || '本地文件', kind: rec.kind || 'image' };

  layer.innerHTML = '';
  if (userBg.kind === 'video') {
    var v = document.createElement('video');
    v.src = url;
    v.autoplay = true;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    layer.appendChild(v);
    v.play().catch(function () { /* 自动播放被拦时留首帧 */ });
  } else {
    var img = document.createElement('img');
    img.src = url;
    img.alt = '';
    layer.appendChild(img);
  }

  document.body.classList.add('has-bg');
  applyMaskForSkin();
  stopSky();
  setBgNote('当前：' + userBg.name + '（只在这台设备）');
}

function setBgNote(text) {
  var el = document.getElementById('bgNote');
  if (!el) return;
  el.textContent = text || '换的背景只存在这台设备上，不会上传，也不会影响别人。';
}

function pickBgFile(file, kind) {
  if (!file) return;
  if (file.size > 80 * 1024 * 1024) {
    toast('文件太大了（上限 80MB）', 'err');
    return;
  }
  var ok = kind === 'video' ? /^video\//i.test(file.type) : /^image\//i.test(file.type);
  if (!ok) {
    toast(kind === 'video' ? '这不是视频文件' : '这不是图片文件', 'err');
    return;
  }

  bgPut({ blob: file, kind: kind, name: file.name, ts: Date.now() })
    .then(function () {
      return bgGet();
    })
    .then(function (rec) {
      renderUserBg(rec);
      toast('背景换好了，只对你这台设备生效', 'ok');
    })
    .catch(function (err) {
      toast('存不下这张图：' + (err && err.message ? err.message : '浏览器拒绝了'), 'err');
    });
}

/* ---------------- 面板 ---------------- */

function initSkin() {
  var btn = document.getElementById('skinBtn');
  var panel = document.getElementById('skinPanel');
  if (!btn || !panel) return;

  applySkin(localSkin() || 'night', false);

  btn.addEventListener('click', function () {
    panel.hidden = !panel.hidden;
    btn.classList.toggle('on', !panel.hidden);
    btn.setAttribute('aria-expanded', String(!panel.hidden));
  });

  var close = document.getElementById('skinClose');
  if (close) close.addEventListener('click', function () {
    panel.hidden = true;
    btn.classList.remove('on');
    btn.setAttribute('aria-expanded', 'false');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) {
      panel.hidden = true;
      btn.classList.remove('on');
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
    }
  });

  document.getElementById('skinSeg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-skin]');
    if (!b) return;
    applySkin(b.getAttribute('data-skin'), true);
  });

  var img = document.getElementById('bgImg');
  if (img) img.addEventListener('change', function () {
    if (this.files && this.files[0]) pickBgFile(this.files[0], 'image');
    this.value = '';
  });

  var vid = document.getElementById('bgVid');
  if (vid) vid.addEventListener('change', function () {
    if (this.files && this.files[0]) pickBgFile(this.files[0], 'video');
    this.value = '';
  });

  var clear = document.getElementById('bgClear');
  if (clear) clear.addEventListener('click', function () {
    bgDel().then(function () {
      renderUserBg(null);
      toast('已恢复默认背景', 'ok');
    });
  });

  /* 读本地已存的背景 */
  bgGet().then(function (rec) {
    if (rec && rec.blob) renderUserBg(rec);
  }).catch(function () { /* 没存过或浏览器禁用，都当没有 */ });

  /* 窗口变大变小重画一次夜景 */
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!SKY.on && document.documentElement.dataset.skin !== 'night') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (document.documentElement.dataset.skin === 'night' && !hasUserBg()) {
        stopSky();
        startSky();
      }
    }, 260);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopSky();
    else if (document.documentElement.dataset.skin === 'night' && !hasUserBg()) startSky();
  });
}

function boot() {
  bindFileEvents();
  document.getElementById('cmtForm').addEventListener('submit', submitComment);
  document.getElementById('capRefresh').addEventListener('click', refreshCaptcha);
  initHalo();
  initSkin();
  initCorner();

  var box = document.getElementById('fileList');
  box.setAttribute('aria-busy', 'true');
  box.innerHTML = skeleton(4);

  Promise.all([
    api('/api/site'),
    api('/api/resources')
  ]).then(function (res) {
    applySite(res[0]);
    files = (res[1].items || []);
    box.removeAttribute('aria-busy');
    renderTabs();
    renderFiles();

    if (site && site.comments && site.comments.enabled) buildCommentScopes();

    /* 从后台「查看前台」跳过来时定位到对应条目 */
    var m = (location.hash || '').match(/^#r(\d+)$/);
    if (m) {
      var row = document.getElementById('r' + m[1]);
      if (row) {
        setTimeout(function () {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          row.classList.add('flash');
        }, 120);
      }
    }
  }).catch(function (err) {
    console.error(err);
    var e = errText(err);
    box.removeAttribute('aria-busy');
    document.getElementById('fileCount').textContent = '';
    box.innerHTML = '<div class="state"><strong>' + esc(e.title) + '</strong>' + esc(e.detail) +
      '<br><button class="link-btn" id="retryAll">再试一次</button></div>';
    document.getElementById('retryAll').addEventListener('click', function () { location.reload(); });
    document.getElementById('linkList').innerHTML = '';
  });
}

document.addEventListener('DOMContentLoaded', boot);
