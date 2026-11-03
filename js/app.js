/* ============================================================
 *  app.js —— 每日记账 主逻辑
 * ============================================================ */
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const state = {
    type: 'expense',          // 当前记账类型
    selectedCat: null,        // 当前选中分类名
    viewingMonth: monthStr(new Date()),  // 正在查看的月份
    editingId: null,          // 正在编辑的记录 id
    authMode: 'login'         // login | signup
  };

  function monthStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ============================================================
  //  初始化
  // ============================================================
  async function init() {
    bindEvents();
    setDefaultDatetime();
    renderQuickNums();
    await window.Store.init();
    window.Store.on('change', renderAll);
    renderAll();
    registerSW();
  }

  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }
  }

  function setDefaultDatetime() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    $('txnAt').value = d.toISOString().slice(0, 16);
  }

  // ============================================================
  //  事件绑定
  // ============================================================
  function bindEvents() {
    // 支出/收入切换
    document.querySelectorAll('.type-switch button').forEach(btn => {
      btn.addEventListener('click', () => {
        state.type = btn.dataset.type;
        document.querySelectorAll('.type-switch button').forEach(b => b.classList.toggle('active', b === btn));
        $('amountInput').className = 'amount-input ' + state.type;
        state.selectedCat = null;
        renderCatChips();
      });
    });

    // 快捷金额
    $('quickNums').addEventListener('click', (e) => {
      if (e.target.dataset.num) $('amountInput').value = e.target.dataset.num;
    });

    // 保存
    $('btnSave').addEventListener('click', saveRecord);
    $('btnCancelEdit').addEventListener('click', cancelEdit);

    // 月份切换
    $('prevMonth').addEventListener('click', () => shiftMonth(-1));
    $('nextMonth').addEventListener('click', () => shiftMonth(1));

    // 导出
    $('btnExport').addEventListener('click', exportCSV);

    // 分类新增
    $('btnAddCat').addEventListener('click', addCategory);

    // 预算
    $('btnEditBudget').addEventListener('click', openBudgetModal);
    $('btnBudgetSave').addEventListener('click', saveBudget);
    $('btnBudgetCancel').addEventListener('click', () => $('budgetModal').classList.remove('show'));

    // 登录
    $('btnAuth').addEventListener('click', () => { $('authModal').classList.add('show'); setAuthMode('login'); });
    $('authClose').addEventListener('click', () => $('authModal').classList.remove('show'));
    $('authSwitch').addEventListener('click', () => setAuthMode(state.authMode === 'login' ? 'signup' : 'login'));
    $('btnAuthSubmit').addEventListener('click', doAuth);
  }

  function shiftMonth(delta) {
    const [y, m] = state.viewingMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    state.viewingMonth = monthStr(d);
    renderAll();
  }

  function renderQuickNums() {
    const nums = ['10', '20', '50', '100', '200', '500'];
    $('quickNums').innerHTML = nums.map(n => `<button type="button" data-num="${n}">${n}元</button>`).join('');
  }

  // ============================================================
  //  分类 chips
  // ============================================================
  function renderCatChips() {
    const cats = window.Store.listCategories().filter(c => c.type === state.type);
    const box = $('catGrid');
    box.innerHTML = cats.map(c => `
      <button type="button" class="cat-chip ${state.selectedCat === c.name ? 'active' : ''}" data-cat="${c.name}">
        <span class="icon">${c.icon}</span><span>${c.name}</span>
      </button>`).join('');
    box.onclick = (e) => {
      const chip = e.target.closest('[data-cat]');
      if (chip) state.selectedCat = chip.dataset.cat;
      renderCatChips();
    };
    // 默认选中第一个
    if (!state.selectedCat && cats.length) state.selectedCat = cats[0].name;
    if (!cats.some(c => c.name === state.selectedCat)) state.selectedCat = cats[0] ? cats[0].name : null;
    box.innerHTML = cats.map(c => `
      <button type="button" class="cat-chip ${state.selectedCat === c.name ? 'active' : ''}" data-cat="${c.name}">
        <span class="icon">${c.icon}</span><span>${c.name}</span>
      </button>`).join('');
  }

  // ============================================================
  //  保存 / 编辑 / 删除
  // ============================================================
  function saveRecord() {
    const amount = parseFloat($('amountInput').value);
    if (!amount || amount <= 0) { toast('请输入正确的金额'); return; }
    if (!state.selectedCat) { toast('请选择分类'); return; }
    const txnAt = $('txnAt').value ? new Date($('txnAt').value).toISOString() : new Date().toISOString();

    const rec = {
      id: state.editingId || undefined,
      type: state.type,
      category: state.selectedCat,
      amount: Math.round(amount * 100) / 100,
      note: $('noteInput').value.trim(),
      txn_at: txnAt
    };
    window.Store.upsertRecord(rec);
    toast(state.editingId ? '已更新' : '已记下一笔');
    cancelEdit();
  }

  function cancelEdit() {
    state.editingId = null;
    $('amountInput').value = '';
    $('noteInput').value = '';
    $('btnCancelEdit').classList.add('hidden');
    $('formTitle').textContent = '记一笔';
    setDefaultDatetime();
  }

  function startEdit(id) {
    const rec = window.Store.listRecords().find(r => r.id === id);
    if (!rec) return;
    state.editingId = id;
    state.type = rec.type;
    document.querySelectorAll('.type-switch button').forEach(b => b.classList.toggle('active', b.dataset.type === rec.type));
    $('amountInput').className = 'amount-input ' + rec.type;
    $('amountInput').value = rec.amount;
    state.selectedCat = rec.category;
    renderCatChips();
    const d = new Date(rec.txn_at);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    $('txnAt').value = d.toISOString().slice(0, 16);
    $('noteInput').value = rec.note || '';
    $('btnCancelEdit').classList.remove('hidden');
    $('formTitle').textContent = '编辑记录';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ============================================================
  //  流水列表（按天分组、日期倒序）
  // ============================================================
  function renderTxnList() {
    const list = window.Store.listRecords().slice().sort((a, b) => new Date(b.txn_at) - new Date(a.txn_at));
    const box = $('txnList');
    if (!list.length) { box.innerHTML = '<div class="empty">还没有记录，开始记第一笔吧～</div>'; return; }

    const cats = {};
    window.Store.listCategories().forEach(c => cats[c.name] = c);

    // 按天分组
    const groups = {};
    list.forEach(r => {
      const day = new Date(r.txn_at).toISOString().slice(0, 10);
      (groups[day] = groups[day] || []).push(r);
    });

    let html = '';
    Object.keys(groups).sort().reverse().forEach(day => {
      const dayRecs = groups[day];
      const dayExp = dayRecs.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
      const dayInc = dayRecs.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
      html += `<div class="day-group-title">${day}  支出 ${fmt(dayExp)} · 收入 ${fmt(dayInc)}</div>`;
      dayRecs.forEach(r => {
        const c = cats[r.category] || { icon: '📦', color: '#888' };
        const sign = r.type === 'expense' ? '-' : '+';
        html += `
          <div class="txn-item">
            <div class="icon-box">${c.icon}</div>
            <div class="info">
              <div class="name">${r.category}</div>
              <div class="note">${r.note || ''}</div>
            </div>
            <div class="ops">
              <button data-edit="${r.id}">编辑</button>
              <button data-del="${r.id}">删除</button>
            </div>
            <div class="amt ${r.type}">${sign}${fmt(r.amount).slice(1)}</div>
          </div>`;
      });
    });
    box.innerHTML = html;

    box.onclick = (e) => {
      const ed = e.target.dataset.edit;
      const dl = e.target.dataset.del;
      if (ed) startEdit(ed);
      if (dl) {
        if (confirm('确定删除这条记录？')) { window.Store.deleteRecord(dl); toast('已删除'); }
      }
    };
  }

  // ============================================================
  //  统计
  // ============================================================
  function recordsOfMonth(month) {
    return window.Store.listRecords().filter(r => new Date(r.txn_at).toISOString().slice(0, 7) === month);
  }

  function renderStats() {
    $('monthLabel').textContent = state.viewingMonth;
    const recs = recordsOfMonth(state.viewingMonth);
    const exp = recs.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const inc = recs.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    $('statIncome').textContent = fmt(inc);
    $('statExpense').textContent = fmt(exp);
    $('statBalance').textContent = fmt(inc - exp);

    drawPie(recs.filter(r => r.type === 'expense'));
    drawBar();
    renderBudget();
  }

  // ---- 饼图（Canvas）----
  function drawPie(expenseRecs) {
    const canvas = $('pieCanvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.clientWidth * devicePixelRatio;
    const H = canvas.height = 220 * devicePixelRatio;
    canvas.style.height = '220px';
    ctx.clearRect(0, 0, W, H);

    // 按分类汇总
    const sum = {};
    expenseRecs.forEach(r => sum[r.category] = (sum[r.category] || 0) + r.amount);
    const entries = Object.entries(sum).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, e) => s + e[1], 0);

    const catMap = {};
    window.Store.listCategories().forEach(c => catMap[c.name] = c);

    if (!total) {
      ctx.fillStyle = '#999'; ctx.font = `${13 * devicePixelRatio}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('本月暂无支出', W / 2, H / 2);
      $('pieLegend').innerHTML = '';
      return;
    }

    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 10 * devicePixelRatio;
    let start = -Math.PI / 2;
    entries.forEach(([name, val]) => {
      const angle = (val / total) * Math.PI * 2;
      const color = (catMap[name] && catMap[name].color) || '#888';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      start += angle;
    });
    // 中心留白做成环形
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();

    $('pieLegend').innerHTML = entries.map(([name, val]) => {
      const color = (catMap[name] && catMap[name].color) || '#888';
      const pct = ((val / total) * 100).toFixed(1);
      return `<span><i style="background:${color}"></i>${name} ${pct}%</span>`;
    }).join('');
  }

  // ---- 近6个月柱状图（Canvas）----
  function drawBar() {
    const canvas = $('barCanvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.clientWidth * devicePixelRatio;
    const H = canvas.height = 220 * devicePixelRatio;
    canvas.style.height = '220px';
    ctx.clearRect(0, 0, W, H);

    // 最近 6 个月（含当前）
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(monthStr(d));
    }
    const recs = window.Store.listRecords();
    const data = months.map(m => {
      const rs = recs.filter(r => r.txn_at.slice(0, 7) === m);
      return {
        m,
        inc: rs.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0),
        exp: rs.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0)
      };
    });
    const max = Math.max(1, ...data.map(d => Math.max(d.inc, d.exp)));

    const padL = 30 * devicePixelRatio, padB = 22 * devicePixelRatio, padT = 10 * devicePixelRatio;
    const plotW = W - padL - 8 * devicePixelRatio;
    const plotH = H - padB - padT;
    const groupW = plotW / 6;
    const barW = groupW * 0.28;

    // 网格线
    ctx.strokeStyle = '#eee'; ctx.fillStyle = '#999'; ctx.font = `${10 * devicePixelRatio}px sans-serif`;
    for (let i = 0; i <= 3; i++) {
      const y = padT + plotH * (1 - i / 3);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - 8, y); ctx.stroke();
      ctx.fillText((max * i / 3 / 100).toFixed(0) + '百', 2, y + 3 * devicePixelRatio);
    }

    data.forEach((d, i) => {
      const gx = padL + groupW * i + groupW / 2;
      // 收入
      const hInc = (d.inc / max) * plotH;
      ctx.fillStyle = '#12a150';
      ctx.fillRect(gx - barW - 2, padT + plotH - hInc, barW, hInc);
      // 支出
      const hExp = (d.exp / max) * plotH;
      ctx.fillStyle = '#e5484d';
      ctx.fillRect(gx + 2, padT + plotH - hExp, barW, hExp);
      // 月份标签
      ctx.fillStyle = '#666'; ctx.textAlign = 'center';
      ctx.fillText(d.m.slice(5) + '月', gx, H - 8 * devicePixelRatio);
    });
  }

  // ============================================================
  //  预算
  // ============================================================
  function renderBudget() {
    const box = $('budgetList');
    const recs = recordsOfMonth(state.viewingMonth);
    const expTotal = recs.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const budget = window.Store.getBudget(state.viewingMonth);
    const cats = window.Store.listCategories().filter(c => c.type === 'expense');

    let html = '';
    // 总预算
    const totalBudget = budget ? Number(budget.total) : 0;
    if (totalBudget > 0) {
      const pct = (expTotal / totalBudget * 100);
      const cls = pct > 100 ? 'over' : pct > 80 ? 'near' : '';
      html += `<div class="budget-row">
        <div class="top"><span>总预算</span><span class="used">${fmt(expTotal)} / ${fmt(totalBudget)}（${pct.toFixed(0)}%）</span></div>
        <div class="progress"><div class="bar ${cls}" style="width:${Math.min(pct,100)}%"></div></div>
        ${pct > 100 ? '<div class="over-tip">⚠️ 已超支 ' + fmt(expTotal - totalBudget) + '</div>' : ''}
      </div>`;
    } else {
      html += '<div class="empty" style="padding:10px;">未设置总预算，点右上角「设置预算」开启提醒</div>';
    }

    // 各分类预算
    const items = (budget && budget.items) || {};
    Object.keys(items).forEach(catName => {
      const limit = Number(items[catName]);
      if (!limit || limit <= 0) return;
      const used = recs.filter(r => r.type === 'expense' && r.category === catName).reduce((s, r) => s + r.amount, 0);
      const pct = used / limit * 100;
      const cls = pct > 100 ? 'over' : pct > 80 ? 'near' : '';
      const c = cats.find(x => x.name === catName) || { icon: '📦' };
      html += `<div class="budget-row">
        <div class="top"><span>${c.icon} ${catName}</span><span class="used">${fmt(used)} / ${fmt(limit)}（${pct.toFixed(0)}%）</span></div>
        <div class="progress"><div class="bar ${cls}" style="width:${Math.min(pct,100)}%"></div></div>
        ${pct > 100 ? '<div class="over-tip">⚠️ 超支 ' + fmt(used - limit) + '</div>' : ''}
      </div>`;
    });
    box.innerHTML = html;
  }

  function openBudgetModal() {
    $('budgetMonthLabel').textContent = state.viewingMonth;
    const budget = window.Store.getBudget(state.viewingMonth) || { total: 0, items: {} };
    $('budgetTotal').value = budget.total || 0;
    const cats = window.Store.listCategories().filter(c => c.type === 'expense');
    $('budgetItems').innerHTML = cats.map(c => `
      <div class="field">
        <label>${c.icon} ${c.name}</label>
        <input type="number" step="0.01" min="0" data-cat="${c.name}" value="${budget.items[c.name] || ''}" placeholder="不填则不限">
      </div>`).join('');
    $('budgetModal').classList.add('show');
  }

  function saveBudget() {
    const items = {};
    document.querySelectorAll('#budgetItems input[data-cat]').forEach(inp => {
      const v = parseFloat(inp.value);
      if (v && v > 0) items[inp.dataset.cat] = v;
    });
    window.Store.upsertBudget({
      month: state.viewingMonth,
      total: parseFloat($('budgetTotal').value) || 0,
      items
    });
    $('budgetModal').classList.remove('show');
    toast('预算已保存');
  }

  // ============================================================
  //  分类管理
  // ============================================================
  function renderCatManage() {
    const cats = window.Store.listCategories();
    const box = $('catManageList');
    const usedCatNames = new Set(window.Store.listRecords().map(r => r.category));
    box.innerHTML = cats.map(c => `
      <div class="cat-manage-row">
        <span class="icon">${c.icon}</span>
        <span class="name">${c.type === 'expense' ? '支出' : '收入'} · ${c.name}</span>
        ${usedCatNames.has(c.name) ? '' : `<button class="del" data-delcat="${c.id}" data-name="${c.name}">删除</button>`}
      </div>`).join('');
    box.onclick = (e) => {
      const id = e.target.dataset.delcat;
      if (id && confirm('删除分类「' + e.target.dataset.name + '」？')) {
        window.Store.deleteCategory(id);
        toast('已删除');
      }
    };
  }

  function addCategory() {
    const name = $('newCatName').value.trim();
    if (!name) { toast('请输入分类名称'); return; }
    const type = $('newCatType').value;
    const icons = type === 'expense' ? ['🍜','🚗','🛍️','🏠','💡','🎮','💊','📱','🎁','📦'] : ['💰','💼','🏆','📈','🧧','📦'];
    const colors = ['#f97316','#3b82f6','#ec4899','#8b5cf6','#eab308','#06b6d4','#ef4444','#6366f1','#f43f5e','#64748b'];
    const existing = window.Store.listCategories();
    window.Store.upsertCategory({
      type, name,
      icon: icons[existing.length % icons.length],
      color: colors[existing.length % colors.length],
      builtin: false
    });
    $('newCatName').value = '';
    toast('已添加分类');
  }

  // ============================================================
  //  导出 CSV
  // ============================================================
  function exportCSV() {
    const list = window.Store.listRecords().slice().sort((a, b) => new Date(a.txn_at) - new Date(b.txn_at));
    if (!list.length) { toast('暂无数据可导出'); return; }
    const header = '日期时间,类型,分类,金额(元),备注';
    const rows = list.map(r => {
      const d = new Date(r.txn_at);
      const dt = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
        + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
      const type = r.type === 'expense' ? '支出' : '收入';
      const note = (r.note || '').replace(/[,\n]/g, ' ');
      return `${dt},${type},${r.category},${r.amount.toFixed(2)},${note}`;
    });
    const csv = '﻿' + header + '\n' + rows.join('\n');  // 前面的 ﻿ 即 UTF-8 BOM
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '记账_' + todayStr() + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出 CSV');
  }

  // ============================================================
  //  登录
  // ============================================================
  function setAuthMode(mode) {
    state.authMode = mode;
    $('authTitle').textContent = mode === 'login' ? '登录以开启云端同步' : '注册新账号';
    $('btnAuthSubmit').textContent = mode === 'login' ? '登录' : '注册';
    $('authErr').textContent = '';
  }

  async function doAuth() {
    const email = $('authEmail').value.trim();
    const pw = $('authPw').value;
    if (!email || !pw) { $('authErr').textContent = '请输入邮箱和密码'; return; }
    try {
      if (state.authMode === 'login') {
        await window.Store.signIn(email, pw);
        toast('登录成功，已同步云端');
      } else {
        await window.Store.signUp(email, pw);
        toast('注册成功！若邮箱需验证，请先去邮箱点确认链接，再回来登录');
        setAuthMode('login');
      }
      $('authModal').classList.remove('show');
    } catch (e) {
      $('authErr').textContent = e.message || '操作失败';
    }
  }

  function renderAuthStatus() {
    const s = window.Store.state;
    const dot = $('statusDot'), txt = $('statusText'), btn = $('btnAuth');
    if (s.mode === 'cloud' && s.user) {
      dot.className = 'dot online';
      txt.textContent = '已云端同步 · ' + (s.user.email || '');
      btn.textContent = '退出登录';
      btn.onclick = () => { if (confirm('退出登录？本地数据仍保留在本设备')) window.Store.signOut(); };
    } else {
      dot.className = 'dot local';
      txt.textContent = s.supported ? '本地模式（未登录）' : '本地模式（未配置云端）';
      btn.textContent = '登录同步';
      btn.onclick = () => $('authModal').classList.add('show');
    }
  }

  // ============================================================
  //  总渲染
  // ============================================================
  function renderAll() {
    renderAuthStatus();
    renderCatChips();
    renderTxnList();
    renderStats();
    renderCatManage();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
