/* ==========================================================================
   zzz513 内容管理 · 评论 / 下载 / 日志 / 设置 / 备份 / 安全
   ========================================================================== */

/* ==========================================================================
   一、评论管理
   ========================================================================== */

var cmtState = { page: 1, pageSize: 20, status: '', q: '', total: 0, items: [] };

Views.comments = async function (box) {
  box.innerHTML = '<div class="panel"><div class="panel-head"><h2>评论管理</h2></div>' + skeletonRows(5) + '</div>';

  box.innerHTML =
    '<div class="panel">' +
      '<div class="panel-head">' +
        '<select class="select" id="cmtStatus" style="width:130px">' +
          '<option value="">全部状态</option>' +
          '<option value="1">已显示</option>' +
          '<option value="0">待审核 / 隐藏</option>' +
        '</select>' +
        '<input class="input" id="cmtQ" placeholder="搜索内容或昵称" style="width:200px">' +
        '<button class="btn btn-sm" id="cmtRefresh">刷新</button>' +
        '<div class="spacer"></div>' +
        '<span class="sub" id="cmtTotal"></span>' +
      '</div>' +
      '<div id="cmtList"></div>' +
      '<div id="cmtPager"></div>' +
    '</div>';

  $('#cmtStatus', box).value = cmtState.status;
  $('#cmtQ', box).value = cmtState.q;

  $('#cmtStatus', box).addEventListener('change', function () {
    cmtState.status = this.value;
    cmtState.page = 1;
    loadComments(box);
  });

  var timer = null;
  $('#cmtQ', box).addEventListener('input', function () {
    var val = this.value;
    clearTimeout(timer);
    timer = setTimeout(function () {
      cmtState.q = val;
      cmtState.page = 1;
      loadComments(box);
    }, 240);
  });

  $('#cmtRefresh', box).addEventListener('click', function () { loadComments(box); });

  await loadComments(box);
  loadBadge();
};

async function loadComments(box) {
  var listEl = $('#cmtList', box);
  listEl.innerHTML = skeletonRows(4);

  var qs = '?page=' + cmtState.page + '&pageSize=' + cmtState.pageSize;
  if (cmtState.status !== '') qs += '&status=' + cmtState.status;
  if (cmtState.q) qs += '&q=' + encodeURIComponent(cmtState.q);

  var data = await req('/api/admin/comments' + qs);
  cmtState.items = data.items;
  cmtState.total = data.total;
  $('#cmtTotal', box).textContent = '共 ' + fmtNum(data.total) + ' 条';

  if (!data.items.length) {
    listEl.innerHTML = emptyBlock('没有评论', cmtState.q || cmtState.status !== '' ? '试试换个筛选条件' : '前台访客留言后会出现在这里', '💬');
    $('#cmtPager', box).innerHTML = '';
    return;
  }

  listEl.innerHTML = data.items.map(function (c) {
    return '<div class="comment-item" data-cid="' + c.id + '">' +
      '<div class="head">' +
        '<b>' + esc(c.nickname) + '</b>' +
        (c.status ? '<span class="badge ok">显示中</span>' : '<span class="badge warn">待审核</span>') +
        (c.resourceId ? '<span class="badge tag">' + esc(c.resourceName || '资料 #' + c.resourceId) + '</span>' : '<span class="badge tag">留言板</span>') +
        '<span style="color:var(--dim);font-size:11.5px">' + fmtTime(c.createdAt) + '</span>' +
      '</div>' +
      '<p class="body">' + renderCommentText(c.content) + '</p>' +
      '<div class="foot">' +
        '<span class="meta">' + esc(c.ip) + ' · ' + esc(c.ua) + '</span>' +
        (c.contact ? '<span class="meta">联系：' + esc(c.contact) + '</span>' : '') +
        '<div class="spacer" style="margin-left:auto"></div>' +
        '<button class="btn btn-sm" data-cact="' + (c.status ? 'hide' : 'show') + '" data-cid="' + c.id + '">' + (c.status ? '隐藏' : '通过') + '</button>' +
        '<button class="btn btn-sm btn-danger" data-cdel="' + c.id + '">删除</button>' +
      '</div>' +
    '</div>';
  }).join('');

  $('#cmtPager', box).innerHTML = pagerHtml(data.total, data.page, data.pageSize);
  bindPager($('#cmtPager', box), function (p) { cmtState.page = p; loadComments(box); },
    function (size) { cmtState.pageSize = size; cmtState.page = 1; loadComments(box); });

  $$('[data-cact]', listEl).forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var id = Number(btn.getAttribute('data-cid'));
      var status = btn.getAttribute('data-cact') === 'show' ? 1 : 0;
      try {
        await req('/api/admin/comments/' + id, { method: 'PUT', body: { status: status } });
        toast(status ? '已通过' : '已隐藏', 'ok');
        loadComments(box);
        loadBadge();
      } catch (err) { toast(err.message, 'err'); }
    });
  });

  $$('[data-cdel]', listEl).forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var yes = await confirmDialog({ title: '删除评论', message: '删除后不可恢复，确定吗？', danger: true, okText: '删除' });
      if (!yes) return;
      try {
        await req('/api/admin/comments/' + btn.getAttribute('data-cdel'), { method: 'DELETE' });
        toast('已删除', 'ok');
        loadComments(box);
        loadBadge();
      } catch (err) { toast(err.message, 'err'); }
    });
  });
}

/**
 * 评论内容渲染：先整体转义，再把 http(s) 链接替换成「详情」两个字。
 * 任何 <script>、onerror= 之类的内容都只是普通文字，不会被浏览器执行。
 */
function renderCommentText(text) {
  var html = esc(text);
  html = html.replace(/https?:\/\/[^\s<>"']+/gi, function (url) {
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer nofollow">详情</a>';
  });
  return html;
}

/* ==========================================================================
   二、下载统计
   ========================================================================== */

var dlState = { page: 1, pageSize: 20, from: '', to: '', resourceId: '', total: 0 };

Views.downloads = async function (box) {
  box.innerHTML = '<div class="panel"><div class="panel-head"><h2>下载统计</h2></div>' + skeletonRows(6) + '</div>';

  var resData = await req('/api/admin/resources');
  var options = '<option value="">全部资料</option>' + resData.items.map(function (r) {
    return '<option value="' + r.id + '">' + esc(r.name) + '</option>';
  }).join('');

  box.innerHTML =
    '<div class="panel">' +
      '<div class="panel-head">' +
        '<input class="input" type="date" id="dlFrom" style="width:150px" value="' + esc(dlState.from) + '">' +
        '<span style="color:var(--dim)">至</span>' +
        '<input class="input" type="date" id="dlTo" style="width:150px" value="' + esc(dlState.to) + '">' +
        '<select class="select" id="dlRes" style="width:200px">' + options + '</select>' +
        '<button class="btn btn-sm" id="dlQuery">查询</button>' +
        '<button class="btn btn-sm" id="dlReset">重置</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-sm" id="dlExport">导出 CSV</button>' +
      '</div>' +
      '<div class="table-wrap"><table class="table" style="min-width:680px">' +
        '<thead><tr><th style="width:160px">时间</th><th>资料</th><th style="width:140px">来源 IP</th>' +
        '<th style="width:160px">User-Agent</th><th>来源页面</th></tr></thead>' +
        '<tbody id="dlRows"></tbody>' +
      '</table></div>' +
      '<div id="dlPager"></div>' +
    '</div>';

  $('#dlRes', box).value = dlState.resourceId;

  $('#dlQuery', box).addEventListener('click', function () {
    dlState.from = $('#dlFrom', box).value;
    dlState.to = $('#dlTo', box).value;
    dlState.resourceId = $('#dlRes', box).value;
    dlState.page = 1;
    loadDownloads(box);
  });
  $('#dlReset', box).addEventListener('click', function () {
    dlState = { page: 1, pageSize: dlState.pageSize, from: '', to: '', resourceId: '', total: 0 };
    $('#dlFrom', box).value = '';
    $('#dlTo', box).value = '';
    $('#dlRes', box).value = '';
    loadDownloads(box);
  });
  $('#dlExport', box).addEventListener('click', async function () {
    var btn = this;
    btn.disabled = true;
    try {
      var qs = [];
      if (dlState.from) qs.push('from=' + dlState.from);
      if (dlState.to) qs.push('to=' + dlState.to);
      if (dlState.resourceId) qs.push('resourceId=' + dlState.resourceId);
      var res = await reqRaw('/api/admin/download-logs/export' + (qs.length ? '?' + qs.join('&') : ''));
      var blob = await res.blob();
      downloadBlob(blob, 'downloads-' + todayInput() + '.csv');
      toast('已开始下载', 'ok');
    } catch (err) { toast(err.message, 'err'); }
    finally { btn.disabled = false; }
  });

  await loadDownloads(box);
};

async function loadDownloads(box) {
  var rows = $('#dlRows', box);
  rows.innerHTML = '<tr><td colspan="5">' + skeletonRows(3) + '</td></tr>';

  var qs = '?page=' + dlState.page + '&pageSize=' + dlState.pageSize;
  if (dlState.from) qs += '&from=' + dlState.from;
  if (dlState.to) qs += '&to=' + dlState.to;
  if (dlState.resourceId) qs += '&resourceId=' + dlState.resourceId;

  var data = await req('/api/admin/download-logs' + qs);
  dlState.total = data.total;

  if (!data.items.length) {
    rows.innerHTML = '<tr><td colspan="5">' + emptyBlock('这段时间没有下载记录', '换个时间范围看看', '📈') + '</td></tr>';
    $('#dlPager', box).innerHTML = '';
    return;
  }

  rows.innerHTML = data.items.map(function (d) {
    return '<tr>' +
      '<td class="nowrap" style="font-family:var(--mono);font-size:11.5px;color:var(--muted)">' + fmtTime(d.createdAt) + '</td>' +
      '<td><b style="font-size:13px">' + esc(d.resourceName) + '</b></td>' +
      '<td style="font-family:var(--mono);font-size:11.5px;color:var(--muted)">' + esc(d.ip) + '</td>' +
      '<td style="font-size:12px;color:var(--muted)">' + esc(d.ua) + '</td>' +
      '<td style="font-size:11.5px;color:var(--dim);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(d.referer) + '">' +
        (d.referer ? esc(d.referer) : '—') + '</td>' +
    '</tr>';
  }).join('');

  $('#dlPager', box).innerHTML = pagerHtml(data.total, data.page, data.pageSize);
  bindPager($('#dlPager', box), function (p) { dlState.page = p; loadDownloads(box); },
    function (size) { dlState.pageSize = size; dlState.page = 1; loadDownloads(box); });
}

function downloadBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

/* ==========================================================================
   三、操作日志
   ========================================================================== */

var logState = { page: 1, pageSize: 20, type: '', from: '', to: '', total: 0 };

Views.logs = async function (box) {
  box.innerHTML =
    '<div class="panel">' +
      '<div class="panel-head">' +
        '<select class="select" id="logType" style="width:150px">' +
          '<option value="">全部类型</option>' +
          '<option value="create">新增</option>' +
          '<option value="update">修改</option>' +
          '<option value="delete">删除</option>' +
          '<option value="batch">批量操作</option>' +
          '<option value="duplicate">复制</option>' +
          '<option value="restore">数据导入</option>' +
          '<option value="password">改密码</option>' +
          '<option value="fav.refresh">强制刷新</option>' +
        '</select>' +
        '<input class="input" type="date" id="logFrom" style="width:150px" value="' + esc(logState.from) + '">' +
        '<span style="color:var(--dim)">至</span>' +
        '<input class="input" type="date" id="logTo" style="width:150px" value="' + esc(logState.to) + '">' +
        '<button class="btn btn-sm" id="logQuery">查询</button>' +
        '<div class="spacer"></div>' +
        '<span class="sub" id="logTotal"></span>' +
      '</div>' +
      '<div class="table-wrap"><table class="table" style="min-width:760px">' +
        '<thead><tr><th style="width:150px">时间</th><th style="width:110px">操作</th>' +
        '<th style="width:100px">对象</th><th>名称</th><th style="width:130px">IP</th><th style="width:70px"></th></tr></thead>' +
        '<tbody id="logRows"></tbody>' +
      '</table></div>' +
      '<div id="logPager"></div>' +
    '</div>';

  $('#logType', box).value = logState.type;
  $('#logType', box).addEventListener('change', function () {
    logState.type = this.value;
    logState.page = 1;
    loadLogs(box);
  });
  $('#logQuery', box).addEventListener('click', function () {
    logState.from = $('#logFrom', box).value;
    logState.to = $('#logTo', box).value;
    logState.page = 1;
    loadLogs(box);
  });

  await loadLogs(box);
};

var TYPE_TEXT = { resource: '资料', category: '分类', tag: '标签', comment: '评论', settings: '设置', backup: '备份', account: '账号', fav: '收藏夹' };

async function loadLogs(box) {
  var rows = $('#logRows', box);
  rows.innerHTML = '<tr><td colspan="6">' + skeletonRows(4) + '</td></tr>';

  var qs = '?page=' + logState.page + '&pageSize=' + logState.pageSize;
  if (logState.type) qs += '&type=' + logState.type;
  if (logState.from) qs += '&from=' + logState.from;
  if (logState.to) qs += '&to=' + logState.to;

  var data = await req('/api/admin/operation-logs' + qs);
  logState.total = data.total;
  $('#logTotal', box).textContent = '共 ' + fmtNum(data.total) + ' 条';

  if (!data.items.length) {
    rows.innerHTML = '<tr><td colspan="6">' + emptyBlock('没有操作记录', '后台的每次增删改都会留下痕迹', '📝') + '</td></tr>';
    $('#logPager', box).innerHTML = '';
    return;
  }

  rows.innerHTML = data.items.map(function (op) {
    return '<tr data-log="' + op.id + '">' +
      '<td class="nowrap" style="font-family:var(--mono);font-size:11.5px;color:var(--muted)">' + fmtTime(op.createdAt) + '</td>' +
      '<td><span class="badge ' + (/delete|hide/.test(op.action) ? 'danger' : /create|restore/.test(op.action) ? 'ok' : 'tag') + '">' +
        esc(ACTION_TEXT[op.action] || op.action) + '</span></td>' +
      '<td style="color:var(--muted)">' + esc(TYPE_TEXT[op.targetType] || op.targetType) + '</td>' +
      '<td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(op.targetName || '—') + '</td>' +
      '<td style="font-family:var(--mono);font-size:11px;color:var(--dim)">' + esc(op.ip) + '</td>' +
      '<td><button class="btn btn-sm btn-ghost" data-diff="' + op.id + '">详情</button></td>' +
    '</tr>' +
    '<tr id="diff-' + op.id + '" hidden><td colspan="6" style="background:#11161d">' + diffHtml(op) + '</td></tr>';
  }).join('');

  $('#logPager', box).innerHTML = pagerHtml(data.total, data.page, data.pageSize);
  bindPager($('#logPager', box), function (p) { logState.page = p; loadLogs(box); },
    function (size) { logState.pageSize = size; logState.page = 1; loadLogs(box); });

  $$('[data-diff]', rows).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-diff');
      var row = $('#diff-' + id, rows);
      if (!row) return;
      row.hidden = !row.hidden;
      btn.textContent = row.hidden ? '详情' : '收起';
    });
  });
}

/** 变更前后对比：只列出真正变化的字段 */
function diffHtml(op) {
  var before = op.before || {};
  var after = op.after || {};
  var keys = Array.from(new Set(Object.keys(before).concat(Object.keys(after))));
  var rows = [];

  keys.forEach(function (key) {
    if (['tags', 'updatedAt', 'createdAt'].indexOf(key) !== -1) return;
    var a = before[key];
    var b = after[key];
    var sa = JSON.stringify(a === undefined ? null : a);
    var sb = JSON.stringify(b === undefined ? null : b);
    if (sa === sb) return;
    rows.push('<tr><td class="k">' + esc(key) + '</td>' +
      '<td><span class="old">' + esc(shortVal(sa)) + '</span> → <span class="new">' + esc(shortVal(sb)) + '</span></td></tr>');
  });

  if (!rows.length) {
    var payload = Object.keys(after).length ? after : before;
    var json = JSON.stringify(payload, null, 2).slice(0, 1600);
    return '<pre style="margin:0;font-family:var(--mono);font-size:11.5px;color:#9aa4b0;white-space:pre-wrap;max-height:260px;overflow:auto">' + esc(json) + '</pre>';
  }

  return '<table class="diff-table">' + rows.join('') + '</table>';
}

function shortVal(text) {
  var s = String(text == null ? '' : text);
  if (s === 'null' || s === '""') return '空';
  if (s.length > 160) return s.slice(0, 160) + '…';
  return s;
}

/* ==========================================================================
   四、站点设置
   ========================================================================== */

var socialDraft = [];

Views.settings = async function (box) {
  box.innerHTML = '<div class="panel"><div class="panel-head"><h2>站点设置</h2></div>' + skeletonRows(5) + '</div>';

  var res = await req('/api/admin/settings');
  var s = res.settings;
  state.settings = s;
  state.customPassword = res.customPassword;

  try {
    socialDraft = JSON.parse(s.socialLinks || '[]');
    if (!Array.isArray(socialDraft)) socialDraft = [];
  } catch (_) {
    socialDraft = [];
  }

  var themeSwatches = Object.keys(THEMES).map(function (key) {
    return '<div class="theme-swatch' + (s.theme === key ? ' active' : '') + '" data-theme="' + key + '">' +
      '<span class="d" style="background:' + THEMES[key].accent + '"></span>' + THEMES[key].name + '</div>';
  }).join('');

  /* 背景摆放：老数据没有这几个键，给兜底值 */
  var bgFit = ['cover', 'contain', 'tile'].indexOf(s.bgFit) >= 0 ? s.bgFit : 'cover';
  var bgPosX = Math.round(Number(s.bgPosX) || 50);
  var bgPosY = Math.round(Number(s.bgPosY) || 50);
  var bgScale = Math.round(Number(s.bgScale) || 100);
  bgPosX = Math.min(100, Math.max(0, bgPosX));
  bgPosY = Math.min(100, Math.max(0, bgPosY));
  bgScale = Math.min(300, Math.max(5, bgScale));

  box.innerHTML =
    '<div class="panel" style="position:sticky;top:53px;z-index:9;margin-bottom:14px">' +
      '<div class="panel-head" style="border-bottom:0">' +
        '<h2>站点设置</h2><span class="sub">改完点保存，前台立即生效</span>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-sm" id="setReset">重新读取</button>' +
        '<button class="btn btn-primary btn-sm" id="setSave">保存设置</button>' +
      '</div>' +
    '</div>' +

    '<div class="panel">' +
      '<div class="panel-head"><h2>基础信息</h2><span class="sub">对应前台顶部与页脚</span></div>' +
      '<div class="panel-body">' +
        '<div class="form-grid">' +
          '<div class="field"><label class="label" for="sTitle">站点标题</label>' +
            '<input class="input" id="sTitle" maxlength="60" value="' + esc(s.siteTitle) + '"></div>' +
          '<div class="field full"><label class="label" for="sHero">首屏主句</label>' +
            '<input class="input" id="sHero" maxlength="120" value="' + esc(s.heroLine) + '">' +
            '<div class="hint">前台最大的那行字，用宋体。别写「欢迎来到我的网站」这类话。</div></div>' +
          '<div class="field full"><label class="label" for="sSubtitle">首屏说明（两三行）</label>' +
            '<textarea class="textarea" id="sSubtitle" maxlength="200" style="min-height:64px">' + esc(s.siteSubtitle) + '</textarea>' +
            '<div class="hint">写具体的事，不写身份。</div></div>' +
          '<div class="field full"><label class="label" for="sBio">简介</label>' +
            '<textarea class="textarea" id="sBio" maxlength="2000" style="min-height:70px">' + esc(s.bio) + '</textarea></div>' +
          '<div class="field"><label class="label" for="sAvatar">头像 URL（留空显示站名首字）</label>' +
            '<input class="input" id="sAvatar" placeholder="https://…/avatar.png" value="' + esc(s.avatarUrl) + '"></div>' +
          '<div class="field"><label class="label" for="sFooter">页脚文字</label>' +
            '<input class="input" id="sFooter" maxlength="200" value="' + esc(s.footerText) + '"></div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="panel">' +
      '<div class="panel-head"><h2>SEO</h2><span class="sub">搜索引擎与社交平台分享卡片</span></div>' +
      '<div class="panel-body">' +
        '<div class="form-grid">' +
          '<div class="field full"><label class="label" for="sDesc">meta description</label>' +
            '<input class="input" id="sDesc" maxlength="300" value="' + esc(s.metaDescription) + '">' +
            '<div class="hint">建议 80–160 字，太长会被截断</div></div>' +
          '<div class="field full"><label class="label" for="sKeywords">meta keywords</label>' +
            '<input class="input" id="sKeywords" maxlength="300" value="' + esc(s.metaKeywords) + '">' +
            '<div class="hint">英文逗号分隔</div></div>' +
          '<div class="field full"><label class="label" for="sOg">OG 封面图 URL</label>' +
            '<input class="input" id="sOg" placeholder="https://…/og.png" value="' + esc(s.ogImage) + '"></div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="panel">' +
      '<div class="panel-head"><h2>社交链接</h2><span class="sub">前台「找到我」那一排</span>' +
        '<div class="spacer"></div><button class="btn btn-sm" id="socAdd">+ 添加</button></div>' +
      '<div class="panel-body" id="socBox"></div>' +
    '</div>' +

    '<div class="panel">' +
      '<div class="panel-head"><h2>外观</h2><span class="sub">点缀色、背景、磨砂与光圈</span></div>' +
      '<div class="panel-body">' +
        '<div class="field"><label class="label">点缀色（全站只有一个颜色，越少用越有力）</label><div class="theme-grid" id="themeGrid">' + themeSwatches + '</div></div>' +
        '<div class="form-grid" style="margin-top:14px">' +
          '<div class="field"><label class="label" for="sAccent">自定义强调色</label>' +
            '<div class="row tight">' +
              '<input type="color" id="sAccentPicker" value="' + esc(s.accent) + '" style="width:44px;height:34px;padding:2px;background:var(--bg-soft);border:1px solid var(--border);border-radius:8px">' +
              '<input class="input" id="sAccent" style="width:110px;font-family:var(--mono)" value="' + esc(s.accent) + '">' +
            '</div></div>' +
          '<div class="field"><label class="label" for="sSkin">默认皮肤</label>' +
            '<select class="select" id="sSkin">' +
              '<option value="night"' + (s.defaultSkin === 'night' ? ' selected' : '') + '>深夜（赛博）</option>' +
              '<option value="paper"' + (s.defaultSkin === 'paper' ? ' selected' : '') + '>纸白</option>' +
            '</select>' +
            '<div class="hint">访客自己换过皮肤就以他的选择为准。</div></div>' +
          '<div class="field"><label class="label" for="sBgType">背景类型</label>' +
            '<select class="select" id="sBgType">' +
              '<option value="none"' + (s.bgType === 'none' ? ' selected' : '') + '>无（纸面底色）</option>' +
              '<option value="image"' + (s.bgType === 'image' ? ' selected' : '') + '>图片 / GIF</option>' +
              '<option value="video"' + (s.bgType === 'video' ? ' selected' : '') + '>视频（mp4 / webm）</option>' +
            '</select></div>' +
          '<div class="field full"><label class="label" for="sBgUrl">背景地址</label>' +
            '<input class="input" id="sBgUrl" placeholder="https://…/bg.jpg 或 .gif / .mp4" value="' + esc(s.bgUrl) + '">' +
            '<div class="hint">支持静态图、GIF 动图、视频；默认关闭。开启后盖一层纸面蒙版，保证字还看得清</div></div>' +
          '<div class="field"><label class="label" for="sBgBlur">背景模糊：<b id="blurVal">' + Number(s.bgBlur) + '</b> px</label>' +
            '<input type="range" id="sBgBlur" min="0" max="16" step="1" value="' + Number(s.bgBlur) + '" style="width:100%;accent-color:var(--accent)"></div>' +
          '<div class="field"><label class="label" for="sBgMask">纸面蒙版：<b id="maskVal">' + Math.round(Number(s.bgMask) * 100) + '</b>%</label>' +
            '<input type="range" id="sBgMask" min="40" max="100" step="1" value="' + Math.round(Number(s.bgMask) * 100) + '" style="width:100%;accent-color:var(--accent)">' +
            '<div class="hint">越大越接近纯纸面，越小背景越明显。低于 60% 容易看不清字。</div></div>' +
          '<div class="field full"><label class="label">背景摆放</label>' +
            '<div class="bg-fit">' +
              '<select class="select" id="sBgFit" style="width:auto">' +
                '<option value="cover"' + (bgFit === 'cover' ? ' selected' : '') + '>铺满裁切</option>' +
                '<option value="contain"' + (bgFit === 'contain' ? ' selected' : '') + '>完整显示</option>' +
                '<option value="tile"' + (bgFit === 'tile' ? ' selected' : '') + '>平铺重复</option>' +
              '</select>' +
              '<span class="hint" id="bgFitHint"></span>' +
            '</div>' +
            '<div class="bg-stage" id="bgStage" title="按住拖动可以调整焦点">' +
              '<div class="bg-shot" id="bgShot"></div>' +
              '<span class="bg-stage-empty" id="bgStageEmpty">先在上面填背景地址</span>' +
              '<span class="bg-stage-tip">按住拖动 · 调整焦点</span>' +
            '</div>' +
            '<div class="bg-sliders">' +
              '<label class="bg-slider"><span>横向 <b id="posXVal">' + bgPosX + '</b>%</span>' +
                '<input type="range" id="sBgPosX" min="0" max="100" step="1" value="' + bgPosX + '"></label>' +
              '<label class="bg-slider"><span>纵向 <b id="posYVal">' + bgPosY + '</b>%</span>' +
                '<input type="range" id="sBgPosY" min="0" max="100" step="1" value="' + bgPosY + '"></label>' +
              '<label class="bg-slider"><span><span id="scaleWord">放大</span> <b id="scaleVal">' + bgScale + '</b>%</span>' +
                '<input type="range" id="sBgScale" min="100" max="300" step="5" value="' + bgScale + '"></label>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="grid-3" style="margin-top:6px">' +
          '<label class="check"><input type="checkbox" id="sGlass"' + (s.glass === '1' ? ' checked' : '') + '> 毛玻璃（按钮与选项变模糊）</label>' +
          '<label class="check"><input type="checkbox" id="sGlow"' + (s.glow === '1' ? ' checked' : '') + '> 鼠标靠近有光圈</label>' +
          '<label class="check"><input type="checkbox" id="sShowDl"' + (s.showDownloads === '1' ? ' checked' : '') + '> 显示下载次数</label>' +
          '<label class="check"><input type="checkbox" id="sShowSize"' + (s.showSize === '1' ? ' checked' : '') + '> 显示文件大小</label>' +
          '<label class="check"><input type="checkbox" id="sComments"' + (s.commentsEnabled === '1' ? ' checked' : '') + '> 开启评论</label>' +
          '<label class="check"><input type="checkbox" id="sReview"' + (s.commentReview === '1' ? ' checked' : '') + '> 评论先审后发</label>' +
          '<label class="check"><input type="checkbox" id="sBiliTool"' + (s.biliToolEnabled !== '0' ? ' checked' : '') + '> 显示「bilibili视频转换mp3」入口</label>' +
        '</div>' +
        '<div class="hint" style="margin-top:10px">改完记得点右上角「保存设置」——前台刷新即生效，不用重新部署。</div>' +
      '</div>' +
    '</div>';

  renderSocialBox(box);

  /* 主题色联动 */
  function setAccent(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    $('#sAccent', box).value = hex;
    $('#sAccentPicker', box).value = hex;
    applyAppearance({ accent: hex, glass: $('#sGlass', box).checked ? '1' : '0', glow: $('#sGlow', box).checked ? '1' : '0' });
  }

  $$('#themeGrid .theme-swatch', box).forEach(function (el) {
    el.addEventListener('click', function () {
      $$('#themeGrid .theme-swatch', box).forEach(function (x) { x.classList.remove('active'); });
      el.classList.add('active');
      setAccent(THEMES[el.getAttribute('data-theme')].accent);
    });
  });

  $('#sAccentPicker', box).addEventListener('input', function () { setAccent(this.value); });
  $('#sAccent', box).addEventListener('change', function () { setAccent(this.value.trim()); });
  $('#sBgBlur', box).addEventListener('input', function () { $('#blurVal', box).textContent = this.value; });
  $('#sBgMask', box).addEventListener('input', function () { $('#maskVal', box).textContent = this.value; });

  /* ---------- 背景摆放：预览 + 拖拽 + 滑块 ---------- */
  var bgStage = $('#bgStage', box);
  var bgShot = $('#bgShot', box);

  function paintBg() {
    var fit = $('#sBgFit', box).value;
    var scale = $('#sBgScale', box);

    /* 平铺时滑块表示「单张宽度」，另外两种表示「放大倍数」，量纲不同 */
    if (fit === 'tile') {
      scale.min = 5;
      scale.max = 100;
      if (Number(scale.value) > 100) scale.value = 40;
      $('#scaleWord', box).textContent = '单张宽度';
      $('#bgFitHint', box).textContent = '同一张图重复铺满，适合小纹理';
    } else {
      scale.min = 100;
      scale.max = 300;
      if (Number(scale.value) < 100) scale.value = 100;
      $('#scaleWord', box).textContent = '放大';
      $('#bgFitHint', box).textContent = fit === 'contain'
        ? '完整显示整张图，四周可能露出底色'
        : '铺满整屏，超出的部分被裁掉';
    }

    var url = $('#sBgUrl', box).value.trim();
    var x = Number($('#sBgPosX', box).value);
    var y = Number($('#sBgPosY', box).value);
    var s = Number(scale.value);
    var has = /^https?:\/\//i.test(url);

    bgShot.style.backgroundImage = has ? 'url("' + url.replace(/"/g, '%22') + '")' : '';
    bgShot.style.backgroundPosition = x + '% ' + y + '%';
    bgShot.style.backgroundRepeat = fit === 'tile' ? 'repeat' : 'no-repeat';
    bgShot.style.backgroundSize = fit === 'tile' ? s + '% auto' : fit;
    bgShot.style.transform = fit === 'tile' ? 'none' : 'scale(' + (s / 100) + ')';
    bgShot.style.transformOrigin = x + '% ' + y + '%';

    $('#bgStageEmpty', box).hidden = has;
    $('#posXVal', box).textContent = x;
    $('#posYVal', box).textContent = y;
    $('#scaleVal', box).textContent = s;
  }

  /* 拖拽：往右拖，图跟着往右走，等价于 position 百分比变小 */
  var drag = null;

  bgStage.addEventListener('pointerdown', function (e) {
    if (!/^https?:\/\//i.test($('#sBgUrl', box).value.trim())) return;
    drag = {
      x: e.clientX, y: e.clientY,
      px: Number($('#sBgPosX', box).value),
      py: Number($('#sBgPosY', box).value),
      w: bgStage.clientWidth || 1,
      h: bgStage.clientHeight || 1
    };
    bgStage.classList.add('dragging');
    if (bgStage.setPointerCapture) bgStage.setPointerCapture(e.pointerId);
  });

  bgStage.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var nx = drag.px - ((e.clientX - drag.x) / drag.w) * 100;
    var ny = drag.py - ((e.clientY - drag.y) / drag.h) * 100;
    $('#sBgPosX', box).value = Math.round(Math.min(100, Math.max(0, nx)));
    $('#sBgPosY', box).value = Math.round(Math.min(100, Math.max(0, ny)));
    paintBg();
  });

  function endBgDrag() {
    if (!drag) return;
    drag = null;
    bgStage.classList.remove('dragging');
  }
  bgStage.addEventListener('pointerup', endBgDrag);
  bgStage.addEventListener('pointercancel', endBgDrag);

  $('#sBgFit', box).addEventListener('change', paintBg);
  $('#sBgPosX', box).addEventListener('input', paintBg);
  $('#sBgPosY', box).addEventListener('input', paintBg);
  $('#sBgScale', box).addEventListener('input', paintBg);
  $('#sBgType', box).addEventListener('change', paintBg);

  var urlTimer = 0;
  $('#sBgUrl', box).addEventListener('input', function () {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(paintBg, 400);
  });

  paintBg();
  $('#sGlass', box).addEventListener('change', function () {
    document.body.classList.toggle('glass', this.checked);
  });
  $('#sGlow', box).addEventListener('change', function () {
    document.body.classList.toggle('glow', this.checked);
  });

  $('#socAdd', box).addEventListener('click', function () {
    socialDraft.push({ name: '', url: '', icon: '', sortOrder: 100 - socialDraft.length });
    renderSocialBox(box);
  });

  $('#setReset', box).addEventListener('click', function () { Views.settings(box); });

  $('#setSave', box).addEventListener('click', async function () {
    var btn = this;
    var activeTheme = $('#themeGrid .theme-swatch.active', box);
    var payload = {
      siteTitle: $('#sTitle', box).value.trim(),
      siteSubtitle: $('#sSubtitle', box).value.trim(),
      heroLine: $('#sHero', box).value.trim(),
      bio: $('#sBio', box).value.trim(),
      avatarUrl: $('#sAvatar', box).value.trim(),
      footerText: $('#sFooter', box).value.trim(),
      metaDescription: $('#sDesc', box).value.trim(),
      metaKeywords: $('#sKeywords', box).value.trim(),
      ogImage: $('#sOg', box).value.trim(),
      theme: activeTheme ? activeTheme.getAttribute('data-theme') : 'indigo',
      accent: $('#sAccent', box).value.trim(),
      bgType: $('#sBgType', box).value,
      bgUrl: $('#sBgUrl', box).value.trim(),
      bgBlur: Number($('#sBgBlur', box).value),
      bgMask: Number($('#sBgMask', box).value) / 100,
      bgFit: $('#sBgFit', box).value,
      bgPosX: Number($('#sBgPosX', box).value),
      bgPosY: Number($('#sBgPosY', box).value),
      bgScale: Number($('#sBgScale', box).value),
      defaultSkin: $('#sSkin', box).value,
      glass: $('#sGlass', box).checked,
      glow: $('#sGlow', box).checked,
      showDownloads: $('#sShowDl', box).checked,
      showSize: $('#sShowSize', box).checked,
      commentsEnabled: $('#sComments', box).checked,
      commentReview: $('#sReview', box).checked,
      biliToolEnabled: $('#sBiliTool', box).checked,
      socialLinks: socialDraft.filter(function (x) { return x.name && x.url; })
    };

    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      var out = await req('/api/admin/settings', { method: 'PUT', body: payload });
      state.settings = out.settings;
      applyAppearance(out.settings);
      toast('设置已保存，前台刷新即可看到', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = '保存设置';
    }
  });
};

function renderSocialBox(box) {
  var el = $('#socBox', box);
  if (!el) return;

  if (!socialDraft.length) {
    el.innerHTML = '<div class="hint">还没有社交链接，点右上角「+ 添加」</div>';
    return;
  }

  el.innerHTML = socialDraft.map(function (item, i) {
    return '<div class="social-row" data-idx="' + i + '">' +
      '<input class="input" data-f="name" placeholder="名称" maxlength="24" value="' + esc(item.name) + '">' +
      '<input class="input" data-f="url" placeholder="https://…" value="' + esc(item.url) + '">' +
      '<input class="input" data-f="icon" placeholder="图标" maxlength="8" value="' + esc(item.icon || '') + '">' +
      '<input class="input" data-f="sortOrder" type="number" value="' + Number(item.sortOrder || 0) + '" title="排序">' +
      '<button class="btn btn-icon btn-danger" data-del="' + i + '" title="删除">✕</button>' +
    '</div>';
  }).join('');

  $$('[data-f]', el).forEach(function (input) {
    input.addEventListener('input', function () {
      var row = input.closest('.social-row');
      var idx = Number(row.getAttribute('data-idx'));
      var field = input.getAttribute('data-f');
      socialDraft[idx][field] = field === 'sortOrder' ? Number(input.value) || 0 : input.value;
    });
  });

  $$('[data-del]', el).forEach(function (btn) {
    btn.addEventListener('click', function () {
      socialDraft.splice(Number(btn.getAttribute('data-del')), 1);
      renderSocialBox(box);
    });
  });
}

/* ==========================================================================
   五、备份与恢复
   ========================================================================== */

Views.backup = async function (box) {
  box.innerHTML =
    '<div class="grid-2" style="align-items:start">' +
      '<div class="panel">' +
        '<div class="panel-head"><h2>导出备份</h2></div>' +
        '<div class="panel-body">' +
          '<p style="margin:0 0 10px;font-size:13px;color:#c8d1db;line-height:1.7">' +
            '把资料、分类、标签、评论和站点设置打包成一个 JSON 文件。密码不包含在内。</p>' +
          '<button class="btn btn-primary" id="bkExport">导出全部数据</button>' +
          '<div class="hint" style="margin-top:10px">建议每次批量改动前导出一份</div>' +
        '</div>' +
      '</div>' +
      '<div class="panel">' +
        '<div class="panel-head"><h2>从备份恢复</h2></div>' +
        '<div class="panel-body">' +
          '<p style="margin:0 0 10px;font-size:13px;color:#c8d1db;line-height:1.7">' +
            '选择之前导出的 JSON，先看差异预览，确认后再写入。</p>' +
          '<input type="file" id="bkFile" accept="application/json,.json" style="display:none">' +
          '<button class="btn" id="bkPick">选择文件…</button>' +
          '<span id="bkFileName" style="margin-left:8px;font-size:12.5px;color:var(--muted)"></span>' +
          '<div id="bkPreview" style="margin-top:12px"></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="panel">' +
      '<div class="panel-head"><h2>说明</h2></div>' +
      '<div class="panel-body" style="font-size:12.5px;color:var(--muted);line-height:1.9">' +
        '· 合并导入：按 id 覆盖同一条资料，其余新增，适合把另一份备份合进来。<br>' +
        '· 覆盖导入：先清空资料 / 分类 / 标签 / 评论，再完整写入，适合整站还原。<br>' +
        '· 两种方式都不会动后台密码，也不会动下载明细与操作日志。' +
      '</div>' +
    '</div>';

  $('#bkExport', box).addEventListener('click', async function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = '打包中…';
    try {
      var data = await req('/api/admin/backup');
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      downloadBlob(blob, 'zzz513-backup-' + todayInput() + '.json');
      toast('已导出', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = '导出全部数据';
    }
  });

  $('#bkPick', box).addEventListener('click', function () { $('#bkFile', box).click(); });

  $('#bkFile', box).addEventListener('change', async function () {
    var file = this.files && this.files[0];
    if (!file) return;
    $('#bkFileName', box).textContent = file.name + '（' + Math.round(file.size / 1024) + ' KB）';

    var text = await file.text();
    var parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      $('#bkPreview', box).innerHTML = '<div class="err">文件不是合法的 JSON</div>';
      return;
    }

    var data = parsed && parsed.data ? parsed.data : parsed;
    if (!data || !Array.isArray(data.resources)) {
      $('#bkPreview', box).innerHTML = '<div class="err">这个文件里没有 resources 数组，可能不是本站导出的备份</div>';
      return;
    }

    $('#bkPreview', box).innerHTML = '<div class="hint">正在比对差异…</div>';
    try {
      var preview = await req('/api/admin/restore/preview', { method: 'POST', body: { data: data } });
      $('#bkPreview', box).innerHTML =
        '<div class="panel" style="background:#10161e">' +
          '<div class="panel-body">' +
            '<dl class="kv">' +
              '<dt>新增资料</dt><dd>' + preview.resources.add + ' 份</dd>' +
              '<dt>覆盖已有</dt><dd>' + preview.resources.update + ' 份</dd>' +
              '<dt>无法识别</dt><dd>' + (preview.resources.invalid ? '<span style="color:#ffb3ae">' + preview.resources.invalid + ' 份（会跳过）</span>' : '0 份') + '</dd>' +
              '<dt>分类</dt><dd>' + preview.categories + ' 个</dd>' +
              '<dt>标签</dt><dd>' + preview.tags + ' 个</dd>' +
              '<dt>评论</dt><dd>' + preview.comments + ' 条</dd>' +
              '<dt>备份时间</dt><dd>' + (preview.exportedAt ? fmtTime(preview.exportedAt) : '未知') + '</dd>' +
            '</dl>' +
            '<div class="row tight" style="margin-top:14px">' +
              '<select class="select" id="bkMode" style="width:170px">' +
                '<option value="merge">合并导入（推荐）</option>' +
                '<option value="replace">覆盖导入（先清空）</option>' +
              '</select>' +
              '<button class="btn btn-primary" id="bkGo">确认导入</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      $('#bkGo', box).addEventListener('click', function () { doRestore(box, data); });
    } catch (err) {
      $('#bkPreview', box).innerHTML = '<div class="err">' + esc(err.message) + '</div>';
    }
  });
};

async function doRestore(box, data) {
  var mode = $('#bkMode', box).value;
  var yes = await confirmDialog({
    title: mode === 'replace' ? '覆盖导入' : '合并导入',
    message: mode === 'replace'
      ? '会<b>先清空</b>现有资料、分类、标签和评论，再写入备份内容。此操作不可撤销。'
      : '按 id 覆盖同一条资料，新的会追加。现有数据不会被清空。',
    danger: mode === 'replace',
    okText: '确认导入'
  });
  if (!yes) return;

  var btn = $('#bkGo', box);
  btn.disabled = true;
  btn.textContent = '导入中…';
  try {
    var out = await req('/api/admin/restore', { method: 'POST', body: { data: data, mode: mode } });
    toast('已导入 ' + out.inserted + ' 份资料', 'ok');
    resState.loaded = false;
    $('#bkPreview', box).innerHTML = '<div class="hint">导入完成：资料 ' + out.before + ' → ' + out.after + ' 份</div>';
  } catch (err) {
    toast(err.message, 'err');
    btn.disabled = false;
    btn.textContent = '确认导入';
  }
}

/* ==========================================================================
   六、账号安全
   ========================================================================== */

var secState = { page: 1, pageSize: 20 };

Views.security = async function (box) {
  box.innerHTML =
    '<div class="grid-2" style="align-items:start">' +
      '<div class="panel">' +
        '<div class="panel-head"><h2>修改密码</h2>' +
          '<div class="spacer"></div>' +
          (state.customPassword ? '<span class="badge ok">已自定义</span>' : '<span class="badge warn">使用 Secret 初始密码</span>') +
        '</div>' +
        '<div class="panel-body">' +
          '<div class="field"><label class="label" for="pwOld">原密码</label>' +
            '<input class="input" type="password" id="pwOld" autocomplete="current-password"></div>' +
          '<div class="field" style="margin-top:10px"><label class="label" for="pwNew">新密码（至少 8 位）</label>' +
            '<input class="input" type="password" id="pwNew" autocomplete="new-password"></div>' +
          '<div class="field" style="margin-top:10px"><label class="label" for="pw2">再输一次</label>' +
            '<input class="input" type="password" id="pw2" autocomplete="new-password"></div>' +
          '<div class="err" id="pwErr"></div>' +
          '<button class="btn btn-primary" id="pwSave" style="margin-top:12px">更新密码</button>' +
          '<div class="hint" style="margin-top:10px">修改后立即生效，不需要重新部署；已登录的会话仍然有效，直到自然过期。</div>' +
        '</div>' +
      '</div>' +
      '<div class="panel">' +
        '<div class="panel-head"><h2>登录记录</h2><div class="spacer"></div><span class="sub" id="lgTotal"></span></div>' +
        '<div class="table-wrap"><table class="table" style="min-width:420px">' +
          '<thead><tr><th style="width:150px">时间</th><th>IP</th><th>设备</th><th style="width:70px">结果</th></tr></thead>' +
          '<tbody id="lgRows"></tbody>' +
        '</table></div>' +
        '<div id="lgPager"></div>' +
      '</div>' +
    '</div>' +
    '<div class="panel">' +
      '<div class="panel-head"><h2>安全须知</h2></div>' +
      '<div class="panel-body" style="font-size:12.5px;color:var(--muted);line-height:1.9">' +
        '· 密码用 SHA-256 加随机盐存储，比较时走常量时间，不会被时序攻击猜出来。<br>' +
        '· 同一 IP 连续输错 5 次锁定 15 分钟，锁定期间即使密码正确也会被拒。<br>' +
        '· 会话是 HttpOnly Cookie，前端脚本读不到；默认 7 天，勾选「记住我」延长到 30 天。<br>' +
        '· 如果忘记密码，可以执行 <code style="font-family:var(--mono);font-size:11.5px">npx wrangler d1 execute zzz513-db --remote --command="DELETE FROM settings WHERE key=\'adminPasswordHash\'"</code> 回退到 Secret 密码。' +
      '</div>' +
    '</div>';

  $('#pwSave', box).addEventListener('click', async function () {
    var oldPw = $('#pwOld', box).value;
    var newPw = $('#pwNew', box).value;
    var again = $('#pw2', box).value;
    var err = $('#pwErr', box);

    if (!oldPw) { err.textContent = '请输入原密码'; return; }
    if (newPw.length < 8) { err.textContent = '新密码至少 8 位'; return; }
    if (newPw !== again) { err.textContent = '两次输入的新密码不一致'; return; }
    err.textContent = '';

    var btn = this;
    btn.disabled = true;
    btn.textContent = '更新中…';
    try {
      await req('/api/admin/password', { method: 'POST', body: { oldPassword: oldPw, newPassword: newPw } });
      toast('密码已更新', 'ok');
      state.customPassword = true;
      $('#pwOld', box).value = '';
      $('#pwNew', box).value = '';
      $('#pw2', box).value = '';
      Views.security(box);
    } catch (e) {
      err.textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '更新密码';
    }
  });

  await loadLoginLogs(box);
};

async function loadLoginLogs(box) {
  var rows = $('#lgRows', box);
  rows.innerHTML = '<tr><td colspan="4">' + skeletonRows(3) + '</td></tr>';
  try {
    var data = await req('/api/admin/login-logs?page=' + secState.page + '&pageSize=' + secState.pageSize);
    $('#lgTotal', box).textContent = '共 ' + data.total + ' 条';
    rows.innerHTML = data.items.length ? data.items.map(function (l) {
      return '<tr>' +
        '<td class="nowrap" style="font-family:var(--mono);font-size:11.5px;color:var(--muted)">' + fmtTime(l.createdAt) + '</td>' +
        '<td style="font-family:var(--mono);font-size:11.5px">' + esc(l.ip) + '</td>' +
        '<td style="font-size:12px;color:var(--muted)">' + esc(l.ua) + '</td>' +
        '<td>' + (l.success ? '<span class="badge ok">成功</span>' : '<span class="badge danger">失败</span>') + '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="4">' + emptyBlock('暂无记录') + '</td></tr>';

    $('#lgPager', box).innerHTML = pagerHtml(data.total, data.page, data.pageSize);
    bindPager($('#lgPager', box), function (p) { secState.page = p; loadLoginLogs(box); },
      function (size) { secState.pageSize = size; secState.page = 1; loadLoginLogs(box); });
  } catch (err) {
    rows.innerHTML = '<tr><td colspan="4"><div class="err">' + esc(err.message) + '</div></td></tr>';
  }
}
