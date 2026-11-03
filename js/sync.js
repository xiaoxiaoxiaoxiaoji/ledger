/* ============================================================
 *  sync.js —— 数据层：本地 localStorage 优先 + Supabase 云端同步
 *  - 未配置 Supabase / SDK 加载失败 / 断网：纯本地模式，应用照常可用
 *  - 配置好并登录：登录即拉取云端、合并冲突（updated_at 较新者胜），
 *    之后每次增删改实时写云端
 * ============================================================ */
(function () {
  const cfg = window.APP_CONFIG || {};
  const LS = {
    records: 'ledger_records',
    categories: 'ledger_categories',
    budgets: 'ledger_budgets',
    session: 'ledger_session_hint'
  };

  // ---------- 预设分类 ----------
  const DEFAULT_CATEGORIES = [
    { type: 'expense', name: '餐饮',   icon: '🍜', color: '#f97316' },
    { type: 'expense', name: '交通',   icon: '🚌', color: '#3b82f6' },
    { type: 'expense', name: '购物',   icon: '🛍️', color: '#ec4899' },
    { type: 'expense', name: '住房',   icon: '🏠', color: '#8b5cf6' },
    { type: 'expense', name: '水电煤', icon: '💡', color: '#eab308' },
    { type: 'expense', name: '娱乐',   icon: '🎮', color: '#06b6d4' },
    { type: 'expense', name: '医疗',   icon: '💊', color: '#ef4444' },
    { type: 'expense', name: '通讯',   icon: '📱', color: '#6366f1' },
    { type: 'expense', name: '人情',   icon: '🎁', color: '#f43f5e' },
    { type: 'expense', name: '其他',   icon: '📦', color: '#64748b' },
    { type: 'income',  name: '工资',   icon: '💰', color: '#16a34a' },
    { type: 'income',  name: '兼职',   icon: '💼', color: '#0d9488' },
    { type: 'income',  name: '奖金',   icon: '🏆', color: '#ca8a04' },
    { type: 'income',  name: '理财',   icon: '📈', color: '#2563eb' },
    { type: 'income',  name: '红包',   icon: '🧧', color: '#dc2626' },
    { type: 'income',  name: '其他',   icon: '📦', color: '#64748b' }
  ];

  // ---------- 本地读写工具 ----------
  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }
  function nowISO() { return new Date().toISOString(); }

  // 首次启动写入预设分类
  function ensureDefaults() {
    let cats = lsGet(LS.categories, null);
    if (!cats) {
      cats = DEFAULT_CATEGORIES.map(c => ({
        id: uuid(), type: c.type, name: c.name, icon: c.icon, color: c.color,
        builtin: true, updated_at: nowISO()
      }));
      lsSet(LS.categories, cats);
    }
    if (!lsGet(LS.records, null)) lsSet(LS.records, []);
    if (!lsGet(LS.budgets, null)) lsSet(LS.budgets, []);
  }

  // ---------- 事件 ----------
  const listeners = { change: [] };
  function emit(evt, data) { (listeners[evt] || []).forEach(fn => { try { fn(data); } catch (e) {} }); }

  const state = {
    sb: null,           // Supabase client
    ready: false,
    mode: 'local',      // local | cloud
    user: null,
    supported: !!(cfg.supabaseUrl && cfg.supabaseKey)
  };

  // ---------- 动态加载 Supabase SDK ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('script load fail'));
      document.head.appendChild(s);
    });
  }

  async function initSupabase() {
    if (!state.supported) return false;
    try {
      if (!window.supabase) await loadScript(cfg.supabaseSdkUrl);
      if (!window.supabase || !window.supabase.createClient) return false;
      state.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
      const { data } = await state.sb.auth.getSession();
      if (data && data.session && data.session.user) {
        state.user = data.session.user;
        state.mode = 'cloud';
        await syncNow();
      }
      // 监听登录状态变化
      state.sb.auth.onAuthStateChange((_event, session) => {
        if (session && session.user) {
          state.user = session.user; state.mode = 'cloud';
          syncNow();
        } else {
          state.user = null; state.mode = 'local';
        }
        emit('change');
      });
      return true;
    } catch (e) {
      console.warn('[ledger] Supabase 初始化失败，使用本地模式：', e);
      state.sb = null; state.mode = 'local';
      return false;
    }
  }

  // ============================================================
  //  通用：把一行云端数据映射成本地格式
  // ============================================================
  function mapRemote(table, row) {
    if (table === 'records') return {
      id: row.id, type: row.type, category: row.category, amount: Number(row.amount),
      note: row.note || '', txn_at: row.txn_at, updated_at: row.updated_at
    };
    if (table === 'categories') return {
      id: row.id, type: row.type, name: row.name, icon: row.icon,
      color: row.color, builtin: !!row.builtin, updated_at: row.updated_at
    };
    if (table === 'budgets') return {
      id: row.id, month: row.month, total: Number(row.total),
      items: row.items || {}, updated_at: row.updated_at
    };
  }

  // ============================================================
  //  同步：拉取云端全量，按 updated_at 合并；本地较新的上传
  // ============================================================
  async function syncNow() {
    if (!state.sb || !state.user) return;
    const tables = ['records', 'categories', 'budgets'];
    for (const t of tables) {
      try {
        const { data: remote, error } = await state.sb.from(t).select('*');
        if (error) continue;
        const local = lsGet(LS[t], []);
        const remoteMap = {};
        (remote || []).forEach(r => remoteMap[r.id] = mapRemote(t, r));

        const merged = [];
        const toUpload = [];

        // 先处理本地每一条
        local.forEach(l => {
          const r = remoteMap[l.id];
          if (!r) {
            merged.push(l); toUpload.push(l);           // 本地新增 → 上传
          } else if (new Date(l.updated_at) > new Date(r.updated_at)) {
            merged.push(l); toUpload.push(l);           // 本地较新 → 上传覆盖
          } else {
            merged.push(r); delete remoteMap[r.id];     // 云端较新 → 用云端
          }
        });
        // 剩下的 remoteMap 是云端有而本地没有的 → 合并进来
        Object.values(remoteMap).forEach(r => merged.push(r));

        lsSet(LS[t], merged);

        // 批量上传本地较新的
        if (toUpload.length) {
          await state.sb.from(t).upsert(toUpload.map(rowToRemote(t)));
        }
      } catch (e) {
        console.warn('[ledger] 同步表 ' + t + ' 失败：', e);
      }
    }
    emit('change');
  }

  function rowToRemote(table) {
    return function (r) {
      const base = { id: r.id, user_id: state.user.id, updated_at: r.updated_at };
      if (table === 'records') return { ...base, type: r.type, category: r.category, amount: r.amount, note: r.note, txn_at: r.txn_at };
      if (table === 'categories') return { ...base, type: r.type, name: r.name, icon: r.icon, color: r.color, builtin: !!r.builtin };
      if (table === 'budgets') return { ...base, month: r.month, total: r.total, items: r.items || {} };
    };
  }

  // 单条写云端（失败不阻塞，留在本地等下次 sync）
  async function pushOne(table, row, isDelete) {
    if (!state.sb || !state.user) return;
    try {
      if (isDelete) {
        await state.sb.from(table).delete().eq('id', row.id);
      } else {
        await state.sb.from(table).upsert(rowToRemote(table)(row));
      }
    } catch (e) { console.warn('[ledger] 写云端失败，稍后重试：', e); }
  }

  // ============================================================
  //  对外 API
  // ============================================================
  const Store = {
    state,

    async init() {
      ensureDefaults();
      await initSupabase();
      state.ready = true;
      emit('change');
    },

    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },

    // ---- records ----
    listRecords() { return lsGet(LS.records, []).slice(); },
    upsertRecord(r) {
      const list = lsGet(LS.records, []);
      r.id = r.id || uuid();
      r.updated_at = nowISO();
      const idx = list.findIndex(x => x.id === r.id);
      if (idx >= 0) list[idx] = r; else list.push(r);
      lsSet(LS.records, list);
      pushOne('records', r, false);
      emit('change');
      return r;
    },
    deleteRecord(id) {
      const list = lsGet(LS.records, []).filter(x => x.id !== id);
      lsSet(LS.records, list);
      pushOne('records', { id }, true);
      emit('change');
    },

    // ---- categories ----
    listCategories() { return lsGet(LS.categories, []).slice(); },
    upsertCategory(c) {
      const list = lsGet(LS.categories, []);
      c.id = c.id || uuid();
      c.updated_at = nowISO();
      c.builtin = !!c.builtin;
      const idx = list.findIndex(x => x.id === c.id);
      if (idx >= 0) list[idx] = c; else list.push(c);
      lsSet(LS.categories, list);
      pushOne('categories', c, false);
      emit('change');
      return c;
    },
    deleteCategory(id) {
      lsSet(LS.categories, lsGet(LS.categories, []).filter(x => x.id !== id));
      pushOne('categories', { id }, true);
      emit('change');
    },

    // ---- budgets ----
    listBudgets() { return lsGet(LS.budgets, []).slice(); },
    getBudget(month) {
      return lsGet(LS.budgets, []).find(b => b.month === month) || null;
    },
    upsertBudget(b) {
      const list = lsGet(LS.budgets, []);
      b.id = b.id || uuid();
      b.updated_at = nowISO();
      b.items = b.items || {};
      const idx = list.findIndex(x => x.month === b.month);
      if (idx >= 0) list[idx] = b; else list.push(b);
      lsSet(LS.budgets, list);
      pushOne('budgets', b, false);
      emit('change');
      return b;
    },

    // ---- auth ----
    async signIn(email, pw) {
      if (!state.sb) throw new Error('尚未配置云端同步，请先在 js/config.js 填入 Supabase 信息（见 README）');
      const { data, error } = await state.sb.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;
      state.user = data.user; state.mode = 'cloud';
      await syncNow();
      emit('change');
      return data.user;
    },
    async signUp(email, pw) {
      if (!state.sb) throw new Error('尚未配置云端同步，请先在 js/config.js 填入 Supabase 信息（见 README）');
      const { data, error } = await state.sb.auth.signUp({ email, password: pw });
      if (error) throw error;
      return data.user;
    },
    async signOut() {
      if (state.sb) { try { await state.sb.auth.signOut(); } catch (e) {} }
      state.user = null; state.mode = 'local';
      emit('change');
    },

    syncNow
  };

  window.Store = Store;
})();
