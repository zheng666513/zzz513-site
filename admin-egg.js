/* ==========================================================================
   彩蛋（91 按钮）
   - 配置：两个站点、A 的占比、开关
   - 数据：总点击 / 今日 / 各站 / 近 14 天 / 地点 / 明细
   ========================================================================== */

var eggState = { page: 1, pageSize: 20, days: 14, site: '', loading: false };

Views.egg = async function (box) {
  box.innerHTML = '<div class="panel"><div class="panel-head"><h2>彩蛋</h2></div>' +
    '<div style="padding:16px">' + skeletonRows(4) + '</div></div>';

  var res = await req('/api/admin/settings');
  var s = res.settings;

  box.innerHTML =
    '<div class="panel" style="position:sticky;top:53px;z-index:9;margin-bottom:14px">' +
      '<div class="panel-head" style="border-bottom:0">' +
        '<h2>彩蛋</h2>' +
        '<span class="sub">右下角那个「91」，点一次记一次，记的是谁、什么时候、在哪儿</span>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-sm" id="eggExport">导出 CSV</button>' +
        '<button class="btn btn-primary btn-sm" id="eggSave">保存设置</button>' +
      '</div>' +
    '</div>' +

    '<div class="panel">' +
      '<div class="panel-head"><h2>配置</h2><span class="sub">占比按整数百分比，两边加起来自动 100</span></div>' +
      '<div class="panel-body">' +
        '<label class="check" style="margin-bottom:14px"><input type="checkbox" id="eggEnabled"' +
          (s.eggEnabled === '1' ? ' checked' : '') + '> 启用这个按钮</label>' +
        '<div class="form-grid">' +
          '<div class="field"><label class="label" for="eggNameA">A 站名称</label>' +
            '<input class="input" id="eggNameA" maxlength="24" value="' + esc(s.eggSiteAName) + '"></div>' +
          '<div class="field"><label class="label" for="eggUrlA">A 站链接</label>' +
            '<input class="input" id="eggUrlA" placeholder="https://…（留空表示只走 B）" value="' + esc(s.eggSiteA) + '"></div>' +
          '<div class="field"><label class="label" for="eggNameB">B 站名称</label>' +
            '<input class="input" id="eggNameB" maxlength="24" value="' + esc(s.eggSiteBName) + '"></div>' +
          '<div class="field"><label class="label" for="eggUrlB">B 站链接</label>' +
            '<input class="input" id="eggUrlB" placeholder="https://…（留空表示只走 A）" value="' + esc(s.eggSiteB) + '"></div>' +
        '</div>' +
        '<div class="field" style="margin-top:16px">' +
          '<label class="label" for="eggPercent">A 的占比：<b id="eggPctVal">' + Number(s.eggPercent) + '</b>%' +
            '　<span style="color:var(--dim)">→ B 自动 ' + (100 - Number(s.eggPercent)) + '%</span></label>' +
          '<input type="range" id="eggPercent" min="0" max="100" step="1" value="' + Number(s.eggPercent) + '"' +
            ' style="width:100%;accent-color:var(--accent)">' +
          '<div class="hint">抽签在后端做，抽完立刻记账，所以统计和实际跳转一定对得上。</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="panel">' +
      '<div class="panel-head"><h2>数据</h2><span class="sub">每 60 秒最多记 30 条，防止有人按住不放</span>' +
        '<div class="spacer"></div>' +
        '<select class="select" id="eggDays" style="width:auto">' +
          [7, 14, 30].map(function (d) {
            return '<option value="' + d + '"' + (d === 14 ? ' selected' : '') + '>近 ' + d + ' 天</option>';
          }).join('') +
        '</select>' +
        '<button class="btn btn-sm btn-danger" id="eggClear">清空记录</button>' +
      '</div>' +
      '<div class="panel-body" id="eggStats">' + skeletonRows(3) + '</div>' +
    '</div>' +
    '<div class="panel">' +
      '<div class="panel-head"><h2>明细</h2><span class="sub">IP 已脱敏；城市来自 Cloudflare 边缘节点</span></div>' +
      '<div id="eggRows"></div>' +
      '<div id="eggPager"></div>' +
    '</div>';

  var pct = $('#eggPercent', box);
  var pctVal = $('#eggPctVal', box);
  pct.addEventListener('input', function () {
    pctVal.textContent = pct.value;
    var bSpan = pct.parentNode.querySelector('label span');
    if (bSpan) bSpan.textContent = '→ B 自动 ' + (100 - Number(pct.value)) + '%';
  });

  $('#eggDays', box).addEventListener('change', function () {
    eggState.days = Number(this.value);
    loadEggStats(box);
  });

  $('#eggSave', box).addEventListener('click', async function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      await req('/api/admin/settings', {
        method: 'PUT',
        body: {
          eggEnabled: $('#eggEnabled', box).checked,
          eggPercent: Number($('#eggPercent', box).value),
          eggSiteAName: $('#eggNameA', box).value.trim(),
          eggSiteA: $('#eggUrlA', box).value.trim(),
          eggSiteBName: $('#eggNameB', box).value.trim(),
          eggSiteB: $('#eggUrlB', box).value.trim()
        }
      });
      toast('配置已保存，前台下一次点击就按新比例', 'ok');
      loadEggStats(box);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = '保存设置';
    }
  });

  $('#eggExport', box).addEventListener('click', async function () {
    var btn = this;
    btn.disabled = true;
    try {
      var r = await reqRaw('/api/admin/egg/export');
      downloadBlob(await r.blob(), 'egg-clicks-' + todayInput() + '.csv');
      toast('已开始下载', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  $('#eggClear', box).addEventListener('click', async function () {
    var yes = await confirmDialog({
      title: '清空点击记录',
      message: '会删掉全部点击明细，<b>配置不会动</b>。确定吗？',
      okText: '清空',
      danger: true
    });
    if (!yes) return;
    try {
      await req('/api/admin/egg', { method: 'DELETE' });
      toast('记录已清空', 'ok');
      eggState.page = 1;
      loadEggStats(box);
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  await loadEggStats(box);
};

async function loadEggStats(box) {
  var host = $('#eggStats', box);
  if (!host) return;
  eggState.loading = true;

  var data;
  try {
    data = await req('/api/admin/egg/stats?days=' + eggState.days +
      '&page=' + eggState.page + '&pageSize=' + eggState.pageSize +
      (eggState.site ? '&site=' + eggState.site : ''));
  } catch (err) {
    host.innerHTML = emptyBlock('统计读不出来', err.message);
    return;
  } finally {
    eggState.loading = false;
  }

  var c = data.cards;
  var cfg = data.config || { a: { name: 'A' }, b: { name: 'B' }, percent: 60 };
  var aShare = c.a + c.b ? Math.round((c.a / (c.a + c.b)) * 100) : 0;

  var cards = [
    { k: '总点击', v: c.total, d: '有记录以来' },
    { k: '今日', v: c.today, d: 'UTC+8 当天' },
    { k: '去了' + cfg.a.name, v: c.a, d: '实际占 ' + aShare + '%（设定 ' + cfg.percent + '%）' },
    { k: '去了' + cfg.b.name, v: c.b, d: '实际占 ' + (c.a + c.b ? 100 - aShare : 0) + '%' },
    { k: '近 ' + c.days + ' 天', v: c.range, d: '区间内点击' }
  ];

  var html = '<div class="stat-grid">';
  cards.forEach(function (card) {
    html += '<div class="stat"><div class="k"><i class="mark"></i>' + esc(card.k) + '</div>' +
      '<div class="v">' + fmtNum(card.v) + '</div><div class="d">' + card.d + '</div></div>';
  });
  html += '</div>';

  /* 每日柱：两根叠在一起，看趋势够用了 */
  var max = 1;
  data.byDay.forEach(function (d) { max = Math.max(max, d.total); });

  html += '<div class="panel-head" style="border-bottom:0;padding:18px 0 6px">' +
    '<h2>每天点了多少次</h2><div class="spacer"></div>' +
    '<span class="sub">深色 A · 浅色 B</span></div>';

  /* 高度一律用像素算，别交给百分比 —— flex 挤压会让两段比例失真 */
  var CHART = 106;
  if (!data.byDay.some(function (d) { return d.total > 0; })) {
    html += '<div class="egg-bars-empty">近 14 天还没有点击</div>';
  } else {
    html += '<div class="egg-bars">';
    data.byDay.forEach(function (d) {
      var hp = d.total ? Math.max(5, Math.round((d.total / max) * CHART)) : 0;
      /* 两段都写成像素，别让 .stack 的 gap / flex 再去分这点高度 */
      var ah = d.total ? Math.round(hp * (d.a / d.total)) : 0;
      var bh = hp - ah;
      html += '<div class="egg-bar" title="' + d.d + ' · 共 ' + d.total + '（A ' + d.a + ' / B ' + d.b + '）">' +
        (d.total
          ? '<div style="width:26px;height:' + hp + 'px;gap:0;display:flex;flex-direction:column;' +
            'border-radius:2px;overflow:hidden;background:rgba(0,0,0,.04)">' +
            '<i style="display:block;width:100%;height:' + ah + 'px;background:var(--accent)"></i>' +
            '<i style="display:block;width:100%;height:' + bh + 'px;background:#b09280"></i>' +
            '</div>'
          : '<div style="width:26px;height:2px;border-radius:1px;background:rgba(0,0,0,.12)"></div>') +
        '<span>' + d.d.slice(5) + '</span>' +
      '</div>';
    });
    html += '</div>';
  }

  if (data.places.length) {
    html += '<div class="panel-head" style="border-bottom:0;padding:10px 0 4px"><h2>都从哪儿来</h2></div>' +
      '<div class="egg-places">';
    data.places.forEach(function (p) {
      var where = [p.country, p.region, p.city].filter(Boolean).join(' · ') || '未知';
      html += '<div class="egg-place"><span>' + esc(where) + '</span><b>' + fmtNum(p.count) + '</b></div>';
    });
    html += '</div>';
  }

  host.innerHTML = html;

  /* 明细 */
  var rows = $('#eggRows', box);
  if (!data.items.length) {
    rows.innerHTML = emptyBlock('还没有点击', '把按钮放出去，等第一条记录');
    $('#eggPager', box).innerHTML = '';
    return;
  }

  rows.innerHTML = '<div class="table-wrap"><table class="table"><thead><tr>' +
    '<th style="width:150px">时间</th><th style="width:110px">去了</th>' +
    '<th>地点</th><th style="width:150px">IP</th><th>设备</th></tr></thead><tbody>' +
    data.items.map(function (it) {
      var where = [it.country, it.region, it.city].filter(Boolean).join(' · ') || '—';
      if (it.colo) where += ' <span style="color:var(--dim)">(' + esc(it.colo) + ')</span>';
      return '<tr>' +
        '<td class="nowrap" style="font-family:var(--num);font-size:12px">' + fmtEggTime(it.createdAt) + '</td>' +
        '<td><span class="badge" style="color:var(--accent-deep);background:var(--accent-soft);border-color:var(--accent-line)">' +
          esc(it.label || (it.site === 'A' ? 'A' : 'B')) + '</span></td>' +
        '<td style="font-size:12.5px">' + where + '</td>' +
        '<td class="nowrap" style="font-family:var(--num);font-size:12px;color:var(--muted)">' + esc(it.ip) + '</td>' +
        '<td style="font-size:12px;color:var(--muted)">' + esc(briefUa(it.ua)) + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';

  $('#eggPager', box).innerHTML = pagerHtml(data.total, data.page, data.pageSize);
  bindPager($('#eggPager', box), function (p) {
    eggState.page = p;
    loadEggStats(box);
  }, function (size) {
    eggState.pageSize = size;
    eggState.page = 1;
    loadEggStats(box);
  });
}

function fmtEggTime(ms) {
  var d = new Date(Number(ms) + 8 * 3600e3);
  var p = function (x) { return String(x).padStart(2, '0'); };
  return d.toISOString().slice(0, 10) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}

/** UA 只留够认人的部分，不整串塞进表格 */
function briefUa(ua) {
  var s = String(ua || '');
  if (!s) return '—';
  var os = /Windows/i.test(s) ? 'Windows'
    : /iPhone|iPad|iPod/i.test(s) ? 'iOS'
    : /Android/i.test(s) ? 'Android'
    : /Mac OS X/i.test(s) ? 'macOS'
    : /Linux/i.test(s) ? 'Linux' : '—';
  var br = /MicroMessenger/i.test(s) ? '微信'
    : /Edg\//i.test(s) ? 'Edge'
    : /OPR\//i.test(s) ? 'Opera'
    : /Firefox\//i.test(s) ? 'Firefox'
    : /Chrome\//i.test(s) ? 'Chrome'
    : /Safari\//i.test(s) ? 'Safari'
    : /curl/i.test(s) ? 'curl' : '其他';
  return br + ' · ' + os;
}
