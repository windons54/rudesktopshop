'use client';
import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import Head from 'next/head';
// XLSX loaded lazily — only when import/export is used
let _xlsxModule = null;
async function getXLSX() {
  if (!_xlsxModule) _xlsxModule = await import('xlsx');
  return _xlsxModule;
}
const XLSX = { utils: null, writeFile: null, read: null };
if (typeof window !== 'undefined') {
  import('xlsx').then(m => { Object.assign(XLSX, m); _xlsxModule = m; });
}

// ─── DEFAULT PRODUCTS (fallback if no custom products in DB) ──────────────────
const PRODUCTS = [
  { id: 1,  name: "Худи «Apex»",         price: 850,  category: "Одежда",      emoji: "🧥", desc: "Флисовая толстовка с вышитым логотипом, оверсайз-крой, 320 г/м²" },
  { id: 2,  name: "Футболка «Origin»",   price: 320,  category: "Одежда",      emoji: "👕", desc: "100% органический хлопок, шелкографическая печать, унисекс" },
  { id: 3,  name: "Бейсболка «Grid»",    price: 280,  category: "Аксессуары",  emoji: "🧢", desc: "Регулируемый ремешок, вышивка спереди и сзади, 6 панелей" },
  { id: 4,  name: "Рюкзак «Carry»",      price: 1200, category: "Аксессуары",  emoji: "🎒", desc: "30 л, водоотталкивающая ткань, USB-порт внутри, ноут-отсек" },
  { id: 5,  name: "Термокружка «Mug X»", price: 490,  category: "Посуда",      emoji: "☕", desc: "Двойные стенки из нержавеющей стали, 480 мл, клапан-поворот" },
  { id: 6,  name: "Носки «Step»",        price: 150,  category: "Одежда",      emoji: "🧦", desc: "Набор 3 пары, хлопок-бамбук, арт-принт по всей длине" },
  { id: 7,  name: "Стикерпак «Pack-01»", price: 90,   category: "Канцелярия",  emoji: "🎨", desc: "20 виниловых стикеров с матовым покрытием, УФ-стойкость" },
  { id: 8,  name: "Скетчбук «Draft»",    price: 220,  category: "Канцелярия",  emoji: "📓", desc: "A5, 120 г/м², перфорация, тиснёная обложка с логотипом" },
  { id: 9,  name: "Пин-сет «Metal»",     price: 180,  category: "Аксессуары",  emoji: "📌", desc: "5 мягких эмалевых значков в фирменной коробке" },
  { id: 10, name: "Зонт «Shade»",        price: 640,  category: "Аксессуары",  emoji: "☂️", desc: "Автоматический, ветрозащитный, диаметр 105 см, тефлон" },
];

let _globalCurrency = { name: "RuDeCoin", icon: "🪙", logo: "" };
function getCurrName(currency) {
  const c = currency || _globalCurrency;
  return (c && c.name) ? c.name : "RuDeCoin";
}

// Returns true if product has an active (non-expired) discount
function isDiscountActive(product) {
  if (!product || !product.discount || product.discount <= 0) return false;
  if (!product.discountUntil) return true; // бессрочная скидка
  return Date.now() < new Date(product.discountUntil).getTime();
}
// Returns effective price considering timed discount
function getEffectivePrice(product) {
  if (isDiscountActive(product)) return Math.round(product.price * (1 - product.discount / 100));
  return product.price;
}
function CurrencyIcon({ currency, size = 16 }) {
  const c = currency || _globalCurrency;
  if (c && c.logo) return <img src={c.logo} alt="" style={{width:size+"px",height:size+"px",objectFit:"contain",verticalAlign:"middle"}} />;
  return <span style={{verticalAlign:"middle"}}>{(c && c.icon) ? c.icon : "🪙"}</span>;
}

// ─── Умное сжатие изображений ────────────────────────────────────────────────
// maxW/maxH: максимальные размеры (пиксели). Изображения меньше — не увеличиваются.
// quality: базовое качество JPEG (0–1). Автоматически снижается если файл всё ещё большой.
// targetKB: целевой размер в КБ (мягкий лимит, используется для авто-снижения качества).
const compressImage = (dataUrl, maxW = 1200, maxH = 1200, quality = 0.85, targetKB = 300) => {
  return new Promise((resolve) => {
    const isTransparent = dataUrl.startsWith('data:image/png') || dataUrl.startsWith('data:image/gif');
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxW || height > maxH) {
        const ratio = Math.min(maxW / width, maxH / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!isTransparent) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(img, 0, 0, width, height);
      const format = isTransparent ? 'image/png' : 'image/jpeg';
      let result = canvas.toDataURL(format, quality);
      if (format === 'image/jpeg') {
        const sizeKB = Math.round((result.length * 3) / 4 / 1024);
        if (sizeKB > targetKB) {
          const reducedQuality = Math.max(0.5, quality * (targetKB / sizeKB));
          result = canvas.toDataURL(format, reducedQuality);
        }
      }
      resolve(result);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

// ── Утилита debounce ──────────────────────────────────────────────────────
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ── Дедупликация запросов — один и тот же запрос не летит параллельно ──────
const _inflightRequests = new Map();
function deduplicatedFetch(action, body = {}) {
  const cacheKey = action + (body.key || '');
  if (_inflightRequests.has(cacheKey)) return _inflightRequests.get(cacheKey);
  const promise = _apiCall(action, body).finally(() => _inflightRequests.delete(cacheKey));
  _inflightRequests.set(cacheKey, promise);
  return promise;
}

// ══════════════════════════════════════════════════════════════
// Серверное хранилище — данные общие для всех браузеров
// pgConfig хранится ТОЛЬКО на сервере (env или файл)
// Клиент никогда не передаёт pgConfig в запросах
// ══════════════════════════════════════════════════════════════

async function _apiCall(action, body = {}) {
  const res = await fetch('/api/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
    keepalive: action === 'version',
  });
  return res.json();
}

// Кэш — синхронный слой, обновляется polling-ом
const _cache = {};
let _cacheReady = false;
let _readyCallbacks = [];
let _cacheVersion = 0; // версия данных в кэше — не перезаписываем старыми данными

function _applyData(data, version) {
  // Если версия меньше текущей — данные устарели, не перезаписываем
  if (version && version < _cacheVersion) return;
  if (version) _cacheVersion = version;
  Object.keys(data).forEach(k => {
    if (!_pendingWrites.has(k)) _cache[k] = data[k];
  });
}

function _notifyReady() {
  _cacheReady = true;
  _readyCallbacks.forEach(fn => fn());
  _readyCallbacks = [];
}

let _initVersion = null;

async function initStore() {
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000));
    const r = await Promise.race([_apiCall('getAll'), timeout]);
    if (r.ok && r.data) {
      _applyData(r.data, r.version || null);
      _initVersion = r.version || null;
    }
  } catch(e) { console.warn('Store init error', e); }
  _notifyReady();
}

function whenStoreReady() {
  if (_cacheReady) return Promise.resolve();
  return new Promise(res => _readyCallbacks.push(res));
}

// Ключи, которые хранятся только локально (личные данные браузера)
const _LOCAL_KEYS = new Set(['cm_session','cm_seen_orders','cm_notif_history','cm_notif_unread','cm_favorites']);

const _lsGet = (k) => { try { const v = localStorage.getItem('_store_'+k); return v !== null ? JSON.parse(v) : null; } catch { return null; } };
const _lsSet = (k, v) => { try { localStorage.setItem('_store_'+k, JSON.stringify(v)); } catch {} };
const _lsDel = (k) => { try { localStorage.removeItem('_store_'+k); } catch {} };

// Ключи которые сейчас записываются на сервер — polling не должен их перетирать
const _pendingWrites = new Set();
const _writePromises = [];

// ── Write batching: группирует быстрые последовательные set() в один setMany запрос ──
const _writeBatch = {};
let _batchTimer = null;
const BATCH_DELAY = 80; // мс задержки для группировки

function _flushBatch() {
  _batchTimer = null;
  const batch = { ..._writeBatch };
  const keys = Object.keys(batch);
  if (keys.length === 0) return;
  keys.forEach(k => delete _writeBatch[k]);

  const doFlush = (attempt) => {
    const action = keys.length === 1 ? 'set' : 'setMany';
    const body = keys.length === 1 ? { key: keys[0], value: batch[keys[0]] } : { data: batch };
    return _apiCall(action, body)
      .then((r) => {
        keys.forEach(k => _pendingWrites.delete(k));
        if (r && !r.ok && attempt < 3) {
          return new Promise(res => setTimeout(res, 500 * (attempt + 1))).then(() => doFlush(attempt + 1));
        }
      })
      .catch(e => {
        if (attempt < 3) {
          return new Promise(res => setTimeout(res, 1000 * (attempt + 1))).then(() => doFlush(attempt + 1));
        }
        keys.forEach(k => _pendingWrites.delete(k));
        console.error('[Storage] batch write error (final)', e.message);
      });
  };
  const p = doFlush(0);
  _writePromises.push(p);
  p.finally(() => { const idx = _writePromises.indexOf(p); if (idx !== -1) _writePromises.splice(idx, 1); });
}

const storage = {
  get: (k) => {
    if (_LOCAL_KEYS.has(k)) return _lsGet(k);
    return _cache.hasOwnProperty(k) ? _cache[k] : null;
  },
  set: (k, v) => {
    if (_LOCAL_KEYS.has(k)) { _lsSet(k, v); return; }
    _cache[k] = v; // обновляем кэш немедленно
    _pendingWrites.add(k);
    _writeBatch[k] = v;
    if (_batchTimer) clearTimeout(_batchTimer);
    _batchTimer = setTimeout(_flushBatch, BATCH_DELAY);
  },
  delete: (k) => {
    if (_LOCAL_KEYS.has(k)) { _lsDel(k); return; }
    delete _cache[k];
    _apiCall('delete', { key: k }).catch(e => console.warn('Store delete error', e));
  },
  all: () => ({ ..._cache }),
  exportDB: () => null,
  importDB: async () => {},
  exec: () => [],
  run: () => {},
  isReady: () => _cacheReady,
  flush: () => Promise.all([..._writePromises]),
  // Обновить кэш с сервера (вызывается polling-ом)
  refresh: async () => {
    try {
      const r = await deduplicatedFetch('getAll');
      if (r.ok && r.data) _applyData(r.data);
    } catch(e) { console.warn('Store refresh error', e); }
  },
};

// SQLite — только для экспорта/импорта в настройках
let _sqliteDB = null;
let _sqlReady = false;
let _sqlReadyCallbacks = [];
const DB_NAME = 'merch_store_sqlite';
const DB_STORE = 'sqlitedb';
const DB_KEY = 'main';
function openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = e => res(e.target.result);
    req.onerror = () => rej(req.error);
  });
}
async function saveDbToIDB() {
  if (!_sqliteDB) return;
  try {
    const data = _sqliteDB.export();
    const idb = await openIDB();
    await new Promise((res, rej) => {
      const tx = idb.transaction(DB_STORE, 'readwrite');
      const req = tx.objectStore(DB_STORE).put(data, DB_KEY);
      req.onsuccess = res; req.onerror = () => rej(req.error);
    });
  } catch(e) { console.error('SQLite save error', e); }
}
async function initSQLite() {
  if (_sqlReady) return _sqliteDB;
  try {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
    const idb = await openIDB();
    const existing = await new Promise(res => {
      const tx = idb.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
    _sqliteDB = existing ? new SQL.Database(existing) : new SQL.Database();
    _sqliteDB.run('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  } catch(e) { console.warn('SQLite init failed:', e); }
  _sqlReady = true;
  _sqlReadyCallbacks.forEach(cb => cb());
  _sqlReadyCallbacks = [];
  return _sqliteDB;
}
function whenSQLReady() {
  if (_sqlReady) return Promise.resolve();
  return new Promise(res => _sqlReadyCallbacks.push(res));
}

// ── HISTORY ────────────────────────────────────────────────────────────────

function HistoryPage({ currentUser, transfers, orders, taskSubmissions, currency }) {
  const hCurrName = getCurrName(currency);
  const [filter, setFilter] = useState("all");

  const transferEvents = transfers
    .filter(t => t.from === currentUser || t.to === currentUser)
    .map(t => ({
      id: "t_" + t.id,
      type: t.from === currentUser ? "transfer_out" : "transfer_in",
      date: t.date || t.id,
      amount: t.amount,
      label: t.from === currentUser ? "Перевод → " + t.to : "Получено от " + t.from,
      comment: t.comment || "",
      ts: t.id,
    }));

  const orderEvents = orders
    .filter(o => o.user === currentUser)
    .map(o => ({
      id: "o_" + o.id,
      type: "order",
      date: o.date,
      amount: o.total,
      label: "Заказ #" + String(o.id).slice(-5),
      comment: (o.items || []).map(i => i.name).join(", "),
      status: o.status,
      ts: o.id,
    }));

  const all = [...transferEvents, ...orderEvents].sort((a, b) => b.ts - a.ts);
  const filtered = filter === "all" ? all : all.filter(e => {
    if (filter === "transfers") return e.type.startsWith("transfer");
    if (filter === "orders") return e.type === "order";
    return true;
  });

  const iconMap = {
    transfer_out: { icon: "↑", bg: "#fee2e2", color: "#c71618" },
    transfer_in:  { icon: "↓", bg: "#d1fae5", color: "#059669" },
    order:        { icon: "🛍", bg: "#eff6ff", color: "#2563eb" },
  };

  const amountColor = { transfer_out: "var(--rd-red)", transfer_in: "var(--rd-green)", order: "var(--rd-dark)" };
  const amountPrefix = { transfer_out: "−", transfer_in: "+", order: "−" };

  return (
    <div className="page-inner page-fade">
      <div className="page-eyebrow">Кошелёк</div>
      <h2 className="page-title">История операций</h2>

      <div style={{display:"flex",gap:"8px",marginBottom:"24px",flexWrap:"wrap"}}>
        {[["all","Все"],["transfers","Переводы"],["orders","Заказы"]].map(([v,l]) => (
          <button key={v}
            onClick={() => setFilter(v)}
            style={{padding:"8px 18px",borderRadius:"20px",border:"1.5px solid",fontSize:"13px",fontWeight:700,cursor:"pointer",transition:"all 0.15s",
              background: filter===v ? "var(--rd-red)" : "#fff",
              color: filter===v ? "#fff" : "var(--rd-gray-text)",
              borderColor: filter===v ? "var(--rd-red)" : "var(--rd-gray-border)"}}>
            {l}
          </button>
        ))}
      </div>

      {filtered.length === 0
        ? <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <div className="empty-state-text">Операций пока нет</div>
          </div>
        : <div style={{background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius)",overflow:"hidden",boxShadow:"var(--rd-shadow)"}}>
            {filtered.map((ev, i) => {
              const ic = iconMap[ev.type];
              return (
                <div key={ev.id} style={{display:"flex",alignItems:"center",gap:"16px",padding:"18px 24px",borderBottom: i < filtered.length-1 ? "1px solid var(--rd-gray-border)" : "none"}}>
                  <div style={{width:"40px",height:"40px",borderRadius:"50%",background:ic.bg,color:ic.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"17px",fontWeight:800,flexShrink:0}}>
                    {ic.icon}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)",marginBottom:"2px"}}>{ev.label}</div>
                    {ev.comment && <div style={{fontSize:"12px",color:"var(--rd-gray-text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"400px"}}>{ev.comment}</div>}
                    {ev.status && <div style={{fontSize:"11px",fontWeight:700,color:"var(--rd-gray-text)",marginTop:"2px"}}>{ev.status}</div>}
                    <div style={{fontSize:"11px",color:"#9ca3af",marginTop:"2px"}}>{ev.date}</div>
                  </div>
                  <div style={{fontWeight:800,fontSize:"20px",color:amountColor[ev.type],flexShrink:0}}>
                    {amountPrefix[ev.type]}{ev.amount} <span style={{fontSize:"12px",fontWeight:600,color:"var(--rd-gray-text)"}}>{hCurrName}</span>
                  </div>
                </div>
              );
            })}
          </div>
      }

      {taskSubmissions && taskSubmissions.filter(s => s.user === currentUser).length > 0 && (() => {
        const myTasks = taskSubmissions.filter(s => s.user === currentUser).slice().reverse();
        const statusCfg = {
          pending:  { label:"На проверке", icon:"⏳", bg:"#fffbeb", color:"#d97706" },
          approved: { label:"Выполнено",   icon:"✅", bg:"var(--rd-green-light)", color:"var(--rd-green)" },
          rejected: { label:"Не выполнено", icon:"❌", bg:"#fee2e2", color:"var(--rd-red)" },
        };
        return (
          <div style={{marginTop:"40px"}}>
            <h3 style={{fontSize:"20px",fontWeight:800,color:"var(--rd-dark)",marginBottom:"16px"}}>🎯 История заданий</h3>
            <div style={{background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius)",overflow:"hidden",boxShadow:"var(--rd-shadow)"}}>
              {myTasks.map((s, i) => {
                const sc = statusCfg[s.status] || { label:s.status, icon:"❓", bg:"#f3f4f6", color:"#6b7280" };
                return (
                  <div key={s.id} style={{display:"flex",alignItems:"flex-start",gap:"16px",padding:"18px 24px",borderBottom: i < myTasks.length-1 ? "1px solid var(--rd-gray-border)" : "none"}}>
                    <div style={{fontSize:"22px",flexShrink:0,marginTop:"2px"}}>{sc.icon}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)",marginBottom:"3px"}}>{s.taskTitle}</div>
                      <div style={{fontSize:"12px",color:"#9ca3af",marginBottom:"6px"}}>{s.date}</div>
                      {s.comment && <div style={{fontSize:"13px",background:"var(--rd-gray-bg)",border:"1px solid var(--rd-gray-border)",borderRadius:"8px",padding:"10px 14px",color:"var(--rd-dark)",lineHeight:1.5,marginTop:"4px"}}>💬 Комментарий: {s.comment}</div>}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:"6px",flexShrink:0}}>
                      <div style={{background:sc.bg,color:sc.color,borderRadius:"8px",padding:"4px 10px",fontSize:"12px",fontWeight:700}}>{sc.label}</div>
                      {s.status === "approved" && <div style={{fontSize:"14px",fontWeight:800,color:"var(--rd-green)"}}>+{s.reward} {hCurrName}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const THEMES = {
  default:  { label: "Корпоративный", primary: "#c71618", hover: "#a51214", light: "rgba(199,22,24,0.06)", dark: "#1a1a1a", bg: "#f7f8fa" },
  ocean:    { label: "Океан",          primary: "#0ea5e9", hover: "#0284c7", light: "rgba(14,165,233,0.07)", dark: "#0f172a", bg: "#f0f9ff" },
  forest:   { label: "Лес",            primary: "#059669", hover: "#047857", light: "rgba(5,150,105,0.07)", dark: "#064e3b", bg: "#f0fdf4" },
  violet:   { label: "Виолет",         primary: "#7c3aed", hover: "#6d28d9", light: "rgba(124,58,237,0.07)", dark: "#1e1b4b", bg: "#f5f3ff" },
  midnight: { label: "Полночь",        primary: "#f59e0b", hover: "#d97706", light: "rgba(245,158,11,0.07)", dark: "#18181b", bg: "#1c1917" },
  rose:     { label: "Роза",           primary: "#e11d48", hover: "#be123c", light: "rgba(225,29,72,0.07)", dark: "#1f1235", bg: "#fff1f2" },
};

function applyTheme(themeKey, customColors = {}) {
  const t = THEMES[themeKey] || THEMES.default;
  const r = document.documentElement.style;
  r.setProperty("--rd-red", customColors.accentColor || t.primary);
  r.setProperty("--rd-red-hover", t.hover);
  r.setProperty("--rd-red-light", t.light);
  r.setProperty("--rd-dark", t.dark);
  r.setProperty("--rd-gray-bg", customColors.pageBg || t.bg);
  if (customColors.shopTextColor) { r.setProperty("--rd-shop-text", customColors.shopTextColor); } else { r.removeProperty("--rd-shop-text"); }
}

function App() {
  const [users, setUsers] = useState({});
  const [customProducts, setCustomProducts] = useState(null);
  const [customCategories, setCustomCategories] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [faq, setFaq] = useState([]);
  const [videos, setVideos] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [auctions, setAuctions] = useState([]);
  const [lotteries, setLotteries] = useState([]);
  const [polls, setPolls] = useState([]);
  const [deposits, setDeposits] = useState([]); // Типы вкладов (создаются админом)
  const [userDeposits, setUserDeposits] = useState([]); // Депозиты пользователей
  const [taskSubmissions, setTaskSubmissions] = useState([]);
  const [dbConfig, setDbConfig] = useState({ connected: false, dbSize: 0, rowCounts: {} });
  // pgConfig живёт на сервере, здесь только для отображения статуса в UI
  const [pgConfig, setPgConfig] = useState(null);
  const [isPgActive, setIsPgActive] = useState(false);
  const savePgConfigState = (cfg) => { setPgConfig(cfg); setIsPgActive(!!(cfg?.host)); };
  const [sqliteDisabled, setSqliteDisabledState] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('__sqlite_disabled__') === '1';
  });
  const setSqliteDisabled = (val) => {
    setSqliteDisabledState(val);
    if (typeof window !== 'undefined') {
      if (val) localStorage.setItem('__sqlite_disabled__', '1');
      else localStorage.removeItem('__sqlite_disabled__');
    }
  };
  const [favorites, setFavorites] = useState([]);
  const saveFavorites = (favs) => { setFavorites(favs); storage.set('cm_favorites', JSON.stringify(favs)); };
  const toggleFavorite = (productId) => { const favs = favorites.includes(productId) ? favorites.filter(id => id !== productId) : [...favorites, productId]; saveFavorites(favs); };
  // Хелперы для валюты — используются по всему сайту
  const currName = () => (appearance.currency && appearance.currency.name) ? appearance.currency.name : "RuDeCoin";
  const currIcon = () => {
    if (appearance.currency && appearance.currency.logo) return <img src={appearance.currency.logo} alt="" style={{width:"16px",height:"16px",objectFit:"contain",verticalAlign:"middle",marginRight:"2px"}} />;
    return (appearance.currency && appearance.currency.icon) ? appearance.currency.icon : "🪙";
  };
  const CurrIcon = () => {
    if (appearance.currency && appearance.currency.logo) return <img src={appearance.currency.logo} alt="" style={{width:"16px",height:"16px",objectFit:"contain",verticalAlign:"middle"}} />;
    return <span>{(appearance.currency && appearance.currency.icon) ? appearance.currency.icon : "🪙"}</span>;
  };
  const [appearance, setAppearance] = useState({ logo: null, theme: "default", headerBg: "", footerBg: "", pageBg: "", accentColor: "", shopTextColor: "", socials: { telegram: "", max: "", vk: "", rutube: "", vkvideo: "" }, birthdayBonus: 100, birthdayEnabled: true, integrations: { tgEnabled: false, tgBotToken: "", tgChatId: "", maxEnabled: false, maxBotToken: "", maxChatId: "" }, currency: { name: "RuDeCoin", icon: "🪙", logo: "" }, seo: { title: "", description: "", favicon: "" }, registrationEnabled: true, bitrix24: { enabled: false, clientId: "", clientSecret: "", portalUrl: "" }, features: { auction: true, lottery: true, voting: true, bank: true, tasks: true }, sectionSettings: { auction: { title: "Аукцион", description: "Делайте ставки и выигрывайте эксклюзивные товары", banner: "" }, lottery: { title: "Лотерея", description: "Участвуйте в розыгрышах и выигрывайте призы", banner: "" }, voting: { title: "Голосования", description: "Участвуйте в опросах и влияйте на решения", banner: "" }, bank: { title: "Банк", description: "Управляйте своими депозитами и получайте проценты", banner: "" }, tasks: { title: "Задания за монеты", description: "Выполняйте задания и получайте корпоративные монеты", banner: "" } } });
  const [currentUser, setCurrentUser] = useState(null);
  const [cart, setCart] = useState([]);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [page, setPage] = useState("shop");
  const [filterCat, setFilterCat] = useState("Все");
  const [orders, setOrders] = useState([]);
  const [seenOrdersCount, setSeenOrdersCount] = useState(() => { try { const v = typeof localStorage!=='undefined' ? localStorage.getItem('_store_cm_seen_orders') : null; return v ? parseInt(JSON.parse(v)) : 0; } catch { return 0; } });
  const markOrdersSeen = () => { setSeenOrdersCount(orders.length); storage.set('cm_seen_orders', String(orders.length)); };
  const [notifHistory, setNotifHistory] = useState(() => { try { const v = typeof localStorage!=='undefined' ? localStorage.getItem('_store_cm_notif_history') : null; return v ? JSON.parse(v) : []; } catch { return []; } });
  const [bellOpen, setBellOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifUnread, setNotifUnread] = useState(() => { try { const v = typeof localStorage!=='undefined' ? localStorage.getItem('_store_cm_notif_unread') : null; return v ? parseInt(JSON.parse(v)) : 0; } catch { return 0; } });
  const pushNotif = (msg, type = "ok") => {
    const entry = { id: Date.now(), msg, type, time: new Date().toLocaleString("ru-RU") };
    setNotifHistory(prev => {
      const updated = [entry, ...prev].slice(0, 50);
      storage.set('cm_notif_history', updated);
      return updated;
    });
    setNotifUnread(prev => { const n = prev + 1; storage.set('cm_notif_unread', String(n)); return n; });
  };
  const markNotifRead = () => { setNotifUnread(0); storage.set('cm_notif_unread', '0'); };
  const clearNotifHistory = () => { setNotifHistory([]); storage.set('cm_notif_history', []); setNotifUnread(0); storage.set('cm_notif_unread', '0'); };
  const [toast, setToast] = useState(null);

  const [sqliteInitError, setSqliteInitError] = useState(null);

  useEffect(() => {
    // Загружаем pgConfig с сервера для отображения статуса в UI
    fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pg_get' }) })
      .then(r => r.json())
      .then(r => { if (r.ok && r.config) savePgConfigState(r.config); })
      .catch(() => {});

    // Загружаем данные с сервера в фоне — страница рендерится сразу
    initStore().then(() => {
      const u  = storage.get("cm_users");
      const o  = storage.get("cm_orders");
      const cp = storage.get("cm_products");
      const tr = storage.get("cm_transfers");
      const cc = storage.get("cm_categories");
      const fq = storage.get("cm_faq");
      const vd = storage.get("cm_videos");
      const tk = storage.get("cm_tasks");
      const ts = storage.get("cm_task_submissions");
      const au = storage.get("cm_auctions");
      const lt = storage.get("cm_lotteries");
      const pl = storage.get("cm_polls");
      const dp = storage.get("cm_deposits");
      const ud = storage.get("cm_user_deposits");
      const ap = storage.get("cm_appearance");

      if (o)  setOrders(o);
      if (cp) setCustomProducts(cp);
      if (tr) setTransfers(tr);
      if (cc) setCustomCategories(cc);
      if (tk) setTasks(tk);
      if (ts) setTaskSubmissions(ts);
      if (au) setAuctions(au);
      if (lt) setLotteries(lt);
      else { storage.set("cm_lotteries", []); }
      if (pl) setPolls(pl);
      else { storage.set("cm_polls", []); }
      if (dp) setDeposits(dp);
      else { storage.set("cm_deposits", []); }
      if (ud) setUserDeposits(ud);
      else { storage.set("cm_user_deposits", []); }
      if (vd) setVideos(vd);
      else { storage.set("cm_videos", []); }

      if (fq && fq.length > 0) {
        setFaq(fq);
      } else {
        const defaultFaq = [
          { id: 1, question: "Как использовать корпоративные баллы?", answer: "Войдите в аккаунт, выберите товар и нажмите «В корзину». При оформлении заказа баллы спишутся автоматически. Баланс всегда виден в шапке сайта." },
          { id: 2, question: "Как быстро доставят мой заказ?", answer: "Заказы обрабатываются в течение 1–2 рабочих дней. Доставка по офису занимает ещё 1–3 дня в зависимости от местоположения." },
          { id: 3, question: "Можно ли вернуть или обменять товар?", answer: "Да, в течение 14 дней с момента получения при сохранении товарного вида и упаковки. Обратитесь в поддержку для оформления возврата." },
          { id: 4, question: "Где посмотреть статус заказа?", answer: "Статус заказа отображается в разделе «Мои заказы» в личном кабинете. Уведомления об изменении статуса приходят автоматически." },
        ];
        setFaq(defaultFaq);
        storage.set("cm_faq", defaultFaq);
      }

      if (ap) {
        if (ap.currency) _globalCurrency = { ...ap.currency };
        setAppearance(prev => ({ ...prev, ...ap,
          socials:         { ...(prev.socials||{}),         ...(ap.socials||{}) },
          integrations:    { ...(prev.integrations||{}),    ...(ap.integrations||{}) },
          currency:        { ...(prev.currency||{}),        ...(ap.currency||{}) },
          seo:             { ...(prev.seo||{}),              ...(ap.seo||{}) },
          sectionSettings: { ...(prev.sectionSettings||{}), ...(ap.sectionSettings||{}) },
          features:        { ...(prev.features||{}),        ...(ap.features||{}) },
        }));
        applyTheme(ap.theme || "default", ap);
        if (ap.seo) applySeo(ap.seo);
      }

      // Пользователи: берём с сервера. admin создаём ТОЛЬКО если его нет совсем
      const base = u || {};
      if (!base.admin) {
        base.admin = { username: "admin", password: "admin123", role: "admin", balance: 0, email: "admin@corp.ru", createdAt: Date.now() };
        storage.set("cm_users", base); // записываем только если создали admin впервые
      }
      setUsers(base);
      // НЕ вызываем storage.set("cm_users") здесь — не затираем данные других браузеров!

      setDbConfig({ connected: true, dbSize: Object.keys(storage.all()).length, rowCounts: getSQLiteStats() });

      // Восстанавливаем сессию из localStorage
      const savedSession = _lsGet("cm_session");
      if (savedSession && savedSession.user) {
        // Восстанавливаем сессию если пользователь найден в базе
        if (base[savedSession.user]) {
          setCurrentUser(savedSession.user);
        } else {
          // Пользователь не найден — возможно данные ещё загружаются
          // Устанавливаем таймер для повторной проверки
          console.warn('[Session] Пользователь', savedSession.user, 'не найден в базе, попробуем позже');
          setTimeout(() => {
            const retryUsers = storage.get("cm_users");
            if (retryUsers && retryUsers[savedSession.user]) {
              setCurrentUser(savedSession.user);
            }
          }, 2000);
        }
      }

      // Начисления (трудодни + дни рождения) — выполняются на сервере атомарно
      _apiCall('daily_grants').then(r => {
        if (r.ok && r.users && (r.grants.workday > 0 || r.grants.birthday > 0)) {
          // Сервер сделал начисления — обновляем локальный кэш и UI
          // Мержим а не заменяем, чтобы не потерять данные
          _cache['cm_users'] = r.users;
          setUsers(prev => {
            const merged = { ...prev };
            Object.keys(r.users).forEach(k => {
              merged[k] = { ...(merged[k] || {}), ...r.users[k] };
              // Гарантируем что пароль не теряется
              if (!merged[k].password && prev[k]?.password) merged[k].password = prev[k].password;
            });
            return merged;
          });
          _lsSet('cm_workday_grant', new Date().toISOString().slice(0, 10));
          _lsSet('cm_birthday_grant', String(new Date().getFullYear()));
        }
      }).catch(() => {});

    }).catch(err => {
      console.error('Store init failed', err);
    });

    const handleUnload = () => storage.flush();
    window.addEventListener('beforeunload', handleUnload);

    // ── Polling: обновляем данные с сервера каждые 4 секунды ──
    const _applyServerData = (data) => {
      if (!data) return;
      // Защита: НЕ перезаписываем users пустым объектом если были данные
      if ('cm_users' in data) {
        const newUsers = data.cm_users;
        if (newUsers && typeof newUsers === 'object' && Object.keys(newUsers).length > 0) {
          // Мержим с текущим состоянием: не теряем пользователей которые уже есть в state
          setUsers(prev => {
            const merged = { ...prev };
            Object.keys(newUsers).forEach(k => {
              if (newUsers[k] && typeof newUsers[k] === 'object') {
                // Для каждого пользователя: мержим поля, не теряем password/role/balance
                merged[k] = {
                  ...(merged[k] || {}),
                  ...newUsers[k],
                };
                // Гарантируем обязательные поля
                if (!merged[k].password && prev[k]?.password) merged[k].password = prev[k].password;
                if (!merged[k].role) merged[k].role = prev[k]?.role || (k === 'admin' ? 'admin' : 'user');
                if (merged[k].balance === undefined || merged[k].balance === null) {
                  merged[k].balance = prev[k]?.balance || 0;
                }
              }
            });
            return merged;
          });
          // Восстановление сессии: если currentUser не установлен, но сессия есть в localStorage
          const savedSession = _lsGet("cm_session");
          if (savedSession && savedSession.user && newUsers[savedSession.user]) {
            setCurrentUser(prev => prev || savedSession.user);
          }
        }
      }
      if ('cm_orders'           in data) setOrders(data.cm_orders);
      if ('cm_products'         in data) setCustomProducts(data.cm_products);
      if ('cm_transfers'        in data) setTransfers(data.cm_transfers);
      if ('cm_categories'       in data) setCustomCategories(data.cm_categories);
      if ('cm_faq'              in data) setFaq(data.cm_faq);
      if ('cm_videos'           in data) setVideos(data.cm_videos);
      if ('cm_tasks'            in data) setTasks(data.cm_tasks);
      if ('cm_task_submissions' in data) setTaskSubmissions(data.cm_task_submissions);
      if ('cm_auctions'         in data) setAuctions(data.cm_auctions);
      if ('cm_lotteries'        in data) setLotteries(data.cm_lotteries);
      if ('cm_polls'            in data) setPolls(data.cm_polls);
      if ('cm_deposits'         in data) setDeposits(data.cm_deposits);
      if ('cm_user_deposits'    in data) setUserDeposits(data.cm_user_deposits);
      if (data.cm_appearance) {
        const ap = data.cm_appearance;
        if (ap.currency) _globalCurrency = { ...ap.currency };
        setAppearance(prev => ({ ...prev, ...ap,
          socials:         { ...(prev.socials||{}),         ...(ap.socials||{}) },
          integrations:    { ...(prev.integrations||{}),    ...(ap.integrations||{}) },
          currency:        { ...(prev.currency||{}),        ...(ap.currency||{}) },
          seo:             { ...(prev.seo||{}),              ...(ap.seo||{}) },
          sectionSettings: { ...(prev.sectionSettings||{}), ...(ap.sectionSettings||{}) },
          features:        { ...(prev.features||{}),        ...(ap.features||{}) },
        }));
        applyTheme(ap.theme || 'default', ap);
        if (ap.seo) applySeo(ap.seo);
      }
    };

    // Polling с проверкой версии — не тянем данные если ничего не изменилось
    let _lastKnownVersion = _initVersion;
    let _pollActive = true;
    const handleVisChange = () => { _pollActive = !document.hidden; };
    document.addEventListener('visibilitychange', handleVisChange);
    const pollInterval = setInterval(async () => {
      if (!_pollActive) return; // не опрашиваем если вкладка скрыта
      try {
        // Сначала проверяем версию (лёгкий запрос)
        const vRes = await fetch('/api/store', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'version' }),
        });
        const vData = await vRes.json();
        if (!vData.ok || vData.version === _lastKnownVersion) return; // данные не изменились

        // Версия изменилась — тянем полные данные
        const res = await fetch('/api/store', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getAll' }),
        });
        const r = await res.json();
        if (r.ok && r.data) {
          const newVer = r.version || vData.version;
          _lastKnownVersion = newVer;
          const filtered = {};
          // _applyData обновит кэш только если версия новее
          _applyData(r.data, newVer);
          Object.keys(r.data).forEach(k => {
            if (!_pendingWrites.has(k)) filtered[k] = r.data[k];
          });
          _applyServerData(filtered);
        }
      } catch(e) { /* ignore */ }
    }, 5000);

    return () => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisChange);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);

  // Получить статистику по ключам хранилища
  function getSQLiteStats() {
    try {
      const all = storage.all();
      const total = Object.keys(all).length;
      const counts = {};
      ['cm_users','cm_products','cm_orders','cm_transfers','cm_categories','cm_appearance'].forEach(k => {
        const v = all[k];
        if (Array.isArray(v)) counts[k] = v.length;
        else if (v && typeof v === 'object') counts[k] = Object.keys(v).length;
        else counts[k] = v !== null && v !== undefined ? 1 : 0;
      });
      counts['_total_keys'] = total;
      return counts;
    } catch { return {}; }
  }

  const refreshDbConfig = () => {
    const all = storage.all();
    const totalKeys = Object.keys(all).length;
    setDbConfig({ connected: storage.isReady(), dbSize: totalKeys, rowCounts: getSQLiteStats() });
  };

  const notify = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3200); pushNotif(msg, type); };

  const saveUsers = (u) => {
    // Гарантируем что пользовательские данные не потеряются
    if (!u || typeof u !== 'object') return;
    
    // Защита: никогда не сохранять пустой объект если уже есть пользователи
    if (Object.keys(u).length === 0) {
      console.warn('[saveUsers] Попытка сохранить пустой объект users — отклонено');
      return;
    }
    
    // Гарантируем что у каждого пользователя есть обязательные поля
    const safe = { ...u };
    Object.keys(safe).forEach(k => {
      if (safe[k] && typeof safe[k] === 'object') {
        if (!safe[k].role) safe[k].role = (k === 'admin') ? 'admin' : 'user';
        if (safe[k].balance === undefined || safe[k].balance === null) safe[k].balance = 0;
      }
    });
    
    setUsers(safe);
    storage.set("cm_users", safe);
  };
  const saveOrders = useCallback((o) => { setOrders(o); storage.set("cm_orders", o); }, []);
  const saveProducts = useCallback((p) => { setCustomProducts(p); storage.set("cm_products", p); }, []);
  const saveTransfers = useCallback((t) => { setTransfers(t); storage.set("cm_transfers", t); }, []);
  const saveDbConfig = (db) => { setDbConfig(db); };
  const saveAppearance = (ap) => {
    if (ap.currency) _globalCurrency = { ...ap.currency };
    setAppearance(ap); storage.set("cm_appearance", ap); applyTheme(ap.theme, ap);
    // Apply SEO immediately on save
    if (ap.seo) applySeo(ap.seo);
  };

  // Apply SEO to document (title, description, favicon)
  function applySeo(seo) {
    if (!seo) return;
    if (seo.title) document.title = seo.title;
    // Meta description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) { metaDesc = document.createElement('meta'); metaDesc.name = 'description'; document.head.appendChild(metaDesc); }
    if (seo.description !== undefined) metaDesc.content = seo.description;
    // Favicon
    if (seo.favicon) {
      let link = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = seo.favicon;
    }
  }

  // Apply Yandex Metrika counter
  React.useEffect(() => {
    const integ = appearance.integrations || {};
    const existingScript = document.getElementById('ym-script');
    if (integ.ymEnabled && integ.ymCounterId) {
      if (!existingScript) {
        const s = document.createElement('script');
        s.id = 'ym-script';
        s.type = 'text/javascript';
        s.text = `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();
for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
ym(${integ.ymCounterId}, "init", { clickmap:true, trackLinks:true, accurateTrackBounce:true });`;
        document.head.appendChild(s);
        // noscript pixel
        const ns = document.createElement('noscript');
        ns.id = 'ym-noscript';
        ns.innerHTML = `<div><img src="https://mc.yandex.ru/watch/${integ.ymCounterId}" style="position:absolute; left:-9999px;" alt="" /></div>`;
        document.body.appendChild(ns);
      }
    } else {
      if (existingScript) existingScript.remove();
      const ns = document.getElementById('ym-noscript');
      if (ns) ns.remove();
    }
  }, [appearance.integrations?.ymEnabled, appearance.integrations?.ymCounterId]);

  const saveCategories = useCallback((cc) => { setCustomCategories(cc); storage.set("cm_categories", cc); }, []);
  const saveFaq = useCallback((fq) => { setFaq(fq); storage.set("cm_faq", fq); }, []);
  const saveVideos = useCallback((vd) => { setVideos(vd); storage.set("cm_videos", vd); }, []);
  const saveTasks = useCallback((tk) => { setTasks(tk); storage.set("cm_tasks", tk); }, []);
  const saveAuctions = useCallback((au) => { setAuctions(au); storage.set("cm_auctions", au); }, []);
  const saveLotteries = useCallback((lt) => { const data = lt || []; setLotteries(data); storage.set("cm_lotteries", data); }, []);
  const savePolls = useCallback((pl) => { const data = pl || []; setPolls(data); storage.set("cm_polls", data); }, []);
  const saveDeposits = useCallback((dp) => { const data = dp || []; setDeposits(data); storage.set("cm_deposits", data); }, []);
  const saveUserDeposits = useCallback((ud) => { const data = ud || []; setUserDeposits(data); storage.set("cm_user_deposits", data); }, []);
  const saveTaskSubmissions = useCallback((ts) => { setTaskSubmissions(ts); storage.set("cm_task_submissions", ts); }, []);

  const [cartAnimating, setCartAnimating] = useState(false);
  const addToCart = (product) => {
    if (product.size && product.sizeStock && product.sizeStock[product.size] === 0) {
      notify("Нет в наличии: " + product.name + " (" + product.size + ")", "err");
      return;
    }
    const key = product.cartKey || ("" + product.id);
    setCart(prev => {
      const ex = prev.find(i => (i.cartKey || ("" + i.id)) === key);
      return ex
        ? prev.map(i => (i.cartKey || ("" + i.id)) === key ? { ...i, qty: i.qty + 1 } : i)
        : [...prev, { ...product, qty: 1 }];
    });
    const sizeStr = product.size ? " (" + product.size + ")" : "";
    notify("\u00ab" + product.name + "\u00bb" + sizeStr + " \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d \u0432 \u043a\u043e\u0440\u0437\u0438\u043d\u0443");
    setCartAnimating(true);
    setTimeout(() => setCartAnimating(false), 600);
  };
  const removeFromCart = (cartKey) => setCart(prev => prev.filter(i => (i.cartKey || ("" + i.id)) !== cartKey));
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  const sendTelegramNotify = (order) => {
    // Use React state (appearance) — it's always up-to-date after save
    const integ = appearance.integrations || {};
    const items = order.items.map(i => `  • ${i.name}${i.size ? " (" + i.size + ")" : ""} x${i.qty || 1} — ${i.price * (i.qty || 1)} RC`).join("\n");
    const text = "🛍️ <b>Новый заказ #" + order.id + "</b>\n\n👤 Покупатель: <code>" + order.user + "</code>\n📅 Дата: " + order.date + "\n\n" + items + "\n\n💰 <b>Итого: " + order.total + "" + currName() + "</b>\n📦 Статус: " + order.status;
    // Telegram
    if (integ.tgEnabled && integ.tgBotToken && integ.tgChatId) {
      const token = integ.tgBotToken.trim();
      const chatId = integ.tgChatId.trim();
      fetch('/api/telegram', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, chat_id: chatId, text, parse_mode: "HTML" })
      })
      .then(r => r.json())
      .then(d => { if (!d.ok) { notify("Telegram: " + (d.description || "Ошибка отправки"), "err"); } })
      .catch(e => { notify("Telegram: ошибка сети", "err"); });
    }
    // Max
    if (integ.maxEnabled && integ.maxBotToken && integ.maxChatId) {
      fetch('/api/max', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: integ.maxBotToken.trim(), chat_id: integ.maxChatId.trim(), text })
      })
      .then(r => r.json())
      .then(d => { if (!d.ok) { notify("Max: " + (d.description || "Ошибка отправки"), "err"); } })
      .catch(e => { notify("Max: ошибка сети", "err"); });
    }
  };

  const checkout = () => {
    if (!currentUser) { setPage("login"); return; }
    const user = users[currentUser];
    if ((user.balance || 0) < cartTotal) { notify("Недостаточно " + currName() + "!", "err"); return; }
    const newUsers = { ...users, [currentUser]: { ...user, balance: user.balance - cartTotal } };
    const order = { id: Date.now(), user: currentUser, items: [...cart], total: cartTotal, date: new Date().toLocaleString("ru-RU"), status: "Обрабатывается" };
    // Deduct stock per size
    var currentProducts = customProducts !== null ? customProducts : PRODUCTS;
    var updProds = currentProducts.map(function(p) {
      var item = cart.find(function(c) { return c.id === p.id && c.size; });
      if (item && p.sizeStock && p.sizeStock[item.size] !== undefined) {
        var ss = Object.assign({}, p.sizeStock);
        ss[item.size] = Math.max(0, ss[item.size] - (item.qty || 1));
        return Object.assign({}, p, {sizeStock: ss});
      }
      if (!item && p.stock !== null && p.stock !== undefined) {
        var ci = cart.find(function(c) { return c.id === p.id; });
        if (ci) return Object.assign({}, p, {stock: Math.max(0, p.stock - (ci.qty||1))});
      }
      return p;
    });
    saveProducts(updProds);
    saveUsers(newUsers);
    saveOrders([order, ...orders]);
    setCart([]);
    setOrderSuccess(true);
    sendTelegramNotify(order);
  };

  const isAdmin = currentUser && users[currentUser]?.role === "admin";
  const allProducts = customProducts !== null ? customProducts : PRODUCTS;
  const activeProducts = useMemo(() => allProducts.filter(p => !p.inactive), [allProducts]);
  const allCategories = customCategories !== null ? customCategories : ["Одежда", "Аксессуары", "Посуда", "Канцелярия"];
  const shopCategories = useMemo(() => ["Все", ...allCategories], [allCategories]);
  const filtered = useMemo(() => filterCat === "Все" ? activeProducts : activeProducts.filter(p => p.category === filterCat), [filterCat, activeProducts]);


  if (sqliteInitError) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",gap:"12px",padding:"24px",textAlign:"center"}}>
      <div style={{fontSize:"32px"}}>⚠️</div>
      <div style={{fontWeight:700,fontSize:"16px",color:"var(--rd-red)"}}>Ошибка инициализации SQLite</div>
      <div style={{fontSize:"13px",color:"var(--rd-gray-text)",maxWidth:"400px"}}>{sqliteInitError}</div>
      <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>Убедитесь, что браузер поддерживает WebAssembly и IndexedDB. Попробуйте перезагрузить страницу.</div>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>🔄 Перезагрузить</button>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: appearance.pageBg || undefined }}>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {orderSuccess && (
        <div className="modal-overlay" style={{zIndex:9999}} onClick={() => { setOrderSuccess(false); setPage("shop"); }}>
          <div className="modal-box" style={{maxWidth:"420px",padding:"48px 36px",textAlign:"center"}} onClick={e => e.stopPropagation()}>
            <div style={{fontSize:"64px",marginBottom:"16px",lineHeight:1}}>✅</div>
            <div style={{fontWeight:800,fontSize:"24px",color:"var(--rd-dark)",marginBottom:"10px"}}>Заказ успешно оформлен!</div>
            <div style={{fontSize:"15px",color:"var(--rd-gray-text)",marginBottom:"32px"}}>Ваш заказ принят в обработку. Вы можете отследить его статус в разделе «История заказов».</div>
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              <button className="btn btn-primary btn-lg" onClick={() => { setOrderSuccess(false); setPage("history"); }}>Мои заказы</button>
              <button className="btn btn-secondary" onClick={() => { setOrderSuccess(false); setPage("shop"); }}>Вернуться в магазин</button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="rd-header" style={appearance.headerBg ? {background: appearance.headerBg, borderBottomColor: appearance.headerBg} : {}}>
        <div className="container">
          <div className="rd-header-inner">
            <div className="rd-logo" onClick={() => setPage("shop")}>{appearance.logo ? <img src={appearance.logo} alt="logo" /> : <img src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4NCjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+DQo8IS0tIENyZWF0b3I6IENvcmVsRFJBVyAtLT4NCjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWw6c3BhY2U9InByZXNlcnZlIiB3aWR0aD0iMTg2LjYwNW1tIiBoZWlnaHQ9IjczLjI1bW0iIHZlcnNpb249IjEuMSIgc3R5bGU9InNoYXBlLXJlbmRlcmluZzpnZW9tZXRyaWNQcmVjaXNpb247IHRleHQtcmVuZGVyaW5nOmdlb21ldHJpY1ByZWNpc2lvbjsgaW1hZ2UtcmVuZGVyaW5nOm9wdGltaXplUXVhbGl0eTsgZmlsbC1ydWxlOmV2ZW5vZGQ7IGNsaXAtcnVsZTpldmVub2RkIg0Kdmlld0JveD0iMCAwIDE4NjYwLjUyIDczMjUiDQogeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiDQogeG1sbnM6eG9kbT0iaHR0cDovL3d3dy5jb3JlbC5jb20vY29yZWxkcmF3L29kbS8yMDAzIj4NCiA8ZGVmcz4NCiAgPGZvbnQgaWQ9IkZvbnRJRDAiIGhvcml6LWFkdi14PSI3NjAiIGZvbnQtdmFyaWFudD0ibm9ybWFsIiBzdHlsZT0iZmlsbC1ydWxlOm5vbnplcm8iIGZvbnQtd2VpZ2h0PSI1MDAiPg0KCTxmb250LWZhY2UgDQoJCWZvbnQtZmFtaWx5PSJTdG9semwgTWVkaXVtIj4NCgkJPGZvbnQtZmFjZS1zcmM+DQoJCQk8Zm9udC1mYWNlLW5hbWUgbmFtZT0iU3RvbHpsLU1lZGl1bSIvPg0KCQk8L2ZvbnQtZmFjZS1zcmM+DQoJPC9mb250LWZhY2U+DQogICA8bWlzc2luZy1nbHlwaD48cGF0aCBkPSJNMCAweiIvPjwvbWlzc2luZy1nbHlwaD4NCiAgIDxnbHlwaCB1bmljb2RlPSJEIiBob3Jpei1hZHYteD0iNzMzIiBkPSJNMzI5LjAwMyA2OTkuOTk5YzEwMiwwIDE4NywtMy4yOTk2OGUrMDAxIDI1NS45OTcsLTkuOTk5NmUrMDAxIDY3Ljk5ODEsLTYuNzAwNTllKzAwMSAxMDIsLTEuNTAwMDFlKzAwMiAxMDIsLTIuNTAwMDNlKzAwMiAwLC05Ljk5OTZlKzAwMSAtMy40MDAyNGUrMDAxLC0xLjgyOTk3ZSswMDIgLTEuMDJlKzAwMiwtMi40OTk5N2UrMDAyIC02Ljg5OTY5ZSswMDEsLTYuNzAwNTllKzAwMSAtMS41Mzk5NmUrMDAyLC0xLjAwMDAzZSswMDIgLTIuNTU5OTdlKzAwMiwtMS4wMDAwM2UrMDAybC0yLjUzZSswMDIgMCAwIDY5OS45OTkgMjUzIDB6bTAgLTUuNjM5OTZlKzAwMmM2Mi45OTY5LDAgMTE0Ljk5OSwxOS45OTc4IDE1NC45OTUsNjAuMDAwMyA0MC4wMDI0LDM5Ljk5NTcgNjAuMDAwMyw5MC45OTkzIDYwLjAwMDMsMTUzLjk5NiAwLDYzLjAwMzcgLTEuOTk5NzhlKzAwMSwxMTQuMDAxIC02LjAwMDAzZSswMDEsMTU0LjAwMyAtMy45OTk1N2UrMDAxLDM5Ljk5NTcgLTkuMTk5ODJlKzAwMSw2MC4wMDAzIC0xLjU0OTk1ZSswMDIsNjAuMDAwM2wtMS4xMDAwNWUrMDAyIDAgMCAtNC4yOGUrMDAyIDExMC4wMDUgMHoiLz4NCiAgIDxnbHlwaCB1bmljb2RlPSJSIiBob3Jpei1hZHYteD0iNjgxIiBkPSJNNDc5LjAwMyAwbC0xLjgxMDA2ZSswMDIgMjUyLjAwMSAtNy44OTk5MmUrMDAxIDAgMCAtMi41MjAwMWUrMDAyIC0xLjQyOTk1ZSswMDIgMCAwIDY5OS45OTkgMzAxIDBjNzQuOTk3LDAgMTMyLjk5OSwtMS45OTk3OGUrMDAxIDE3NS45OTksLTYuMDk5OTFlKzAwMSA0Mi4wMDAyLC00LjEwMDEzZSswMDEgNjIuOTk2OSwtOS42OTk5M2UrMDAxIDYyLjk5NjksLTEuNjcwMDJlKzAwMiAwLC01LjU5OThlKzAwMSAtMS4zOTk3OGUrMDAxLC0xLjAyZSswMDIgLTQuMTAwMTNlKzAwMSwtMS4zNjk5NWUrMDAyIC0yLjY5OTY3ZSswMDEsLTMuNTAwMTNlKzAwMSAtNi42MDAwM2UrMDAxLC01LjkwMDE0ZSswMDEgLTEuMTU5OThlKzAwMiwtNy4yMDAwM2UrMDAxbDE5Ni4wMDMgLTIuNjMwMDJlKzAwMiAtMS43NTk5OWUrMDAyIDB6bS0yLjYwMDA2ZSswMDIgNTY0LjAwM2wwIC0xLjg3ZSswMDIgMTQyLjAwMyAwYzM2Ljk5OSwwIDY0LjAwMjUsNy45OTc3OSA4My4wMDE1LDI0Ljk5OSAxOC4wMDAxLDE1Ljk5NTYgMjYuOTk2NywzOC45OTY4IDI2Ljk5NjcsNjcuOTk4MSAwLDI5LjAwMTMgLTguOTk2NjdlKzAwMCw1Mi4wMDI1IC0yLjc5OTU2ZSswMDEsNjguOTk2OSAtMS45MDA1N2UrMDAxLDE3LjAwMTIgLTQuNjAwMjVlKzAwMSwyNS4wMDU3IC04LjIwMDI2ZSswMDEsMjUuMDA1N2wtMS40MjAwM2UrMDAyIDB6Ii8+DQogICA8Z2x5cGggdW5pY29kZT0iZSIgaG9yaXotYWR2LXg9IjY1MSIgZD0iTTMzMSA1NjEuOTk4YzkwLjAwMDQsMCAxNjEuMDAyLC0zLjA5OTllKzAwMSAyMTMuOTk2LC05LjI5OTdlKzAwMSA1Mi4wMDI1LC02LjE5OThlKzAwMSA3NC4wMDQ4LC0xLjM5ZSswMDIgNjcuMDA1OSwtMi4zMDk5OGUrMDAybC00LjIyZSswMDIgMGM0Ljk5NDQsLTQuMzAwNThlKzAwMSAxOS45OTc4LC03LjUwMDM3ZSswMDEgNDUuOTk1NywtOS44MDA0OWUrMDAxIDI1Ljk5NzksLTIuMzAwMTJlKzAwMSA1OC4wMDI1LC0zLjM5OTU3ZSswMDEgOTYuOTk5MywtMy4zOTk1N2UrMDAxIDI4LjAwMjQsMCA1My4wMDE0LDYuMDAwMDMgNzUuMDAzNywxOC45OTkgMjEuOTk1NiwxMi4wMDAxIDM3Ljk5NzksMjkuMDAxMyA0Ny4wMDEzLDQ5Ljk5OGwxNDcuOTk2IDBjLTEuODk5OWUrMDAxLC02LjE5OThlKzAwMSAtNS4zMDAxNGUrMDAxLC0xLjA4OTk5ZSswMDIgLTEuMDJlKzAwMiwtMS4zOTk5OGUrMDAyIC00Ljg5OTkxZSswMDEsLTMuMDk5OWUrMDAxIC0xLjAzOTk4ZSswMDIsLTQuNzAwMTNlKzAwMSAtMS42NzAwMmUrMDAyLC00LjcwMDEzZSswMDEgLTguNDk5OTNlKzAwMSwwIC0xLjU0OTk1ZSswMDIsMjYuOTk2NyAtMi4wODk5NWUrMDAyLDgwLjk5NyAtNS40MDAwMmUrMDAxLDU0LjAwMDIgLTguMTAwMzdlKzAwMSwxMjIuMDA1IC04LjEwMDM3ZSswMDEsMjA1IDAsODMuMDAxNSAyNy4wMDM1LDE1MS4wMDYgODEuMDAzNywyMDYuMDA1IDU0LjAwMDIsNTQuOTk5MSAxMjIuOTk3LDgxLjk5NTkgMjA1Ljk5OSw4MS45OTU5em0tOS45ODg4ZS0wMDEgLTEuMTc5OTZlKzAwMmMtMy40MDAyNGUrMDAxLDAgLTYuMjAwNDhlKzAwMSwtOS4wMDM0MmUrMDAwIC04LjQ5OTkzZSswMDEsLTIuNzAwMzVlKzAwMSAtMi4zMDAxMmUrMDAxLC0xLjg5OTllKzAwMSAtMy45MDAzNmUrMDAxLC00LjI5OTkxZSswMDEgLTQuODAwMDJlKzAwMSwtNy4zOTk4MWUrMDAxbDI2Mi45OTYgMGMtNy45OTc3OWUrMDAwLDMwLjk5OSAtMi4yOTk0NWUrMDAxLDU0Ljk5OTEgLTQuNTk5NTdlKzAwMSw3My45OTgxIC0yLjMwMDEyZSswMDEsMTguMDAwMSAtNS4xMDAzNmUrMDAxLDI3LjAwMzUgLTguNDAwMDRlKzAwMSwyNy4wMDM1eiIvPg0KICAgPGdseXBoIHVuaWNvZGU9ImsiIGhvcml6LWFkdi14PSI2MzMiIGQ9Ik02MTMuMDAyIDBsLTEuODMwMDRlKzAwMiAwIC0yLjI0OTk4ZSswMDIgMjQwLjAwMSAwIC0yLjQwMDAxZSswMDIgLTEuNDMwMDJlKzAwMiAwIDAgNzcwLjAwMSAxNDMuMDAyIDAgMCAtNC40OTAwM2UrMDAyIDIwOS4wMDIgMjI5IDE4MS45OTkgMCAtMi41MTAwMmUrMDAyIC0yLjYxOTk3ZSswMDIgMjY4LjAwMyAtMi44ODAwMWUrMDAyeiIvPg0KICAgPGdseXBoIHVuaWNvZGU9Im8iIGhvcml6LWFkdi14PSI2NjAiIGQ9Ik0xMjYuOTk5IDQ4MC4wMDJjNTQuOTk5MSw1NC45OTkxIDEyMy4wMDQsODEuOTk1OSAyMDMuMDAyLDgxLjk5NTkgNzkuOTk4MSwwIDE0Ny45OTYsLTIuNjk5NjdlKzAwMSAyMDQuMDAxLC04LjE5OTU5ZSswMDEgNTQuOTk5MSwtNS40OTk5MWUrMDAxIDgyLjk5NDcsLTEuMjMwMDRlKzAwMiA4Mi45OTQ3LC0yLjA1ZSswMDIgMCwtOC4zMDAxNWUrMDAxIC0yLjY5OTY3ZSswMDEsLTEuNTFlKzAwMiAtOC4xOTk1OWUrMDAxLC0yLjA1ZSswMDIgLTUuNDk5OTFlKzAwMSwtNS41MDA1OWUrMDAxIC0xLjI0MDAzZSswMDIsLTguMjAwMjZlKzAwMSAtMi4wNWUrMDAyLC04LjIwMDI2ZSswMDEgLTguMTAwMzdlKzAwMSwwIC0xLjQ4MDAzZSswMDIsMjYuOTk2NyAtMi4wMzAwMmUrMDAyLDgyLjAwMjYgLTUuNDk5OTFlKzAwMSw1NC45OTkxIC04LjMwMDE1ZSswMDEsMTIyLjk5NyAtOC4zMDAxNWUrMDAxLDIwNSAwLDgxLjk5NTkgMjguMDAyNCwxNTAuMDAxIDgzLjAwMTUsMjA1em0zMDQuMDA0IC05LjYwMDA0ZSswMDFjLTIuNzAwMzVlKzAwMSwyNy45OTU2IC02LjAwMDAzZSswMDEsNDIuMDAwMiAtMS4wMTAwMmUrMDAyLDQyLjAwMDIgLTQuMTAwMTNlKzAwMSwwIC03LjQwMDQ4ZSswMDEsLTEuNDAwNDZlKzAwMSAtMS4wMTAwMmUrMDAyLC00LjIwMDAyZSswMDEgLTIuNjk5NjdlKzAwMSwtMi44MDAyNGUrMDAxIC00LjEwMDEzZSswMDEsLTYuNDAwMjVlKzAwMSAtNC4xMDAxM2UrMDAxLC0xLjA4OTk5ZSswMDIgMCwtNC41MDAzNmUrMDAxIDE0LjAwNDYsLTguMTAwMzdlKzAwMSA0MS4wMDEzLC0xLjA4OTk5ZSswMDIgMjYuOTk2NywtMi44MDAyNGUrMDAxIDYwLjAwMDMsLTQuMjAwMDJlKzAwMSAxMDEuMDAyLC00LjIwMDAyZSswMDEgNDEuMDAxMywwIDc0Ljk5NywxMy45OTc4IDEwMiw0Mi4wMDAyIDI2Ljk5NjcsMjcuOTk1NiAzOS45OTU3LDYzLjk5NTggMzkuOTk1NywxMDguOTk5IDAsNDQuOTk2OCAtMS4zOTk3OGUrMDAxLDgwLjk5NyAtNC4wOTk0NmUrMDAxLDEwOC45OTl6Ii8+DQogICA8Z2x5cGggdW5pY29kZT0icCIgaG9yaXotYWR2LXg9IjY3MyIgZD0iTTM3OS4wMDEgNTYxLjk5OGM3MS4wMDE0LDAgMTMxLjAwMiwtMi42OTk2N2UrMDAxIDE3OS4wMDIsLTcuOTk5ODFlKzAwMSA0OC4wMDAyLC01LjQwMDAyZSswMDEgNzIuMDAwMywtMS4yMjk5N2UrMDAyIDcyLjAwMDMsLTIuMDY5OThlKzAwMiAwLC04LjQwMDA0ZSswMDEgLTIuNDAwMDFlKzAwMSwtMS41MzAwNGUrMDAyIC03LjEwMDE0ZSswMDEsLTIuMDYwMDVlKzAwMiAtNC44MDAwMmUrMDAxLC01LjQwMDAyZSswMDEgLTEuMDhlKzAwMiwtOC4wOTk3ZSswMDEgLTEuODAwMDFlKzAwMiwtOC4wOTk3ZSswMDEgLTcuMjk5OTJlKzAwMSwwIC0xLjMxMDAyZSswMDIsMjkuMDAxMyAtMS43NDAwMWUrMDAyLDg1Ljk5ODFsMCAtMy4yNDAwMWUrMDAyIC0xLjQzMDAyZSswMDIgMCAwIDgwMC4wMDEgMTQzLjAwMiAwIDAgLTcuNjk5NDdlKzAwMWM0Mi45OTkxLDU4Ljk5NDYgMTAxLjAwMiw4OC45OTQ4IDE3NC4wMDEsODguOTk0OHptLTMuMzAwMzVlKzAwMSAtNC4zNzk5NWUrMDAyYzQwLjAwMjQsMCA3My4wMDYsMTMuOTk3OCAxMDAuMDAzLDQyLjAwMDIgMjUuOTk3OSwyNy45OTU2IDM5LjAwMzYsNjMuOTk1OCAzOS4wMDM2LDEwOC45OTkgMCw0NC45OTY4IC0xLjMwMDU3ZSswMDEsODAuOTk3IC0zLjkwMDM2ZSswMDEsMTA4Ljk5OSAtMi41OTk3OWUrMDAxLDI3Ljk5NTYgLTUuOTAwMTRlKzAwMSw0Mi4wMDAyIC0xLjAwMDAzZSswMDIsNDIuMDAwMiAtNC4wOTk0NmUrMDAxLDAgLTcuMzk5ODFlKzAwMSwtMS40MDA0NmUrMDAxIC0xLjAwOTk1ZSswMDIsLTQuMjAwMDJlKzAwMSAtMi43MDAzNWUrMDAxLC0yLjgwMDI0ZSswMDEgLTQuMDAwMjRlKzAwMSwtNi40MDAyNWUrMDAxIC00LjAwMDI0ZSswMDEsLTEuMDg5OTllKzAwMiAwLC00LjUwMDM2ZSswMDEgMTIuOTk4OSwtOC4xMDAzN2UrMDAxIDQwLjAwMjQsLTEuMDg5OTllKzAwMiAyNi45OTY3LC0yLjgwMDI0ZSswMDEgNjAuMDAwMywtNC4yMDAwMmUrMDAxIDEwMC45OTUsLTQuMjAwMDJlKzAwMXoiLz4NCiAgIDxnbHlwaCB1bmljb2RlPSJzIiBob3Jpei1hZHYteD0iNTkxIiBkPSJNMzExLjAwMyAtMS4yMDAwMWUrMDAxYy03LjQwMDQ4ZSswMDEsMCAtMS4zNjAwM2UrMDAyLDE3LjAwMTIgLTEuODUwMDJlKzAwMiw1Mi4wMDI1IC00Ljg5OTkxZSswMDEsMzMuOTk1NyAtNy44OTk5MmUrMDAxLDgwLjk5NyAtOC45MDAxNWUrMDAxLDE0MC45OTdsMTQ1IDBjMTIuMDAwMSwtNC44OTk5MWUrMDAxIDU2LjAwNDgsLTcuMzk5ODFlKzAwMSAxMzIuOTk5LC03LjM5OTgxZSswMDEgNjIuMDA0OCwwIDkzLjAwMzgsMTQuOTk2NyA5My4wMDM4LDQ0Ljk5NjggMCw0LjAwMjI3IDAsOC4wMDQ1NCAtOS45ODg4ZS0wMDEsMTEuMDAxMiAtMS4wMDU2M2UrMDAwLDMuMDAzMzkgLTMuMDAzMzllKzAwMCw2LjAwMDAzIC01LjAwMTE1ZSswMDAsOS4wMDM0MiAtMy4wMDMzOWUrMDAwLDIuOTk2NjQgLTUuMDAxMTVlKzAwMCw0Ljk5NDQgLTguMDA0NTRlKzAwMCw3Ljk5Nzc5IC0yLjk5NjY0ZSswMDAsMS45OTc3NiAtNi4wMDAwM2UrMDAwLDQuMDAyMjcgLTEuMDk5NDRlKzAwMSw2LjAwMDAzIC01LjAwMTE1ZSswMDAsMS45OTc3NiAtMS4wMDAyM2UrMDAxLDQuMDAyMjcgLTEuNDAwNDZlKzAwMSw1LjAwMTE1IC0zLjk5NTUyZSswMDAsMC45OTg4OCAtOS45OTU1NWUrMDAwLDIuOTk2NjQgLTEuNzAwMTJlKzAwMSw1LjAwMTE1IC03Ljk5Nzc5ZSswMDAsMS45OTc3NiAtMS40OTk2N2UrMDAxLDMuOTk1NTIgLTEuOTk5NzhlKzAwMSw0Ljk5NDQgLTYuMDAwMDNlKzAwMCwxLjAwNTYzIC0xLjM5OTc4ZSswMDEsMy4wMDMzOSAtMi40MDAwMWUrMDAxLDUuMDAxMTUgLTEuMDAwMjNlKzAwMSwyLjAwNDUxIC0xLjg5OTllKzAwMSw0LjAwMjI3IC0yLjU5OTc5ZSswMDEsNi4wMDAwMyAtOC4yMDAyNmUrMDAxLDE4Ljk5OSAtMS4zOWUrMDAyLDQxLjAwMTMgLTEuNzEwMDRlKzAwMiw2NC4wMDI1IC0zLjI5OTY4ZSswMDEsMjMuMDAxMiAtNC44OTk5MWUrMDAxLDU2Ljk5NjkgLTQuODk5OTFlKzAwMSwxMDIuOTk5IDAsNTYuOTk2OSAyMi4wMDIzLDEwMiA2Ni4wMDAzLDEzNC45OTcgNDIuOTk5MSwzMi4wMDQ2IDEwMiw0OC4wMDAyIDE3NSw0OC4wMDAyIDcyLjk5OTIsMCAxMzAuMDAzLC0xLjU5OTU2ZSswMDEgMTcxLjAwNCwtNC43MDAxM2UrMDAxIDQwLjk5NDYsLTMuMTk5NzllKzAwMSA2Ni4wMDAzLC03LjQ5OTdlKzAwMSA3NS45OTU4LC0xLjI4OTk3ZSswMDJsLTEuNDVlKzAwMiAwYy0xLjIwMDAxZSswMDEsMzYuOTk5IC00LjgwMDAyZSswMDEsNTUuOTk4IC0xLjA3MDAyZSswMDIsNTUuOTk4IC02LjA5OTkxZSswMDEsMCAtOS4xOTk4MmUrMDAxLC0xLjQ5OTY3ZSswMDEgLTkuMTk5ODJlKzAwMSwtNC41OTk1N2UrMDAxIDAsLTEuMjAwMDFlKzAwMSA2LjAwMDAzLC0yLjEwMDM1ZSswMDEgMTguOTk5LC0yLjYwMDQ2ZSswMDEgMTMuMDA1NywtNC45OTQ0ZSswMDAgNDEuMDAxMywtMS4yOTk4OWUrMDAxIDg2LjAwNDksLTIuMjk5NDVlKzAwMSA0NC45OTY4LC0xLjAwMDIzZSswMDEgNzkuOTk4MSwtMS45MDA1N2UrMDAxIDEwNS45OTYsLTIuNzAwMzVlKzAwMSAyNi4wMDQ2LC04Ljk5NjY3ZSswMDAgNTEuMDAzNiwtMS45OTk3OGUrMDAxIDc0LjAwNDgsLTMuMjk5NjhlKzAwMSAyMi45OTQ1LC0xLjMwMDU3ZSswMDEgMzkuOTk1NywtMi45MDAxM2UrMDAxIDQ5Ljk5OCwtNC44MDAwMmUrMDAxIDkuOTk1NTUsLTEuODk5OWUrMDAxIDE0Ljk5NjcsLTQuMTAwMTNlKzAwMSAxNC45OTY3LC02LjgwMDQ4ZSswMDEgMCwtNS44OTk0NmUrMDAxIC0yLjMwMDEyZSswMDEsLTEuMDQ5OTdlKzAwMiAtNi44OTk2OWUrMDAxLC0xLjM1OTk2ZSswMDIgLTQuNjAwMjVlKzAwMSwtMy4wOTk5ZSswMDEgLTEuMDUwMDRlKzAwMiwtNC43MDAxM2UrMDAxIC0xLjc1OTk5ZSswMDIsLTQuNzAwMTNlKzAwMXoiLz4NCiAgIDxnbHlwaCB1bmljb2RlPSJ0IiBob3Jpei1hZHYteD0iNTI1IiBkPSJNNDY1Ljk5OCAxNDguMDAzbDI0LjAwMDEgLTEuMTYwMDVlKzAwMmMtMS42OTk0NWUrMDAxLC0xLjEwMDEyZSswMDEgLTMuOTk5NTdlKzAwMSwtMi4wOTk2N2UrMDAxIC03LjA5OTQ3ZSswMDEsLTMuMDAwMDFlKzAwMSAtMy4xMDA1OGUrMDAxLC05Ljk5NTU1ZSswMDAgLTYuMjAwNDhlKzAwMSwtMS4zOTk3OGUrMDAxIC05LjMwMDM4ZSswMDEsLTEuMzk5NzhlKzAwMSAtNS45MDAxNGUrMDAxLDAgLTEuMDhlKzAwMiwxOC45OTkgLTEuNDY5OTdlKzAwMiw1NS45OTggLTMuOTAwMzZlKzAwMSwzNi45OTkgLTUuOTAwMTRlKzAwMSw5My4wMDM4IC01LjkwMDE0ZSswMDEsMTY4LjAwMWwwIDIwMy4wMDIgLTkuNzk5ODJlKzAwMSAwIDAgMTM0Ljk5NyA5Ny45OTgyIDAgMCAxMTkuMDAyIDE0My4wMDIgMzAuOTk5IDAgLTEuNTAwMDFlKzAwMiAyMDQuMDAxIDAgMCAtMS4zNDk5N2UrMDAyIC0yLjA0MDAxZSswMDIgMCAwIC0xLjk0OTk4ZSswMDJjMCwtNi42MDAwM2UrMDAxIDI4Ljk5NDUsLTkuOTAwMzhlKzAwMSA4Ny45OTU5LC05LjkwMDM4ZSswMDEgMjYuMDA0NiwwIDY0LjAwMjUsOS4wMDM0MiAxMTQuOTk5LDI3LjAwMzV6Ii8+DQogICA8Z2x5cGggdW5pY29kZT0idSIgaG9yaXotYWR2LXg9IjYxNiIgZD0iTTQxNy45OTcgNTQ5Ljk5OGwxNDMuMDAyIDAgMCAtNS40OTk5OGUrMDAyIC0xLjQzMDAyZSswMDIgMCAwIDc2LjAwMjZjLTQuMjAwMDJlKzAwMSwtNS45MDAxNGUrMDAxIC05Ljg5OTcxZSswMDEsLTguODAwMjZlKzAwMSAtMS42OTk5OWUrMDAyLC04LjgwMDI2ZSswMDEgLTYuMDk5OTFlKzAwMSwwIC0xLjA4ZSswMDIsMTkuOTk3OCAtMS40MzAwMmUrMDAyLDU5LjAwMTQgLTMuNDk5NDVlKzAwMSwzOC45OTY4IC01LjI5OTQ2ZSswMDEsOTAuOTk5MyAtNS4yOTk0NmUrMDAxLDE1Ny45OThsMCAzNDQuOTk4IDE0Mi45OTUgMCAwIC0zLjEzOTk5ZSswMDJjMCwtMy42OTk5ZSswMDEgOC4wMDQ1NCwtNi41MDAxNGUrMDAxIDI0LjAwMDEsLTguNDAwMDRlKzAwMSAxNS4wMDM0LC0xLjg5OTllKzAwMSA0MS4wMDEzLC0yLjc5OTU2ZSswMDEgNzcuMDAxNSwtMi43OTk1NmUrMDAxIDM5LjAwMzYsMCA3MC4wMDI2LDEyLjAwMDEgOTAuOTk5MywzNC45OTQ1IDIxLjAwMzUsMjMuMDAxMiAzMC45OTksNTcuMDAzNiAzMC45OTksMTAybDAgMjg5eiIvPg0KICA8L2ZvbnQ+DQogIDxzdHlsZSB0eXBlPSJ0ZXh0L2NzcyI+DQogICA8IVtDREFUQVsNCiAgICBAZm9udC1mYWNlIHsgZm9udC1mYW1pbHk6IlN0b2x6bCBNZWRpdW0iO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6NTAwO3NyYzp1cmwoIiNGb250SUQwIikgZm9ybWF0KHN2Zyl9DQogICAgLmZpbDEge2ZpbGw6IzJCMkIyQX0NCiAgICAuZmlsMCB7ZmlsbDojRDEyRDJGfQ0KICAgIC5mbnQwIHtmb250LXdlaWdodDo1MDA7Zm9udC1zaXplOjE0ODEuNjZweDtmb250LWZhbWlseTonU3RvbHpsIE1lZGl1bSd9DQogICBdXT4NCiAgPC9zdHlsZT4NCiA8L2RlZnM+DQogPGcgaWQ9ItCh0LvQvtC5X3gwMDIwXzEiPg0KICA8bWV0YWRhdGEgaWQ9IkNvcmVsQ29ycElEXzBDb3JlbC1MYXllciIvPg0KICA8cGF0aCBjbGFzcz0iZmlsMCIgZD0iTTM1ODIuOTkgMTcxMy41NmwxNzI0LjA1IDBjNTEzLjYyLDAgOTMzLjg0LDQyMC4yMiA5MzMuODQsOTMzLjg0bDAgMTcyNC4wNWMwLDUxMy42MiAtNDIwLjIyLDkzMy44NCAtOTMzLjg0LDkzMy44NGwtMTcyNC4wNSAwYy01MTMuNjIsMCAtOTMzLjg0LC00MjAuMjIgLTkzMy44NCwtOTMzLjg0bDAgLTE3MjQuMDVjMCwtNTEzLjYyIDQyMC4yMiwtOTMzLjg0IDkzMy44NCwtOTMzLjg0em0yNjggMjM1MS42OWMtNzYuNjcsLTQ0LjI4IC0xNDMuODksLTEwMy4yMyAtMTk3LjgxLC0xNzMuNDYgLTUzLjg5LC03MC4yNSAtOTMuNDMsLTE1MC40MyAtMTE2LjM1LC0yMzUuOTcgLTIyLjkyLC04NS41MiAtMjguNzcsLTE3NC43NCAtMTcuMjEsLTI2Mi41MiAxMS41NSwtODcuODEgNDAuMywtMTcyLjQ1IDg0LjU4LC0yNDkuMTUgNDQuMjUsLTc2LjY4IDEwMy4yLC0xNDMuOSAxNzMuNDYsLTE5Ny43OSA3MC4yNSwtNTMuOTEgMTUwLjQzLC05My40NiAyMzUuOTcsLTExNi4zOCA4NS41MiwtMjIuOTIgMTc0Ljc0LC0yOC43NSAyNjIuNTIsLTE3LjIgODcuNzksMTEuNTcgMTcyLjQ1LDQwLjMgMjQ5LjEzLDg0LjU4bC0zMzcuMTMgNTgzLjk0IC0zMzcuMTYgNTgzLjk1em0xMDc1LjY3IC0xMzk0LjY1YzEwMi4yMyw1OS4wMiAxOTEuODcsMTM3LjYzIDI2My43MywyMzEuMjkgNzEuODgsOTMuNjYgMTI0LjYsMjAwLjU4IDE1NS4xNiwzMTQuNiAzMC41NSwxMTQuMDUgMzguMzYsMjMzLjAxIDIyLjk0LDM1MC4wNSAtMTUuNDIsMTE3LjA2IC01My43NCwyMjkuOTQgLTExMi43NSwzMzIuMTggLTU5LjA0LDEwMi4yNCAtMTM3LjYzLDE5MS44NyAtMjMxLjMxLDI2My43MyAtOTMuNjYsNzEuODggLTIwMC41NiwxMjQuNjEgLTMxNC42MSwxNTUuMTYgLTExNC4wNSwzMC41NSAtMjMyLjk4LDM4LjM2IC0zNTAuMDQsMjIuOTQgLTExNy4wNiwtMTUuNCAtMjI5LjkyLC01My43MSAtMzMyLjE4LC0xMTIuNzVsNDQ5LjUzIC03NzguNjEgNDQ5LjUzIC03NzguNTl6Ii8+DQogIDx0ZXh0IHg9IjcxNjguMTIiIHk9IjQwMTUuODUiICBjbGFzcz0iZmlsMSBmbnQwIj5SdURlc2t0b3A8L3RleHQ+DQogPC9nPg0KPC9zdmc+DQo=" alt="RuDesktop" />}</div>
            <nav className="rd-nav">
              <button className={`rd-nav-btn ${page === "shop" ? "active" : ""}`} onClick={() => setPage("shop")}>Магазин</button>
              <button className={`rd-nav-btn ${page === "auction" ? "active" : ""}`} onClick={() => setPage("auction")} style={{display: appearance.features?.auction === false ? "none" : ""}}>Аукцион</button>
              <button className={`rd-nav-btn ${page === "lottery" ? "active" : ""}`} onClick={() => setPage("lottery")} style={{display: appearance.features?.lottery === false ? "none" : ""}}>Лотерея</button>
              <button className={`rd-nav-btn ${page === "voting" ? "active" : ""}`} onClick={() => setPage("voting")} style={{display: appearance.features?.voting === false ? "none" : ""}}>Голосования</button>
              <button className={`rd-nav-btn ${page === "bank" ? "active" : ""}`} onClick={() => setPage("bank")} style={{display: appearance.features?.bank === false ? "none" : ""}}>Банк</button>
              <button className={`rd-nav-btn ${page === "tasks" ? "active" : ""}`} onClick={() => setPage("tasks")} style={{display: appearance.features?.tasks === false ? "none" : ""}}>Задания</button>
            </nav>
            {/* Mobile hamburger button */}
            <button className="rd-burger" onClick={() => setMobileNavOpen(o => !o)} aria-label="Меню">
              <span className={`rd-burger-line ${mobileNavOpen ? "open" : ""}`}></span>
              <span className={`rd-burger-line ${mobileNavOpen ? "open" : ""}`}></span>
              <span className={`rd-burger-line ${mobileNavOpen ? "open" : ""}`}></span>
            </button>
            <div className="rd-header-right">
              {currentUser ? <>
                <div className="balance-pill" onClick={() => setPage("history")} style={{cursor:"pointer"}} title="История операций"><CurrIcon /> {users[currentUser]?.balance || 0} <span className="balance-label">{currName()}</span></div>
                {users[currentUser]?.role === "admin" && (() => {
                  const newCount = orders.length - seenOrdersCount;
                  const totalUnread = notifUnread;
                  return (
                    <div style={{position:"relative"}}
                      onMouseEnter={() => { if (window._bellCloseTimer) { clearTimeout(window._bellCloseTimer); window._bellCloseTimer = null; } }}
                      onMouseLeave={() => { window._bellCloseTimer = setTimeout(() => setBellOpen(false), 250); }}>
                      <button
                        onClick={() => { setBellOpen(o => !o); markNotifRead(); if (!bellOpen) markOrdersSeen(); }}
                        title={totalUnread > 0 ? `Уведомлений: ${totalUnread}` : "Уведомления"}
                        style={{position:"relative",background:bellOpen?"var(--rd-red-light)":"none",border:"none",cursor:"pointer",padding:"6px",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",color:totalUnread>0?"var(--rd-red)":"var(--rd-gray-text)",transition:"all 0.15s"}}
                        onMouseEnter={e=>e.currentTarget.style.background="var(--rd-red-light)"}
                        onMouseLeave={e=>{ if(!bellOpen) e.currentTarget.style.background="none"; }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                        </svg>
                        {totalUnread > 0 && (
                          <span style={{position:"absolute",top:"2px",right:"2px",background:"var(--rd-red)",color:"#fff",borderRadius:"50%",minWidth:"16px",height:"16px",fontSize:"10px",fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 3px",lineHeight:1}}>
                            {totalUnread > 99 ? "99+" : totalUnread}
                          </span>
                        )}
                      </button>
                      {bellOpen && (
                        <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,width:"min(340px, calc(100vw - 24px))",background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius)",boxShadow:"var(--rd-shadow-lg)",zIndex:300,overflow:"hidden",animation:"dropIn 0.15s ease"}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px 10px",borderBottom:"1.5px solid var(--rd-gray-border)",background:"var(--rd-gray-bg)"}}>
                            <div style={{fontWeight:800,fontSize:"15px",color:"var(--rd-dark)"}}>🔔 Уведомления</div>
                            <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                              {notifHistory.length > 0 && (
                                <button onClick={clearNotifHistory} style={{fontSize:"11px",color:"var(--rd-gray-text)",background:"none",border:"none",cursor:"pointer",padding:"2px 6px",borderRadius:"6px",fontWeight:600}} onMouseEnter={e=>e.currentTarget.style.color="var(--rd-red)"} onMouseLeave={e=>e.currentTarget.style.color="var(--rd-gray-text)"}>
                                  Очистить
                                </button>
                              )}
                              <button onClick={() => { setBellOpen(false); setPage("settings"); markOrdersSeen(); }} style={{fontSize:"11px",color:"var(--rd-red)",background:"none",border:"none",cursor:"pointer",padding:"2px 6px",borderRadius:"6px",fontWeight:700,background:"var(--rd-red-light)",border:"1px solid rgba(199,22,24,0.15)"}}>
                                Все заказы →
                              </button>
                            </div>
                          </div>
                          <div style={{maxHeight:"380px",overflowY:"auto"}}>
                            {notifHistory.length === 0
                              ? <div style={{padding:"32px 16px",textAlign:"center",color:"var(--rd-gray-text)"}}>
                                  <div style={{fontSize:"28px",marginBottom:"8px"}}>🔕</div>
                                  <div style={{fontSize:"13px",fontWeight:600}}>Уведомлений пока нет</div>
                                </div>
                              : notifHistory.map((n, i) => (
                                  <div key={n.id} style={{display:"flex",gap:"10px",padding:"10px 16px",borderBottom: i < notifHistory.length-1 ? "1px solid var(--rd-gray-border)" : "none",alignItems:"flex-start",background: i === 0 && notifUnread === 0 ? "transparent" : "transparent"}}>
                                    <div style={{width:"28px",height:"28px",borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"13px",
                                      background: n.type==="err" ? "rgba(199,22,24,0.1)" : n.type==="warn" ? "rgba(245,158,11,0.1)" : "rgba(5,150,105,0.1)",
                                      color: n.type==="err" ? "var(--rd-red)" : n.type==="warn" ? "#d97706" : "var(--rd-green)"}}>
                                      {n.type==="err" ? "✕" : n.type==="warn" ? "⚠" : "✓"}
                                    </div>
                                    <div style={{flex:1,minWidth:0}}>
                                      <div style={{fontSize:"13px",fontWeight:600,color:"var(--rd-dark)",lineHeight:1.4,wordBreak:"break-word"}}>{n.msg}</div>
                                      <div style={{fontSize:"11px",color:"#9ca3af",marginTop:"3px"}}>{n.time}</div>
                                    </div>
                                  </div>
                                ))
                            }
                          </div>
                          {newCount > 0 && (
                            <div style={{padding:"10px 16px",borderTop:"1px solid var(--rd-gray-border)",background:"var(--rd-red-light)"}}>
                              <div style={{fontSize:"12px",fontWeight:700,color:"var(--rd-red)",textAlign:"center"}}>
                                📦 {newCount} {newCount === 1 ? "новый заказ" : newCount < 5 ? "новых заказа" : "новых заказов"}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {(() => {
                  const displayName = users[currentUser]?.firstName ? users[currentUser].firstName + " " + (users[currentUser].lastName || "") : currentUser;
                  return (
                    <div className="user-menu-wrap"
                      onMouseEnter={() => { if (window._menuCloseTimer) { clearTimeout(window._menuCloseTimer); window._menuCloseTimer = null; } setMenuOpen(true); }}
                      onMouseLeave={() => { window._menuCloseTimer = setTimeout(() => setMenuOpen(false), 200); }}>
                      <button className="user-menu-trigger">
                        {users[currentUser]?.avatar
                          ? <img src={users[currentUser].avatar} alt="avatar" style={{width:"30px",height:"30px",borderRadius:"8px",objectFit:"cover",border:"1.5px solid rgba(199,22,24,0.25)"}} />
                          : <div style={{width:"30px",height:"30px",borderRadius:"50%",background:"var(--rd-red-light)",border:"1.5px solid rgba(199,22,24,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:"13px",color:"var(--rd-red)",flexShrink:0}}>{currentUser[0].toUpperCase()}</div>
                        }
                        <span className="user-name">{displayName}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{color:"var(--rd-gray-text)",transition:"transform 0.2s",transform:menuOpen?"rotate(180deg)":"none"}}><path d="M6 9l6 6 6-6"/></svg>
                      </button>
                      {menuOpen && (
                        <div className="user-dropdown">
                          <div className="user-dropdown-header">
                            <div className="user-dropdown-name">{displayName}</div>
                            <div className="user-dropdown-balance"><CurrIcon /> {users[currentUser]?.balance || 0} {currName()}</div>
                          </div>
                          {[
                            { icon:"📦", label:"Мои заказы",  page:"orders" },
                            { icon:"❤️", label:"Избранное",   page:"favorites" },
                            { icon:"🪙", label:"Перевод " + currName(), page:"transfer" },
                            { icon:"👤", label: isAdmin ? "Настройки" : "Профиль", page:"settings" },
                          ].map(item => (
                            <button key={item.page} className="user-dropdown-item" onClick={() => { setPage(item.page); setMenuOpen(false); }}>
                              <span className="udi-icon">{item.icon}</span>
                              {item.label}
                            </button>
                          ))}
                          <div className="user-dropdown-divider"></div>
                          <button className="user-dropdown-item danger" onClick={() => { setCurrentUser(null); _lsSet("cm_session", null); setPage("shop"); setMenuOpen(false); }}>
                            <span className="udi-icon">🚪</span>
                            Выйти
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </> : <>
                <button className="btn btn-ghost btn-sm" onClick={() => setPage("login")}>Войти</button>
                {appearance.registrationEnabled !== false && (
                  <button className="btn btn-primary btn-sm" onClick={() => setPage("register")}>Регистрация</button>
                )}
              </>}
              <div className={"cart-wrap" + (cartAnimating ? " cart-bounce" : "")} onClick={() => setPage("cart")}>
                <div className="cart-icon">🛒</div>
                {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
              </div>
            </div>
          </div>
        </div>
      </header>

      {mobileNavOpen && (
        <div className="rd-mobile-nav" onClick={() => setMobileNavOpen(false)}>
          {[
            { p: "shop", label: "🛍️ Магазин", flag: null },
            { p: "auction", label: "🔨 Аукцион", flag: "auction" },
            { p: "lottery", label: "🎰 Лотерея", flag: "lottery" },
            { p: "voting", label: "🗳️ Голосования", flag: "voting" },
            { p: "tasks", label: "🎯 Задания", flag: "tasks" },
            { p: "bank", label: "🏦 Банк", flag: "bank" },
          ].filter(({ flag }) => !flag || appearance.features?.[flag] !== false).map(({ p, label }) => (
            <button key={p} className={`rd-mobile-nav-btn${page === p ? " active" : ""}`} onClick={() => { setPage(p); setMobileNavOpen(false); }}>
              {label}
            </button>
          ))}
        </div>
      )}
      {page === "shop" && (() => {
        const banner = appearance.banner || {};
        const hasBg = !!banner.image;
        const title = banner.title || "Корпоративный мерч для вашей команды";
        const desc = banner.desc || "Эксклюзивные товары. Тратьте корпоративные баллы и собирайте стиль.";
        const show = banner.enabled !== false;
        if (!show) return null;
        return (
          <div className="hero-banner">
            {hasBg && <div className="hero-banner-bg" style={{backgroundImage:`url(${banner.image})`}} />}
            {hasBg && <div className="hero-banner-overlay" />}
            {!hasBg && (
              <div style={{position:"absolute",inset:0,background:"linear-gradient(135deg,#1a0a0a 0%,#2d1a1a 40%,#1a1010 100%)"}} />
            )}
            {!hasBg && (
              <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none"}}>
                <div style={{position:"absolute",width:"600px",height:"600px",borderRadius:"50%",background:"radial-gradient(circle,rgba(199,22,24,0.18) 0%,transparent 70%)",top:"-200px",right:"-100px"}} />
                <div style={{position:"absolute",width:"400px",height:"400px",borderRadius:"50%",background:"radial-gradient(circle,rgba(199,22,24,0.10) 0%,transparent 70%)",bottom:"-150px",left:"30%"}} />
              </div>
            )}
            <div className="hero-banner-content">
              <div className="hero-banner-eyebrow">Корпоративный магазин мерча</div>
              <div className="hero-banner-title">{title}</div>
              <div className="hero-banner-desc">{desc}</div>
              {banner.buttonLink && (
                <a href={banner.buttonLink} target="_blank" rel="noopener noreferrer"
                  style={{display:"inline-flex",alignItems:"center",gap:"8px",marginTop:"20px",background:"var(--rd-red)",color:"#fff",border:"none",borderRadius:"10px",padding:"0.75em 1.5em",fontWeight:700,fontSize:"clamp(13px,1.5vw,16px)",cursor:"pointer",textDecoration:"none",transition:"all 0.2s",boxShadow:"0 4px 14px rgba(199,22,24,0.4)",whiteSpace:"nowrap",width:"fit-content"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="var(--rd-red-hover)";e.currentTarget.style.transform="translateY(-1px)"}}
                  onMouseLeave={e=>{e.currentTarget.style.background="var(--rd-red)";e.currentTarget.style.transform=""}}>
                  <span>{banner.buttonText || "Подробнее"}</span>
                  <svg style={{flexShrink:0,width:"1em",height:"1em"}} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </a>
              )}
            </div>
          </div>
        );
      })()}

      <main className="page-fade" style={{flex:1}}>
        {page === "shop" && <ShopPage products={filtered} allProducts={activeProducts} categories={shopCategories} filterCat={filterCat} setFilterCat={setFilterCat} addToCart={addToCart} setPage={setPage} currentUser={currentUser} users={users} favorites={favorites} toggleFavorite={toggleFavorite} currency={appearance.currency} faq={faq} videos={videos} tasks={tasks} auctions={auctions} appearance={appearance} orders={orders} transfers={transfers} />}
        {page === "faq" && <FaqPage faq={faq} />}
        {page === "auction" && appearance.features?.auction !== false && <AuctionPage auctions={auctions} saveAuctions={saveAuctions} currentUser={currentUser} users={users} saveUsers={saveUsers} notify={notify} currency={appearance.currency} appearance={appearance} />}
        {page === "auction" && appearance.features?.auction === false && <div className="empty-state"><div className="empty-state-icon">🔨</div><div className="empty-state-text">Раздел «Аукцион» недоступен</div></div>}
        {page === "lottery" && appearance.features?.lottery !== false && <LotteryPage lotteries={lotteries} currentUser={currentUser} currency={appearance.currency} appearance={appearance} />}
        {page === "lottery" && appearance.features?.lottery === false && <div className="empty-state"><div className="empty-state-icon">🎰</div><div className="empty-state-text">Раздел «Лотерея» недоступен</div></div>}
        {page === "voting" && appearance.features?.voting !== false && <VotingPage polls={polls} savePolls={savePolls} currentUser={currentUser} users={users} saveUsers={saveUsers} notify={notify} currency={appearance.currency} appearance={appearance} />}
        {page === "voting" && appearance.features?.voting === false && <div className="empty-state"><div className="empty-state-icon">🗳️</div><div className="empty-state-text">Раздел «Голосования» недоступен</div></div>}
        {page === "bank" && appearance.features?.bank !== false && <BankPage deposits={deposits} userDeposits={userDeposits} saveUserDeposits={saveUserDeposits} currentUser={currentUser} users={users} saveUsers={saveUsers} notify={notify} currency={appearance.currency} appearance={appearance} />}
        {page === "bank" && appearance.features?.bank === false && <div className="empty-state"><div className="empty-state-icon">🏦</div><div className="empty-state-text">Раздел «Банк» недоступен</div></div>}
        {page === "tasks" && appearance.features?.tasks !== false && <TasksPage tasks={tasks} currentUser={currentUser} taskSubmissions={taskSubmissions} saveTaskSubmissions={saveTaskSubmissions} notify={notify} appearance={appearance} users={users} saveUsers={saveUsers} />}
        {page === "tasks" && appearance.features?.tasks === false && <div className="empty-state"><div className="empty-state-icon">🎯</div><div className="empty-state-text">Раздел «Задания» недоступен</div></div>}
        {page === "favorites" && currentUser && <FavoritesPage products={activeProducts.filter(p => favorites.includes(p.id))} favorites={favorites} toggleFavorite={toggleFavorite} addToCart={addToCart} setPage={setPage} />}
        {page === "history" && currentUser && <HistoryPage currentUser={currentUser} transfers={transfers} orders={orders} taskSubmissions={taskSubmissions} currency={appearance.currency} />}
        {page === "cart" && <CartPage cart={cart} removeFromCart={removeFromCart} cartTotal={cartTotal} checkout={checkout} currentUser={currentUser} setPage={setPage} users={users} currency={appearance.currency} />}
        {page === "login" && <LoginPage users={users} setCurrentUser={setCurrentUser} setPage={setPage} notify={notify} appearance={appearance} saveUsers={saveUsers} />}
        {page === "register" && <RegisterPage users={users} saveUsers={saveUsers} setCurrentUser={setCurrentUser} setPage={setPage} notify={notify} appearance={appearance} />}
        
        {page === "orders" && currentUser && <OrdersPage orders={orders.filter(o => o.user === currentUser)} currency={appearance.currency} />}
        {page === "transfer" && currentUser && <TransferPage currentUser={currentUser} users={users} saveUsers={saveUsers} transfers={transfers} saveTransfers={saveTransfers} notify={notify} setPage={setPage} currency={appearance.currency} />}
        {page === "settings" && currentUser && <SettingsPage currentUser={currentUser} users={users} saveUsers={saveUsers} notify={notify} setPage={setPage} dbConfig={dbConfig} saveDbConfig={saveDbConfig} refreshDbConfig={refreshDbConfig} pgConfig={pgConfig} savePgConfig={savePgConfigState} isPgActive={isPgActive} isAdmin={isAdmin} orders={orders} saveOrders={saveOrders} products={allProducts} saveProducts={saveProducts} categories={allCategories} saveCategories={saveCategories} appearance={appearance} saveAppearance={saveAppearance} transfers={transfers} saveTransfers={saveTransfers} markOrdersSeen={markOrdersSeen} faq={faq} saveFaq={saveFaq} videos={videos} saveVideos={saveVideos} tasks={tasks} saveTasks={saveTasks} taskSubmissions={taskSubmissions} saveTaskSubmissions={saveTaskSubmissions} auctions={auctions} saveAuctions={saveAuctions} lotteries={lotteries} saveLotteries={saveLotteries} polls={polls} savePolls={savePolls} deposits={deposits} saveDeposits={saveDeposits} userDeposits={userDeposits} saveUserDeposits={saveUserDeposits} users={users} saveUsers={saveUsers} sqliteDisabled={sqliteDisabled} setSqliteDisabled={setSqliteDisabled} />}
      </main>

      <footer className="rd-footer" style={appearance.footerBg ? {background: appearance.footerBg} : {}}>
        <div className="container">
          {/* Footer navigation - duplicate of header menu */}
          <div className="rd-footer-nav">
            {[
              { p: "shop", label: "Магазин", flag: null },
              { p: "auction", label: "Аукцион", flag: "auction" },
              { p: "lottery", label: "Лотерея", flag: "lottery" },
              { p: "voting", label: "Голосования", flag: "voting" },
              { p: "bank", label: "Банк", flag: "bank" },
              { p: "tasks", label: "Задания", flag: "tasks" },
            ].filter(({ flag }) => !flag || appearance.features?.[flag] !== false).map(({ p, label }) => (
              <button key={p} className="rd-footer-nav-btn" onClick={() => setPage(p)}>{label}</button>
            ))}
          </div>
          <div className="rd-footer-inner">
            <div className="rd-footer-logo"><img src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4NCjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+DQo8IS0tIENyZWF0b3I6IENvcmVsRFJBVyAtLT4NCjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWw6c3BhY2U9InByZXNlcnZlIiB3aWR0aD0iMTg2LjYwNW1tIiBoZWlnaHQ9IjczLjI1bW0iIHZlcnNpb249IjEuMSIgc3R5bGU9InNoYXBlLXJlbmRlcmluZzpnZW9tZXRyaWNQcmVjaXNpb247IHRleHQtcmVuZGVyaW5nOmdlb21ldHJpY1ByZWNpc2lvbjsgaW1hZ2UtcmVuZGVyaW5nOm9wdGltaXplUXVhbGl0eTsgZmlsbC1ydWxlOmV2ZW5vZGQ7IGNsaXAtcnVsZTpldmVub2RkIg0Kdmlld0JveD0iMCAwIDE4NjYwLjUyIDczMjUiDQogeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiDQogeG1sbnM6eG9kbT0iaHR0cDovL3d3dy5jb3JlbC5jb20vY29yZWxkcmF3L29kbS8yMDAzIj4NCiA8ZGVmcz4NCiAgPGZvbnQgaWQ9IkZvbnRJRDAiIGhvcml6LWFkdi14PSI3NjAiIGZvbnQtdmFyaWFudD0ibm9ybWFsIiBzdHlsZT0iZmlsbC1ydWxlOm5vbnplcm8iIGZvbnQtd2VpZ2h0PSI1MDAiPg0KCTxmb250LWZhY2UgDQoJCWZvbnQtZmFtaWx5PSJTdG9semwgTWVkaXVtIj4NCgkJPGZvbnQtZmFjZS1zcmM+DQoJCQk8Zm9udC1mYWNlLW5hbWUgbmFtZT0iU3RvbHpsLU1lZGl1bSIvPg0KCQk8L2ZvbnQtZmFjZS1zcmM+DQoJPC9mb250LWZhY2U+DQogICA8bWlzc2luZy1nbHlwaD48cGF0aCBkPSJNMCAweiIvPjwvbWlzc2luZy1nbHlwaD4NCiAgIDxnbHlwaCB1bmljb2RlPSJEIiBob3Jpei1hZHYteD0iNzMzIiBkPSJNMzI5LjAwMyA2OTkuOTk5YzEwMiwwIDE4NywtMy4yOTk2OGUrMDAxIDI1NS45OTcsLTkuOTk5NmUrMDAxIDY3Ljk5ODEsLTYuNzAwNTllKzAwMSAxMDIsLTEuNTAwMDFlKzAwMiAxMDIsLTIuNTAwMDNlKzAwMiAwLC05Ljk5OTZlKzAwMSAtMy40MDAyNGUrMDAxLC0xLjgyOTk3ZSswMDIgLTEuMDJlKzAwMiwtMi40OTk5N2UrMDAyIC02Ljg5OTY5ZSswMDEsLTYuNzAwNTllKzAwMSAtMS41Mzk5NmUrMDAyLC0xLjAwMDAzZSswMDIgLTIuNTU5OTdlKzAwMiwtMS4wMDAwM2UrMDAybC0yLjUzZSswMDIgMCAwIDY5OS45OTkgMjUzIDB6bTAgLTUuNjM5OTZlKzAwMmM2Mi45OTY5LDAgMTE0Ljk5OSwxOS45OTc4IDE1NC45OTUsNjAuMDAwMyA0MC4wMDI0LDM5Ljk5NTcgNjAuMDAwMyw5MC45OTkzIDYwLjAwMDMsMTUzLjk5NiAwLDYzLjAwMzcgLTEuOTk5NzhlKzAwMSwxMTQuMDAxIC02LjAwMDAzZSswMDEsMTU0LjAwMyAtMy45OTk1N2UrMDAxLDM5Ljk5NTcgLTkuMTk5ODJlKzAwMSw2MC4wMDAzIC0xLjU0OTk1ZSswMDIsNjAuMDAwM2wtMS4xMDAwNWUrMDAyIDAgMCAtNC4yOGUrMDAyIDExMC4wMDUgMHoiLz4NCiAgIDxnbHlwaCB1bmljb2RlPSJSIiBob3Jpei1hZHYteD0iNjgxIiBkPSJNNDc5LjAwMyAwbC0xLjgxMDA2ZSswMDIgMjUyLjAwMSAtNy44OTk5MmUrMDAxIDAgMCAtMi41MjAwMWUrMDAyIC0xLjQyOTk1ZSswMDIgMCAwIDY5OS45OTkgMzAxIDBjNzQuOTk3LDAgMTMyLjk5OSwtMS45OTk3OGUrMDAxIDE3NS45OTksLTYuMDk5OTFlKzAwMSA0Mi4wMDAyLC00LjEwMDEzZSswMDEgNjIuOTk2OSwtOS42OTk5M2UrMDAxIDYyLjk5NjksLTEuNjcwMDJlKzAwMiAwLC01LjU5OThlKzAwMSAtMS4zOTk3OGUrMDAxLC0xLjAyZSswMDIgLTQuMTAwMTNlKzAwMSwtMS4zNjk5NWUrMDAyIC0yLjY5OTY3ZSswMDEsLTMuNTAwMTNlKzAwMSAtNi42MDAwM2UrMDAxLC01LjkwMDE0ZSswMDEgLTEuMTU5OThlKzAwMiwtNy4yMDAwM2UrMDAxbDE5Ni4wMDMgLTIuNjMwMDJlKzAwMiAtMS43NTk5OWUrMDAyIDB6bS0yLjYwMDA2ZSswMDIgNTY0LjAwM2wwIC0xLjg3ZSswMDIgMTQyLjAwMyAwYzM2Ljk5OSwwIDY0LjAwMjUsNy45OTc3OSA4My4wMDE1LDI0Ljk5OSAxOC4wMDAxLDE1Ljk5NTYgMjYuOTk2NywzOC45OTY4IDI2Ljk5NjcsNjcuOTk4MSAwLDI5LjAwMTMgLTguOTk2NjdlKzAwMCw1Mi4wMDI1IC0yLjc5OTU2ZSswMDEsNjguOTk2OSAtMS45MDA1N2UrMDAxLDE3LjAwMTIgLTQuNjAwMjVlKzAwMSwyNS4wMDU3IC04LjIwMDI2ZSswMDEsMjUuMDA1N2wtMS40MjAwM2UrMDAyIDB6Ii8+DQogICA8Z2x5cGggdW5pY29kZT0iZSIgaG9yaXotYWR2LXg9IjY1MSIgZD0iTTMzMSA1NjEuOTk4YzkwLjAwMDQsMCAxNjEuMDAyLC0zLjA5OTllKzAwMSAyMTMuOTk2LC05LjI5OTdlKzAwMSA1Mi4wMDI1LC02LjE5OThlKzAwMSA3NC4wMDQ4LC0xLjM5ZSswMDIgNjcuMDA1OSwtMi4zMDk5OGUrMDAybC00LjIyZSswMDIgMGM0Ljk5NDQsLTQuMzAwNThlKzAwMSAxOS45OTc4LC03LjUwMDM3ZSswMDEgNDUuOTk1NywtOS44MDA0OWUrMDAxIDI1Ljk5NzksLTIuMzAwMTJlKzAwMSA1OC4wMDI1LC0zLjM5OTU3ZSswMDEgOTYuOTk5MywtMy4zOTk1N2UrMDAxIDI4LjAwMjQsMCA1My4wMDE0LDYuMDAwMDMgNzUuMDAzNywxOC45OTkgMjEuOTk1NiwxMi4wMDAxIDM3Ljk5NzksMjkuMDAxMyA0Ny4wMDEzLDQ5Ljk5OGwxNDcuOTk2IDBjLTEuODk5OWUrMDAxLC02LjE5OThlKzAwMSAtNS4zMDAxNGUrMDAxLC0xLjA4OTk5ZSswMDIgLTEuMDJlKzAwMiwtMS4zOTk5OGUrMDAyIC00Ljg5OTkxZSswMDEsLTMuMDk5OWUrMDAxIC0xLjAzOTk4ZSswMDIsLTQuNzAwMTNlKzAwMSAtMS42NzAwMmUrMDAyLC00LjcwMDEzZSswMDEgLTguNDk5OTNlKzAwMSwwIC0xLjU0OTk1ZSswMDIsMjYuOTk2NyAtMi4wODk5NWUrMDAyLDgwLjk5NyAtNS40MDAwMmUrMDAxLDU0LjAwMDIgLTguMTAwMzdlKzAwMSwxMjIuMDA1IC04LjEwMDM3ZSswMDEsMjA1IDAsODMuMDAxNSAyNy4wMDM1LDE1MS4wMDYgODEuMDAzNywyMDYuMDA1IDU0LjAwMDIsNTQuOTk5MSAxMjIuOTk3LDgxLjk5NTkgMjA1Ljk5OSw4MS45OTU5em0tOS45ODg4ZS0wMDEgLTEuMTc5OTZlKzAwMmMtMy40MDAyNGUrMDAxLDAgLTYuMjAwNDhlKzAwMSwtOS4wMDM0MmUrMDAwIC04LjQ5OTkzZSswMDEsLTIuNzAwMzVlKzAwMSAtMi4zMDAxMmUrMDAxLC0xLjg5OTllKzAwMSAtMy45MDAzNmUrMDAxLC00LjI5OTkxZSswMDEgLTQuODAwMDJlKzAwMSwtNy4zOTk4MWUrMDAxbDI2Mi45OTYgMGMtNy45OTc3OWUrMDAwLDMwLjk5OSAtMi4yOTk0NWUrMDAxLDU0Ljk5OTEgLTQuNTk5NTdlKzAwMSw3My45OTgxIC0yLjMwMDEyZSswMDEsMTguMDAwMSAtNS4xMDAzNmUrMDAxLDI3LjAwMzUgLTguNDAwMDRlKzAwMSwyNy4wMDM1eiIvPg0KICAgPGdseXBoIHVuaWNvZGU9ImsiIGhvcml6LWFkdi14PSI2MzMiIGQ9Ik02MTMuMDAyIDBsLTEuODMwMDRlKzAwMiAwIC0yLjI0OTk4ZSswMDIgMjQwLjAwMSAwIC0yLjQwMDAxZSswMDIgLTEuNDMwMDJlKzAwMiAwIDAgNzcwLjAwMSAxNDMuMDAyIDAgMCAtNC40OTAwM2UrMDAyIDIwOS4wMDIgMjI5IDE4MS45OTkgMCAtMi41MTAwMmUrMDAyIC0yLjYxOTk3ZSswMDIgMjY4LjAwMyAtMi44ODAwMWUrMDAyeiIvPg0KICAgPGdseXBoIHVuaWNvZGU9Im8iIGhvcml6LWFkdi14PSI2NjAiIGQ9Ik0xMjYuOTk5IDQ4MC4wMDJjNTQuOTk5MSw1NC45OTkxIDEyMy4wMDQsODEuOTk1OSAyMDMuMDAyLDgxLjk5NTkgNzkuOTk4MSwwIDE0Ny45OTYsLTIuNjk5NjdlKzAwMSAyMDQuMDAxLC04LjE5OTU5ZSswMDEgNTQuOTk5MSwtNS40OTk5MWUrMDAxIDgyLjk5NDcsLTEuMjMwMDRlKzAwMiA4Mi45OTQ3LC0yLjA1ZSswMDIgMCwtOC4zMDAxNWUrMDAxIC0yLjY5OTY3ZSswMDEsLTEuNTFlKzAwMiAtOC4xOTk1OWUrMDAxLC0yLjA1ZSswMDIgLTUuNDk5OTFlKzAwMSwtNS41MDA1OWUrMDAxIC0xLjI0MDAzZSswMDIsLTguMjAwMjZlKzAwMSAtMi4wNWUrMDAyLC04LjIwMDI2ZSswMDEgLTguMTAwMzdlKzAwMSwwIC0xLjQ4MDAzZSswMDIsMjYuOTk2NyAtMi4wMzAwMmUrMDAyLDgyLjAwMjYgLTUuNDk5OTFlKzAwMSw1NC45OTkxIC04LjMwMDE1ZSswMDEsMTIyLjk5NyAtOC4zMDAxNWUrMDAxLDIwNSAwLDgxLjk5NTkgMjguMDAyNCwxNTAuMDAxIDgzLjAwMTUsMjA1em0zMDQuMDA0IC05LjYwMDA0ZSswMDFjLTIuNzAwMzVlKzAwMSwyNy45OTU2IC02LjAwMDAzZSswMDEsNDIuMDAwMiAtMS4wMTAwMmUrMDAyLDQyLjAwMDIgLTQuMTAwMTNlKzAwMSwwIC03LjQwMDQ4ZSswMDEsLTEuNDAwNDZlKzAwMSAtMS4wMTAwMmUrMDAyLC00LjIwMDAyZSswMDEgLTIuNjk5NjdlKzAwMSwtMi44MDAyNGUrMDAxIC00LjEwMDEzZSswMDEsLTYuNDAwMjVlKzAwMSAtNC4xMDAxM2UrMDAxLC0xLjA4OTk5ZSswMDIgMCwtNC41MDAzNmUrMDAxIDE0LjAwNDYsLTguMTAwMzdlKzAwMSA0MS4wMDEzLC0xLjA4OTk5ZSswMDIgMjYuOTk2NywtMi44MDAyNGUrMDAxIDYwLjAwMDMsLTQuMjAwMDJlKzAwMSAxMDEuMDAyLC00LjIwMDAyZSswMDEgNDEuMDAxMywwIDc0Ljk5NywxMy45OTc4IDEwMiw0Mi4wMDAyIDI2Ljk5NjcsMjcuOTk1NiAzOS45OTU3LDYzLjk5NTggMzkuOTk1NywxMDguOTk5IDAsNDQuOTk2OCAtMS4zOTk3OGUrMDAxLDgwLjk5NyAtNC4wOTk0NmUrMDAxLDEwOC45OTl6Ii8+DQogICA8Z2x5cGggdW5pY29kZT0icCIgaG9yaXotYWR2LXg9IjY3MyIgZD0iTTM3OS4wMDEgNTYxLjk5OGM3MS4wMDE0LDAgMTMxLjAwMiwtMi42OTk2N2UrMDAxIDE3OS4wMDIsLTcuOTk5ODFlKzAwMSA0OC4wMDAyLC01LjQwMDAyZSswMDEgNzIuMDAwMywtMS4yMjk5N2UrMDAyIDcyLjAwMDMsLTIuMDY5OThlKzAwMiAwLC04LjQwMDA0ZSswMDEgLTIuNDAwMDFlKzAwMSwtMS41MzAwNGUrMDAyIC03LjEwMDE0ZSswMDEsLTIuMDYwMDVlKzAwMiAtNC44MDAwMmUrMDAxLC01LjQwMDAyZSswMDEgLTEuMDhlKzAwMiwtOC4wOTk3ZSswMDEgLTEuODAwMDFlKzAwMiwtOC4wOTk3ZSswMDEgLTcuMjk5OTJlKzAwMSwwIC0xLjMxMDAyZSswMDIsMjkuMDAxMyAtMS43NDAwMWUrMDAyLDg1Ljk5ODFsMCAtMy4yNDAwMWUrMDAyIC0xLjQzMDAyZSswMDIgMCAwIDgwMC4wMDEgMTQzLjAwMiAwIDAgLTcuNjk5NDdlKzAwMWM0Mi45OTkxLDU4Ljk5NDYgMTAxLjAwMiw4OC45OTQ4IDE3NC4wMDEsODguOTk0OHptLTMuMzAwMzVlKzAwMSAtNC4zNzk5NWUrMDAyYzQwLjAwMjQsMCA3My4wMDYsMTMuOTk3OCAxMDAuMDAzLDQyLjAwMDIgMjUuOTk3OSwyNy45OTU2IDM5LjAwMzYsNjMuOTk1OCAzOS4wMDM2LDEwOC45OTkgMCw0NC45OTY4IC0xLjMwMDU3ZSswMDEsODAuOTk3IC0zLjkwMDM2ZSswMDEsMTA4Ljk5OSAtMi41OTk3OWUrMDAxLDI3Ljk5NTYgLTUuOTAwMTRlKzAwMSw0Mi4wMDAyIC0xLjAwMDAzZSswMDIsNDIuMDAwMiAtNC4wOTk0NmUrMDAxLDAgLTcuMzk5ODFlKzAwMSwtMS40MDA0NmUrMDAxIC0xLjAwOTk1ZSswMDIsLTQuMjAwMDJlKzAwMSAtMi43MDAzNWUrMDAxLC0yLjgwMDI0ZSswMDEgLTQuMDAwMjRlKzAwMSwtNi40MDAyNWUrMDAxIC00LjAwMDI0ZSswMDEsLTEuMDg5OTllKzAwMiAwLC00LjUwMDM2ZSswMDEgMTIuOTk4OSwtOC4xMDAzN2UrMDAxIDQwLjAwMjQsLTEuMDg5OTllKzAwMiAyNi45OTY3LC0yLjgwMDI0ZSswMDEgNjAuMDAwMywtNC4yMDAwMmUrMDAxIDEwMC45OTUsLTQuMjAwMDJlKzAwMXoiLz4NCiAgIDxnbHlwaCB1bmljb2RlPSJzIiBob3Jpei1hZHYteD0iNTkxIiBkPSJNMzExLjAwMyAtMS4yMDAwMWUrMDAxYy03LjQwMDQ4ZSswMDEsMCAtMS4zNjAwM2UrMDAyLDE3LjAwMTIgLTEuODUwMDJlKzAwMiw1Mi4wMDI1IC00Ljg5OTkxZSswMDEsMzMuOTk1NyAtNy44OTk5MmUrMDAxLDgwLjk5NyAtOC45MDAxNWUrMDAxLDE0MC45OTdsMTQ1IDBjMTIuMDAwMSwtNC44OTk5MWUrMDAxIDU2LjAwNDgsLTcuMzk5ODFlKzAwMSAxMzIuOTk5LC03LjM5OTgxZSswMDEgNjIuMDA0OCwwIDkzLjAwMzgsMTQuOTk2NyA5My4wMDM4LDQ0Ljk5NjggMCw0LjAwMjI3IDAsOC4wMDQ1NCAtOS45ODg4ZS0wMDEsMTEuMDAxMiAtMS4wMDU2M2UrMDAwLDMuMDAzMzkgLTMuMDAzMzllKzAwMCw2LjAwMDAzIC01LjAwMTE1ZSswMDAsOS4wMDM0MiAtMy4wMDMzOWUrMDAwLDIuOTk2NjQgLTUuMDAxMTVlKzAwMCw0Ljk5NDQgLTguMDA0NTRlKzAwMCw3Ljk5Nzc5IC0yLjk5NjY0ZSswMDAsMS45OTc3NiAtNi4wMDAwM2UrMDAwLDQuMDAyMjcgLTEuMDk5NDRlKzAwMSw2LjAwMDAzIC01LjAwMTE1ZSswMDAsMS45OTc3NiAtMS4wMDAyM2UrMDAxLDQuMDAyMjcgLTEuNDAwNDZlKzAwMSw1LjAwMTE1IC0zLjk5NTUyZSswMDAsMC45OTg4OCAtOS45OTU1NWUrMDAwLDIuOTk2NjQgLTEuNzAwMTJlKzAwMSw1LjAwMTE1IC03Ljk5Nzc5ZSswMDAsMS45OTc3NiAtMS40OTk2N2UrMDAxLDMuOTk1NTIgLTEuOTk5NzhlKzAwMSw0Ljk5NDQgLTYuMDAwMDNlKzAwMCwxLjAwNTYzIC0xLjM5OTc4ZSswMDEsMy4wMDMzOSAtMi40MDAwMWUrMDAxLDUuMDAxMTUgLTEuMDAwMjNlKzAwMSwyLjAwNDUxIC0xLjg5OTllKzAwMSw0LjAwMjI3IC0yLjU5OTc5ZSswMDEsNi4wMDAwMyAtOC4yMDAyNmUrMDAxLDE4Ljk5OSAtMS4zOWUrMDAyLDQxLjAwMTMgLTEuNzEwMDRlKzAwMiw2NC4wMDI1IC0zLjI5OTY4ZSswMDEsMjMuMDAxMiAtNC44OTk5MWUrMDAxLDU2Ljk5NjkgLTQuODk5OTFlKzAwMSwxMDIuOTk5IDAsNTYuOTk2OSAyMi4wMDIzLDEwMiA2Ni4wMDAzLDEzNC45OTcgNDIuOTk5MSwzMi4wMDQ2IDEwMiw0OC4wMDAyIDE3NSw0OC4wMDAyIDcyLjk5OTIsMCAxMzAuMDAzLC0xLjU5OTU2ZSswMDEgMTcxLjAwNCwtNC43MDAxM2UrMDAxIDQwLjk5NDYsLTMuMTk5NzllKzAwMSA2Ni4wMDAzLC03LjQ5OTdlKzAwMSA3NS45OTU4LC0xLjI4OTk3ZSswMDJsLTEuNDVlKzAwMiAwYy0xLjIwMDAxZSswMDEsMzYuOTk5IC00LjgwMDAyZSswMDEsNTUuOTk4IC0xLjA3MDAyZSswMDIsNTUuOTk4IC02LjA5OTkxZSswMDEsMCAtOS4xOTk4MmUrMDAxLC0xLjQ5OTY3ZSswMDEgLTkuMTk5ODJlKzAwMSwtNC41OTk1N2UrMDAxIDAsLTEuMjAwMDFlKzAwMSA2LjAwMDAzLC0yLjEwMDM1ZSswMDEgMTguOTk5LC0yLjYwMDQ2ZSswMDEgMTMuMDA1NywtNC45OTQ0ZSswMDAgNDEuMDAxMywtMS4yOTk4OWUrMDAxIDg2LjAwNDksLTIuMjk5NDVlKzAwMSA0NC45OTY4LC0xLjAwMDIzZSswMDEgNzkuOTk4MSwtMS45MDA1N2UrMDAxIDEwNS45OTYsLTIuNzAwMzVlKzAwMSAyNi4wMDQ2LC04Ljk5NjY3ZSswMDAgNTEuMDAzNiwtMS45OTk3OGUrMDAxIDc0LjAwNDgsLTMuMjk5NjhlKzAwMSAyMi45OTQ1LC0xLjMwMDU3ZSswMDEgMzkuOTk1NywtMi45MDAxM2UrMDAxIDQ5Ljk5OCwtNC44MDAwMmUrMDAxIDkuOTk1NTUsLTEuODk5OWUrMDAxIDE0Ljk5NjcsLTQuMTAwMTNlKzAwMSAxNC45OTY3LC02LjgwMDQ4ZSswMDEgMCwtNS44OTk0NmUrMDAxIC0yLjMwMDEyZSswMDEsLTEuMDQ5OTdlKzAwMiAtNi44OTk2OWUrMDAxLC0xLjM1OTk2ZSswMDIgLTQuNjAwMjVlKzAwMSwtMy4wOTk5ZSswMDEgLTEuMDUwMDRlKzAwMiwtNC43MDAxM2UrMDAxIC0xLjc1OTk5ZSswMDIsLTQuNzAwMTNlKzAwMXoiLz4NCiAgIDxnbHlwaCB1bmljb2RlPSJ0IiBob3Jpei1hZHYteD0iNTI1IiBkPSJNNDY1Ljk5OCAxNDguMDAzbDI0LjAwMDEgLTEuMTYwMDVlKzAwMmMtMS42OTk0NWUrMDAxLC0xLjEwMDEyZSswMDEgLTMuOTk5NTdlKzAwMSwtMi4wOTk2N2UrMDAxIC03LjA5OTQ3ZSswMDEsLTMuMDAwMDFlKzAwMSAtMy4xMDA1OGUrMDAxLC05Ljk5NTU1ZSswMDAgLTYuMjAwNDhlKzAwMSwtMS4zOTk3OGUrMDAxIC05LjMwMDM4ZSswMDEsLTEuMzk5NzhlKzAwMSAtNS45MDAxNGUrMDAxLDAgLTEuMDhlKzAwMiwxOC45OTkgLTEuNDY5OTdlKzAwMiw1NS45OTggLTMuOTAwMzZlKzAwMSwzNi45OTkgLTUuOTAwMTRlKzAwMSw5My4wMDM4IC01LjkwMDE0ZSswMDEsMTY4LjAwMWwwIDIwMy4wMDIgLTkuNzk5ODJlKzAwMSAwIDAgMTM0Ljk5NyA5Ny45OTgyIDAgMCAxMTkuMDAyIDE0My4wMDIgMzAuOTk5IDAgLTEuNTAwMDFlKzAwMiAyMDQuMDAxIDAgMCAtMS4zNDk5N2UrMDAyIC0yLjA0MDAxZSswMDIgMCAwIC0xLjk0OTk4ZSswMDJjMCwtNi42MDAwM2UrMDAxIDI4Ljk5NDUsLTkuOTAwMzhlKzAwMSA4Ny45OTU5LC05LjkwMDM4ZSswMDEgMjYuMDA0NiwwIDY0LjAwMjUsOS4wMDM0MiAxMTQuOTk5LDI3LjAwMzV6Ii8+DQogICA8Z2x5cGggdW5pY29kZT0idSIgaG9yaXotYWR2LXg9IjYxNiIgZD0iTTQxNy45OTcgNTQ5Ljk5OGwxNDMuMDAyIDAgMCAtNS40OTk5OGUrMDAyIC0xLjQzMDAyZSswMDIgMCAwIDc2LjAwMjZjLTQuMjAwMDJlKzAwMSwtNS45MDAxNGUrMDAxIC05Ljg5OTcxZSswMDEsLTguODAwMjZlKzAwMSAtMS42OTk5OWUrMDAyLC04LjgwMDI2ZSswMDEgLTYuMDk5OTFlKzAwMSwwIC0xLjA4ZSswMDIsMTkuOTk3OCAtMS40MzAwMmUrMDAyLDU5LjAwMTQgLTMuNDk5NDVlKzAwMSwzOC45OTY4IC01LjI5OTQ2ZSswMDEsOTAuOTk5MyAtNS4yOTk0NmUrMDAxLDE1Ny45OThsMCAzNDQuOTk4IDE0Mi45OTUgMCAwIC0zLjEzOTk5ZSswMDJjMCwtMy42OTk5ZSswMDEgOC4wMDQ1NCwtNi41MDAxNGUrMDAxIDI0LjAwMDEsLTguNDAwMDRlKzAwMSAxNS4wMDM0LC0xLjg5OTllKzAwMSA0MS4wMDEzLC0yLjc5OTU2ZSswMDEgNzcuMDAxNSwtMi43OTk1NmUrMDAxIDM5LjAwMzYsMCA3MC4wMDI2LDEyLjAwMDEgOTAuOTk5MywzNC45OTQ1IDIxLjAwMzUsMjMuMDAxMiAzMC45OTksNTcuMDAzNiAzMC45OTksMTAybDAgMjg5eiIvPg0KICA8L2ZvbnQ+DQogIDxzdHlsZSB0eXBlPSJ0ZXh0L2NzcyI+DQogICA8IVtDREFUQVsNCiAgICBAZm9udC1mYWNlIHsgZm9udC1mYW1pbHk6IlN0b2x6bCBNZWRpdW0iO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6NTAwO3NyYzp1cmwoIiNGb250SUQwIikgZm9ybWF0KHN2Zyl9DQogICAgLmZpbDEge2ZpbGw6IzJCMkIyQX0NCiAgICAuZmlsMCB7ZmlsbDojRDEyRDJGfQ0KICAgIC5mbnQwIHtmb250LXdlaWdodDo1MDA7Zm9udC1zaXplOjE0ODEuNjZweDtmb250LWZhbWlseTonU3RvbHpsIE1lZGl1bSd9DQogICBdXT4NCiAgPC9zdHlsZT4NCiA8L2RlZnM+DQogPGcgaWQ9ItCh0LvQvtC5X3gwMDIwXzEiPg0KICA8bWV0YWRhdGEgaWQ9IkNvcmVsQ29ycElEXzBDb3JlbC1MYXllciIvPg0KICA8cGF0aCBjbGFzcz0iZmlsMCIgZD0iTTM1ODIuOTkgMTcxMy41NmwxNzI0LjA1IDBjNTEzLjYyLDAgOTMzLjg0LDQyMC4yMiA5MzMuODQsOTMzLjg0bDAgMTcyNC4wNWMwLDUxMy42MiAtNDIwLjIyLDkzMy44NCAtOTMzLjg0LDkzMy44NGwtMTcyNC4wNSAwYy01MTMuNjIsMCAtOTMzLjg0LC00MjAuMjIgLTkzMy44NCwtOTMzLjg0bDAgLTE3MjQuMDVjMCwtNTEzLjYyIDQyMC4yMiwtOTMzLjg0IDkzMy44NCwtOTMzLjg0em0yNjggMjM1MS42OWMtNzYuNjcsLTQ0LjI4IC0xNDMuODksLTEwMy4yMyAtMTk3LjgxLC0xNzMuNDYgLTUzLjg5LC03MC4yNSAtOTMuNDMsLTE1MC40MyAtMTE2LjM1LC0yMzUuOTcgLTIyLjkyLC04NS41MiAtMjguNzcsLTE3NC43NCAtMTcuMjEsLTI2Mi41MiAxMS41NSwtODcuODEgNDAuMywtMTcyLjQ1IDg0LjU4LC0yNDkuMTUgNDQuMjUsLTc2LjY4IDEwMy4yLC0xNDMuOSAxNzMuNDYsLTE5Ny43OSA3MC4yNSwtNTMuOTEgMTUwLjQzLC05My40NiAyMzUuOTcsLTExNi4zOCA4NS41MiwtMjIuOTIgMTc0Ljc0LC0yOC43NSAyNjIuNTIsLTE3LjIgODcuNzksMTEuNTcgMTcyLjQ1LDQwLjMgMjQ5LjEzLDg0LjU4bC0zMzcuMTMgNTgzLjk0IC0zMzcuMTYgNTgzLjk1em0xMDc1LjY3IC0xMzk0LjY1YzEwMi4yMyw1OS4wMiAxOTEuODcsMTM3LjYzIDI2My43MywyMzEuMjkgNzEuODgsOTMuNjYgMTI0LjYsMjAwLjU4IDE1NS4xNiwzMTQuNiAzMC41NSwxMTQuMDUgMzguMzYsMjMzLjAxIDIyLjk0LDM1MC4wNSAtMTUuNDIsMTE3LjA2IC01My43NCwyMjkuOTQgLTExMi43NSwzMzIuMTggLTU5LjA0LDEwMi4yNCAtMTM3LjYzLDE5MS44NyAtMjMxLjMxLDI2My43MyAtOTMuNjYsNzEuODggLTIwMC41NiwxMjQuNjEgLTMxNC42MSwxNTUuMTYgLTExNC4wNSwzMC41NSAtMjMyLjk4LDM4LjM2IC0zNTAuMDQsMjIuOTQgLTExNy4wNiwtMTUuNCAtMjI5LjkyLC01My43MSAtMzMyLjE4LC0xMTIuNzVsNDQ5LjUzIC03NzguNjEgNDQ5LjUzIC03NzguNTl6Ii8+DQogIDx0ZXh0IHg9IjcxNjguMTIiIHk9IjQwMTUuODUiICBjbGFzcz0iZmlsMSBmbnQwIj5SdURlc2t0b3A8L3RleHQ+DQogPC9nPg0KPC9zdmc+DQo=" alt="RuDesktop" /></div>
            <div className="rd-footer-copy">Корпоративный магазин мерча © 2025</div>
            <div className="rd-footer-version" style={{fontSize:"11px",color:"rgba(255,255,255,0.3)",marginTop:"6px"}}>{appearance.portalVersion || "Версия портала 3"}</div>
          </div>
          {/* Social icons */}
          {(() => {
            const soc = appearance.socials || {};
            const SOCIALS = [
              { key:"telegram", label:"Telegram", icon:"✈️" },
              { key:"max",      label:"MAX",       icon:"🎬" },
              { key:"vk",       label:"ВКонтакте", icon:"💙" },
              { key:"rutube",   label:"Rutube",    icon:"📺" },
              { key:"vkvideo",  label:"VK Видео",  icon:"▶️" },
            ];
            const active = SOCIALS.filter(s => soc[s.key] && soc[s.key].trim());
            if (!active.length) return null;
            return (
              <div style={{display:"flex",justifyContent:"center",gap:"16px",marginTop:"20px",paddingTop:"20px",borderTop:"1px solid rgba(255,255,255,0.1)"}}>
                {active.map(s => (
                  <a key={s.key} href={soc[s.key]} target="_blank" rel="noopener noreferrer" title={s.label}
                    style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"4px",color:"#9ca3af",textDecoration:"none",transition:"color 0.15s"}}
                    onMouseEnter={e=>{e.currentTarget.style.color="#fff"}}
                    onMouseLeave={e=>{e.currentTarget.style.color="#9ca3af"}}>
                    {(appearance.socialIcons || {})[s.key]
                      ? <img src={(appearance.socialIcons || {})[s.key]} style={{width:"24px",height:"24px",objectFit:"contain",borderRadius:"4px"}} alt={s.label} />
                      : <span style={{fontSize:"22px",lineHeight:1}}>{s.icon}</span>
                    }
                    <span style={{fontSize:"10px",fontWeight:600,letterSpacing:"0.05em"}}>{s.label}</span>
                  </a>
                ))}
              </div>
            );
          })()}
        </div>
      </footer>
    </div>
  );
}



// ── TASK COUNTDOWN ────────────────────────────────────────────────────────

function TaskCountdown({ deadline }) {
  
  const calc = () => {
    const end = new Date(deadline).getTime();
    const now = Date.now();
    const diff = end - now;
    if (diff <= 0) return null;
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return { d, h, m, s, diff };
  };
  const [time, setTime] = useState(calc);
  useEffect(() => {
    const t = setInterval(() => setTime(calc()), 1000);
    return () => clearInterval(t);
  }, [deadline]);

  if (!time) return (
    <div style={{display:"flex",alignItems:"center",gap:"6px",padding:"8px 12px",background:"#fee2e2",borderRadius:"8px",fontSize:"12px",fontWeight:700,color:"var(--rd-red)"}}>
      ⛔ Задание завершено
    </div>
  );

  const urgent = time.diff < 86400000; // less than 1 day
  const warn = time.diff < 3 * 86400000; // less than 3 days
  const bg = urgent ? "#fee2e2" : warn ? "#fffbeb" : "var(--rd-gray-bg)";
  const color = urgent ? "var(--rd-red)" : warn ? "#d97706" : "var(--rd-gray-text)";
  const icon = urgent ? "🔥" : warn ? "⏰" : "🕐";

  const pad = n => String(n).padStart(2,"0");
  const parts = time.d > 0
    ? [{ v: time.d, l: "дн" }, { v: pad(time.h), l: "ч" }, { v: pad(time.m), l: "мин" }]
    : [{ v: pad(time.h), l: "ч" }, { v: pad(time.m), l: "мин" }, { v: pad(time.s), l: "сек" }];

  return (
    <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 12px",background:bg,borderRadius:"8px",border:`1px solid ${urgent?"rgba(199,22,24,0.2)":warn?"rgba(217,119,6,0.2)":"var(--rd-gray-border)"}`}}>
      <span style={{fontSize:"14px"}}>{icon}</span>
      <span style={{fontSize:"11px",fontWeight:600,color,flexShrink:0}}>До конца:</span>
      <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
        {parts.map((p,i) => (
          <React.Fragment key={i}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
              <span style={{fontSize:"15px",fontWeight:900,color,lineHeight:1,fontVariantNumeric:"tabular-nums",fontFamily:"monospace"}}>{p.v}</span>
              <span style={{fontSize:"9px",fontWeight:600,color,opacity:0.8,lineHeight:1,marginTop:"1px"}}>{p.l}</span>
            </div>
            {i < parts.length-1 && <span style={{fontSize:"14px",fontWeight:900,color,opacity:0.6,marginBottom:"6px"}}>:</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── TASKS ─────────────────────────────────────────────────────────────────

function TaskSubmitButton({ task, currentUser, taskSubmissions, saveTaskSubmissions, notify, appearance, onClose, isShopModal }) {
  // If isShopModal, we use global window access pattern - pass real props when used standalone
  const alreadySubmitted = (taskSubmissions || []).some(s => s.taskId === task.id && s.user === currentUser && (s.status === "pending" || s.status === "approved"));

  const handleSubmit = () => {
    if (!currentUser) { if (notify) notify("Войдите в аккаунт", "err"); return; }
    if (alreadySubmitted) return;
    const submission = {
      id: Date.now(),
      taskId: task.id,
      taskTitle: task.title,
      user: currentUser,
      date: new Date().toLocaleString("ru-RU"),
      status: "pending",
      comment: "",
      reward: task.reward || 0,
    };
    const updated = [...(taskSubmissions || []), submission];
    if (saveTaskSubmissions) saveTaskSubmissions(updated);

    // Telegram notification
    try {
      const ap = storage.get("cm_appearance") || {};
      const tgEnabled = ap.integrations?.tgEnabled;
      const tgToken = ap.integrations?.tgBotToken;
      const tgChat = ap.integrations?.tgChatId;
      if (tgEnabled && tgToken && tgChat) {
        const msg = `🎯 Задание выполнено!\n👤 Пользователь: ${currentUser}\n📋 Задание: ${task.title}\n💰 Награда: ${task.reward} монет\n🕐 ${new Date().toLocaleString("ru-RU")}`;
        fetch('/api/telegram', {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ token: tgToken, chat_id: tgChat, text: msg })
        }).catch(() => {});
      }
      // Max notification
      const maxEnabled = ap.integrations?.maxEnabled;
      const maxToken = ap.integrations?.maxBotToken;
      const maxChat = ap.integrations?.maxChatId;
      if (maxEnabled && maxToken && maxChat) {
        const msg = `🎯 Задание выполнено!\n👤 Пользователь: ${currentUser}\n📋 Задание: ${task.title}\n💰 Награда: ${task.reward} монет\n🕐 ${new Date().toLocaleString("ru-RU")}`;
        fetch('/api/max', {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ token: maxToken, chat_id: maxChat, text: msg })
        }).catch(() => {});
      }
    } catch {}

    if (notify) notify("Задание отправлено на проверку ✓");
    if (onClose) onClose();
  };

  if (alreadySubmitted) {
    return <div style={{background:"var(--rd-green-light)",border:"1.5px solid rgba(5,150,105,0.2)",borderRadius:"10px",padding:"14px 18px",fontSize:"14px",fontWeight:700,color:"var(--rd-green)",display:"flex",alignItems:"center",gap:"8px"}}>✓ Задание отправлено на проверку</div>;
  }

  return (
    <button onClick={handleSubmit} style={{background:"linear-gradient(135deg,var(--rd-green) 0%,#047857 100%)",color:"#fff",border:"none",borderRadius:"12px",padding:"14px 28px",fontWeight:800,fontSize:"16px",cursor:"pointer",width:"100%",letterSpacing:"0.02em",boxShadow:"0 4px 12px rgba(5,150,105,0.3)",transition:"all 0.2s"}}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow="0 6px 18px rgba(5,150,105,0.4)"}}
      onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 4px 12px rgba(5,150,105,0.3)"}}>
      ✅ Я выполнил задание
    </button>
  );
}

function TasksPage({ tasks, currentUser, taskSubmissions, saveTaskSubmissions, notify, appearance, users, saveUsers }) {
  const [modalTask, setModalTask] = useState(null);
  const [quizState, setQuizState] = useState(null);
  const activeTasks = (tasks || []).filter(t => t.active !== false);

  const closeModal = () => { setModalTask(null); setQuizState(null); };

  const startQuiz = (task) => {
    const alreadyPassed = (taskSubmissions || []).some(s => s.taskId === task.id && s.user === currentUser && (s.status === "pending" || s.status === "approved"));
    if (alreadyPassed) { notify("Вы уже прошли этот квиз", "err"); return; }
    const maxFail = task.quizMaxFailedAttempts > 0 ? task.quizMaxFailedAttempts : null;
    if (maxFail) {
      const failedCount = (taskSubmissions || []).filter(s => s.taskId === task.id && s.user === currentUser && s.status === "rejected").length;
      if (failedCount >= maxFail) { notify("Попытки прохождения квиза исчерпаны", "err"); return; }
    }
    setModalTask(task);
    setQuizState({ answers: {}, submitted: false, score: null });
  };

  const submitQuiz = (task) => {
    if (!currentUser) { notify("Войдите в аккаунт", "err"); return; }
    const questions = task.quizQuestions || [];
    const total = questions.length;
    if (total === 0) return;
    let correct = 0;
    questions.forEach((q, i) => { if (quizState.answers[i] === q.correct) correct++; });
    const pct = Math.round((correct / total) * 100);
    const pass = pct >= (task.quizPassPct || 80);
    setQuizState(prev => ({ ...prev, submitted: true, score: pct, pass, correct, total }));
    const alreadyPassed = (taskSubmissions || []).some(s => s.taskId === task.id && s.user === currentUser && (s.status === "pending" || s.status === "approved"));
    if (alreadyPassed) return;
    if (pass) {
      const sub = { id: Date.now(), taskId: task.id, taskTitle: task.title, user: currentUser, date: new Date().toLocaleString("ru-RU"), status: "approved", comment: `Квиз пройден: ${pct}% (${correct}/${total})`, reward: task.reward || 0 };
      saveTaskSubmissions([...(taskSubmissions || []), sub]);
      saveUsers({ ...users, [currentUser]: { ...users[currentUser], balance: (users[currentUser]?.balance || 0) + (task.reward || 0) } });
      notify(`🎉 Квиз пройден! +${task.reward} монет`);
    } else {
      const sub = { id: Date.now(), taskId: task.id, taskTitle: task.title, user: currentUser, date: new Date().toLocaleString("ru-RU"), status: "rejected", comment: `Квиз не пройден: ${pct}% (нужно ${task.quizPassPct || 80}%)`, reward: 0 };
      saveTaskSubmissions([...(taskSubmissions || []), sub]);
      const maxFail = task.quizMaxFailedAttempts > 0 ? task.quizMaxFailedAttempts : null;
      if (maxFail) {
        const failedCount = (taskSubmissions || []).filter(s => s.taskId === task.id && s.user === currentUser && s.status === "rejected").length + 1;
        const remaining = maxFail - failedCount;
        if (remaining <= 0) {
          notify(`Квиз не пройден: ${pct}%. Попытки исчерпаны!`, "err");
        } else {
          notify(`Квиз не пройден: ${pct}%. Осталось попыток: ${remaining}`, "err");
        }
      } else {
        notify(`Квиз не пройден: ${pct}%. Нужно ${task.quizPassPct || 80}%`, "err");
      }
    }
  };

  const SubmitBtn = ({ task }) => {
    const alreadySubmitted = (taskSubmissions || []).some(s => s.taskId === task.id && s.user === currentUser && (s.status === "pending" || s.status === "approved"));
    const handleSubmit = () => {
      if (!currentUser) { notify("Войдите в аккаунт", "err"); return; }
      if (alreadySubmitted) return;
      const submission = { id: Date.now(), taskId: task.id, taskTitle: task.title, user: currentUser, date: new Date().toLocaleString("ru-RU"), status: "pending", comment: "", reward: task.reward || 0 };
      saveTaskSubmissions([...(taskSubmissions || []), submission]);
      try {
        const ap = appearance || {};
        if (ap.integrations?.tgEnabled && ap.integrations?.tgBotToken && ap.integrations?.tgChatId) {
          const msg = `🎯 Задание выполнено!\n👤 Пользователь: ${currentUser}\n📋 Задание: ${task.title}\n💰 Награда: ${task.reward} монет`;
          fetch('/api/telegram', { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ token: ap.integrations.tgBotToken, chat_id: ap.integrations.tgChatId, text: msg }) }).catch(() => {});
        }
        if (ap.integrations?.maxEnabled && ap.integrations?.maxBotToken && ap.integrations?.maxChatId) {
          const msg = `🎯 Задание выполнено!\n👤 Пользователь: ${currentUser}\n📋 Задание: ${task.title}\n💰 Награда: ${task.reward} монет`;
          fetch('/api/max', { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ token: ap.integrations.maxBotToken, chat_id: ap.integrations.maxChatId, text: msg }) }).catch(() => {});
        }
      } catch {}
      notify("Задание отправлено на проверку ✓");
      closeModal();
    };
    if (alreadySubmitted) return <div style={{background:"var(--rd-green-light)",border:"1.5px solid rgba(5,150,105,0.2)",borderRadius:"10px",padding:"14px 18px",fontSize:"14px",fontWeight:700,color:"var(--rd-green)"}}>✓ Задание отправлено на проверку</div>;
    return <button onClick={handleSubmit} style={{background:"linear-gradient(135deg,var(--rd-green) 0%,#047857 100%)",color:"#fff",border:"none",borderRadius:"12px",padding:"14px 28px",fontWeight:800,fontSize:"16px",cursor:"pointer",width:"100%",boxShadow:"0 4px 12px rgba(5,150,105,0.3)",transition:"all 0.2s"}} onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)"}} onMouseLeave={e=>{e.currentTarget.style.transform=""}}>✅ Я выполнил задание</button>;
  };

  const mySubmissions = (taskSubmissions || []).filter(s => s.user === currentUser);

  const sectionSettings = appearance?.sectionSettings?.tasks || {};
  const tasksTitle = sectionSettings.title || "Задания";
  const tasksDescription = sectionSettings.description || "Выполняйте задания и получайте монеты";
  const tasksBannerImage = sectionSettings.banner || "";

  return (
    <div style={{minHeight:"60vh"}}>
      {tasksBannerImage ? (
        <div className="section-banner-wrap">
          <div className="hero-banner">
            <div className="hero-banner-bg" style={{backgroundImage:`url(${tasksBannerImage})`}} />
            <div className="hero-banner-overlay" />
            <div className="hero-banner-content" style={{padding:"48px 24px"}}>
              <h1 className="hero-banner-title" style={{fontSize:"clamp(26px,5vw,40px)",marginBottom:"12px"}}>{tasksTitle}</h1>
              <p className="hero-banner-desc">{tasksDescription}</p>
            </div>
          </div>
          {activeTasks.length > 0 && (
            <div className="section-banner-stats-overlay">
              <div className="section-banner-stat">
                <div className="section-banner-stat-num" style={{color:"#ff6b6b"}}>{activeTasks.length}</div>
                <div className="section-banner-stat-label">Активных</div>
              </div>
              <div className="section-banner-stat">
                <div className="section-banner-stat-num" style={{color:"#fff"}}>{mySubmissions.filter(s=>s.status==="approved").length}</div>
                <div className="section-banner-stat-label">Выполнено</div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{background:"#fff",borderBottom:"1.5px solid var(--rd-gray-border)",padding:"40px 0 32px"}}>
          <div className="container">
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"12px"}}>
              <div>
                <h1 style={{fontSize:"clamp(26px,5vw,40px)",fontWeight:900,color:"var(--rd-dark)",letterSpacing:"-0.02em"}}>{tasksTitle}</h1>
                <p style={{fontSize:"15px",color:"var(--rd-gray-text)",marginTop:"6px"}}>{tasksDescription}</p>
              </div>
              {activeTasks.length > 0 && (
                <div style={{display:"flex",gap:"16px",flexWrap:"wrap"}}>
                  <div style={{textAlign:"center",background:"var(--rd-gray-bg)",borderRadius:"12px",padding:"12px 20px"}}>
                    <div style={{fontSize:"22px",fontWeight:900,color:"var(--rd-red)"}}>{activeTasks.length}</div>
                    <div style={{fontSize:"11px",color:"var(--rd-gray-text)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Активных</div>
                  </div>
                  {mySubmissions.length > 0 && (
                    <div style={{textAlign:"center",background:"var(--rd-gray-bg)",borderRadius:"12px",padding:"12px 20px"}}>
                      <div style={{fontSize:"22px",fontWeight:900,color:"var(--rd-dark)"}}>{mySubmissions.filter(s=>s.status==="approved").length}</div>
                      <div style={{fontSize:"11px",color:"var(--rd-gray-text)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Выполнено</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="container auction-page">
      {activeTasks.length === 0 ? (
        <div className="empty-state"><div className="empty-state-icon">🎯</div><div className="empty-state-text">Заданий пока нет — следите за обновлениями</div></div>
      ) : (
        <>
        <div style={{fontSize:"13px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--rd-gray-text)",marginBottom:"16px"}}>Активные задания</div>
        <div className="auction-grid" style={{marginBottom:"40px"}}>
          {activeTasks.map(task => {
            const submitted = (taskSubmissions || []).some(s => s.taskId === task.id && s.user === currentUser && (s.status === "pending" || s.status === "approved"));
            const isQuiz = task.taskType === "quiz";
            const failedAttempts = isQuiz ? (taskSubmissions || []).filter(s => s.taskId === task.id && s.user === currentUser && s.status === "rejected").length : 0;
            const maxFail = isQuiz && task.quizMaxFailedAttempts > 0 ? task.quizMaxFailedAttempts : null;
            const attemptsExhausted = isQuiz && maxFail !== null && failedAttempts >= maxFail;
            const quizBlocked = isQuiz && (submitted || attemptsExhausted);
            return (
              <div key={task.id} style={{borderRadius:"var(--rd-radius)",overflow:"hidden",boxShadow:"var(--rd-shadow-md)",background:"#fff",border:"1.5px solid var(--rd-gray-border)",display:"flex",flexDirection:"column",transition:"box-shadow 0.2s"}}
                onMouseEnter={e=>e.currentTarget.style.boxShadow="var(--rd-shadow-lg)"}
                onMouseLeave={e=>e.currentTarget.style.boxShadow="var(--rd-shadow-md)"}>
                <div style={{position:"relative",height:"200px",background:task.image?`url('${task.image}') center/cover no-repeat`:"linear-gradient(135deg,var(--rd-red) 0%,#a51214 100%)",display:"flex",alignItems:"flex-end",padding:"24px"}}>
                  <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,0.7) 0%,rgba(0,0,0,0.1) 60%)"}} />
                  <div style={{position:"relative",zIndex:1}}>
                    {task.bannerText && <div style={{fontSize:"12px",fontWeight:700,color:"rgba(255,255,255,0.8)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:"6px"}}>{task.bannerText}</div>}
                    <div style={{fontSize:"22px",fontWeight:900,color:"#fff",lineHeight:1.2}}>{task.title}</div>
                  </div>
                  <div style={{position:"absolute",top:"16px",right:"16px",zIndex:1,background:"rgba(0,0,0,0.4)",backdropFilter:"blur(8px)",border:"1.5px solid rgba(255,255,255,0.25)",borderRadius:"14px",padding:"10px 16px",textAlign:"center"}}>
                    <div style={{fontSize:"28px",fontWeight:900,color:"#fff",lineHeight:1}}>{task.reward}</div>
                    <div style={{fontSize:"11px",fontWeight:700,color:"rgba(255,255,255,0.85)"}}>монет</div>
                  </div>
                  {isQuiz && <div style={{position:"absolute",bottom:"56px",right:"16px",zIndex:1,background:"rgba(37,99,235,0.85)",color:"#fff",borderRadius:"8px",padding:"4px 10px",fontSize:"11px",fontWeight:800}}>📝 Квиз</div>}
                  {submitted && <div style={{position:"absolute",top:"16px",left:"16px",zIndex:1,background:"var(--rd-green)",color:"#fff",borderRadius:"8px",padding:"4px 10px",fontSize:"11px",fontWeight:800}}>✓ Выполнено</div>}
                  {attemptsExhausted && !submitted && <div style={{position:"absolute",top:"16px",left:"16px",zIndex:1,background:"#6b7280",color:"#fff",borderRadius:"8px",padding:"4px 10px",fontSize:"11px",fontWeight:800}}>🚫 Попытки исчерпаны</div>}
                </div>
                <div style={{padding:"20px 22px",flex:1,display:"flex",flexDirection:"column",gap:"14px"}}>
                  <p style={{fontSize:"14px",color:"var(--rd-gray-text)",lineHeight:1.6,flex:1}}>{task.shortDesc || (task.description || "").substring(0,120) + ((task.description||"").length > 120 ? "…" : "")}</p>
                  {task.deadline && <TaskCountdown deadline={task.deadline} />}
                  {isQuiz && maxFail !== null && !submitted && (
                    <div style={{fontSize:"12px",color:attemptsExhausted?"var(--rd-red)":"var(--rd-gray-text)",fontWeight:600}}>
                      {attemptsExhausted ? "Попытки исчерпаны" : `Неудачных попыток: ${failedAttempts} / ${maxFail}`}
                    </div>
                  )}
                  <button onClick={() => !quizBlocked && (isQuiz ? startQuiz(task) : setModalTask(task))}
                    disabled={quizBlocked}
                    style={{background:quizBlocked?(submitted?"var(--rd-green)":"#9ca3af"):"var(--rd-red)",color:"#fff",border:"none",borderRadius:"10px",padding:"11px 20px",fontWeight:700,fontSize:"14px",cursor:quizBlocked?"default":"pointer",transition:"background 0.2s",opacity:1}}
                    onMouseEnter={e=>{if(!quizBlocked)e.currentTarget.style.background="var(--rd-red-hover)"}}
                    onMouseLeave={e=>{if(!quizBlocked)e.currentTarget.style.background="var(--rd-red)"}}>
                    {isQuiz ? (submitted ? "✓ Квиз пройден" : attemptsExhausted ? "🚫 Попытки исчерпаны" : "📝 Пройти квиз →") : "Подробнее →"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}

      {currentUser && mySubmissions.length > 0 && (
        <div style={{marginTop:"32px"}}>
          <h3 style={{fontSize:"20px",fontWeight:800,color:"var(--rd-dark)",marginBottom:"16px"}}>История моих заданий</h3>
          <div style={{background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius)",overflow:"hidden",boxShadow:"var(--rd-shadow)"}}>
            {mySubmissions.slice().reverse().map((s, i) => {
              const cfg = { pending:{label:"На проверке",bg:"#fffbeb",color:"#d97706",icon:"⏳"}, approved:{label:"Выполнено",bg:"var(--rd-green-light)",color:"var(--rd-green)",icon:"✅"}, rejected:{label:"Не выполнено",bg:"#fee2e2",color:"var(--rd-red)",icon:"❌"} }[s.status] || {label:s.status,bg:"#f3f4f6",color:"#6b7280",icon:"❓"};
              return (
                <div key={s.id} style={{display:"flex",alignItems:"flex-start",gap:"16px",padding:"18px 24px",borderBottom:i<mySubmissions.length-1?"1px solid var(--rd-gray-border)":"none"}}>
                  <div style={{fontSize:"24px",flexShrink:0,marginTop:"2px"}}>{cfg.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)",marginBottom:"4px"}}>{s.taskTitle}</div>
                    <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginBottom:"6px"}}>{s.date}</div>
                    {s.comment && <div style={{fontSize:"13px",background:"var(--rd-gray-bg)",border:"1px solid var(--rd-gray-border)",borderRadius:"8px",padding:"10px 14px",color:"var(--rd-dark)",lineHeight:1.5}}>💬 {s.comment}</div>}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:"6px",flexShrink:0}}>
                    <div style={{background:cfg.bg,color:cfg.color,borderRadius:"8px",padding:"4px 10px",fontSize:"12px",fontWeight:700}}>{cfg.label}</div>
                    {s.status === "approved" && <div style={{fontSize:"13px",fontWeight:800,color:"var(--rd-green)"}}>+{s.reward} монет</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>

      {/* Regular task modal */}
      {modalTask && !quizState && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}} onClick={closeModal}>
          <div style={{background:"#fff",borderRadius:"var(--rd-radius)",maxWidth:"560px",width:"100%",maxHeight:"90vh",overflow:"auto",boxShadow:"var(--rd-shadow-lg)"}} onClick={e=>e.stopPropagation()}>
            {modalTask.image && <div style={{height:"220px",background:`url('${modalTask.image}') center/cover no-repeat`,borderRadius:"var(--rd-radius) var(--rd-radius) 0 0",position:"relative"}}><div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,0.4) 0%,transparent 60%)",borderRadius:"var(--rd-radius) var(--rd-radius) 0 0"}} /></div>}
            <div style={{padding:"28px"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"16px",marginBottom:"12px"}}>
                <h3 style={{fontSize:"22px",fontWeight:900,color:"var(--rd-dark)",lineHeight:1.3}}>{modalTask.title}</h3>
                <button onClick={closeModal} style={{background:"none",border:"none",fontSize:"24px",cursor:"pointer",color:"var(--rd-gray-text)",flexShrink:0}}>×</button>
              </div>
              <div style={{display:"inline-flex",alignItems:"center",gap:"10px",background:"var(--rd-red-light)",border:"1.5px solid rgba(199,22,24,0.2)",borderRadius:"12px",padding:"10px 18px",marginBottom:"20px"}}>
                <span style={{fontSize:"32px",fontWeight:900,color:"var(--rd-red)",lineHeight:1}}>{modalTask.reward}</span>
                <span style={{fontSize:"15px",fontWeight:700,color:"var(--rd-red)"}}>монет за выполнение</span>
              </div>
              <div style={{fontSize:"15px",color:"var(--rd-dark)",lineHeight:1.75,marginBottom:"16px",whiteSpace:"pre-wrap"}}>{modalTask.description}</div>
              {modalTask.deadline && <div style={{marginBottom:"20px"}}><TaskCountdown deadline={modalTask.deadline} /></div>}
              {currentUser ? <SubmitBtn task={modalTask} /> : <div style={{background:"var(--rd-gray-bg)",borderRadius:"10px",padding:"14px 18px",fontSize:"14px",color:"var(--rd-gray-text)",fontWeight:600,textAlign:"center"}}>Войдите в аккаунт, чтобы выполнить задание</div>}
            </div>
          </div>
        </div>
      )}

      {/* Quiz modal */}
      {modalTask && quizState && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
          <div style={{background:"#fff",borderRadius:"var(--rd-radius)",maxWidth:"600px",width:"100%",maxHeight:"90vh",overflow:"auto",boxShadow:"var(--rd-shadow-lg)"}} onClick={e=>e.stopPropagation()}>
            <div style={{background:"linear-gradient(135deg,var(--rd-red) 0%,#a51214 100%)",borderRadius:"var(--rd-radius) var(--rd-radius) 0 0",padding:"24px 28px",position:"relative"}}>
              {modalTask.image && <div style={{position:"absolute",inset:0,background:`url('${modalTask.image}') center/cover no-repeat`,borderRadius:"var(--rd-radius) var(--rd-radius) 0 0",opacity:0.25}} />}
              <div style={{position:"relative",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"12px"}}>
                <div>
                  <div style={{fontSize:"12px",fontWeight:700,color:"rgba(255,255,255,0.75)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:"6px"}}>📝 Квиз</div>
                  <div style={{fontSize:"22px",fontWeight:900,color:"#fff",lineHeight:1.2}}>{modalTask.title}</div>
                  <div style={{fontSize:"13px",color:"rgba(255,255,255,0.8)",marginTop:"8px"}}>Нужно правильных: {modalTask.quizPassPct||80}% · Награда: {modalTask.reward} монет</div>
                </div>
                <button onClick={closeModal} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:"8px",width:"32px",height:"32px",cursor:"pointer",color:"#fff",fontSize:"18px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
              </div>
            </div>
            <div style={{padding:"28px"}}>
              {(taskSubmissions||[]).some(s=>s.taskId===modalTask.id&&s.user===currentUser&&(s.status==="pending"||s.status==="approved")) && !quizState.submitted && (
                <div style={{background:"var(--rd-green-light)",border:"1.5px solid rgba(5,150,105,0.2)",borderRadius:"10px",padding:"16px 20px",fontSize:"14px",fontWeight:700,color:"var(--rd-green)",marginBottom:"20px",textAlign:"center"}}>✓ Вы уже прошли этот квиз</div>
              )}
              {quizState.submitted ? (
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:"64px",marginBottom:"16px"}}>{quizState.pass?"🎉":"😔"}</div>
                  <div style={{fontSize:"28px",fontWeight:900,color:quizState.pass?"var(--rd-green)":"var(--rd-red)",marginBottom:"8px"}}>{quizState.pass?"Квиз пройден!":"Квиз не пройден"}</div>
                  <div style={{fontSize:"48px",fontWeight:900,color:"var(--rd-dark)",marginBottom:"4px"}}>{quizState.score}%</div>
                  <div style={{fontSize:"15px",color:"var(--rd-gray-text)",marginBottom:"24px"}}>Правильных: {quizState.correct} из {quizState.total} · Нужно: {modalTask.quizPassPct||80}%</div>
                  {quizState.pass && <div style={{background:"var(--rd-green-light)",border:"1.5px solid rgba(5,150,105,0.2)",borderRadius:"12px",padding:"16px 24px",fontSize:"18px",fontWeight:800,color:"var(--rd-green)",marginBottom:"20px"}}>+{modalTask.reward} монет зачислено! 🎊</div>}
                  <button onClick={closeModal} className="btn btn-primary" style={{minWidth:"160px"}}>Закрыть</button>
                </div>
              ) : (
                <div>
                  {(modalTask.quizQuestions||[]).map((q, qi) => (
                    <div key={qi} style={{marginBottom:"24px"}}>
                      <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)",marginBottom:"12px",display:"flex",gap:"10px",alignItems:"flex-start"}}>
                        <span style={{flexShrink:0,width:"26px",height:"26px",borderRadius:"50%",background:"var(--rd-red)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",fontWeight:800}}>{qi+1}</span>
                        {q.question}
                      </div>
                      {q.image && <div style={{paddingLeft:"36px",marginBottom:"10px"}}><img src={q.image} alt="" style={{maxHeight:"200px",maxWidth:"100%",borderRadius:"10px",border:"1.5px solid var(--rd-gray-border)"}} /></div>}
                      <div style={{display:"flex",flexDirection:"column",gap:"8px",paddingLeft:"36px"}}>
                        {(q.options||[]).map((opt, oi) => {
                          const selected = quizState.answers[qi] === oi;
                          return (
                            <button key={oi} onClick={()=>setQuizState(prev=>({...prev,answers:{...prev.answers,[qi]:oi}}))}
                              style={{display:"flex",alignItems:"center",gap:"12px",padding:"12px 16px",border:`2px solid ${selected?"var(--rd-red)":"var(--rd-gray-border)"}`,borderRadius:"10px",background:selected?"var(--rd-red-light)":"#fff",cursor:"pointer",textAlign:"left",transition:"all 0.15s",fontWeight:selected?700:400,color:selected?"var(--rd-red)":"var(--rd-dark)"}}>
                              <span style={{width:"20px",height:"20px",borderRadius:"50%",border:`2px solid ${selected?"var(--rd-red)":"var(--rd-gray-border)"}`,background:selected?"var(--rd-red)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                                {selected && <span style={{width:"8px",height:"8px",borderRadius:"50%",background:"#fff",display:"block"}} />}
                              </span>
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {(modalTask.quizQuestions||[]).length === 0 && <div style={{textAlign:"center",color:"var(--rd-gray-text)",padding:"32px"}}>Вопросы ещё не добавлены</div>}
                  <div style={{display:"flex",gap:"12px",marginTop:"8px",alignItems:"center",justifyContent:"space-between"}}>
                    <div style={{fontSize:"13px",color:"var(--rd-gray-text)"}}>Отвечено: {Object.keys(quizState.answers).length} / {(modalTask.quizQuestions||[]).length}</div>
                    <button onClick={()=>submitQuiz(modalTask)} className="btn btn-primary"
                      disabled={Object.keys(quizState.answers).length < (modalTask.quizQuestions||[]).length}
                      style={{opacity:Object.keys(quizState.answers).length < (modalTask.quizQuestions||[]).length?0.5:1}}>
                      Отправить ответы ✓
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function TasksAdminTab({ tasks, saveTasks, taskSubmissions, saveTaskSubmissions, notify, users, saveUsers }) {
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ title:"", bannerText:"", shortDesc:"", description:"", reward:100, image:"", active:true, deadline:"", taskType:"regular", quizPassPct:80, quizMaxFailedAttempts:0, quizQuestions:[] });
  const [imgPreview, setImgPreview] = useState("");
  const [commentInputs, setCommentInputs] = useState({});
  const [taskSearch, setTaskSearch] = useState("");
  const [taskSort, setTaskSort] = useState("newest");

  const taskList = tasks || [];

  const emptyForm = { title:"", bannerText:"", shortDesc:"", description:"", reward:100, image:"", active:true, deadline:"", taskType:"regular", quizPassPct:80, quizMaxFailedAttempts:0, quizQuestions:[] };
  const startNew = () => { setEditId("new"); setForm(emptyForm); setImgPreview(""); };
  const startEdit = (task) => {
    setEditId(task.id);
    setForm({ title:task.title||"", bannerText:task.bannerText||"", shortDesc:task.shortDesc||"", description:task.description||"", reward:task.reward||100, image:task.image||"", active:task.active!==false, deadline:task.deadline||"", taskType:task.taskType||"regular", quizPassPct:task.quizPassPct||80, quizMaxFailedAttempts:task.quizMaxFailedAttempts||0, quizQuestions:task.quizQuestions||[] });
    setImgPreview(task.image||"");
  };
  const cancel = () => { setEditId(null); };

  const save = () => {
    if (!form.title.trim()) { notify("Введите название задания","err"); return; }
    if (editId === "new") {
      saveTasks([...taskList, { ...form, id: Date.now(), title:form.title.trim() }]);
      notify("Задание добавлено ✓");
    } else {
      saveTasks(taskList.map(t => t.id === editId ? { ...t, ...form, title:form.title.trim() } : t));
      notify("Задание сохранено ✓");
    }
    setEditId(null);
  };

  const deleteTask = (id) => {
    if (!confirm("Удалить задание?")) return;
    saveTasks(taskList.filter(t => t.id !== id));
    notify("Задание удалено");
  };

  const handleImg = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target.result, 1200, 800, 0.85, 250);
      setForm(f => ({...f, image: compressed}));
      setImgPreview(compressed);
    };
    reader.readAsDataURL(file);
  };

  const allSubmissions = taskSubmissions || [];

  const setSubmissionStatus = (subId, status) => {
    const sub = allSubmissions.find(s => s.id === subId);
    if (!sub) return;
    // Preserve current comment input if exists
    const updatedSub = {...sub, status, comment: commentInputs[subId] !== undefined ? commentInputs[subId] : sub.comment};
    const updated = allSubmissions.map(s => s.id === subId ? updatedSub : s);
    saveTaskSubmissions(updated);

    // If approved, credit user balance (only once)
    if (status === "approved" && sub.status !== "approved") {
      const currentUsers = users || {};
      if (currentUsers[sub.user]) {
        const updatedUsers = {...currentUsers, [sub.user]: {...currentUsers[sub.user], balance: (currentUsers[sub.user].balance || 0) + (sub.reward || 0)}};
        saveUsers(updatedUsers);
        notify(`✅ ${sub.reward} монет начислено пользователю ${sub.user}`);
      } else {
        notify("Статус: Выполнено");
      }
    } else if (status === "rejected") {
      notify("Статус: Не выполнено");
    } else if (status === "pending") {
      notify("Статус: На проверке");
    }
  };

  const updateComment = (subId, val) => setCommentInputs(prev => ({...prev, [subId]: val}));
  const saveComment = (subId) => {
    const updated = allSubmissions.map(s => s.id === subId ? {...s, comment: commentInputs[subId] || ""} : s);
    saveTaskSubmissions(updated);
    notify("Комментарий сохранён ✓");
  };

  const statusCfg = {
    pending:  { label:"На проверке", bg:"#fffbeb", color:"#d97706" },
    approved: { label:"Выполнено",   bg:"var(--rd-green-light)", color:"var(--rd-green)" },
    rejected: { label:"Не выполнено", bg:"#fee2e2", color:"var(--rd-red)" },
  };

  return (
    <div>
      {/* Task list header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"20px"}}>
        <div style={{fontWeight:700,fontSize:"18px",color:"var(--rd-dark)"}}>{editId === "new" ? "➕ Новое задание" : `Задания (${taskList.length})`}</div>
        {!editId && <button className="btn btn-primary btn-sm" onClick={startNew}>+ Новое задание</button>}
        {editId && <button className="btn btn-ghost btn-sm" onClick={cancel}>← Назад</button>}
      </div>

      {editId && (
        <div className="product-form-card" style={{marginBottom:"24px"}}>
          <div className="product-form-title">{editId === "new" ? "➕ Новое задание" : "✏️ Редактирование"}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>
            <div className="form-field" style={{gridColumn:"1/-1"}}>
              <label className="form-label">Название задания *</label>
              <input className="form-input" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Например: Пройди обучение" />
            </div>
            <div className="form-field">
              <label className="form-label">Текст на баннере</label>
              <input className="form-input" value={form.bannerText} onChange={e=>setForm(f=>({...f,bannerText:e.target.value}))} placeholder="Задание недели" />
            </div>
            <div className="form-field">
              <label className="form-label">Награда (монет)</label>
              <input className="form-input" type="number" min="1" value={form.reward} onChange={e=>setForm(f=>({...f,reward:parseInt(e.target.value)||0}))} />
            </div>
            <div className="form-field" style={{gridColumn:"1/-1"}}>
              <label className="form-label">Краткое описание (для карточки)</label>
              <input className="form-input" value={form.shortDesc} onChange={e=>setForm(f=>({...f,shortDesc:e.target.value}))} placeholder="1-2 предложения о задании" />
            </div>
            <div className="form-field" style={{gridColumn:"1/-1"}}>
              <label className="form-label">Полное описание (в модальном окне)</label>
              <textarea className="form-input" rows="5" style={{resize:"vertical"}} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Подробные условия выполнения задания…" />
            </div>
            <div className="form-field" style={{gridColumn:"1/-1"}}>
              <label className="form-label">Изображение</label>
              <input type="file" accept="image/*" onChange={handleImg} style={{display:"none"}} id="task-img-upload" />
              <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
                <label htmlFor="task-img-upload" style={{cursor:"pointer",padding:"8px 16px",background:"var(--rd-gray-bg)",border:"1.5px solid var(--rd-gray-border)",borderRadius:"8px",fontSize:"13px",fontWeight:600,color:"var(--rd-dark)"}}>📷 Загрузить</label>
                {imgPreview && <div style={{width:"60px",height:"40px",borderRadius:"6px",overflow:"hidden",border:"1px solid var(--rd-gray-border)"}}><img src={imgPreview} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" /></div>}
                {imgPreview && <button onClick={() => {setImgPreview(""); setForm(f=>({...f,image:""}));}} style={{background:"none",border:"none",cursor:"pointer",color:"var(--rd-red)",fontSize:"12px",fontWeight:600}}>✕ Удалить</button>}
              </div>
            </div>
            <div className="form-field" style={{gridColumn:"1/-1"}}>
              <label className="form-label">📅 Дата окончания задания</label>
              <input type="datetime-local" className="form-input" value={form.deadline} onChange={e=>setForm(f=>({...f,deadline:e.target.value}))}
                style={{fontFamily:"inherit"}} />
              {form.deadline && <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"4px"}}>Таймер будет показан пользователям на карточке</div>}
            </div>
            <div className="form-field" style={{gridColumn:"1/-1"}}>
              <label style={{display:"flex",alignItems:"center",gap:"8px",cursor:"pointer",fontSize:"14px",fontWeight:600}}>
                <input type="checkbox" checked={form.active} onChange={e=>setForm(f=>({...f,active:e.target.checked}))} style={{width:"16px",height:"16px"}} />
                Активно (показывать пользователям)
              </label>
            </div>

            {/* Task type */}
            <div className="form-field" style={{gridColumn:"1/-1"}}>
              <label className="form-label">Тип задания</label>
              <div style={{display:"flex",gap:"10px"}}>
                {[{v:"regular",l:"📋 Обычное",d:"Пользователь отправляет на проверку"},{v:"quiz",l:"📝 Квиз",d:"Автоматическая проверка по вопросам"}].map(opt => (
                  <button key={opt.v} onClick={()=>setForm(f=>({...f,taskType:opt.v}))}
                    style={{flex:1,padding:"12px 16px",border:`2px solid ${form.taskType===opt.v?"var(--rd-red)":"var(--rd-gray-border)"}`,borderRadius:"10px",background:form.taskType===opt.v?"var(--rd-red-light)":"#fff",cursor:"pointer",textAlign:"left",transition:"all 0.15s"}}>
                    <div style={{fontWeight:700,fontSize:"14px",color:form.taskType===opt.v?"var(--rd-red)":"var(--rd-dark)"}}>{opt.l}</div>
                    <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"2px"}}>{opt.d}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Quiz builder */}
            {form.taskType === "quiz" && (
              <div style={{gridColumn:"1/-1",background:"var(--rd-gray-bg)",borderRadius:"12px",padding:"20px",border:"1.5px solid var(--rd-gray-border)"}}>
                <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)",marginBottom:"16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span>📝 Вопросы квиза</span>
                  <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
                    <label style={{display:"flex",alignItems:"center",gap:"6px",fontSize:"13px",fontWeight:600,cursor:"pointer"}}>
                      Порог прохождения:
                      <input type="number" min="1" max="100" value={form.quizPassPct}
                        onChange={e=>setForm(f=>({...f,quizPassPct:Math.min(100,Math.max(1,parseInt(e.target.value)||80))}))}
                        style={{width:"64px",padding:"4px 8px",border:"1.5px solid var(--rd-gray-border)",borderRadius:"6px",fontSize:"14px",fontWeight:700,color:"var(--rd-red)",textAlign:"center"}} />
                      <span style={{fontSize:"13px",color:"var(--rd-gray-text)"}}>%</span>
                    </label>
                    <label style={{display:"flex",alignItems:"center",gap:"6px",fontSize:"13px",fontWeight:600,cursor:"pointer",borderLeft:"1.5px solid var(--rd-gray-border)",paddingLeft:"12px"}}>
                      Макс. неудачных попыток:
                      <input type="number" min="0" max="99" value={form.quizMaxFailedAttempts}
                        onChange={e=>setForm(f=>({...f,quizMaxFailedAttempts:Math.max(0,parseInt(e.target.value)||0)}))}
                        style={{width:"56px",padding:"4px 8px",border:"1.5px solid var(--rd-gray-border)",borderRadius:"6px",fontSize:"14px",fontWeight:700,color:"var(--rd-blue)",textAlign:"center"}} />
                      <span style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>(0 = без лимита)</span>
                    </label>
                  </div>
                </div>

                {(form.quizQuestions||[]).map((q, qi) => (
                  <div key={qi} style={{background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"10px",padding:"16px",marginBottom:"12px"}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:"10px",marginBottom:"12px"}}>
                      <span style={{flexShrink:0,width:"24px",height:"24px",borderRadius:"50%",background:"var(--rd-red)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",fontWeight:800,marginTop:"8px"}}>{qi+1}</span>
                      <input className="form-input" style={{flex:1}} placeholder="Текст вопроса"
                        value={q.question} onChange={e=>{const qs=[...(form.quizQuestions||[])];qs[qi]={...qs[qi],question:e.target.value};setForm(f=>({...f,quizQuestions:qs}));}} />
                      <button onClick={()=>{const qs=(form.quizQuestions||[]).filter((_,i)=>i!==qi);setForm(f=>({...f,quizQuestions:qs}));}} style={{background:"none",border:"none",cursor:"pointer",color:"var(--rd-red)",fontSize:"18px",flexShrink:0,marginTop:"6px"}}>✕</button>
                    </div>
                    <div style={{paddingLeft:"34px",marginBottom:"10px"}}>{q.image?(<div style={{position:"relative",display:"inline-block"}}><img src={q.image} alt="" style={{maxHeight:"140px",maxWidth:"100%",borderRadius:"8px",border:"1.5px solid var(--rd-gray-border)",display:"block"}} /><button onClick={()=>{const qs=[...(form.quizQuestions||[])];qs[qi]={...qs[qi],image:""};setForm(f=>({...f,quizQuestions:qs}));}} style={{position:"absolute",top:"4px",right:"4px",background:"rgba(0,0,0,0.6)",border:"none",borderRadius:"50%",width:"22px",height:"22px",color:"#fff",cursor:"pointer",fontSize:"13px",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div>):(<label style={{display:"inline-flex",alignItems:"center",gap:"6px",padding:"6px 14px",border:"1.5px dashed var(--rd-gray-border)",borderRadius:"8px",cursor:"pointer",fontSize:"12px",fontWeight:600,color:"var(--rd-gray-text)",background:"#fff"}}>🖼️ Добавить фото<input type="file" accept="image/*" style={{display:"none"}} onChange={async e=>{const file=e.target.files[0];if(!file)return;const r=new FileReader();r.onload=async ev=>{const c=await compressImage(ev.target.result,800,600,0.82);const qs=[...(form.quizQuestions||[])];qs[qi]={...qs[qi],image:c};setForm(f=>({...f,quizQuestions:qs}));};r.readAsDataURL(file);e.target.value="";}} /></label>)}</div>
                    <div style={{paddingLeft:"34px",display:"flex",flexDirection:"column",gap:"8px"}}>
                      {(q.options||[]).map((opt, oi) => (
                        <div key={oi} style={{display:"flex",alignItems:"center",gap:"8px"}}>
                          <input type="radio" name={`q${qi}-correct`} checked={q.correct===oi}
                            onChange={()=>{const qs=[...(form.quizQuestions||[])];qs[qi]={...qs[qi],correct:oi};setForm(f=>({...f,quizQuestions:qs}));}}
                            style={{width:"16px",height:"16px",accentColor:"var(--rd-green)",flexShrink:0}} title="Правильный ответ" />
                          <input className="form-input" style={{flex:1,borderColor:q.correct===oi?"var(--rd-green)":"var(--rd-gray-border)"}} placeholder={`Вариант ${oi+1}`}
                            value={opt} onChange={e=>{const qs=[...(form.quizQuestions||[])];qs[qi].options=[...qs[qi].options];qs[qi].options[oi]=e.target.value;setForm(f=>({...f,quizQuestions:qs}));}} />
                          <button onClick={()=>{const qs=[...(form.quizQuestions||[])];qs[qi].options=qs[qi].options.filter((_,i)=>i!==oi);if(qs[qi].correct>=qs[qi].options.length)qs[qi].correct=0;setForm(f=>({...f,quizQuestions:qs}));}} style={{background:"none",border:"none",cursor:"pointer",color:"var(--rd-gray-text)",fontSize:"16px",flexShrink:0}}>✕</button>
                        </div>
                      ))}
                      <button onClick={()=>{const qs=[...(form.quizQuestions||[])];qs[qi].options=[...qs[qi].options,""];setForm(f=>({...f,quizQuestions:qs}));}}
                        style={{alignSelf:"flex-start",background:"none",border:"1.5px dashed var(--rd-gray-border)",borderRadius:"8px",padding:"6px 14px",fontSize:"12px",fontWeight:600,color:"var(--rd-gray-text)",cursor:"pointer"}}>
                        + Добавить вариант
                      </button>
                      <div style={{fontSize:"11px",color:"var(--rd-gray-text)"}}>🔘 Выберите правильный ответ (кружок слева)</div>
                    </div>
                  </div>
                ))}

                <button onClick={()=>setForm(f=>({...f,quizQuestions:[...(f.quizQuestions||[]),{question:"",options:["",""],correct:0}]}))}
                  className="btn btn-secondary btn-sm" style={{width:"100%",marginTop:"4px"}}>
                  + Добавить вопрос
                </button>
              </div>
            )}
          </div>
          <div style={{display:"flex",gap:"10px",marginTop:"16px"}}>
            <button className="btn btn-primary" onClick={save}>💾 Сохранить</button>
            <button className="btn btn-ghost" onClick={cancel}>Отмена</button>
          </div>
        </div>
      )}

      {editId !== "new" && (<>
        {taskList.length > 0 && (
          <div style={{display:"flex",gap:"10px",marginBottom:"16px",flexWrap:"wrap",alignItems:"center"}}>
            <input className="form-input" placeholder="🔍 Поиск по названию..." value={taskSearch} onChange={e => setTaskSearch(e.target.value)} style={{flex:"1 1 200px",minWidth:"160px",padding:"8px 14px",fontSize:"13px"}} />
            <select className="form-input" value={taskSort} onChange={e => setTaskSort(e.target.value)} style={{flex:"0 0 auto",padding:"8px 14px",fontSize:"13px",minWidth:"160px"}}>
              <option value="newest">Сначала новые</option>
              <option value="oldest">Сначала старые</option>
            </select>
          </div>
        )}
        {taskList.length === 0 && (
          <div className="empty-state" style={{marginBottom:"24px"}}><div className="empty-state-icon">🎯</div><div className="empty-state-text">Заданий нет — добавьте первое</div></div>
        )}
        <div style={{display:"flex",flexDirection:"column",gap:"12px",marginBottom:"36px"}}>
        {taskList.filter(t => !taskSearch || t.title.toLowerCase().includes(taskSearch.toLowerCase())).sort((a, b) => taskSort === "newest" ? b.id - a.id : a.id - b.id).map(task => (
          <div key={task.id} style={{background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius)",padding:"18px 22px",boxShadow:"var(--rd-shadow)",display:"flex",alignItems:"center",gap:"16px"}}>
            {task.image && <img src={task.image} style={{width:"64px",height:"48px",objectFit:"cover",borderRadius:"8px",flexShrink:0}} alt="" />}
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)",marginBottom:"2px",display:"flex",alignItems:"center",gap:"8px"}}>
                {task.title}
                {task.taskType === "quiz" && <span style={{fontSize:"11px",background:"var(--rd-blue-light)",color:"var(--rd-blue)",border:"1px solid rgba(37,99,235,0.2)",borderRadius:"6px",padding:"2px 7px",fontWeight:700}}>📝 Квиз · {(task.quizQuestions||[]).length} вопр. · {task.quizPassPct||80}% · попыток: {task.quizMaxFailedAttempts > 0 ? task.quizMaxFailedAttempts : "∞"}</span>}
              </div>
              <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>Награда: <b>{task.reward}</b> монет · {task.active!==false ? <span style={{color:"var(--rd-green)",fontWeight:700}}>Активно</span> : <span style={{color:"var(--rd-gray-text)"}}>Скрыто</span>}{task.deadline && <span> · ⏰ до {(d=>isNaN(d)?"—":d.toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}))(new Date(task.deadline))}</span>}</div>
            </div>
            <div style={{display:"flex",gap:"8px",flexShrink:0}}>
              <button className="btn btn-ghost btn-sm" onClick={() => startEdit(task)}>✏️</button>
              <button className="btn btn-ghost btn-sm" onClick={() => deleteTask(task.id)} style={{color:"var(--rd-red)"}}>🗑️</button>
            </div>
          </div>
        ))}
      </div>

      {/* Submissions history */}
      <div style={{borderTop:"2px solid var(--rd-gray-border)",paddingTop:"28px"}}>
        <div style={{fontWeight:700,fontSize:"18px",color:"var(--rd-dark)",marginBottom:"16px"}}>📋 История выполнения ({allSubmissions.length})</div>
        {allSubmissions.length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon">📭</div><div className="empty-state-text">Пока никто не отправил задания</div></div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
            {allSubmissions.slice().reverse().map(sub => {
              const sc = statusCfg[sub.status] || {label:sub.status, bg:"#f3f4f6", color:"#6b7280"};
              const currentComment = commentInputs[sub.id] !== undefined ? commentInputs[sub.id] : (sub.comment || "");
              return (
                <div key={sub.id} style={{background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius)",padding:"20px 22px",boxShadow:"var(--rd-shadow)"}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"16px",marginBottom:"12px"}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)",marginBottom:"4px"}}>{sub.taskTitle}</div>
                      <div style={{fontSize:"13px",color:"var(--rd-gray-text)"}}>👤 {sub.user} · {sub.date} · <b>{sub.reward}</b> монет</div>
                    </div>
                    <div style={{background:sc.bg,color:sc.color,borderRadius:"8px",padding:"5px 12px",fontSize:"12px",fontWeight:700,flexShrink:0}}>{sc.label}</div>
                  </div>
                  <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"12px"}}>
                    {["pending","approved","rejected"].map(st => (
                      <button key={st} onClick={() => setSubmissionStatus(sub.id, st)}
                        style={{padding:"6px 14px",borderRadius:"8px",border:"1.5px solid",fontSize:"12px",fontWeight:700,cursor:"pointer",transition:"all 0.15s",
                          background: sub.status===st ? (st==="approved"?"var(--rd-green)":st==="rejected"?"var(--rd-red)":"#d97706") : "#fff",
                          color: sub.status===st ? "#fff" : "var(--rd-gray-text)",
                          borderColor: sub.status===st ? (st==="approved"?"var(--rd-green)":st==="rejected"?"var(--rd-red)":"#d97706") : "var(--rd-gray-border)"}}>
                        {st==="pending"?"⏳ На проверке":st==="approved"?"✅ Выполнено":"❌ Не выполнено"}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label style={{fontSize:"12px",fontWeight:600,color:"var(--rd-gray-text)",display:"block",marginBottom:"4px"}}>Комментарий для пользователя</label>
                    <textarea className="form-input" rows="2" style={{resize:"vertical",minHeight:"60px",fontSize:"13px",width:"100%"}} value={currentComment} onChange={e=>updateComment(sub.id, e.target.value)} placeholder="Укажите причину отказа или уточнение…" />
                    <button className="btn btn-primary btn-sm" onClick={() => saveComment(sub.id)} style={{marginTop:"8px"}}>Сохранить</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>)}
    </div>
  );
}

// ── AUCTION ────────────────────────────────────────────────────────────────

function AuctionCountdownInline({ endsAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const diff = endsAt - now;
  if (diff <= 0) return <div style={{fontSize:"22px",fontWeight:900,color:"var(--rd-red)"}}>Завершён</div>;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const pad = n => String(n).padStart(2, "0");
  const units = d > 0 ? [{v:d,l:"дн"},{v:h,l:"ч"},{v:m,l:"мин"},{v:s,l:"сек"}] : [{v:h,l:"ч"},{v:m,l:"мин"},{v:s,l:"сек"}];
  return (
    <div style={{display:"flex",gap:"8px",alignItems:"flex-end"}}>
      {units.map((u, i) => (
        <React.Fragment key={i}>
          {i > 0 && <div style={{fontSize:"24px",fontWeight:900,color:"rgba(199,22,24,0.7)",lineHeight:1,paddingBottom:"14px"}}>:</div>}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
            <div style={{fontSize:"44px",fontWeight:900,color:"#fff",lineHeight:1,fontVariantNumeric:"tabular-nums",minWidth:"52px",textAlign:"center"}}>{String(u.v).padStart(2,"0")}</div>
            <div style={{fontSize:"10px",color:"rgba(255,255,255,0.4)",textTransform:"uppercase",letterSpacing:"0.08em",marginTop:"4px"}}>{u.l}</div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function AuctionTimer({ endsAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = endsAt - now;
  if (diff <= 0) return <div className="auction-timer-block"><div className="auction-timer-label">Аукцион завершён</div><div className="auction-timer-ended">🏁 Завершён</div></div>;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const pad = n => String(n).padStart(2, "0");
  return (
    <div className="auction-timer-block">
      <div className="auction-timer-label">⏱ До завершения</div>
      <div className="auction-timer-digits">
        {d > 0 && <><div className="auction-timer-unit"><div className="auction-timer-num">{d}</div><div className="auction-timer-sub">дн</div></div><div className="auction-timer-sep">:</div></>}
        <div className="auction-timer-unit"><div className="auction-timer-num">{pad(h)}</div><div className="auction-timer-sub">час</div></div>
        <div className="auction-timer-sep">:</div>
        <div className="auction-timer-unit"><div className="auction-timer-num">{pad(m)}</div><div className="auction-timer-sub">мин</div></div>
        <div className="auction-timer-sep">:</div>
        <div className="auction-timer-unit"><div className="auction-timer-num">{pad(s)}</div><div className="auction-timer-sub">сек</div></div>
      </div>
    </div>
  );
}

function AuctionCard({ auction, currentUser, users, saveUsers, saveAuctions, allAuctions, notify, currency }) {
  const cName = getCurrName(currency);
  const [bidAmt, setBidAmt] = useState("");
  const isEnded = Date.now() >= auction.endsAt;
  const lastBid = auction.bids && auction.bids.length > 0 ? auction.bids[auction.bids.length - 1] : null;
  const currentPrice = lastBid ? lastBid.amount : auction.startPrice;
  const minNext = currentPrice + auction.step;
  const leader = lastBid ? users[lastBid.user] : null;
  const isMyLead = lastBid && lastBid.user === currentUser;
  const isWinner = isEnded && lastBid && lastBid.user === currentUser && !auction.settled;

  // Auto-settle: deduct from winner when auction ends
  useEffect(() => {
    if (isEnded && lastBid && !auction.settled) {
      // Находим победителя с достаточным балансом
      let winnerBid = null;
      let winnerUser = null;
      
      // Проходим по ставкам в обратном порядке (от последней к первой)
      for (let i = auction.bids.length - 1; i >= 0; i--) {
        const bid = auction.bids[i];
        const u = users[bid.user];
        
        // Проверяем, есть ли у пользователя достаточно средств
        if (u && (u.balance || 0) >= bid.amount) {
          winnerBid = bid;
          winnerUser = bid.user;
          break;
        }
      }
      
      // Если нашли победителя с достаточным балансом
      if (winnerBid && winnerUser) {
        const amt = winnerBid.amount;
        const u = users[winnerUser];
        
        // Списываем средства с победителя
        saveUsers({ ...users, [winnerUser]: { ...u, balance: (u.balance || 0) - amt } });
        
        // Помечаем аукцион как завершенный с информацией о победителе
        const updated = allAuctions.map(a => a.id === auction.id ? { 
          ...a, 
          settled: true, 
          finalWinner: winnerUser,
          finalAmount: amt 
        } : a);
        saveAuctions(updated);

        // Telegram notification about auction winner
        try {
          const ap = storage.get("cm_appearance") || {};
          const integ = ap.integrations || {};
          const winnerData = users[winnerUser];
          const winnerName = winnerData ? ((winnerData.firstName || "") + " " + (winnerData.lastName || "")).trim() || winnerUser : winnerUser;
          const msg = `🏆 <b>Аукцион завершён!</b>\n\n🔨 Лот: <b>${auction.name}</b>\n👤 Победитель: ${winnerName} (<code>${winnerUser}</code>)\n💰 Финальная ставка: <b>${amt}</b> монет\n📅 ${new Date().toLocaleString("ru-RU")}`;
          if (integ.tgEnabled && integ.tgBotToken && integ.tgChatId) {
            fetch('/api/telegram', {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: integ.tgBotToken.trim(), chat_id: integ.tgChatId.trim(), text: msg, parse_mode: "HTML" })
            }).catch(() => {});
          }
          if (integ.maxEnabled && integ.maxBotToken && integ.maxChatId) {
            fetch('/api/max', {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: integ.maxBotToken.trim(), chat_id: integ.maxChatId.trim(), text: msg })
            }).catch(() => {});
          }
        } catch {}
      } else {
        // Если ни у кого из участников нет достаточно средств
        const updated = allAuctions.map(a => a.id === auction.id ? { 
          ...a, 
          settled: true, 
          finalWinner: null,
          finalAmount: null,
          noWinner: true 
        } : a);
        saveAuctions(updated);
      }
    }
  }, [isEnded]);

  const placeBid = () => {
    if (!currentUser) { notify("Войдите в аккаунт, чтобы делать ставки", "err"); return; }
    const amt = parseInt(bidAmt);
    if (!amt || amt < minNext) { notify(`Минимальная ставка: ${minNext} ${cName}`, "err"); return; }
    const myBalance = users[currentUser]?.balance || 0;
    if (myBalance < amt) { notify(`Недостаточно ${cName}. Ваш баланс: ${myBalance}`, "err"); return; }
    const newBid = { user: currentUser, amount: amt, time: Date.now() };
    const updated = allAuctions.map(a => a.id === auction.id
      ? { ...a, bids: [...(a.bids || []), newBid] }
      : a
    );
    saveAuctions(updated);
    setBidAmt("");
    notify(`Ставка ${amt} ${cName} принята! 🎯`);
  };

  const getInitials = (u) => {
    const ud = users[u];
    if (!ud) return u[0]?.toUpperCase() || "?";
    const fn = ud.firstName || ""; const ln = ud.lastName || "";
    if (fn || ln) return ((fn[0] || "") + (ln[0] || "")).toUpperCase();
    return u[0]?.toUpperCase() || "?";
  };
  const getFullName = (u) => {
    const ud = users[u];
    if (!ud) return u;
    const fn = ud.firstName || ""; const ln = ud.lastName || "";
    return (fn + " " + ln).trim() || ud.username || u;
  };

  return (
    <div className={"auction-card" + (isEnded ? " ended" : "")}>
      <div className="auction-img">
        {auction.image ? <img src={auction.image} alt={auction.name} /> : <span>🏷️</span>}
      </div>
      <div className="auction-body">
        <div className="auction-name">{auction.name}</div>
        <AuctionTimer endsAt={auction.endsAt} />
        <div className="auction-price-row">
          <div className="auction-price-block">
            <div className="auction-price-label">Текущая цена</div>
            <div className="auction-price-val">{currentPrice} {cName}</div>
            <div className="auction-step">Шаг ставки: +{auction.step} {cName}</div>
          </div>
          {auction.bids && auction.bids.length > 0 && (
            <div style={{fontSize:"12px",color:"var(--rd-gray-text)",textAlign:"right"}}>
              {auction.bids.length} ставок
            </div>
          )}
        </div>

        {lastBid ? (
          <div className="auction-leader">
            <div className="auction-leader-avatar">
              {leader?.avatar ? <img src={leader.avatar} alt="" /> : getInitials(lastBid.user)}
            </div>
            <div className="auction-leader-info">
              <div className="auction-leader-name">{getFullName(lastBid.user)}</div>
              <div className="auction-leader-label">Лидер аукциона</div>
            </div>
            {isMyLead && <span style={{fontSize:"11px",background:"var(--rd-green-light)",color:"var(--rd-green)",border:"1px solid rgba(5,150,105,0.2)",borderRadius:"20px",padding:"2px 8px",fontWeight:700}}>Вы лидируете</span>}
          </div>
        ) : (
          <div className="auction-no-bids">Ставок пока нет — будьте первым!</div>
        )}

        {isEnded && auction.settled && (
          auction.noWinner ? (
            <div className="auction-winner-banner" style={{background:"#fff0f0",border:"1.5px solid #fecaca",color:"var(--rd-red)"}}>
              ⚠️ Аукцион завершён без победителя (недостаточно средств у участников)
            </div>
          ) : auction.finalWinner ? (
            <div className="auction-winner-banner">
              🏆 Победитель: {getFullName(auction.finalWinner)} — {auction.finalAmount} {cName}
            </div>
          ) : lastBid && (
            <div className="auction-winner-banner">
              🏆 Победитель: {getFullName(lastBid.user)} — {lastBid.amount} {cName}
            </div>
          )
        )}

        {!isEnded && (
          <div className="auction-bid-row">
            <input
              className="form-input auction-bid-input"
              type="number"
              placeholder={`Мин. ${minNext} ${cName}`}
              value={bidAmt}
              min={minNext}
              onChange={e => setBidAmt(e.target.value)}
              onKeyDown={e => e.key === "Enter" && placeBid()}
            />
            <button className="btn btn-primary" style={{whiteSpace:"nowrap",flexShrink:0}} onClick={placeBid} disabled={!currentUser}>
              🔨 Ставка
            </button>
          </div>
        )}
        {!currentUser && !isEnded && <div style={{fontSize:"12px",color:"var(--rd-gray-text)",textAlign:"center"}}>Войдите, чтобы сделать ставку</div>}
      </div>
    </div>
  );
}

function AuctionPage({ auctions, saveAuctions, currentUser, users, saveUsers, notify, currency, appearance }) {
  const active = (auctions || []).filter(a => Date.now() < a.endsAt);
  const ended = (auctions || []).filter(a => Date.now() >= a.endsAt);
  const sectionSettings = appearance?.sectionSettings?.auction || {};
  const title = sectionSettings.title || "Аукцион";
  const description = sectionSettings.description || "Делайте ставки и выигрывайте эксклюзивные товары";
  const bannerImage = sectionSettings.banner || "";
  
  return (
    <div style={{minHeight:"60vh"}}>
      {bannerImage ? (
        <div className="section-banner-wrap">
          <div className="hero-banner">
            <div className="hero-banner-bg" style={{backgroundImage:`url(${bannerImage})`}} />
            <div className="hero-banner-overlay" />
            <div className="hero-banner-content" style={{padding:"48px 24px"}}>
              <h1 className="hero-banner-title" style={{fontSize:"clamp(26px,5vw,40px)",marginBottom:"12px"}}>{title}</h1>
              <p className="hero-banner-desc">{description}</p>
            </div>
          </div>
          {auctions && auctions.length > 0 && (
            <div className="section-banner-stats-overlay">
              <div className="section-banner-stat">
                <div className="section-banner-stat-num" style={{color:"#ff6b6b"}}>{active.length}</div>
                <div className="section-banner-stat-label">Активных</div>
              </div>
              <div className="section-banner-stat">
                <div className="section-banner-stat-num" style={{color:"#fff"}}>{ended.length}</div>
                <div className="section-banner-stat-label">Завершённых</div>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {!bannerImage && (
        <div style={{background:"#fff",borderBottom:"1.5px solid var(--rd-gray-border)",padding:"40px 0 32px"}}>
          <div className="container">
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"12px"}}>
              <div>
                <h1 style={{fontSize:"clamp(26px,5vw,40px)",fontWeight:900,color:"var(--rd-dark)",letterSpacing:"-0.02em"}}>{title}</h1>
                <p style={{fontSize:"15px",color:"var(--rd-gray-text)",marginTop:"6px"}}>{description}</p>
              </div>
              {auctions && auctions.length > 0 && (
                <div style={{display:"flex",gap:"16px",flexWrap:"wrap",marginLeft:"auto"}}>
                  <div style={{textAlign:"center",background:"var(--rd-gray-bg)",borderRadius:"12px",padding:"12px 20px"}}>
                    <div style={{fontSize:"22px",fontWeight:900,color:"var(--rd-red)"}}>{active.length}</div>
                    <div style={{fontSize:"11px",color:"var(--rd-gray-text)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Активных</div>
                  </div>
                  <div style={{textAlign:"center",background:"var(--rd-gray-bg)",borderRadius:"12px",padding:"12px 20px"}}>
                    <div style={{fontSize:"22px",fontWeight:900,color:"var(--rd-dark)"}}>{ended.length}</div>
                    <div style={{fontSize:"11px",color:"var(--rd-gray-text)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Завершённых</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="container auction-page">
        {(!auctions || auctions.length === 0) && (
          <div className="empty-state"><div className="empty-state-icon">🔨</div><div className="empty-state-text">Аукционов пока нет</div></div>
        )}
        {active.length > 0 && (
          <>
            <div style={{fontSize:"13px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--rd-gray-text)",marginBottom:"16px"}}>Активные аукционы</div>
            <div className="auction-grid" style={{marginBottom:"40px"}}>
              {active.map(a => <AuctionCard key={a.id} auction={a} currentUser={currentUser} users={users} saveUsers={saveUsers} saveAuctions={saveAuctions} allAuctions={auctions} notify={notify} currency={currency} />)}
            </div>
          </>
        )}
        {ended.length > 0 && (
          <>
            <div style={{fontSize:"13px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--rd-gray-text)",marginBottom:"16px"}}>Завершённые</div>
            <div className="auction-grid">
              {ended.map(a => <AuctionCard key={a.id} auction={a} currentUser={currentUser} users={users} saveUsers={saveUsers} saveAuctions={saveAuctions} allAuctions={auctions} notify={notify} currency={currency} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AuctionAdminTab({ auctions, saveAuctions, notify, users }) {
  const list = auctions || [];
  const [form, setForm] = useState({ name: "", image: "", startPrice: "", step: "", endsAt: "" });
  const [imgPreview, setImgPreview] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editImgPreview, setEditImgPreview] = useState("");
  const [adminSearch, setAdminSearch] = useState("");
  const [adminSort, setAdminSort] = useState("newest");

  const handleImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target.result, 1200, 1200, 0.85, 300);
      setForm(f => ({ ...f, image: compressed }));
      setImgPreview(compressed);
    };
    reader.readAsDataURL(file);
  };

  const handleEditImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target.result, 1200, 1200, 0.85, 300);
      setEditForm(f => ({ ...f, image: compressed }));
      setEditImgPreview(compressed);
    };
    reader.readAsDataURL(file);
  };

  const startEdit = (a) => {
    const endsAtLocal = new Date(a.endsAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setEditingId(a.id);
    setEditForm({ name: a.name, image: a.image || "", startPrice: String(a.startPrice), step: String(a.step), endsAt: endsAtLocal });
    setEditImgPreview(a.image || "");
  };

  const cancelEdit = () => { setEditingId(null); setEditForm(null); setEditImgPreview(""); };

  const saveEdit = () => {
    if (!editForm.name.trim()) { notify("Введите название", "err"); return; }
    if (!editForm.startPrice || parseInt(editForm.startPrice) <= 0) { notify("Укажите стартовую цену", "err"); return; }
    if (!editForm.step || parseInt(editForm.step) <= 0) { notify("Укажите шаг ставки", "err"); return; }
    if (!editForm.endsAt) { notify("Укажите дату завершения", "err"); return; }
    const endsAt = new Date(editForm.endsAt).getTime();
    const updated = list.map(a => a.id === editingId ? {
      ...a,
      name: editForm.name.trim(),
      image: editForm.image,
      startPrice: parseInt(editForm.startPrice),
      step: parseInt(editForm.step),
      endsAt,
    } : a);
    saveAuctions(updated);
    cancelEdit();
    notify("Аукцион обновлён ✓");
  };

  const create = () => {
    if (!form.name.trim()) { notify("Введите название товара", "err"); return; }
    if (!form.startPrice || parseInt(form.startPrice) <= 0) { notify("Укажите стартовую цену", "err"); return; }
    if (!form.step || parseInt(form.step) <= 0) { notify("Укажите шаг ставки", "err"); return; }
    if (!form.endsAt) { notify("Укажите дату завершения", "err"); return; }
    const endsAt = new Date(form.endsAt).getTime();
    if (endsAt <= Date.now()) { notify("Дата завершения должна быть в будущем", "err"); return; }
    const newAuction = {
      id: Date.now(),
      name: form.name.trim(),
      image: form.image,
      startPrice: parseInt(form.startPrice),
      step: parseInt(form.step),
      endsAt,
      bids: [],
      settled: false,
      createdAt: Date.now(),
    };
    saveAuctions([...list, newAuction]);
    setForm({ name: "", image: "", startPrice: "", step: "", endsAt: "" });
    setImgPreview("");
    notify("Аукцион создан ✓");
  };

  const deleteAuction = (id) => {
    if (!confirm("Удалить аукцион?")) return;
    saveAuctions(list.filter(a => a.id !== id));
    notify("Аукцион удалён");
  };

  const minDate = new Date(Date.now() + 60000).toISOString().slice(0, 16);

  return (
    <div>
      {/* Create form */}
      <div className="product-form-card" style={{position:"relative",top:"auto",marginBottom:"24px"}}>
        <div className="product-form-title">🔨 Создать аукцион</div>
        <div className="form-field">
          <label className="form-label">Название товара</label>
          <input className="form-input" placeholder="Эксклюзивная худи с вышивкой" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
        </div>
        <div className="form-field" style={{marginTop:"12px"}}>
          <label className="form-label">Фотография товара</label>
          <input type="file" accept="image/*" style={{display:"none"}} id="auction-img-input" onChange={handleImage} />
          <div style={{display:"flex",gap:"10px",alignItems:"center",flexWrap:"wrap"}}>
            <label htmlFor="auction-img-input" className="btn btn-secondary btn-sm" style={{cursor:"pointer"}}>📷 Загрузить фото</label>
            {imgPreview && <button className="btn btn-ghost btn-sm" style={{color:"var(--rd-red)"}} onClick={() => {setImgPreview(""); setForm(f => ({...f, image:""}));}}>✕ Удалить</button>}
          </div>
          {imgPreview && <img src={imgPreview} alt="" style={{marginTop:"10px",width:"120px",height:"80px",objectFit:"cover",borderRadius:"8px",border:"1.5px solid var(--rd-gray-border)"}} />}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px",marginTop:"12px"}}>
          <div className="form-field">
            <label className="form-label">Стартовая цена</label>
            <input className="form-input" type="number" min="1" placeholder="500" value={form.startPrice} onChange={e => setForm(f => ({...f, startPrice: e.target.value}))} />
          </div>
          <div className="form-field">
            <label className="form-label">Шаг аукциона</label>
            <input className="form-input" type="number" min="1" placeholder="50" value={form.step} onChange={e => setForm(f => ({...f, step: e.target.value}))} />
          </div>
        </div>
        <div className="form-field" style={{marginTop:"12px"}}>
          <label className="form-label">Дата и время завершения</label>
          <input className="form-input" type="datetime-local" min={minDate} value={form.endsAt} onChange={e => setForm(f => ({...f, endsAt: e.target.value}))} />
        </div>
        <button className="btn btn-primary" style={{marginTop:"16px",width:"100%"}} onClick={create}>🔨 Создать аукцион</button>
      </div>

      {/* Search & Sort */}
      {list.length > 0 && (
        <div style={{display:"flex",gap:"10px",marginBottom:"16px",flexWrap:"wrap",alignItems:"center"}}>
          <input className="form-input" placeholder="🔍 Поиск по названию..." value={adminSearch} onChange={e => setAdminSearch(e.target.value)} style={{flex:"1 1 200px",minWidth:"160px",padding:"8px 14px",fontSize:"13px"}} />
          <select className="form-input" value={adminSort} onChange={e => setAdminSort(e.target.value)} style={{flex:"0 0 auto",padding:"8px 14px",fontSize:"13px",minWidth:"160px"}}>
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала старые</option>
          </select>
        </div>
      )}

      {/* List */}
      {list.length === 0
        ? <div className="empty-state" style={{marginBottom:"24px"}}><div className="empty-state-icon">🔨</div><div className="empty-state-text">Аукционов пока нет</div></div>
        : <div style={{display:"flex",flexDirection:"column",gap:"12px",marginBottom:"24px"}}>
            {list.filter(a => !adminSearch || a.name.toLowerCase().includes(adminSearch.toLowerCase())).sort((a, b) => adminSort === "newest" ? (b.createdAt || b.id) - (a.createdAt || a.id) : (a.createdAt || a.id) - (b.createdAt || b.id)).map(a => {
              const isEnded = Date.now() >= a.endsAt;
              const lastBid = a.bids && a.bids.length > 0 ? a.bids[a.bids.length - 1] : null;
              const currentPrice = lastBid ? lastBid.amount : a.startPrice;

              // Edit mode for this auction
              if (editingId === a.id && editForm) {
                return (
                  <div key={a.id} className="product-form-card" style={{position:"relative",top:"auto"}}>
                    <div className="product-form-title">✏️ Редактировать аукцион</div>
                    <div className="form-field">
                      <label className="form-label">Название товара</label>
                      <input className="form-input" value={editForm.name} onChange={e => setEditForm(f=>({...f,name:e.target.value}))} />
                    </div>
                    <div className="form-field" style={{marginTop:"12px"}}>
                      <label className="form-label">Фотография</label>
                      <input type="file" accept="image/*" style={{display:"none"}} id={"auction-edit-img-"+a.id} onChange={handleEditImage} />
                      <div style={{display:"flex",gap:"10px",alignItems:"center",flexWrap:"wrap"}}>
                        <label htmlFor={"auction-edit-img-"+a.id} className="btn btn-secondary btn-sm" style={{cursor:"pointer"}}>📷 Загрузить фото</label>
                        {editImgPreview && <button className="btn btn-ghost btn-sm" style={{color:"var(--rd-red)"}} onClick={() => {setEditImgPreview(""); setEditForm(f=>({...f,image:""}));}}>✕ Удалить</button>}
                      </div>
                      {editImgPreview && <img src={editImgPreview} alt="" style={{marginTop:"10px",width:"120px",height:"80px",objectFit:"cover",borderRadius:"8px",border:"1.5px solid var(--rd-gray-border)"}} />}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px",marginTop:"12px"}}>
                      <div className="form-field">
                        <label className="form-label">Стартовая цена</label>
                        <input className="form-input" type="number" min="1" value={editForm.startPrice} onChange={e => setEditForm(f=>({...f,startPrice:e.target.value}))} />
                      </div>
                      <div className="form-field">
                        <label className="form-label">Шаг аукциона</label>
                        <input className="form-input" type="number" min="1" value={editForm.step} onChange={e => setEditForm(f=>({...f,step:e.target.value}))} />
                      </div>
                    </div>
                    <div className="form-field" style={{marginTop:"12px"}}>
                      <label className="form-label">Дата и время завершения</label>
                      <input className="form-input" type="datetime-local" value={editForm.endsAt} onChange={e => setEditForm(f=>({...f,endsAt:e.target.value}))} />
                    </div>
                    <div style={{display:"flex",gap:"10px",marginTop:"16px"}}>
                      <button className="btn btn-primary" onClick={saveEdit}>💾 Сохранить</button>
                      <button className="btn btn-secondary" onClick={cancelEdit}>Отмена</button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={a.id} className="auction-admin-card">
                  <div className="auction-admin-thumb">
                    {a.image ? <img src={a.image} alt="" /> : "🏷️"}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"10px"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)",marginBottom:"4px"}}>{a.name}</div>
                        <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>
                          Старт: {a.startPrice} · Шаг: +{a.step} · Сейчас: <strong style={{color:"var(--rd-red)"}}>{currentPrice}</strong>
                        </div>
                        <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"2px"}}>
                          {isEnded ? "✅ Завершён" : `⏱ До ${new Date(a.endsAt).toLocaleString("ru-RU")}`} · {a.bids?.length || 0} ставок
                        </div>
                        {isEnded && lastBid && (() => {
                          const ud = users && users[lastBid.user];
                          const fullName = ud ? ((ud.firstName || "") + " " + (ud.lastName || "")).trim() || ud.username || lastBid.user : lastBid.user;
                          return (
                            <div style={{marginTop:"8px",display:"inline-flex",alignItems:"center",gap:"6px",background:"#fef9c3",border:"1.5px solid #fde047",borderRadius:"20px",padding:"4px 12px",fontSize:"12px",fontWeight:700,color:"#854d0e"}}>
                              🏆 Победитель: {fullName} — {lastBid.amount} {getCurrName()}
                            </div>
                          );
                        })()}
                        {isEnded && !lastBid && (
                          <div style={{marginTop:"8px",fontSize:"12px",color:"var(--rd-gray-text)",fontStyle:"italic"}}>Ставок не было</div>
                        )}
                      </div>
                      <div style={{display:"flex",gap:"6px",flexShrink:0}}>
                        <button className="btn btn-ghost btn-sm" onClick={() => startEdit(a)}>✏️</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => deleteAuction(a.id)} style={{color:"var(--rd-red)"}}>🗑️</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
      }

    </div>
  );
}

// ── FAQ PAGE ──────────────────────────────────────────────────────────────

function FaqPage({ faq }) {
  const [openIdx, setOpenIdx] = useState(null);
  const list = faq || [];
  return (
    <div style={{minHeight:"60vh"}}>
      <div style={{background:"#fff",borderBottom:"1.5px solid var(--rd-gray-border)",padding:"48px 0 40px"}}>
        <div className="container">
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:"12px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--rd-red)",background:"var(--rd-red-light)",border:"1px solid rgba(199,22,24,0.2)",borderRadius:"20px",display:"inline-block",padding:"4px 14px",marginBottom:"14px",display:"none"}}>Поддержка</div>
            <h1 style={{fontSize:"clamp(28px,5vw,44px)",fontWeight:900,color:"var(--rd-dark)",letterSpacing:"-0.02em",marginBottom:"12px"}}>Вопросы и ответы</h1>
            <p style={{fontSize:"16px",color:"var(--rd-gray-text)",maxWidth:"480px",margin:"0 auto"}}>Ответы на самые популярные вопросы о магазине</p>
          </div>
        </div>
      </div>
      <div className="container" style={{padding:"48px 24px 80px"}}>
        {list.length === 0
          ? <div className="empty-state"><div className="empty-state-icon">❓</div><div className="empty-state-text">Вопросов пока нет</div></div>
          : <div className="faq-list" style={{maxWidth:"760px",margin:"0 auto"}}>
              {list.map((item, idx) => (
                <div key={item.id || idx} className={"faq-item" + (openIdx === idx ? " open" : "")} onClick={() => setOpenIdx(openIdx === idx ? null : idx)}>
                  <div className="faq-question">
                    <span>{item.question}</span>
                    <div className="faq-icon">{openIdx === idx ? "−" : "+"}</div>
                  </div>
                  {openIdx === idx && <div className="faq-answer">{item.answer}</div>}
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  );
}

// ── SHOP ──────────────────────────────────────────────────────────────────

function ShopPage({ products, allProducts, categories, filterCat, setFilterCat, addToCart, setPage, currentUser, users, favorites, toggleFavorite, currency, faq, videos, tasks, auctions, appearance, orders, transfers }) {
  const cName = getCurrName(currency);
  const [modalProduct, setModalProduct] = useState(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("default");
  const [openFaq, setOpenFaq] = useState(null);
  const [taskModalOpen, setTaskModalOpen] = useState(null);

  const visibleProducts = products.filter(p => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.sku && p.sku.toLowerCase().includes(q)) || (p.desc && p.desc.toLowerCase().includes(q));
  }).sort((a, b) => {
    if (sort === "price_asc") return a.price - b.price;
    if (sort === "price_desc") return b.price - a.price;
    if (sort === "new") return (b.id || 0) - (a.id || 0);
    return 0;
  });

  return (
    <>
      {modalProduct && <ProductModal product={modalProduct} onClose={() => setModalProduct(null)} addToCart={addToCart} currency={currency} />}
      <div className="filter-bar">
        <div className="container">
          <div className="filter-bar-inner">
            {categories.map(cat => (
              <button key={cat} onClick={() => setFilterCat(cat)} className={"filter-tab" + (filterCat === cat ? " active" : "")}>{cat}</button>
            ))}
          </div>
        </div>
      </div>

      <section className="products-section" style={{background:"var(--rd-gray-bg)"}}>
        <div className="container">
          <div style={{display:"flex",gap:"12px",marginBottom:"20px",flexWrap:"wrap",alignItems:"center"}}>
            <div style={{flex:"1",minWidth:"200px",position:"relative"}}>
              <span style={{position:"absolute",left:"14px",top:"50%",transform:"translateY(-50%)",color:"var(--rd-gray-text)",fontSize:"16px",pointerEvents:"none"}}>🔍</span>
              <input className="form-input" style={{paddingLeft:"40px"}} placeholder="Поиск по названию, артикулу…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="form-select" style={{width:"auto",minWidth:"180px"}} value={sort} onChange={e => setSort(e.target.value)}>
              <option value="default">По умолчанию</option>
              <option value="price_asc">Сначала дешевле</option>
              <option value="price_desc">Сначала дороже</option>
              <option value="new">Новинки</option>
            </select>
          </div>
          {visibleProducts.length === 0
            ? <div className="empty-state"><div className="empty-state-icon">🔍</div><div className="empty-state-text">Ничего не найдено</div></div>
            : <div className="products-grid">
                {visibleProducts.map(p => <ProductCard key={p.id} product={p} addToCart={addToCart} onOpen={setModalProduct} favorites={favorites} toggleFavorite={toggleFavorite} />)}
              </div>
          }
        </div>
      </section>

      {tasks && tasks.length > 0 && (() => {
        const activeTasks = tasks.filter(t => t.active !== false);
        if (!activeTasks.length) return null;
        return (
          <section style={{padding:"48px 0 20px",background:"#fff"}}>
            <div className="container">
              <div className="faq-header">
                <div className="faq-eyebrow">Активности</div>
                <h2 className="faq-title">{appearance?.sectionSettings?.tasks?.title || "Задания за монеты"}</h2>
                <p className="faq-subtitle">{appearance?.sectionSettings?.tasks?.description || "Выполняйте задания и получайте корпоративные монеты"}</p>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:"20px"}}>
                {activeTasks.map(task => (
                  <div key={task.id} style={{borderRadius:"var(--rd-radius)",overflow:"hidden",boxShadow:"var(--rd-shadow-md)",background:"#fff",border:"1.5px solid var(--rd-gray-border)",display:"flex",flexDirection:"column"}}>
                    <div style={{position:"relative",height:"180px",background:task.image ? `url('${task.image}') center/cover no-repeat` : "linear-gradient(135deg,var(--rd-red) 0%,#a51214 100%)",display:"flex",alignItems:"flex-end",padding:"20px"}}>
                      <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,0.65) 0%,rgba(0,0,0,0.1) 60%)"}} />
                      <div style={{position:"relative",zIndex:1}}>
                        <div style={{fontSize:"13px",fontWeight:700,color:"rgba(255,255,255,0.85)",marginBottom:"4px"}}>{task.bannerText || "Задание"}</div>
                        <div style={{fontSize:"20px",fontWeight:900,color:"#fff",lineHeight:1.2}}>{task.title}</div>
                      </div>
                      <div style={{position:"absolute",top:"16px",right:"16px",zIndex:1,background:"rgba(255,255,255,0.15)",backdropFilter:"blur(8px)",border:"1.5px solid rgba(255,255,255,0.3)",borderRadius:"12px",padding:"8px 14px",textAlign:"center"}}>
                        <div style={{fontSize:"22px",fontWeight:900,color:"#fff",lineHeight:1}}>{task.reward}</div>
                        <div style={{fontSize:"10px",fontWeight:700,color:"rgba(255,255,255,0.85)",letterSpacing:"0.05em"}}>монет</div>
                      </div>
                    </div>
                    <div style={{padding:"18px 20px",flex:1,display:"flex",flexDirection:"column",gap:"12px"}}>
                      <p style={{fontSize:"14px",color:"var(--rd-gray-text)",lineHeight:1.6,flex:1}}>{task.shortDesc || task.description || ""}</p>
                      {task.deadline && <TaskCountdown deadline={task.deadline} />}
                      <button onClick={() => setTaskModalOpen(task)} style={{background:"var(--rd-red)",color:"#fff",border:"none",borderRadius:"10px",padding:"10px 20px",fontWeight:700,fontSize:"14px",cursor:"pointer",transition:"background 0.2s",width:"100%"}}
                        onMouseEnter={e=>e.currentTarget.style.background="var(--rd-red-hover)"}
                        onMouseLeave={e=>e.currentTarget.style.background="var(--rd-red)"}>
                        Подробнее →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      })()}

      {taskModalOpen && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}} onClick={() => setTaskModalOpen(null)}>
          <div style={{background:"#fff",borderRadius:"var(--rd-radius)",maxWidth:"560px",width:"100%",maxHeight:"90vh",overflow:"auto",boxShadow:"var(--rd-shadow-lg)"}} onClick={e => e.stopPropagation()}>
            {taskModalOpen.image && (
              <div style={{height:"220px",background:`url('${taskModalOpen.image}') center/cover no-repeat`,position:"relative",borderRadius:"var(--rd-radius) var(--rd-radius) 0 0"}}>
                <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,0.5) 0%,transparent 60%)",borderRadius:"var(--rd-radius) var(--rd-radius) 0 0"}} />
              </div>
            )}
            <div style={{padding:"28px 28px 24px"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"16px",marginBottom:"8px"}}>
                <h3 style={{fontSize:"22px",fontWeight:900,color:"var(--rd-dark)",lineHeight:1.3}}>{taskModalOpen.title}</h3>
                <button onClick={() => setTaskModalOpen(null)} style={{background:"none",border:"none",fontSize:"24px",cursor:"pointer",color:"var(--rd-gray-text)",flexShrink:0,lineHeight:1}}>×</button>
              </div>
              <div style={{display:"inline-flex",alignItems:"center",gap:"8px",background:"var(--rd-red-light)",border:"1.5px solid rgba(199,22,24,0.2)",borderRadius:"10px",padding:"8px 16px",marginBottom:"20px"}}>
                <span style={{fontSize:"28px",fontWeight:900,color:"var(--rd-red)",lineHeight:1}}>{taskModalOpen.reward}</span>
                <span style={{fontSize:"14px",fontWeight:700,color:"var(--rd-red)"}}>монет за выполнение</span>
              </div>
              <div style={{fontSize:"15px",color:"var(--rd-dark)",lineHeight:1.7,marginBottom:"16px",whiteSpace:"pre-wrap"}}>{taskModalOpen.description}</div>
              {taskModalOpen.deadline && <div style={{marginBottom:"20px"}}><TaskCountdown deadline={taskModalOpen.deadline} /></div>}
              {currentUser ? (
                <button onClick={() => { setTaskModalOpen(null); setPage("tasks"); }} style={{background:"var(--rd-red)",color:"#fff",border:"none",borderRadius:"12px",padding:"14px 28px",fontWeight:800,fontSize:"16px",cursor:"pointer",width:"100%"}}>
                  Перейти к заданиям →
                </button>
              ) : (
                <div style={{background:"var(--rd-gray-bg)",borderRadius:"10px",padding:"14px 18px",fontSize:"14px",color:"var(--rd-gray-text)",fontWeight:600}}>Войдите в аккаунт, чтобы выполнить задание</div>
              )}
            </div>
          </div>
        </div>
      )}

      {(() => {
        if (!auctions || auctions.length === 0) return null;
        const now = Date.now();
        const active = auctions.filter(a => now < a.endsAt).sort((a, b) => a.endsAt - b.endsAt);
        if (!active.length) return null;
        const a = active[0];
        const lastBid = a.bids && a.bids.length > 0 ? a.bids[a.bids.length - 1] : null;
        const currentPrice = lastBid ? lastBid.amount : a.startPrice;
        const cName = getCurrName(currency);
        return (
          <section style={{padding:"0 0 48px",background:"var(--rd-gray-bg)"}}>
            <div className="container">
              <div style={{paddingTop:"48px",marginBottom:"28px",textAlign:"center"}}>
                <h2 style={{fontSize:"clamp(24px,4vw,36px)",fontWeight:900,color:"var(--rd-dark)",letterSpacing:"-0.02em"}}>Аукцион</h2>
              </div>
              <div style={{borderRadius:"20px",overflow:"hidden",background:"linear-gradient(135deg,#1a0505 0%,#2d0a0a 50%,#1a1a2e 100%)",boxShadow:"0 12px 48px rgba(199,22,24,0.25)",position:"relative",display:"flex",flexWrap:"wrap",minHeight:"320px"}}>
                {/* Background image */}
                {a.image && <div style={{position:"absolute",inset:0,background:`url('${a.image}') center/cover no-repeat`,opacity:0.18}} />}
                {/* Decorative glow */}
                <div style={{position:"absolute",top:"-60px",right:"-60px",width:"300px",height:"300px",borderRadius:"50%",background:"radial-gradient(circle,rgba(199,22,24,0.35) 0%,transparent 70%)",pointerEvents:"none"}} />

                {/* Left: info */}
                <div style={{position:"relative",flex:"1 1 340px",padding:"40px 44px",display:"flex",flexDirection:"column",justifyContent:"space-between",gap:"24px",zIndex:1}}>
                  <div>
                    <div style={{display:"inline-flex",alignItems:"center",gap:"8px",background:"rgba(199,22,24,0.25)",border:"1.5px solid rgba(199,22,24,0.45)",borderRadius:"20px",padding:"5px 14px",marginBottom:"16px"}}>
                      <span style={{width:"8px",height:"8px",borderRadius:"50%",background:"var(--rd-red)",boxShadow:"0 0 8px var(--rd-red)",display:"inline-block",animation:"pulse 1.5s infinite"}} />
                      <span style={{fontSize:"12px",fontWeight:800,color:"rgba(255,255,255,0.9)",textTransform:"uppercase",letterSpacing:"0.1em"}}>Аукцион идёт</span>
                    </div>
                    <h2 style={{fontSize:"clamp(22px,3.5vw,34px)",fontWeight:900,color:"#fff",lineHeight:1.15,letterSpacing:"-0.02em",marginBottom:"10px"}}>{a.name}</h2>
                    <div style={{fontSize:"14px",color:"rgba(255,255,255,0.55)"}}>Шаг ставки: <span style={{color:"rgba(255,255,255,0.85)",fontWeight:700}}>+{a.step} {cName}</span> · {a.bids?.length || 0} ставок</div>
                  </div>

                  <div style={{display:"flex",gap:"12px",flexWrap:"wrap",alignItems:"stretch"}}>
                    <div style={{background:"rgba(255,255,255,0.06)",border:"1.5px solid rgba(255,255,255,0.12)",borderRadius:"14px",padding:"14px 22px",flex:"1 1 180px",minWidth:"180px"}}>
                      <div style={{fontSize:"11px",color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:"4px"}}>Текущая цена</div>
                      <div style={{fontSize:"32px",fontWeight:900,color:"var(--rd-red)",lineHeight:1}}>{currentPrice} <span style={{fontSize:"16px",fontWeight:700}}>{cName}</span></div>
                      <div style={{fontSize:"12px",color:"rgba(255,255,255,0.4)",marginTop:"2px"}}>Старт: {a.startPrice} {cName}</div>
                    </div>
                    {lastBid && (() => {
                      return (
                        <div style={{background:"rgba(255,255,255,0.06)",border:"1.5px solid rgba(255,255,255,0.12)",borderRadius:"14px",padding:"14px 22px",flex:"1 1 180px",minWidth:"180px"}}>
                          <div style={{fontSize:"11px",color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:"6px"}}>Лидер аукциона</div>
                          <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                            <div style={{width:"36px",height:"36px",borderRadius:"50%",background:"linear-gradient(135deg,var(--rd-red),#ff6b6b)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,color:"#fff",fontSize:"14px",flexShrink:0}}>
                              {lastBid.user[0]?.toUpperCase()}
                            </div>
                            <div style={{fontSize:"14px",fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{lastBid.user}</div>
                          </div>
                        </div>
                      );
                    })()}
                    <button onClick={() => setPage("auction")} style={{background:"linear-gradient(135deg,var(--rd-red),#a51214)",color:"#fff",border:"none",borderRadius:"12px",padding:"14px 28px",fontWeight:800,fontSize:"15px",cursor:"pointer",boxShadow:"0 4px 20px rgba(199,22,24,0.4)",transition:"all 0.2s",whiteSpace:"nowrap"}}
                      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 28px rgba(199,22,24,0.5)"}}
                      onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 4px 20px rgba(199,22,24,0.4)"}}>
                      Сделать ставку →
                    </button>
                  </div>
                </div>

                {/* Right: timer */}
                <div style={{position:"relative",flex:"0 0 auto",padding:"40px 44px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"12px",zIndex:1,borderLeft:"1.5px solid rgba(255,255,255,0.07)"}}>
                  <div style={{fontSize:"12px",fontWeight:700,color:"rgba(255,255,255,0.45)",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:"4px"}}>⏱ До конца</div>
                  <AuctionCountdownInline endsAt={a.endsAt} />
                  <div style={{fontSize:"12px",color:"rgba(255,255,255,0.35)",textAlign:"center"}}>{new Date(a.endsAt).toLocaleString("ru-RU",{day:"2-digit",month:"long",hour:"2-digit",minute:"2-digit"})}</div>
                </div>
              </div>
            </div>
          </section>
        );
      })()}

      {videos && videos.length > 0 && videos.some(v => v.published) && (
        <section style={{padding:"48px 0",background:"#fff"}}>
          <div className="container">
            <div className="video-center-container">
              {videos.filter(v => v.published).slice(0, 1).map((video, idx) => {
                // Функция для извлечения ID из URL VK Video или RuTube
                const getVideoEmbedUrl = (url) => {
                  if (!url) return null;
                  
                  // VK Video
                  if (url.includes('vkvideo.ru') || url.includes('vk.com/video')) {
                    const vkMatch = url.match(/video(-?\d+_\d+)/);
                    if (vkMatch) {
                      return `https://vk.com/video_ext.php?oid=${vkMatch[1].split('_')[0]}&id=${vkMatch[1].split('_')[1]}&hd=2`;
                    }
                  }
                  
                  // RuTube
                  if (url.includes('rutube.ru')) {
                    const rutubeMatch = url.match(/rutube\.ru\/video\/([a-zA-Z0-9]+)/);
                    if (rutubeMatch) {
                      return `https://rutube.ru/play/embed/${rutubeMatch[1]}`;
                    }
                  }
                  
                  return null;
                };

                const embedUrl = getVideoEmbedUrl(video.url);
                
                return (
                  <div key={video.id || idx} style={{borderRadius:"var(--rd-radius)",overflow:"hidden",boxShadow:"var(--rd-shadow-md)",background:"#fff",border:"1.5px solid var(--rd-gray-border)"}}>
                    {embedUrl ? (
                      <div style={{position:"relative",paddingBottom:"56.25%",height:0,overflow:"hidden"}}>
                        <iframe
                          src={embedUrl}
                          style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",border:"none"}}
                          allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock;"
                          allowFullScreen
                        />
                      </div>
                    ) : (
                      <div style={{height:"180px",background:"linear-gradient(135deg,#f3f4f6 0%,#e5e7eb 100%)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"48px"}}>
                        🎬
                      </div>
                    )}
                    <div style={{padding:"20px"}}>
                      {video.title && (
                        <h3 style={{fontSize:"18px",fontWeight:700,color:"var(--rd-dark)",marginBottom:"8px",lineHeight:1.3}}>
                          {video.title}
                        </h3>
                      )}
                      {video.description && (
                        <p style={{fontSize:"14px",color:"var(--rd-gray-text)",lineHeight:1.6}}>
                          {video.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {faq && faq.length > 0 && (
        <section className="faq-section">
          <div className="container">
            <div className="faq-header">
              <div className="faq-eyebrow" style={{display:"none"}}>Поддержка</div>
              <h2 className="faq-title">Вопросы и ответы</h2>
              <p className="faq-subtitle">Ответы на самые популярные вопросы о магазине</p>
            </div>
            <div className="faq-list">
              {faq.map((item, idx) => (
                <div key={item.id || idx} className={"faq-item" + (openFaq === idx ? " open" : "")} onClick={() => setOpenFaq(openFaq === idx ? null : idx)}>
                  <div className="faq-question">
                    <span>{item.question}</span>
                    <div className="faq-icon">{openFaq === idx ? "−" : "+"}</div>
                  </div>
                  {openFaq === idx && (
                    <div className="faq-answer">{item.answer}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {(() => {
        const allUsers = Object.entries(users || {});
        const userCount = allUsers.filter(([, u]) => u.role !== "admin").length;
        const totalIssued = (transfers || []).reduce((s, t) => {
          const toUser = t.to && users[t.to] && users[t.to].role !== "admin";
          const fromAdmin = !t.from || (users[t.from] && users[t.from].role === "admin");
          return s + (toUser && fromAdmin ? (t.amount || 0) : 0);
        }, 0);
        const totalSpent = (orders || []).reduce((s, o) => s + (o.total || 0), 0);
        const totalItems = (orders || []).reduce((s, o) => s + (o.items || []).reduce((ss, i) => ss + (i.qty || 1), 0), 0);
        const cName = getCurrName(currency);
        const fmt = (n) => n >= 1000000 ? (n/1000000).toFixed(1).replace(/\.0$/,"") + "M" : n >= 1000 ? (n/1000).toFixed(1).replace(/\.0$/,"") + "K" : String(n);
        const stats = [
          { num: fmt(totalIssued), label: `Выпущено ${cName}` },
          { num: fmt(totalSpent), label: `Потрачено ${cName}` },
          { num: fmt(totalItems), label: "Куплено товаров" },
          { num: fmt(userCount), label: "Пользователей" },
        ];
        return (
          <section className="stats-counter-section">
            <div className="container">
              <div className="stats-counter-grid">
                {stats.map((s, i) => (
                  <div key={i} className="stats-counter-card">
                    <div className="stats-counter-num">{s.num}</div>
                    <div className="stats-counter-label">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      })()}
    </>
  );
}

const SIZES = ["S", "M", "L", "XL", "XXL"];
const CLOTHING_CATEGORY = "Одежда";

function ProductModal({ product, onClose, addToCart, currency }) {
  const cName = getCurrName(currency);
  const [imgIdx, setImgIdx] = useState(0);
  const [selectedSize, setSelectedSize] = useState(null);
  const isClothing = product.category === CLOTHING_CATEGORY;
  const sizes = (product.sizes && product.sizes.length > 0) ? product.sizes : SIZES;
  const imgs = product.images && product.images.length > 0 ? product.images : (product.image ? [product.image] : []);

  const discountActive = isDiscountActive(product);
  const finalPrice = getEffectivePrice(product);
  const handleAddToCart = () => {
    if (isClothing && !selectedSize) return;
    addToCart({ ...product, price: finalPrice, originalPrice: discountActive ? product.price : null,
      size: isClothing ? selectedSize : null,
      cartKey: isClothing ? (product.id + "_" + selectedSize) : ("" + product.id) });
    onClose();
  };

  const stopProp = (e) => e.stopPropagation();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={stopProp}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-inner">

          {/* Left: gallery */}
          <div className="modal-gallery">
            <div className="modal-gallery-main">
              {product.badge && (
                <div className="pc-badge-wrap" style={{top:"14px",right:"14px",left:"auto"}}>
                  {product.badge === "hit" && <span className="pc-badge pc-badge-hit">Хит</span>}
                  {product.badge === "new" && <span className="pc-badge pc-badge-new">Новинка</span>}
                  {product.badge === "sale" && <span className="pc-badge pc-badge-sale">Акция</span>}
                  {product.badge === "excl" && <span className="pc-badge pc-badge-excl">Эксклюзив</span>}
                </div>
              )}
              {imgs.length > 0 ? (
                <>
                  <img src={imgs[imgIdx]} alt={product.name} />
                  {imgs.length > 1 && (
                    <>
                      <button className="modal-gallery-nav prev" onClick={() => setImgIdx(i => (i - 1 + imgs.length) % imgs.length)}>‹</button>
                      <button className="modal-gallery-nav next" onClick={() => setImgIdx(i => (i + 1) % imgs.length)}>›</button>
                    </>
                  )}
                </>
              ) : (
                <div className="modal-gallery-emoji">{product.emoji}</div>
              )}
            </div>
            {imgs.length > 1 && (
              <div className="modal-thumbs">
                {imgs.map((src, i) => (
                  <div key={i} className={"modal-thumb" + (i === imgIdx ? " active" : "")} onClick={() => setImgIdx(i)}>
                    <img src={src} alt={"фото " + (i + 1)} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: info */}
          <div className="modal-content">
            <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"12px",flexWrap:"wrap"}}>
              <span className="modal-badge" style={{marginBottom:0}}>{product.category}</span>
              {product.sku && <span style={{fontSize:"12px",color:"var(--rd-gray-text)",fontWeight:600}}>Арт.: {product.sku}</span>}
            </div>
            <div className="modal-name">{product.name}</div>
            <div className="modal-desc">{product.desc || "Описание отсутствует."}</div>
            <div className="modal-divider"></div>
            <div className="modal-price-row">
              {discountActive && <div className="modal-price-original">{product.price} {cName}</div>}
              <div style={{display:"flex",alignItems:"baseline",gap:"8px",flexWrap:"wrap"}}>
                <span className="modal-price-val" style={discountActive ? {color:"var(--rd-red)"} : {}}>
                  {finalPrice}
                </span>
                <span className="modal-price-unit">{cName}</span>
                {discountActive && <span className="discount-pill" style={{fontSize:"12px",padding:"3px 10px"}}>&#8722;{product.discount}%</span>}
                {discountActive && product.discountUntil && (
                  <span style={{fontSize:"11px",color:"var(--rd-gray-text)"}}>до {new Date(product.discountUntil).toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</span>
                )}
              </div>
            </div>
            {isClothing && (
              <div style={{marginBottom:"20px"}}>
                <div className="size-label">Выберите размер</div>
                <div className="size-selector">
                  {sizes.map(s => (
                    <button key={s} className={"size-btn" + (selectedSize === s ? " selected" : "")}
                      onClick={() => setSelectedSize(s)}>{s}</button>
                  ))}
                </div>
                {!selectedSize && <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"6px"}}>Выберите размер перед добавлением</div>}
              </div>
            )}
            <button
              className={"btn btn-primary btn-block" + (isClothing && !selectedSize ? " disabled" : "")}
              style={isClothing && !selectedSize ? {opacity:0.5,cursor:"not-allowed"} : {}}
              onClick={handleAddToCart}>
              В корзину
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const ProductCard = memo(function ProductCard({ product, addToCart, onOpen, favorites, toggleFavorite }) {
  const cName = getCurrName();
  const [imgIdx, setImgIdx] = useState(0);
  const imgs = product.images && product.images.length > 0 ? product.images : (product.image ? [product.image] : []);

  const prevImg = (e) => { e.stopPropagation(); setImgIdx(i => (i - 1 + imgs.length) % imgs.length); };
  const nextImg = (e) => { e.stopPropagation(); setImgIdx(i => (i + 1) % imgs.length); };

  return (
    <div className="product-card" style={{cursor:"pointer"}} onClick={() => onOpen(product)}>
      <div className="pc-gallery-wrap">
        {product.badge && (
          <div className="pc-badge-wrap">
            {product.badge === "hit" && <span className="pc-badge pc-badge-hit">Хит</span>}
            {product.badge === "new" && <span className="pc-badge pc-badge-new">Новинка</span>}
            {product.badge === "sale" && <span className="pc-badge pc-badge-sale">Акция</span>}
            {product.badge === "excl" && <span className="pc-badge pc-badge-excl">Эксклюзив</span>}
          </div>
        )}
        {imgs.length > 0 ? (
          <div className="pc-gallery">
            <img src={imgs[imgIdx]} alt={product.name} />
            {imgs.length > 1 && (
              <>
                <button className="pc-gallery-nav prev" onClick={prevImg}>‹</button>
                <button className="pc-gallery-nav next" onClick={nextImg}>›</button>
                <div className="pc-gallery-dots">
                  {imgs.map((_, i) => (
                    <button key={i} className={"pc-gallery-dot" + (i === imgIdx ? " active" : "")}
                      onClick={(e) => { e.stopPropagation(); setImgIdx(i); }} />
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="pc-emoji" style={{position:"relative"}}>{product.emoji}</div>
        )}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px"}}>
        <div className="pc-category" style={{marginBottom:0}}>{product.category}</div>
        {product.sku && <span style={{fontSize:"10px",color:"var(--rd-gray-text)",fontWeight:600}}>SKU: {product.sku}</span>}
      </div>
      <div className="pc-name">{product.name}</div>
      <div className="pc-desc">{product.desc}</div>
      <div className="pc-footer">
        <div className="price-block">
          {isDiscountActive(product) && <span className="price-original">{product.price} {cName}</span>}
          <span className={"price-final" + (isDiscountActive(product) ? " has-discount" : "")}>
            {getEffectivePrice(product)}
            <span className="price-unit-small"> {cName}</span>
          </span>
          {(function() {
            var ss = product.sizeStock || {};
            var hasSS = product.category === CLOTHING_CATEGORY && Object.keys(ss).length > 0;
            // В карточке размер не выбран — показываем суммарный остаток по всем размерам
            var stockVal = hasSS
              ? Object.values(ss).reduce(function(a, b) { return a + b; }, 0)
              : (!hasSS && product.stock !== null && product.stock !== undefined ? product.stock : null);
            if (stockVal === null) return null;
            var clr = stockVal === 0 ? "var(--rd-red)" : stockVal <= 5 ? "#d97706" : "var(--rd-green)";
            var bg2 = stockVal === 0 ? "var(--rd-red-light)" : stockVal <= 5 ? "rgba(245,158,11,0.1)" : "var(--rd-green-light)";
            var bc = stockVal === 0 ? "rgba(199,22,24,0.2)" : stockVal <= 5 ? "rgba(245,158,11,0.2)" : "rgba(5,150,105,0.2)";
            return React.createElement("span", {style:{fontSize:"11px",fontWeight:600,color:clr,background:bg2,padding:"2px 8px",borderRadius:"10px",border:"1px solid",borderColor:bc}},
              stockVal === 0 ? "Нет в наличии" : "📦 " + stockVal + " шт."
            );
          })()}
        </div>
        <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
          {toggleFavorite && (
            <button
              className="btn btn-ghost btn-sm"
              title={favorites && favorites.includes(product.id) ? "Убрать из избранного" : "В избранное"}
              onClick={(e) => { e.stopPropagation(); toggleFavorite(product.id); }}
              style={{fontSize:"18px",padding:"6px 8px",color: favorites && favorites.includes(product.id) ? "var(--rd-red)" : "var(--rd-gray-text)",lineHeight:1,flex:"0 0 auto"}}>
              {favorites && favorites.includes(product.id) ? "❤️" : "🤍"}
            </button>
          )}
          <button className="btn btn-primary btn-sm pc-action-btn" onClick={(e) => { e.stopPropagation(); onOpen(product); }}>
            Подробнее
          </button>
          {addToCart && (
            <button className="btn btn-primary btn-sm pc-action-btn" style={{background:"var(--rd-red)",border:"none",color:"#fff"}} onClick={(e) => { e.stopPropagation(); addToCart(product); }}>
              Купить
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

// ── FAVORITES ────────────────────────────────────────────────────────────

function FavoritesPage({ products, favorites, toggleFavorite, addToCart, setPage }) {
  return (
    <div className="page-fade" style={{padding:"32px 0"}}>
      <div className="container">
        <div className="page-eyebrow">Мой список</div>
        <h2 className="page-title">Избранное</h2>
        {products.length === 0
          ? <div className="empty-state" style={{marginTop:"60px"}}>
              <div className="empty-state-icon">🤍</div>
              <div className="empty-state-text">Вы ещё не добавили товары в избранное</div>
              <button className="btn btn-primary" style={{marginTop:"20px"}} onClick={() => setPage("shop")}>Перейти в магазин</button>
            </div>
          : <div className="products-grid">
              {products.map(p => (
                <ProductCard key={p.id} product={p} addToCart={addToCart} onOpen={() => {}} favorites={favorites} toggleFavorite={toggleFavorite} />
              ))}
            </div>
        }
      </div>
    </div>
  );
}

    // ── CART ──────────────────────────────────────────────────────────────────

function CartPage({ cart, removeFromCart, cartTotal, checkout, currentUser, setPage, users, currency }) {
  const cName = getCurrName(currency);
  return (
    <div className="page-inner">
      <div className="page-eyebrow">Корзина</div>
      <h2 className="page-title">Ваш выбор</h2>
      {cart.length === 0
        ? <div className="cart-empty">
            <div className="cart-empty-icon">🛒</div>
            <div className="cart-empty-text">Корзина пуста</div>
            <button className="btn btn-secondary" onClick={() => setPage("shop")}>Перейти в магазин</button>
          </div>
        : <>
            <div className="cart-list">
              {cart.map((item, idx) => (
                <div key={item.cartKey || item.id} className="cart-item">
                  <div className="cart-item-left">
                    <span className="cart-item-emoji">{item.emoji}</span>
                    <div>
                      <div className="cart-item-name">{item.name}{item.size ? <span style={{marginLeft:"8px",fontSize:"11px",fontWeight:700,background:"var(--rd-gray-bg)",border:"1.5px solid var(--rd-gray-border)",borderRadius:"6px",padding:"1px 7px",color:"var(--rd-dark)"}}>{item.size}</span> : null}</div>
                      <div className="cart-item-meta">×{item.qty} × {item.price} {cName}{item.originalPrice ? <span style={{textDecoration:"line-through",marginLeft:"6px",color:"#aaa",fontSize:"11px"}}>{item.originalPrice}</span> : null}</div>
                    </div>
                  </div>
                  <div className="cart-item-right">
                    <span className="cart-item-price">{item.price * item.qty}</span>
                    <button className="cart-item-remove" onClick={() => removeFromCart(item.cartKey || ("" + item.id))}>✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="cart-summary" style={{marginTop:"8px"}}>
              <div>
                <div className="cs-label">Итого к оплате</div>
                <div className="cs-total">{cartTotal}<span className="cs-unit">{cName}</span></div>
                {currentUser && <div className="cs-balance">Баланс: {users[currentUser]?.balance || 0} {cName}</div>}
              </div>
              <button className="btn btn-primary btn-lg" onClick={checkout}>
                {currentUser ? "Оформить заказ" : "Войти и купить"}
              </button>
            </div>
          </>
      }
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────────────

function LoginPage({ users, setCurrentUser, setPage, notify, appearance, saveUsers }) {
  const [form, setForm] = useState({ username: "", password: "", remember: true });
  const submit = () => {
    const u = users[form.username];
    if (!u) { notify("Пользователь не найден", "err"); return; }
    if (u.password !== form.password) { notify("Неверный пароль", "err"); return; }
    setCurrentUser(form.username);
    // Всегда сохраняем сессию в localStorage (не зависит от «Запомнить меня»)
    _lsSet("cm_session", { user: form.username, ts: Date.now() });
    notify(`Добро пожаловать, ${form.username}!`);
    setPage("shop");
  };

  const bx24 = appearance?.bitrix24 || {};
  const handleBitrix24 = () => {
    if (!bx24.portalUrl || !bx24.clientId) {
      notify("Битрикс24 не настроен администратором", "err");
      return;
    }
    const redirectUri = encodeURIComponent(window.location.origin + "/oauth/bitrix24");
    const state = btoa(JSON.stringify({ ts: Date.now() }));
    const authUrl = `${bx24.portalUrl}/oauth/authorize/?client_id=${bx24.clientId}&response_type=code&redirect_uri=${redirectUri}&state=${state}`;
    // Store state for verification
    _lsSet("bx24_oauth_state", state);
    window.location.href = authUrl;
  };

  // Check for OAuth callback params (code in URL)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("bx24_code");
    const bxUser = params.get("bx24_user");
    const bxEmail = params.get("bx24_email");
    const bxFirst = params.get("bx24_first");
    const bxLast = params.get("bx24_last");
    if (code === "ok" && bxUser) {
      // User authenticated via Bitrix24
      const existing = users[bxUser];
      if (!existing) {
        // Auto-create account
        const newUser = {
          username: bxUser,
          firstName: bxFirst || bxUser,
          lastName: bxLast || "",
          email: bxEmail || "",
          password: "",
          role: "user",
          balance: 0,
          createdAt: Date.now(),
          bitrix24: true,
        };
        if (saveUsers) saveUsers({ ...users, [bxUser]: newUser });
      }
      setCurrentUser(bxUser);
      _lsSet("cm_session", { user: bxUser, ts: Date.now() });
      notify(`Добро пожаловать, ${bxFirst || bxUser}!`);
      // Clear URL params
      window.history.replaceState({}, "", window.location.pathname);
      setPage("shop");
    }
  }, []);

  const registrationEnabled = appearance?.registrationEnabled !== false;

  return (
    <div className="auth-wrap">
      <div className="page-eyebrow">Вход</div>
      <h2 className="page-title" style={{fontSize:"32px"}}>Войдите в аккаунт</h2>
      <div className="auth-card">
        {bx24.enabled && (
          <>
            <button
              onClick={handleBitrix24}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:"10px",padding:"12px 20px",borderRadius:"var(--rd-radius-sm)",border:"1.5px solid rgba(255,87,34,0.35)",background:"#fff",cursor:"pointer",fontWeight:700,fontSize:"15px",color:"#FF5722",transition:"all 0.2s",marginBottom:"8px"}}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,87,34,0.06)";e.currentTarget.style.borderColor="rgba(255,87,34,0.6)"}}
              onMouseLeave={e=>{e.currentTarget.style.background="#fff";e.currentTarget.style.borderColor="rgba(255,87,34,0.35)"}}>
              <span style={{width:"24px",height:"24px",borderRadius:"6px",background:"#FF5722",display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:900,fontSize:"14px",flexShrink:0}}>B</span>
              Войти через Битрикс24
            </button>
            <div style={{display:"flex",alignItems:"center",gap:"10px",margin:"16px 0"}}>
              <div style={{flex:1,height:"1px",background:"var(--rd-gray-border)"}}></div>
              <span style={{fontSize:"12px",color:"var(--rd-gray-text)",fontWeight:600,whiteSpace:"nowrap"}}>или войдите с паролем</span>
              <div style={{flex:1,height:"1px",background:"var(--rd-gray-border)"}}></div>
            </div>
          </>
        )}
        <div className="form-field">
          <label className="form-label">Email</label>
          <input className="form-input" type="email" placeholder="Введите email" value={form.username} onChange={e => setForm({...form, username: e.target.value})} />
        </div>
        <div className="form-field">
          <label className="form-label">Пароль</label>
          <input className="form-input" type="password" placeholder="Введите пароль" value={form.password} onChange={e => setForm({...form, password: e.target.value})} onKeyDown={e => e.key === "Enter" && submit()} />
        </div>
        <label style={{display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",fontSize:"14px",color:"var(--rd-gray-text)",marginTop:"4px",userSelect:"none"}}>
          <input type="checkbox" checked={form.remember} onChange={e=>setForm({...form,remember:e.target.checked})} style={{width:"16px",height:"16px",accentColor:"var(--rd-red)",cursor:"pointer"}} />
          Запомнить меня
        </label>
        <button className="btn btn-primary btn-block" style={{marginTop:"8px"}} onClick={submit}>Войти</button>
        {registrationEnabled && (
          <div className="auth-link">
            Нет аккаунта? <a onClick={() => setPage("register")}>Зарегистрироваться</a>
          </div>
        )}
      </div>
    </div>
  );
}

// ── REGISTER ──────────────────────────────────────────────────────────────

function RegisterPage({ users, saveUsers, setCurrentUser, setPage, notify, appearance }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "", confirm: "" });

  if (appearance?.registrationEnabled === false) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{textAlign:"center",padding:"48px 36px"}}>
          <div style={{fontSize:"48px",marginBottom:"16px"}}>🔒</div>
          <div style={{fontWeight:800,fontSize:"20px",color:"var(--rd-dark)",marginBottom:"10px"}}>Регистрация закрыта</div>
          <div style={{fontSize:"14px",color:"var(--rd-gray-text)",marginBottom:"24px"}}>Самостоятельная регистрация отключена администратором. Обратитесь к администратору для создания аккаунта.</div>
          <button className="btn btn-primary" onClick={() => setPage("login")}>Войти</button>
        </div>
      </div>
    );
  }

  const submit = () => {
    if (!form.firstName || !form.lastName || !form.email || !form.password) { notify("Заполните все обязательные поля", "err"); return; }
    if (form.password !== form.confirm) { notify("Пароли не совпадают", "err"); return; }
    // Проверяем email как уникальный идентификатор
    const emailExists = Object.values(users).some(u => u.email === form.email);
    if (emailExists) { notify("Email уже зарегистрирован", "err"); return; }
    if (form.password.length < 6) { notify("Пароль минимум 6 символов", "err"); return; }
    // Используем email как username
    const username = form.email;
    const newUser = { username: username, firstName: form.firstName, lastName: form.lastName, email: form.email, password: form.password, role: "user", balance: 0, createdAt: Date.now() };
    const newUsers = { ...users, [username]: newUser };
    saveUsers(newUsers);
    setCurrentUser(username);
    _lsSet("cm_session", { user: username, ts: Date.now() });
    notify("Регистрация прошла успешно!");
    setPage("shop");
  };
  return (
    <div className="auth-wrap">
      <div className="page-eyebrow">Регистрация</div>
      <h2 className="page-title" style={{fontSize:"32px"}}>Создайте аккаунт</h2>
      <div className="auth-card">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
          <div className="form-field">
            <label className="form-label">Имя <span style={{color:"var(--rd-red)"}}>*</span></label>
            <input className="form-input" placeholder="Иван" value={form.firstName} onChange={e => setForm({...form, firstName: e.target.value})} />
          </div>
          <div className="form-field">
            <label className="form-label">Фамилия <span style={{color:"var(--rd-red)"}}>*</span></label>
            <input className="form-input" placeholder="Петров" value={form.lastName} onChange={e => setForm({...form, lastName: e.target.value})} />
          </div>
        </div>
        <div className="form-field">
          <label className="form-label">Email <span style={{color:"var(--rd-red)"}}>*</span></label>
          <input className="form-input" type="email" placeholder="example@corp.ru" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
          <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"4px"}}>Email будет использоваться для входа в систему</div>
        </div>
        <div className="form-field">
          <label className="form-label">Пароль</label>
          <input className="form-input" type="password" placeholder="Минимум 6 символов" value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
        </div>
        <div className="form-field">
          <label className="form-label">Подтвердите пароль</label>
          <input className="form-input" type="password" placeholder="Повторите пароль" value={form.confirm} onChange={e => setForm({...form, confirm: e.target.value})} onKeyDown={e => e.key === "Enter" && submit()} />
        </div>
        <button className="btn btn-primary btn-block" style={{marginTop:"8px"}} onClick={submit}>Зарегистрироваться</button>
        <div className="auth-link">
          Уже есть аккаунт? <a onClick={() => setPage("login")}>Войти</a>
        </div>
      </div>
    </div>
  );
}

// ── USER EDIT FORM ────────────────────────────────────────────────────────

class UserEditErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:"20px",background:"#fef2f2",border:"1.5px solid #fca5a5",borderRadius:"10px",color:"#991b1b"}}>
          <div style={{fontWeight:700,marginBottom:"8px"}}>⚠️ Ошибка при открытии формы</div>
          <div style={{fontSize:"12px",fontFamily:"monospace",wordBreak:"break-all"}}>{this.state.error.message}</div>
          <button className="btn btn-ghost btn-sm" style={{marginTop:"12px"}} onClick={()=>this.setState({error:null})}>Попробовать снова</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function UserEditForm({ username, user, users, saveUsers, notify, onClose, isAdmin }) {
  const safeUser = user || {};
  const [form, setForm] = useState({ email: safeUser.email || "", newPassword: "", confirmPassword: "", birthdate: safeUser.birthdate || "", employmentDate: safeUser.employmentDate || "", avatar: safeUser.avatar || "" });

  const save = () => {
    if (!form.email.trim()) { notify("Email не может быть пустым", "err"); return; }
    if (form.newPassword && form.newPassword.length < 6) { notify("Пароль минимум 6 символов", "err"); return; }
    if (form.newPassword && form.newPassword !== form.confirmPassword) { notify("Пароли не совпадают", "err"); return; }
    // ВАЖНО: берём АКТУАЛЬНЫЕ данные пользователя из users (не из замыкания safeUser)
    // чтобы не затереть баланс/роль/пароль и другие поля обновлённые polling-ом
    const currentUserData = users[username] || safeUser;
    const updated = {
      ...currentUserData,
      email: form.email.trim(),
      avatar: form.avatar || currentUserData.avatar || "",
      birthdate: form.birthdate || currentUserData.birthdate || "",
      employmentDate: form.employmentDate || currentUserData.employmentDate || "",
    };
    // Меняем пароль ТОЛЬКО если админ явно ввёл новый пароль
    if (form.newPassword) {
      updated.password = form.newPassword;
    }
    // Гарантируем что пароль, роль и баланс НИКОГДА не потеряются
    if (!updated.password) updated.password = currentUserData.password;
    if (!updated.role) updated.role = currentUserData.role || "user";
    if (updated.balance === undefined || updated.balance === null) updated.balance = currentUserData.balance || 0;
    // Сохраняем — берём АКТУАЛЬНЫЙ объект users (не stale) и обновляем ТОЛЬКО этого пользователя
    const freshUsers = { ...users };
    // Гарантируем что другие пользователи не потеряются
    Object.keys(freshUsers).forEach(u => {
      if (!freshUsers[u]) freshUsers[u] = users[u];
    });
    freshUsers[username] = updated;
    saveUsers(freshUsers);
    notify("Профиль пользователя обновлён ✓");
    onClose();
  };

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"20px",padding:"12px 16px",background:"var(--rd-gray-bg)",borderRadius:"var(--rd-radius-sm)",border:"1.5px solid var(--rd-gray-border)"}}>
        <div style={{width:"40px",height:"40px",borderRadius:"50%",background:"var(--rd-red-light)",border:"1.5px solid rgba(199,22,24,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:"16px",color:"var(--rd-red)"}}>
          {(username||"?")[0].toUpperCase()}
        </div>
        <div>
          <div style={{fontWeight:700,fontSize:"15px"}}>{username}</div>
          <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>{safeUser.role === "admin" ? "Администратор" : "Пользователь"}</div>
        </div>
      </div>
      <div className="form-field">
        <label className="form-label">Email</label>
        <input className="form-input" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="email@corp.ru" />
      </div>
      <div className="form-field">
        <label className="form-label">Дата рождения</label>
        <input className="form-input" type="date" value={form.birthdate} onChange={e => { if (isAdmin) setForm(f => ({...f, birthdate: e.target.value})); }} disabled={!isAdmin} style={!isAdmin ? {opacity:0.6,cursor:"not-allowed"} : {}} />
        {!isAdmin && <div style={{fontSize:"11px",color:"var(--rd-gray-text)",marginTop:"4px"}}>Редактировать может только администратор</div>}
      </div>
      <div className="form-field">
        <label className="form-label">Дата трудоустройства <span style={{fontSize:"11px",color:"var(--rd-red)",fontWeight:600}}>(только для администратора)</span></label>
        <input className="form-input" type="date" value={form.employmentDate} onChange={e => setForm(f => ({...f, employmentDate: e.target.value}))} />
        {form.employmentDate && !isNaN(new Date(form.employmentDate)) && <div style={{fontSize:"11px",color:"var(--rd-gray-text)",marginTop:"4px"}}>📅 {new Date(form.employmentDate).toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric"})}</div>}
      </div>
      <div style={{height:"1px",background:"var(--rd-gray-border)",margin:"16px 0"}}></div>
      <div style={{fontSize:"12px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",color:"var(--rd-gray-text)",marginBottom:"12px"}}>Сменить пароль</div>
      <div className="form-field">
        <label className="form-label">Новый пароль</label>
        <input className="form-input" type="password" placeholder="Оставьте пустым, чтобы не менять" value={form.newPassword} onChange={e => setForm(f => ({...f, newPassword: e.target.value}))} />
      </div>
      <div className="form-field">
        <label className="form-label">Подтвердите пароль</label>
        <input className="form-input" type="password" placeholder="Повторите новый пароль" value={form.confirmPassword} onChange={e => setForm(f => ({...f, confirmPassword: e.target.value}))} />
      </div>
      <button className="btn btn-primary btn-block" style={{marginTop:"8px"}} onClick={save}>Сохранить изменения</button>
    </div>
  );
}

// ── ADMIN ─────────────────────────────────────────────────────────────────

const BLANK_PRODUCT = { name: "", price: "", category: "Одежда", emoji: "🛍️", desc: "", images: [], sizes: ["S","M","L","XL","XXL"], sku: "", badge: "", discount: 0, discountUntil: "", inactive: false, stock: "", sizeStock: {} };
const ALL_CATEGORIES = ["Одежда", "Аксессуары", "Посуда", "Канцелярия"];
const EMOJIS = ["🛍️","👕","🧥","🧢","👟","🎒","☕","🍵","📓","✏️","📌","🎨","☂️","🧦","🏅","💼","🕶️","🧤","🧣","⌚"];


// ── WORKDAYS TAB ─────────────────────────────────────────────────────────────
function WorkdaysTab({ users, currentUser, notify, saveUsers, transfers, saveTransfers, appearance, saveAppearance }) {
  const workdaysCfg = (appearance.workdays) || {};
  const wdCurrName = getCurrName(appearance.currency);
  const [coinsPerDay, setCoinsPerDay] = useState(String(workdaysCfg.coinsPerDay || 10));
  const [globalMode, setGlobalMode] = useState(workdaysCfg.globalMode || "employment");
  const [globalCustomDate, setGlobalCustomDate] = useState(workdaysCfg.globalCustomDate || "");
  const [userOverrides, setUserOverrides] = useState(workdaysCfg.userOverrides || {});
  const [filterStr, setFilterStr] = useState("");
  const [openUsers, setOpenUsers] = useState({});

  const allUsers = Object.entries(users).filter(([u]) => u !== "admin" && u !== currentUser);
  const filtered = allUsers.filter(([u]) => u.toLowerCase().includes(filterStr.toLowerCase()));

  const saveSettings = () => {
    const coins = Number(coinsPerDay);
    if (isNaN(coins) || coins < 0) { notify("Некорректное количество " + wdCurrName, "err"); return; }
    const cfg = { coinsPerDay: coins, globalMode, globalCustomDate, userOverrides };
    saveAppearance({ ...appearance, workdays: cfg });
    notify("Настройки трудодней сохранены ✓");
  };

  const getUserMode = (u) => userOverrides[u]?.mode || null;
  const getEffectiveMode = (u) => userOverrides[u]?.mode || globalMode;
  const getUserCustomDate = (u) => userOverrides[u]?.customDate || "";
  const setUserMode = (u, mode) => setUserOverrides(prev => ({ ...prev, [u]: { ...(prev[u]||{}), mode } }));
  const setUserCustomDate = (u, d) => setUserOverrides(prev => ({ ...prev, [u]: { ...(prev[u]||{}), customDate: d } }));
  const clearUserOverride = (u) => setUserOverrides(prev => { const n={...prev}; delete n[u]; return n; });
  const toggleUserOpen = (u) => setOpenUsers(prev => ({ ...prev, [u]: !prev[u] }));

  const getStartDate = (u, ud) => {
    const override = userOverrides[u];
    const mode = override?.mode || globalMode;
    if (mode === "employment") return ud.employmentDate || null;
    if (mode === "activation") return ud.activationDate || ud.createdAt || null;
    if (mode === "custom") {
      const d = override?.customDate || globalCustomDate;
      return d || null;
    }
    return null;
  };

  const calcDays = (u, ud) => {
    const startStr = getStartDate(u, ud);
    if (!startStr) return null;
    const start = new Date(startStr);
    const now = new Date();
    if (isNaN(start.getTime()) || start > now) return 0;
    return Math.floor((now - start) / (1000 * 60 * 60 * 24));
  };

  const runAccrual = () => {
    const coins = Number(coinsPerDay);
    if (isNaN(coins) || coins <= 0) { notify("Укажите количество " + wdCurrName + " за день", "err"); return; }
    const updated = { ...users };
    const now = new Date().toLocaleString("ru-RU");
    const newTransfers = [...(transfers || [])];
    let count = 0;
    allUsers.forEach(([u, ud]) => {
      const days = calcDays(u, ud);
      if (days === null || days <= 0) return;
      const amount = coins * days;
      updated[u] = { ...updated[u], balance: (updated[u].balance || 0) + amount };
      newTransfers.push({ id: Date.now() + Math.random(), from: currentUser, to: u, amount, comment: "Трудодни: " + days + " дн. × " + coins + " " + wdCurrName, date: now });
      count++;
    });
    if (count === 0) { notify("Нет пользователей для начисления (не указаны даты)", "err"); return; }
    saveUsers(updated);
    if (saveTransfers) saveTransfers(newTransfers);
    notify("Трудодни начислены " + count + " пользователям ✓");
  };

  const modeLabel = { employment: "от даты трудоустройства", activation: "от даты активации", custom: "от указанной даты" };

  return (
    <div>
      <div className="settings-card" style={{marginBottom:"16px"}}>
        <div style={{fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"var(--rd-gray-text)",marginBottom:"20px",paddingBottom:"10px",borderBottom:"1px solid var(--rd-gray-border)"}}>⚙️ Параметры начисления</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"20px",marginBottom:"20px"}}>
          <div>
            <div style={{fontSize:"12px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",color:"var(--rd-gray-text)",marginBottom:"6px"}}>{wdCurrName} за 1 день работы</div>
            <div style={{position:"relative"}}>
              <input className="form-input" type="number" min="0" step="0.5" placeholder="10" value={coinsPerDay}
                onChange={e => setCoinsPerDay(e.target.value)}
                style={{paddingRight:"96px",fontSize:"20px",fontWeight:700}} />
              <span style={{position:"absolute",right:"14px",top:"50%",transform:"translateY(-50%)",fontSize:"12px",fontWeight:700,color:"var(--rd-gray-text)"}}>{wdCurrName}/день</span>
            </div>
            <div style={{display:"flex",gap:"6px",marginTop:"8px",flexWrap:"wrap"}}>
              {[1,5,10,25,50].map(v => (
                <button key={v} onClick={() => setCoinsPerDay(String(v))}
                  style={{padding:"4px 10px",borderRadius:"20px",border:"1.5px solid var(--rd-gray-border)",background:String(coinsPerDay)===String(v)?"var(--rd-red)":"#fff",color:String(coinsPerDay)===String(v)?"#fff":"var(--rd-gray-text)",fontSize:"12px",fontWeight:700,cursor:"pointer"}}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:"12px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",color:"var(--rd-gray-text)",marginBottom:"6px"}}>Способ начисления (по умолчанию)</div>
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              {[["employment","💼 От даты трудоустройства"],["activation","✅ От даты активации"],["custom","📅 От указанной даты"]].map(([v,l]) => (
                <label key={v} style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 14px",border:"1.5px solid " + (globalMode===v?"var(--rd-red)":"var(--rd-gray-border)"),borderRadius:"10px",background:globalMode===v?"var(--rd-red-light)":"#fff",cursor:"pointer",transition:"all 0.12s"}}>
                  <input type="radio" checked={globalMode===v} onChange={()=>setGlobalMode(v)} style={{accentColor:"var(--rd-red)"}} />
                  <span style={{fontSize:"13px",fontWeight:globalMode===v?700:400,color:globalMode===v?"var(--rd-red)":"var(--rd-dark)"}}>{l}</span>
                </label>
              ))}
            </div>
            {globalMode === "custom" && (
              <div style={{marginTop:"10px"}}>
                <div style={{fontSize:"12px",fontWeight:600,color:"var(--rd-gray-text)",marginBottom:"4px"}}>Дата начала начисления</div>
                <input className="form-input" type="date" value={globalCustomDate} onChange={e=>setGlobalCustomDate(e.target.value)} />
              </div>
            )}
          </div>
        </div>
        <div style={{display:"flex",gap:"12px"}}>
          <button className="btn btn-primary" onClick={saveSettings}>💾 Сохранить настройки</button>
        </div>
      </div>

      <div className="settings-card" style={{marginBottom:"16px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"16px",paddingBottom:"10px",borderBottom:"1px solid var(--rd-gray-border)"}}>
          <div style={{fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"var(--rd-gray-text)"}}>
            👥 Индивидуальные настройки ({allUsers.length} польз.)
          </div>
          <input className="form-input" placeholder="Поиск..." value={filterStr} onChange={e=>setFilterStr(e.target.value)}
            style={{padding:"6px 12px",fontSize:"13px",width:"160px"}} />
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:"10px",maxHeight:"440px",overflowY:"auto"}}>
          {filtered.length === 0
            ? <div style={{padding:"24px",textAlign:"center",color:"var(--rd-gray-text)"}}>Пользователи не найдены</div>
            : filtered.map(([u, ud]) => {
                const override = userOverrides[u];
                const isOpen = !!openUsers[u];
                const days = calcDays(u, ud);
                const effectiveMode = getEffectiveMode(u);
                const coins = Number(coinsPerDay) || 0;
                return (
                  <div key={u} style={{border:"1.5px solid " + (override?"rgba(199,22,24,0.3)":"var(--rd-gray-border)"),borderRadius:"12px",padding:"14px 16px",background:override?"rgba(199,22,24,0.03)":"#fff"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
                      {ud.avatar
                        ? <img src={ud.avatar} style={{width:"36px",height:"36px",borderRadius:"50%",objectFit:"cover",flexShrink:0}} alt="" />
                        : <div style={{width:"36px",height:"36px",borderRadius:"50%",background:"var(--rd-red-light)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:"14px",color:"var(--rd-red)",flexShrink:0}}>{u[0].toUpperCase()}</div>
                      }
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>{u}</div>
                        <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>
                          {override
                            ? <span style={{color:"var(--rd-red)",fontWeight:600}}>⚡ Индивид.: {modeLabel[effectiveMode]}</span>
                            : <span>По умолчанию: {modeLabel[effectiveMode]}</span>
                          }
                          {days !== null && <span style={{marginLeft:"8px",fontWeight:700,color:"var(--rd-green)"}}>· {days} дн. · +{(days*(Number(coinsPerDay)||0)).toFixed(0)} мон.</span>}
                          {days === null && <span style={{marginLeft:"8px",color:"#f59e0b",fontWeight:600}}>· дата не задана</span>}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:"6px",flexShrink:0}}>
                        {override && (
                          <button onClick={()=>clearUserOverride(u)} className="btn btn-ghost btn-sm" style={{fontSize:"11px",color:"var(--rd-red)"}}>✕ Сбросить</button>
                        )}
                        <button onClick={()=>toggleUserOpen(u)} className="btn btn-ghost btn-sm" style={{fontSize:"11px"}}>
                          {isOpen ? "Скрыть" : "⚙️ Настроить"}
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{paddingTop:"10px",borderTop:"1px solid var(--rd-gray-border)",marginTop:"10px",display:"flex",flexDirection:"column",gap:"8px"}}>
                        <div style={{fontSize:"12px",fontWeight:700,color:"var(--rd-gray-text)",textTransform:"uppercase",letterSpacing:"0.05em"}}>Способ начисления для {u}</div>
                        <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                          {[["employment","💼 Трудоустройство"],["activation","✅ Активация"],["custom","📅 Своя дата"]].map(([v,l]) => (
                            <label key={v} style={{display:"inline-flex",alignItems:"center",gap:"6px",padding:"6px 12px",border:"1.5px solid " + (effectiveMode===v?"var(--rd-red)":"var(--rd-gray-border)"),borderRadius:"8px",background:effectiveMode===v?"var(--rd-red-light)":"#fff",cursor:"pointer",fontSize:"12px",fontWeight:effectiveMode===v?700:400}}>
                              <input type="radio" checked={effectiveMode===v} onChange={()=>setUserMode(u,v)} style={{accentColor:"var(--rd-red)"}} />
                              {l}
                            </label>
                          ))}
                        </div>
                        {effectiveMode==="custom" && (
                          <div>
                            <div style={{fontSize:"12px",fontWeight:600,marginBottom:"4px",color:"var(--rd-gray-text)"}}>Дата начала</div>
                            <input className="form-input" type="date" value={getUserCustomDate(u)} onChange={e=>setUserCustomDate(u,e.target.value)} style={{maxWidth:"200px"}} />
                          </div>
                        )}
                        {effectiveMode==="employment" && !ud.employmentDate && (
                          <div style={{fontSize:"12px",color:"#f59e0b",fontWeight:600}}>⚠️ Дата трудоустройства не задана в профиле пользователя</div>
                        )}
                        {effectiveMode==="activation" && !ud.activationDate && !ud.createdAt && (
                          <div style={{fontSize:"12px",color:"#f59e0b",fontWeight:600}}>⚠️ Дата активации не задана</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
          }
        </div>
      </div>

      <div style={{background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius)",padding:"20px 28px",boxShadow:"var(--rd-shadow-md)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"16px"}}>
        <div>
          <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)",marginBottom:"2px"}}>Начислить трудодни вручную</div>
          <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>Начисляется {coinsPerDay} мон. × количество дней для каждого пользователя. Автоматически — в 0:00.</div>
        </div>
        <button className="btn btn-primary" style={{minWidth:"180px",fontSize:"14px",flexShrink:0}} onClick={runAccrual}>
          💼 Начислить трудодни
        </button>
      </div>
    </div>
  );
}

function BulkAccrualTab({ users, currentUser, notify, saveUsers, transfers, saveTransfers, appearance }) {
  const bulkCurrName = getCurrName(appearance?.currency);
  
  const allUsers = Object.entries(users).filter(([u]) => u !== currentUser);
  const [bulkAmt, setBulkAmt] = useState("");
  const [bulkComment, setBulkComment] = useState("Начисление от администратора");
  const [bulkSelected, setBulkSelected] = useState(() => new Set(allUsers.map(([u]) => u)));
  const [bulkFilter, setBulkFilter] = useState("");

  const filtered = allUsers.filter(([u]) => u.toLowerCase().includes(bulkFilter.toLowerCase()));
  const toggleUser = (u) => setBulkSelected(prev => { const s = new Set(prev); s.has(u) ? s.delete(u) : s.add(u); return s; });
  const toggleAll = () => {
    const allIn = filtered.every(([u]) => bulkSelected.has(u));
    setBulkSelected(prev => { const s = new Set(prev); filtered.forEach(([u]) => allIn ? s.delete(u) : s.add(u)); return s; });
  };
  const totalCoins = (Number(bulkAmt) || 0) * bulkSelected.size;

  const doAccrue = () => {
    const amt = Number(bulkAmt);
    if (!amt || amt <= 0) { notify("Введите сумму начисления", "err"); return; }
    if (bulkSelected.size === 0) { notify("Выберите хотя бы одного пользователя", "err"); return; }
    const updated = { ...users };
    const now = new Date().toLocaleString("ru-RU");
    const newTransfers = [...(transfers || [])];
    bulkSelected.forEach(u => {
      updated[u] = { ...updated[u], balance: (updated[u].balance || 0) + amt };
      newTransfers.push({ id: Date.now() + Math.random(), from: currentUser, to: u, amount: amt, comment: bulkComment || "Начисление от администратора", date: now });
    });
    saveUsers(updated);
    if (saveTransfers) saveTransfers(newTransfers);
    notify(`Начислено ${amt} ${getCurrName()} для ${bulkSelected.size} пользователей ✓`);
    setBulkAmt(""); setBulkSelected(new Set(allUsers.map(([u]) => u)));
  };

  return (
    <div>
      <div className="settings-card" style={{marginBottom:"16px"}}>
        <div style={{fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"var(--rd-gray-text)",marginBottom:"20px",paddingBottom:"10px",borderBottom:"1px solid var(--rd-gray-border)"}}>Параметры начисления</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"16px",marginBottom:"16px"}}>
          <div>
            <div style={{fontSize:"12px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",color:"var(--rd-gray-text)",marginBottom:"6px"}}>Сумма начисления</div>
            <div style={{position:"relative"}}>
              <input className="form-input" type="number" min="1" placeholder="0" value={bulkAmt}
                onChange={e => setBulkAmt(e.target.value)}
                style={{paddingRight:"64px",fontSize:"20px",fontWeight:700}} />
              <span style={{position:"absolute",right:"14px",top:"50%",transform:"translateY(-50%)",fontSize:"12px",fontWeight:700,color:"var(--rd-gray-text)"}}>{bulkCurrName}</span>
            </div>
            <div style={{display:"flex",gap:"6px",marginTop:"8px",flexWrap:"wrap"}}>
              {[50,100,250,500,1000].map(v => (
                <button key={v} onClick={() => setBulkAmt(String(v))}
                  style={{padding:"4px 10px",borderRadius:"20px",border:"1.5px solid var(--rd-gray-border)",background:bulkAmt==v?"var(--rd-red)":"#fff",color:bulkAmt==v?"#fff":"var(--rd-gray-text)",fontSize:"12px",fontWeight:700,cursor:"pointer"}}>
                  +{v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:"12px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",color:"var(--rd-gray-text)",marginBottom:"6px"}}>Комментарий</div>
            <input className="form-input" placeholder="Начисление от администратора" value={bulkComment} onChange={e => setBulkComment(e.target.value)} />
          </div>
        </div>
        {bulkAmt > 0 && bulkSelected.size > 0 && (
          <div style={{background:"var(--rd-green-light)",border:"1px solid rgba(5,150,105,0.25)",borderRadius:"var(--rd-radius-sm)",padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"16px",marginTop:"4px"}}>
            <div>
              <div style={{fontSize:"13px",color:"var(--rd-green)",fontWeight:700}}>Итого будет начислено</div>
              <div style={{fontSize:"12px",color:"var(--rd-green)",opacity:0.8}}>{bulkSelected.size} получателей × {bulkAmt} {bulkCurrName}</div>
            </div>
            <div style={{fontSize:"28px",fontWeight:800,color:"var(--rd-green)"}}>{totalCoins} {bulkCurrName}</div>
          </div>
        )}
      </div>

      <div className="settings-card" style={{marginBottom:"16px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"16px",paddingBottom:"10px",borderBottom:"1px solid var(--rd-gray-border)"}}>
          <div style={{fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"var(--rd-gray-text)"}}>
            Получатели ({bulkSelected.size} из {allUsers.length})
          </div>
          <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
            <input className="form-input" placeholder="Поиск..." value={bulkFilter} onChange={e=>setBulkFilter(e.target.value)}
              style={{padding:"6px 12px",fontSize:"13px",width:"160px"}} />
            <button onClick={toggleAll} className="btn btn-ghost btn-sm">
              {filtered.every(([u]) => bulkSelected.has(u)) ? "Снять все" : "Выбрать все"}
            </button>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:"6px",maxHeight:"360px",overflowY:"auto"}}>
          {filtered.length === 0
            ? <div style={{padding:"24px",textAlign:"center",color:"var(--rd-gray-text)",fontSize:"14px"}}>Пользователи не найдены</div>
            : filtered.map(([u, ud]) => {
                const selected = bulkSelected.has(u);
                return (
                  <div key={u} onClick={() => toggleUser(u)}
                    style={{display:"flex",alignItems:"center",gap:"14px",padding:"12px 16px",borderRadius:"10px",border:"1.5px solid",borderColor:selected?"var(--rd-red)":"var(--rd-gray-border)",background:selected?"var(--rd-red-light)":"#fff",cursor:"pointer",transition:"all 0.12s"}}>
                    <div style={{width:"20px",height:"20px",borderRadius:"5px",border:"2px solid",borderColor:selected?"var(--rd-red)":"var(--rd-gray-border)",background:selected?"var(--rd-red)":"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:"12px",color:"#fff",fontWeight:800}}>
                      {selected ? "✓" : ""}
                    </div>
                    {ud.avatar
                      ? <img src={ud.avatar} style={{width:"36px",height:"36px",borderRadius:"50%",objectFit:"cover",flexShrink:0}} alt="" />
                      : <div style={{width:"36px",height:"36px",borderRadius:"50%",background:"var(--rd-red-light)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:"14px",color:"var(--rd-red)",flexShrink:0}}>
                          {u[0].toUpperCase()}
                        </div>
                    }
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>{u}</div>
                      <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>{ud.email || "—"} · {ud.role === "admin" ? "Администратор" : "Пользователь"}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)"}}>{ud.balance || 0}</div>
                      <div style={{fontSize:"11px",color:"var(--rd-gray-text)"}}>{getCurrName()}</div>
                      {selected && bulkAmt > 0 && (
                        <div style={{fontSize:"11px",color:"var(--rd-green)",fontWeight:700}}>+{bulkAmt}</div>
                      )}
                    </div>
                  </div>
                );
              })
          }
        </div>
      </div>

      <div style={{display:"flex",gap:"12px"}}>
        <button className="btn btn-primary" style={{minWidth:"200px",fontSize:"15px"}} onClick={doAccrue}
          disabled={!bulkAmt || bulkSelected.size === 0}>
          🪙 Начислить {bulkAmt > 0 && bulkSelected.size > 0 ? `${totalCoins} ${bulkCurrName}` : ""}
        </button>
        <button className="btn btn-ghost" onClick={() => { setBulkSelected(new Set(allUsers.map(([u])=>u))); setBulkAmt(""); }}>
          Сбросить
        </button>
      </div>
    </div>
  );
}



function FaqAdminTab({ faq, saveFaq, notify }) {
  
  const faqList = faq || [];
  const [qInput, setQInput] = useState("");
  const [aInput, setAInput] = useState("");
  const [editIdx, setEditIdx] = useState(null);
  const [editQ, setEditQ] = useState("");
  const [editA, setEditA] = useState("");

  const addItem = () => {
    if (!qInput.trim()) { notify("Введите вопрос", "err"); return; }
    if (!aInput.trim()) { notify("Введите ответ", "err"); return; }
    saveFaq([...faqList, { id: Date.now(), question: qInput.trim(), answer: aInput.trim() }]);
    setQInput(""); setAInput("");
    notify("Вопрос добавлен ✓");
  };

  const deleteItem = (idx) => {
    if (!confirm("Удалить этот вопрос?")) return;
    saveFaq(faqList.filter((_, i) => i !== idx));
    notify("Вопрос удалён");
  };

  const startEdit = (idx) => { setEditIdx(idx); setEditQ(faqList[idx].question); setEditA(faqList[idx].answer); };

  const saveEdit = () => {
    if (!editQ.trim() || !editA.trim()) { notify("Заполните оба поля", "err"); return; }
    saveFaq(faqList.map((item, i) => i === editIdx ? { ...item, question: editQ.trim(), answer: editA.trim() } : item));
    setEditIdx(null);
    notify("Вопрос обновлён ✓");
  };

  const moveItem = (idx, dir) => {
    const arr = [...faqList];
    const t = idx + dir;
    if (t < 0 || t >= arr.length) return;
    [arr[idx], arr[t]] = [arr[t], arr[idx]];
    saveFaq(arr);
  };

  return (
    <div>
      {/* Список вопросов */}
      {faqList.length === 0
        ? <div className="empty-state" style={{marginBottom:"24px"}}><div className="empty-state-icon">❓</div><div className="empty-state-text">Вопросов пока нет — добавьте первый ниже</div></div>
        : <div style={{display:"flex",flexDirection:"column",gap:"12px",marginBottom:"24px"}}>
            {faqList.map((item, idx) => (
              <div key={item.id || idx} style={{background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius)",padding:"20px 22px",boxShadow:"var(--rd-shadow)"}}>
                {editIdx === idx ? (
                  <div>
                    <div className="form-field">
                      <label className="form-label">Вопрос</label>
                      <input className="form-input" value={editQ} onChange={e => setEditQ(e.target.value)} autoFocus />
                    </div>
                    <div className="form-field" style={{marginTop:"10px"}}>
                      <label className="form-label">Ответ</label>
                      <textarea className="form-input" rows="4" style={{resize:"vertical",minHeight:"90px"}} value={editA} onChange={e => setEditA(e.target.value)} />
                    </div>
                    <div style={{display:"flex",gap:"10px",marginTop:"12px"}}>
                      <button className="btn btn-primary btn-sm" onClick={saveEdit}>💾 Сохранить</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditIdx(null)}>Отмена</button>
                    </div>
                  </div>
                ) : (
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"12px"}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)",marginBottom:"8px",display:"flex",alignItems:"center",gap:"8px"}}>
                        <span style={{flexShrink:0,width:"22px",height:"22px",borderRadius:"50%",background:"var(--rd-red-light)",border:"1.5px solid rgba(199,22,24,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",fontWeight:800,color:"var(--rd-red)"}}>Q</span>
                        {item.question}
                      </div>
                      <div style={{fontSize:"13px",color:"var(--rd-gray-text)",lineHeight:"1.6",paddingLeft:"30px"}}>{item.answer}</div>
                    </div>
                    <div style={{display:"flex",gap:"6px",flexShrink:0}}>
                      <button className="btn btn-ghost btn-sm" onClick={() => moveItem(idx,-1)} disabled={idx===0} title="Вверх">↑</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => moveItem(idx,1)} disabled={idx===faqList.length-1} title="Вниз">↓</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => startEdit(idx)} title="Редактировать">✏️</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => deleteItem(idx)} title="Удалить" style={{color:"var(--rd-red)"}}>🗑️</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
      }

      {/* Форма добавления — всегда внизу */}
      <div className="product-form-card">
        <div className="product-form-title">❓ Добавить вопрос</div>
        <div className="form-field">
          <label className="form-label">Вопрос</label>
          <input className="form-input" placeholder="Как использовать корпоративные баллы?" value={qInput} onChange={e => setQInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && addItem()} />
        </div>
        <div className="form-field" style={{marginTop:"12px"}}>
          <label className="form-label">Ответ</label>
          <textarea className="form-input" rows="4" style={{resize:"vertical",minHeight:"100px"}} placeholder="Подробный ответ на вопрос…" value={aInput} onChange={e => setAInput(e.target.value)} />
        </div>
        <button className="btn btn-primary" style={{marginTop:"14px"}} onClick={addItem}>+ Добавить вопрос</button>
      </div>
    </div>
  );
}

function VideoAdminTab({ videos, saveVideos, notify }) {
  const videoList = videos || [];
  const [form, setForm] = useState({ title: "", description: "", url: "", published: true });
  const [editIdx, setEditIdx] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const addVideo = () => {
    if (!form.url.trim()) { notify("Введите URL видео", "err"); return; }
    // Проверка что URL содержит vkvideo.ru, vk.com/video или rutube.ru
    if (!form.url.includes('vkvideo.ru') && !form.url.includes('vk.com/video') && !form.url.includes('rutube.ru')) {
      notify("Поддерживаются только VK Video и RuTube", "err");
      return;
    }
    saveVideos([...videoList, { id: Date.now(), ...form }]);
    setForm({ title: "", description: "", url: "", published: true });
    notify("Видео добавлено ✓");
  };

  const deleteVideo = (idx) => {
    if (!confirm("Удалить это видео?")) return;
    saveVideos(videoList.filter((_, i) => i !== idx));
    notify("Видео удалено");
  };

  const startEdit = (idx) => {
    setEditIdx(idx);
    setEditForm({ ...videoList[idx] });
  };

  const saveEdit = () => {
    if (!editForm.url.trim()) { notify("Введите URL видео", "err"); return; }
    if (!editForm.url.includes('vkvideo.ru') && !editForm.url.includes('vk.com/video') && !editForm.url.includes('rutube.ru')) {
      notify("Поддерживаются только VK Video и RuTube", "err");
      return;
    }
    saveVideos(videoList.map((item, i) => i === editIdx ? editForm : item));
    setEditIdx(null);
    setEditForm(null);
    notify("Видео обновлено ✓");
  };

  const togglePublished = (idx) => {
    saveVideos(videoList.map((item, i) => i === idx ? { ...item, published: !item.published } : item));
    notify(videoList[idx].published ? "Видео скрыто" : "Видео опубликовано");
  };

  const moveVideo = (idx, dir) => {
    const arr = [...videoList];
    const t = idx + dir;
    if (t < 0 || t >= arr.length) return;
    [arr[idx], arr[t]] = [arr[t], arr[idx]];
    saveVideos(arr);
  };

  return (
    <div>
      {videoList.length === 0
        ? <div className="empty-state" style={{marginBottom:"24px"}}><div className="empty-state-icon">🎬</div><div className="empty-state-text">Видео пока нет — добавьте первое ниже</div></div>
        : <div style={{display:"flex",flexDirection:"column",gap:"12px",marginBottom:"24px"}}>
            {videoList.map((video, idx) => (
              <div key={video.id || idx} style={{background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius)",padding:"20px 22px",boxShadow:"var(--rd-shadow)",opacity:video.published?1:0.6}}>
                {editIdx === idx ? (
                  <div>
                    <div className="form-field">
                      <label className="form-label">Заголовок</label>
                      <input className="form-input" value={editForm.title || ""} onChange={e => setEditForm({...editForm, title: e.target.value})} />
                    </div>
                    <div className="form-field" style={{marginTop:"10px"}}>
                      <label className="form-label">Описание</label>
                      <textarea className="form-input" rows="3" style={{resize:"vertical"}} value={editForm.description || ""} onChange={e => setEditForm({...editForm, description: e.target.value})} />
                    </div>
                    <div className="form-field" style={{marginTop:"10px"}}>
                      <label className="form-label">URL видео <span style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>(VK Video или RuTube)</span></label>
                      <input className="form-input" value={editForm.url} onChange={e => setEditForm({...editForm, url: e.target.value})} placeholder="https://vkvideo.ru/video..." />
                    </div>
                    <div style={{marginTop:"10px"}}>
                      <label style={{display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",userSelect:"none"}}>
                        <input type="checkbox" checked={editForm.published} onChange={e => setEditForm({...editForm, published: e.target.checked})} style={{width:"16px",height:"16px",accentColor:"var(--rd-red)",cursor:"pointer"}} />
                        <span style={{fontSize:"14px",color:"var(--rd-dark)",fontWeight:600}}>Опубликовано</span>
                      </label>
                    </div>
                    <div style={{display:"flex",gap:"10px",marginTop:"12px"}}>
                      <button className="btn btn-primary btn-sm" onClick={saveEdit}>💾 Сохранить</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditIdx(null)}>Отмена</button>
                    </div>
                  </div>
                ) : (
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"12px"}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"8px"}}>
                        <span style={{fontSize:"20px"}}>🎬</span>
                        <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)"}}>{video.title || "Без названия"}</div>
                        {video.published ? (
                          <span style={{fontSize:"11px",fontWeight:700,padding:"3px 8px",borderRadius:"6px",background:"rgba(34,197,94,0.1)",color:"#16a34a"}}>Опубликовано</span>
                        ) : (
                          <span style={{fontSize:"11px",fontWeight:700,padding:"3px 8px",borderRadius:"6px",background:"var(--rd-gray-bg)",color:"var(--rd-gray-text)"}}>Скрыто</span>
                        )}
                      </div>
                      {video.description && (
                        <div style={{fontSize:"13px",color:"var(--rd-gray-text)",lineHeight:"1.6",marginBottom:"8px"}}>{video.description}</div>
                      )}
                      <div style={{fontSize:"12px",color:"var(--rd-gray-text)",fontFamily:"monospace",wordBreak:"break-all"}}>{video.url}</div>
                    </div>
                    <div style={{display:"flex",gap:"6px",flexShrink:0}}>
                      <button className="btn btn-ghost btn-sm" onClick={() => togglePublished(idx)} title={video.published ? "Скрыть" : "Опубликовать"}>
                        {video.published ? "👁️" : "🙈"}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => moveVideo(idx,-1)} disabled={idx===0} title="Вверх">↑</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => moveVideo(idx,1)} disabled={idx===videoList.length-1} title="Вниз">↓</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => startEdit(idx)} title="Редактировать">✏️</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => deleteVideo(idx)} title="Удалить" style={{color:"var(--rd-red)"}}>🗑️</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
      }

      <div className="product-form-card">
        <div className="product-form-title">🎬 Добавить видео</div>
        <div className="form-field">
          <label className="form-label">Заголовок (необязательно)</label>
          <input className="form-input" placeholder="Название видео" value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
        </div>
        <div className="form-field" style={{marginTop:"12px"}}>
          <label className="form-label">Описание (необязательно)</label>
          <textarea className="form-input" rows="3" style={{resize:"vertical"}} placeholder="Краткое описание видео" value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
        </div>
        <div className="form-field" style={{marginTop:"12px"}}>
          <label className="form-label">URL видео <span style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>(VK Video или RuTube)</span></label>
          <input className="form-input" placeholder="https://vkvideo.ru/video... или https://rutube.ru/video/..." value={form.url} onChange={e => setForm({...form, url: e.target.value})} />
          <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"4px"}}>
            Примеры: https://vkvideo.ru/video-123456789_456123456 или https://rutube.ru/video/abc123def456/
          </div>
        </div>
        <div style={{marginTop:"12px"}}>
          <label style={{display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",userSelect:"none"}}>
            <input type="checkbox" checked={form.published} onChange={e => setForm({...form, published: e.target.checked})} style={{width:"16px",height:"16px",accentColor:"var(--rd-red)",cursor:"pointer"}} />
            <span style={{fontSize:"14px",color:"var(--rd-dark)",fontWeight:600}}>Опубликовать сразу</span>
          </label>
        </div>
        <button className="btn btn-primary" style={{marginTop:"14px"}} onClick={addVideo}>+ Добавить видео</button>
      </div>
    </div>
  );
}

function AdminPage({ users, saveUsers, orders, saveOrders, products, saveProducts, categories, saveCategories, notify, setPage, currentUser, transfers, saveTransfers, activeTab, setActiveTab, faq, saveFaq, embedded }) {
  const isAdmin = currentUser && users[currentUser]?.role === "admin";
  const cName = getCurrName();
  const [internalTab, setInternalTab] = useState("products");
  const tab = activeTab || internalTab;
  const setTab = (t) => { if (setActiveTab) setActiveTab(t); else setInternalTab(t); };
  const [amounts, setAmounts] = useState({});
  const [search, setSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("all");
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [form, setForm] = useState(BLANK_PRODUCT);
  const [imgPreviews, setImgPreviews] = useState([]);

  const [userEditModal, setUserEditModal] = useState(null);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createUserForm, setCreateUserForm] = useState({ username: "", firstName: "", lastName: "", email: "", password: "", role: "user", balance: "0" });
  const createUserSubmit = () => {
    const f = createUserForm;
    if (!f.username.trim()) { notify("Введите логин", "err"); return; }
    if (users[f.username.trim()]) { notify("Логин уже занят", "err"); return; }
    if (!f.firstName.trim()) { notify("Введите имя", "err"); return; }
    if (!f.password || f.password.length < 6) { notify("Пароль минимум 6 символов", "err"); return; }
    const newUser = {
      username: f.username.trim(),
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      email: f.email.trim(),
      password: f.password,
      role: f.role,
      balance: parseInt(f.balance) || 0,
      createdAt: Date.now(),
    };
    saveUsers({ ...users, [newUser.username]: newUser });
    setCreateUserForm({ username: "", firstName: "", lastName: "", email: "", password: "", role: "user", balance: "0" });
    setShowCreateUser(false);
    notify(`Пользователь «${newUser.username}» создан ✓`);
  };
  const [catInput, setCatInput] = useState("");
  const [editCatIdx, setEditCatIdx] = useState(null);
  const [editCatVal, setEditCatVal] = useState("");


  const PRODUCT_COLUMNS = ["id","name","category","price","sku","emoji","desc","badge","discount","inactive","sizes"];

  const USER_COLUMNS = ["username","email","role","balance","birthdate"];

  const usersToRows = () => Object.entries(users)
    .filter(([u]) => u !== "admin")
    .map(([username, ud]) => ({
      username,
      email: ud.email || "",
      role: ud.role || "user",
      balance: ud.balance || 0,
      birthdate: ud.birthdate || "",
    }));

  const exportUsersCSV = () => {
    const rows = usersToRows();
    const header = USER_COLUMNS.join(",");
    const lines = rows.map(r => USER_COLUMNS.map(k => {
      const v = String(r[k] ?? "").replace(/"/g, '""');
      return v.includes(",") || v.includes('"') ? '"' + v + '"' : v;
    }).join(","));
    const blob = new Blob([header + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "users.csv"; a.click(); URL.revokeObjectURL(url);
    notify("Пользователи экспортированы в CSV ✓");
  };

  const exportUsersXLSX = () => {
    const rows = usersToRows();
    const ws = XLSX.utils.json_to_sheet(rows, { header: USER_COLUMNS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Пользователи");
    XLSX.writeFile(wb, "users.xlsx");
    notify("Пользователи экспортированы в XLSX ✓");
  };

  const handleUsersImport = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        let rows = [];
        if (file.name.endsWith(".csv")) {
          const lines = ev.target.result.split("\n").filter(l => l.trim());
          const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
          rows = lines.slice(1).map(line => {
            const vals = []; let cur = ""; let inQ = false;
            for (let ch of line) {
              if (ch === '"') { inQ = !inQ; }
              else if (ch === "," && !inQ) { vals.push(cur); cur = ""; }
              else cur += ch;
            }
            vals.push(cur);
            const obj = {}; headers.forEach((h, i) => obj[h] = (vals[i]||"").trim().replace(/^"|"$/g,""));
            return obj;
          });
        } else {
          const wb = XLSX.read(ev.target.result, { type: "array" });
          rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
        }
        const updated = { ...users };
        let added = 0, upd = 0;
        rows.filter(r => r.username && r.username !== "admin").forEach(r => {
          const uname = String(r.username).trim();
          if (!uname) return;
          if (updated[uname]) {
            updated[uname] = { ...updated[uname],
              email: r.email || updated[uname].email || "",
              role: r.role === "admin" ? "admin" : "user",
              balance: Number(r.balance) || updated[uname].balance || 0,
              birthdate: r.birthdate || updated[uname].birthdate || "",
            }; upd++;
          } else {
            updated[uname] = {
              password: "changeme123",
              email: r.email || "",
              role: r.role === "admin" ? "admin" : "user",
              balance: Number(r.balance) || 0,
              birthdate: r.birthdate || "",
              createdAt: Date.now(),
            }; added++;
          }
        });
        saveUsers(updated);
        notify("Импорт пользователей: добавлено " + added + ", обновлено " + upd + " ✓");
      } catch(err) { notify("Ошибка импорта: " + err.message, "err"); }
    };
    file.name.endsWith(".csv") ? reader.readAsText(file) : reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const productsToRows = () => products.map(p => ({
    id: p.id,
    name: p.name || "",
    category: p.category || "",
    price: p.price || 0,
    sku: p.sku || "",
    emoji: p.emoji || "",
    desc: p.desc || "",
    badge: p.badge || "",
    discount: p.discount || 0,
    inactive: p.inactive ? 1 : 0,
    sizes: Array.isArray(p.sizes) ? p.sizes.join(",") : (p.sizes || ""),
  }));

  const exportCSV = () => {
    const rows = productsToRows();
    const header = PRODUCT_COLUMNS.join(",");
    const lines = rows.map(r => PRODUCT_COLUMNS.map(k => {
      const v = String(r[k] ?? "").replace(/"/g, '""');
      return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v}"` : v;
    }).join(","));
    const blob = new Blob([header + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "products.csv"; a.click(); URL.revokeObjectURL(url);
    notify("CSV экспортирован ✓");
  };

  const exportXLSX = () => {
    const rows = productsToRows();
    const ws = XLSX.utils.json_to_sheet(rows, { header: PRODUCT_COLUMNS });
    // Style header row
    PRODUCT_COLUMNS.forEach((col, i) => {
      const cell = ws[XLSX.utils.encode_cell({r:0, c:i})];
      if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: "C71618" } }, fontColor: { rgb: "FFFFFF" } };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Товары");
    XLSX.writeFile(wb, "products.xlsx");
    notify("XLSX экспортирован ✓");
  };

  const handleImport = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        let rows = [];
        if (file.name.endsWith(".csv")) {
          const text = ev.target.result;
          const lines = text.split("\n").filter(l => l.trim());
          const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
          rows = lines.slice(1).map(line => {
            const vals = []; let cur = ""; let inQ = false;
            for (let ch of line) {
              if (ch === '"') { inQ = !inQ; }
              else if (ch === "," && !inQ) { vals.push(cur); cur = ""; }
              else cur += ch;
            }
            vals.push(cur);
            const obj = {}; headers.forEach((h, i) => obj[h] = (vals[i]||"").trim().replace(/^"|"$/g,""));
            return obj;
          });
        } else {
          const wb = XLSX.read(ev.target.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        }

        const existingIds = new Set(products.map(p => String(p.id)));
        let added = 0, updated = 0;

        const parsed = rows.filter(r => r.name).map(r => ({
          id: r.id ? Number(r.id) : Date.now() + Math.random(),
          name: String(r.name || ""),
          category: String(r.category || "Другое"),
          price: Number(r.price) || 0,
          sku: String(r.sku || ""),
          emoji: String(r.emoji || "🛍️"),
          desc: String(r.desc || ""),
          badge: String(r.badge || ""),
          discount: Number(r.discount) || 0,
          inactive: r.inactive == 1 || r.inactive === "1" || r.inactive === true,
          sizes: r.sizes ? String(r.sizes).split(",").map(s=>s.trim()).filter(Boolean) : [],
          images: [],
        }));

        const updated_products = [...products];
        for (const p of parsed) {
          const idx = updated_products.findIndex(ex => String(ex.id) === String(p.id));
          if (idx >= 0) { updated_products[idx] = {...updated_products[idx], ...p}; updated++; }
          else { updated_products.push(p); added++; }
        }
        saveProducts(updated_products);
        notify(`Импорт завершён: добавлено ${added}, обновлено ${updated} товаров ✓`);
      } catch(err) {
        notify("Ошибка импорта: " + err.message, "err");
      }
    };
    file.name.endsWith(".csv") ? reader.readAsText(file) : reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const userList = Object.entries(users).filter(([u, ud]) => {
    if (u === currentUser || u === "admin") return false;
    if (!u.toLowerCase().includes(search.toLowerCase())) return false;
    if (userRoleFilter === "admin" && ud.role !== "admin") return false;
    if (userRoleFilter === "user" && ud.role === "admin") return false;
    return true;
  });
  const totalCoins = Object.values(users).filter(u => u.role !== "admin").reduce((s, u) => s + (u.balance || 0), 0);

  const grant = (username, sign) => {
    const amt = parseInt(amounts[username] || 0);
    if (!amt || amt <= 0) { notify("Введите корректную сумму", "err"); return; }
    const user = users[username];
    const newBal = sign > 0 ? (user.balance || 0) + amt : Math.max(0, (user.balance || 0) - amt);
    saveUsers({ ...users, [username]: { ...user, balance: newBal } });
    setAmounts(prev => ({ ...prev, [username]: "" }));
    notify(sign > 0 ? `+${amt} ${getCurrName()} → ${username}` : `-${amt} ${getCurrName()} у ${username}`);
  };

  const deleteUser = (username) => {
    if (!confirm("Удалить пользователя " + username + "? Это действие необратимо.")) return;
    if (username === "admin") { notify("Нельзя удалить администратора", "err"); return; }
    const nu = {...users};
    delete nu[username];
    // Напрямую обновляем state и пишем на сервер с флагом intentional_delete
    setUsers(nu);
    _pendingWrites.add('cm_users');
    _apiCall('set', { key: 'cm_users', value: nu, intentional_delete: username }).then(() => {
      _pendingWrites.delete('cm_users');
    }).catch(() => { _pendingWrites.delete('cm_users'); });
    notify("Пользователь " + username + " удалён");
  };

  const toggleAdmin = (username) => {
    const u = users[username];
    const newRole = u.role === "admin" ? "user" : "admin";
    saveUsers({...users, [username]: {...u, role: newRole}});
    notify(username + (newRole === "admin" ? " назначен администратором" : " разжалован до пользователя"));
  };

  const updateStatus = (id, status) => {
    const order = orders.find(o => o.id === id);
    if (!order) return;
    const prevStatus = order.status;
    const newOrders = orders.map(o => o.id === id ? { ...o, status } : o);
    saveOrders(newOrders);
    // Refund if cancelling a non-already-cancelled order
    if (status === "Отменён" && prevStatus !== "Отменён") {
      const buyer = users[order.user];
      if (buyer) {
        const refunded = { ...users, [order.user]: { ...buyer, balance: (buyer.balance || 0) + order.total } };
        saveUsers(refunded);
        notify(`Заказ отменён. ${order.total} ${getCurrName()} возвращены пользователю ${order.user}`);
      } else {
        notify("Заказ отменён");
      }
    } else if (prevStatus === "Отменён" && status !== "Отменён") {
      // Re-activating a cancelled order — deduct again if user has enough
      const buyer = users[order.user];
      if (buyer && (buyer.balance || 0) >= order.total) {
        const deducted = { ...users, [order.user]: { ...buyer, balance: buyer.balance - order.total } };
        saveUsers(deducted);
        notify(`Статус обновлён. ${order.total} ${getCurrName()} списаны повторно`);
      } else {
        notify("Статус заказа обновлён");
      }
    } else {
      notify("Статус заказа обновлён");
    }
  };

  const startEdit = (p) => {
    setEditingProduct(p.id);
    setForm({ name: p.name, price: p.price, category: p.category, emoji: p.emoji, desc: p.desc, images: p.images || (p.image ? [p.image] : []), sizes: p.sizes || ["S","M","L","XL","XXL"], sku: p.sku || "", badge: p.badge || "", discount: p.discount || 0, discountUntil: p.discountUntil || "", inactive: !!p.inactive, stock: p.stock !== undefined && p.stock !== null ? String(p.stock) : "", sizeStock: p.sizeStock || {} });
    setImgPreviews(p.images || (p.image ? [p.image] : []));
    setShowProductModal(true);
  };

  const openNewProduct = () => { setEditingProduct(null); setForm(BLANK_PRODUCT); setImgPreviews([]); setShowProductModal(true); };
  const resetForm = () => { setEditingProduct(null); setForm(BLANK_PRODUCT); setImgPreviews([]); setShowProductModal(false); };

  const handleImg = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const compressed = await compressImage(ev.target.result, 1200, 1200, 0.85, 300);
        setImgPreviews(prev => {
          const next = [...prev, compressed];
          setForm(f => ({...f, images: next}));
          return next;
        });
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };
  const removeImg = (idx) => {
    setImgPreviews(prev => {
      const next = prev.filter((_, i) => i !== idx);
      setForm(f => ({...f, images: next}));
      return next;
    });
  };

  const saveProduct = () => {
    if (!form.name.trim()) { notify("Введите название", "err"); return; }
    if (!form.price || isNaN(form.price) || +form.price <= 0) { notify("Введите корректную цену", "err"); return; }
    if (editingProduct) {
      saveProducts(products.map(p => p.id === editingProduct ? { ...p, ...form, price: +form.price, images: imgPreviews, stock: form.stock !== "" ? +form.stock : null, sizeStock: form.sizeStock || {} } : p));
      notify("Товар обновлён ✓");
    } else {
      const newP = { ...form, price: +form.price, images: imgPreviews, id: Date.now(), stock: form.stock !== "" ? +form.stock : null, sizeStock: form.sizeStock || {} };
      saveProducts([...products, newP]);
      notify("Товар добавлен ✓");
    }
    setShowProductModal(false);
    resetForm();
  };

  const deleteProduct = (id) => {
    if (!confirm("Удалить товар?")) return;
    saveProducts(products.filter(p => p.id !== id));
    if (editingProduct === id) resetForm();
    notify("Товар удалён");
  };

  return (
    <div className="admin-wrap">
      {!embedded && (
        <>
          <div className="page-eyebrow">Панель администратора</div>
          <h2 className="page-title">Управление магазином</h2>

          <div className="stats-grid">
            {[
              { label: "Пользователей", val: Object.keys(users).filter(u => u !== "admin").length, icon: "👥" },
              { label: "Заказов всего", val: orders.length, icon: "📦" },
              { label: "Товаров в каталоге", val: products.length, icon: "🛍️" },
            ].map(s => (
              <div key={s.label} className="stat-card">
                <div className="sc-icon">{s.icon}</div>
                <div className="sc-label">{s.label}</div>
                <div className="sc-value">{s.val}</div>
              </div>
            ))}
          </div>
        </>
      )}

      

      {tab === "products" && (
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"20px",flexWrap:"wrap",gap:"12px"}}>
            <div style={{fontWeight:700,fontSize:"16px",color:"var(--rd-dark)"}}>Все товары ({products.length})</div>
            <button className="btn btn-primary btn-sm" onClick={openNewProduct} style={{gap:"6px"}}>
              ➕ Добавить товар
            </button>
          </div>
          <div className="product-list-admin">
            {products.map(p => (
              <div key={p.id} className={`product-admin-card ${editingProduct === p.id ? "is-editing" : ""}`}>
                {(p.images && p.images.length > 0) || p.image
                  ? <img src={(p.images && p.images[0]) || p.image} className="pac-img" style={{objectFit:"cover"}} alt={p.name} />
                  : <div className="pac-img">{p.emoji}</div>
                }
                <div className="pac-info">
                  <div className="pac-name">{p.name}</div>
                  <div className="pac-meta">
                    {p.category} · {p.price} {getCurrName()}
                    {p.inactive ? " · 🚫 Скрыт" : ""}
                    {p.discount > 0 ? " · -" + p.discount + "%" : ""}
                    {p.sizeStock && Object.keys(p.sizeStock).length > 0
                      ? " · " + Object.keys(p.sizeStock).map(function(sz){ return sz+":"+p.sizeStock[sz]; }).join(" ")
                      : (p.stock !== null && p.stock !== undefined ? " · 📦"+p.stock : "")}
                  </div>
                </div>
                <div className="pac-actions">
                  <button className="btn-icon" title="Редактировать" onClick={() => startEdit(p)}>✏️</button>
                  <button className="btn-icon delete" title="Удалить" onClick={() => deleteProduct(p.id)}>🗑️</button>
                </div>
              </div>
            ))}
            {products.length === 0 && <div style={{color:"var(--rd-gray-text)",textAlign:"center",padding:"32px"}}>Товаров пока нет</div>}
          </div>

          {showProductModal && (
            <div className="modal-overlay" onClick={resetForm}>
              <div className="modal-box" onClick={e => e.stopPropagation()} style={{maxWidth:"680px",width:"95vw",maxHeight:"90vh",overflowY:"auto",padding:"32px 28px"}}>
                <button className="modal-close" onClick={resetForm}>✕</button>
                <div style={{fontWeight:800,fontSize:"22px",marginBottom:"24px",color:"var(--rd-dark)"}}>
                  {editingProduct ? "✏️ Редактирование товара" : "➕ Новый товар"}
                </div>

                {imgPreviews.length > 0 && (
                  <div className="upload-thumbs">
                    {imgPreviews.map((src, i) => (
                      <div key={i} className="upload-thumb">
                        <img src={src} alt={"фото " + (i+1)} />
                        <button className="upload-thumb-del" onClick={() => removeImg(i)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="img-upload-zone">
                  <input type="file" accept="image/*" multiple onChange={handleImg} />
                  <div className="img-upload-hint">
                    <strong>📷 {imgPreviews.length > 0 ? "Добавить ещё фото" : "Загрузить фото"}</strong>
                    Можно выбрать несколько файлов · PNG, JPG, WEBP
                  </div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"16px",marginTop:"4px"}}>
                  <div className="form-field">
                    <label className="form-label">Название товара</label>
                    <input className="form-input" placeholder="Например: Худи «Team»" value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Артикул (SKU)</label>
                    <input className="form-input" placeholder="RD-HOODIE-001" value={form.sku || ""} onChange={e => setForm(f=>({...f,sku:e.target.value}))} />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Количество на складе</label>
                    {(form.category === CLOTHING_CATEGORY && (form.sizes||[]).length > 0) ? (
                      <div>
                        <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginBottom:"10px"}}>По размерам (пусто = без ограничений)</div>
                        <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                          {(form.sizes||[]).map(function(sz) {
                            var ssVal = (form.sizeStock||{})[sz];
                            return (
                              <div key={sz} style={{display:"flex",alignItems:"center",gap:"10px"}}>
                                <span style={{minWidth:"36px",height:"36px",display:"inline-flex",alignItems:"center",justifyContent:"center",background:"var(--rd-red)",color:"#fff",borderRadius:"8px",fontWeight:700,fontSize:"13px"}}>{sz}</span>
                                <input
                                  className="form-input"
                                  type="number" min="0"
                                  placeholder="∞"
                                  style={{maxWidth:"120px",textAlign:"center"}}
                                  value={ssVal !== undefined ? ssVal : ""}
                                  onChange={function(e) {
                                    var val = e.target.value;
                                    setForm(function(f) {
                                      var ss = Object.assign({}, f.sizeStock||{});
                                      if (val === "") { delete ss[sz]; } else { ss[sz] = +val; }
                                      return Object.assign({}, f, {sizeStock: ss});
                                    });
                                  }}
                                />
                                <span style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>
                                  {ssVal === 0 ? "нет в наличии" : ssVal > 0 ? "шт." : "∞"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <input className="form-input" type="number" min="0" placeholder="∞ — без ограничений" value={form.stock || ""} onChange={function(e){setForm(function(f){return Object.assign({},f,{stock:e.target.value});});}} />
                    )}
                  </div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"16px"}}>
                  <div className="form-field">
                    <label className="form-label">Цена</label>
                    <input className="form-input" type="number" min="1" placeholder="500" value={form.price} onChange={e => setForm(f=>({...f,price:e.target.value}))} />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Категория</label>
                    <select className="form-select" value={form.category} onChange={e => setForm(f=>({...f,category:e.target.value}))}>
                      {ALL_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">Плашка на карточке</label>
                  <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                    {[{val:"",label:"Нет"},{val:"hit",label:"🔥 Хит"},{val:"new",label:"✨ Новинка"},{val:"sale",label:"🏷️ Акция"},{val:"excl",label:"⭐ Эксклюзив"}].map(b => (
                      <button key={b.val} type="button" onClick={() => setForm(f=>({...f,badge:b.val}))}
                        style={{padding:"6px 14px",borderRadius:"20px",fontSize:"12px",fontWeight:700,cursor:"pointer",transition:"all 0.2s",border:"1.5px solid",
                          borderColor:form.badge===b.val?"var(--rd-red)":"var(--rd-gray-border)",
                          background:form.badge===b.val?"var(--rd-red)":"#fff",
                          color:form.badge===b.val?"#fff":"var(--rd-gray-text)"}}>
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>

                {form.category === "Одежда" && (
                  <div className="form-field">
                    <label className="form-label">Доступные размеры</label>
                    <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                      {["S","M","L","XL","XXL"].map(s => {
                        const active = (form.sizes||[]).includes(s);
                        return (
                          <button key={s} type="button" className={`size-btn ${active ? "selected" : ""}`}
                            onClick={() => {
                              const cur = form.sizes || [];
                              setForm(f => ({...f, sizes: active ? cur.filter(x=>x!==s) : [...cur, s]}));
                            }}>{s}</button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="form-field">
                  <label className="form-label">Скидка (%)</label>
                  <div style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
                    <input className="form-input" type="number" min="0" max="90" placeholder="0"
                      value={form.discount || 0}
                      onChange={e => setForm(f=>({...f,discount:Math.min(90,Math.max(0,parseInt(e.target.value)||0))}))}
                      style={{maxWidth:"100px"}} />
                    {form.discount > 0 && form.price && (
                      <span style={{fontSize:"13px",color:"var(--rd-gray-text)"}}>
                        {form.price} → <strong style={{color:"var(--rd-red)"}}>{Math.round(form.price*(1-form.discount/100))}</strong> {getCurrName()}
                      </span>
                    )}
                    <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                      {[0,10,15,20,25,30,50].map(v => (
                        <button key={v} type="button" onClick={() => setForm(f=>({...f,discount:v}))}
                          style={{padding:"4px 10px",borderRadius:"20px",fontSize:"12px",fontWeight:700,cursor:"pointer",border:"1.5px solid",
                            borderColor:(form.discount||0)===v?"var(--rd-red)":"var(--rd-gray-border)",
                            background:(form.discount||0)===v?"var(--rd-red)":"#fff",
                            color:(form.discount||0)===v?"#fff":"var(--rd-gray-text)"}}>
                          {v===0?"Нет":"-"+v+"%"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {(form.discount || 0) > 0 && (
                  <div className="form-field">
                    <label className="form-label">Скидка действует до</label>
                    <input className="form-input" type="datetime-local"
                      value={form.discountUntil || ""}
                      onChange={e => setForm(f=>({...f, discountUntil: e.target.value}))}
                      style={{maxWidth:"260px"}} />
                    {form.discountUntil && (
                      <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"4px"}}>
                        Скидка истечёт: {new Date(form.discountUntil).toLocaleString("ru-RU")}
                        <button type="button" onClick={() => setForm(f=>({...f, discountUntil:""}))}
                          style={{marginLeft:"8px",background:"none",border:"none",color:"var(--rd-red)",cursor:"pointer",fontSize:"12px",fontWeight:700}}>✕ Убрать</button>
                      </div>
                    )}
                    {!form.discountUntil && <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"4px"}}>Не указано — скидка действует бессрочно</div>}
                  </div>
                )}

                <div className="form-field">
                  <label className="form-label">Эмодзи (если нет фото)</label>
                  <div style={{display:"flex",flexWrap:"wrap",gap:"6px",padding:"10px",background:"var(--rd-gray-bg)",borderRadius:"var(--rd-radius-sm)",border:"1.5px solid var(--rd-gray-border)"}}>
                    {EMOJIS.map(e => (
                      <button key={e} onClick={() => setForm(f=>({...f,emoji:e}))}
                        style={{width:"32px",height:"32px",border:"1.5px solid",borderColor:form.emoji===e?"var(--rd-red)":"transparent",borderRadius:"6px",background:form.emoji===e?"var(--rd-red-light)":"transparent",cursor:"pointer",fontSize:"18px",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s"}}>
                        {e}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">Описание</label>
                  <textarea className="form-input" rows="6" style={{resize:"vertical",minHeight:"140px"}} placeholder="Материал, особенности, размеры…" value={form.desc} onChange={e => setForm(f=>({...f,desc:e.target.value}))}></textarea>
                </div>

                <div className="form-field" style={{display:"flex",alignItems:"center",gap:"12px",padding:"12px 14px",background:"var(--rd-gray-bg)",borderRadius:"var(--rd-radius-sm)",border:"1.5px solid var(--rd-gray-border)"}}>
                  <input type="checkbox" id="inactive-toggle-modal" checked={!!form.inactive} onChange={e => setForm(f=>({...f,inactive:e.target.checked}))} style={{width:"18px",height:"18px",cursor:"pointer",accentColor:"var(--rd-red)"}} />
                  <label htmlFor="inactive-toggle-modal" style={{cursor:"pointer",fontWeight:600,fontSize:"14px",color:"var(--rd-dark)"}}>Деактивировать товар (скрыть из каталога)</label>
                </div>

                <div style={{display:"flex",gap:"12px",marginTop:"8px"}}>
                  <button className="btn btn-primary" style={{flex:1}} onClick={saveProduct}>
                    {editingProduct ? "Сохранить изменения" : "Добавить товар"}
                  </button>
                  <button className="btn btn-ghost" onClick={resetForm}>Отмена</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {tab === "users" && (
        <div>
          <div style={{marginBottom:"12px",display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
            <input className="form-input" style={{width:"180px",flexShrink:0}} placeholder="Поиск по логину…" value={search} onChange={e => setSearch(e.target.value)} />
            <button className="btn btn-primary btn-sm" style={{flexShrink:0}} onClick={() => setShowCreateUser(true)}>➕ Создать</button>
            <button className="btn btn-secondary btn-sm" style={{flexShrink:0}} onClick={exportUsersCSV}>⬇ CSV</button>
            <button className="btn btn-secondary btn-sm" style={{flexShrink:0}} onClick={exportUsersXLSX}>⬇ XLSX</button>
            <label className="btn btn-secondary btn-sm" style={{cursor:"pointer",position:"relative",flexShrink:0}}>
              ⬆ Импорт
              <input type="file" accept=".csv,.xlsx,.xls" style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",width:"100%",height:"100%"}} onChange={handleUsersImport} />
            </label>
            <div style={{display:"flex",gap:"6px"}}>
              {[["all","Все"],["user","Пользователи"],["admin","Администраторы"]].map(([v,l]) => (
                <button key={v} onClick={() => setUserRoleFilter(v)}
                  style={{padding:"6px 14px",borderRadius:"var(--rd-radius-sm)",fontSize:"13px",fontWeight:700,cursor:"pointer",border:"1.5px solid",transition:"all 0.15s",
                    background:userRoleFilter===v?"var(--rd-green-light)":"#fff",
                    color:userRoleFilter===v?"var(--rd-green)":"var(--rd-gray-text)",
                    borderColor:userRoleFilter===v?"rgba(5,150,105,0.3)":"var(--rd-gray-border)"}}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Create user inline form */}
          {showCreateUser && (
            <div style={{background:"#fff",border:"2px solid var(--rd-red)",borderRadius:"14px",padding:"24px",marginBottom:"20px",boxShadow:"0 4px 24px rgba(199,22,24,0.1)"}}>
              <div style={{fontWeight:800,fontSize:"16px",color:"var(--rd-dark)",marginBottom:"18px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span>➕ Создать пользователя</span>
                <button onClick={() => setShowCreateUser(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:"18px",color:"var(--rd-gray-text)"}}>✕</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px",marginBottom:"12px"}}>
                <div className="form-field">
                  <label className="form-label">Имя <span style={{color:"var(--rd-red)"}}>*</span></label>
                  <input className="form-input" placeholder="Иван" value={createUserForm.firstName} onChange={e => setCreateUserForm(f=>({...f,firstName:e.target.value}))} />
                </div>
                <div className="form-field">
                  <label className="form-label">Фамилия</label>
                  <input className="form-input" placeholder="Петров" value={createUserForm.lastName} onChange={e => setCreateUserForm(f=>({...f,lastName:e.target.value}))} />
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px",marginBottom:"12px"}}>
                <div className="form-field">
                  <label className="form-label">Логин <span style={{color:"var(--rd-red)"}}>*</span></label>
                  <input className="form-input" placeholder="ivanpetrov" value={createUserForm.username} onChange={e => setCreateUserForm(f=>({...f,username:e.target.value.replace(/\s/g,"")}))} />
                </div>
                <div className="form-field">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" placeholder="ivan@corp.ru" value={createUserForm.email} onChange={e => setCreateUserForm(f=>({...f,email:e.target.value}))} />
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"12px",marginBottom:"16px"}}>
                <div className="form-field">
                  <label className="form-label">Пароль <span style={{color:"var(--rd-red)"}}>*</span></label>
                  <input className="form-input" type="password" placeholder="Мин. 6 символов" value={createUserForm.password} onChange={e => setCreateUserForm(f=>({...f,password:e.target.value}))} />
                </div>
                <div className="form-field">
                  <label className="form-label">Роль</label>
                  <select className="form-select" value={createUserForm.role} onChange={e => setCreateUserForm(f=>({...f,role:e.target.value}))}>
                    <option value="user">Пользователь</option>
                    <option value="admin">Администратор</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Начальный баланс</label>
                  <input className="form-input" type="number" min="0" placeholder="0" value={createUserForm.balance} onChange={e => setCreateUserForm(f=>({...f,balance:e.target.value}))} />
                </div>
              </div>
              <div style={{display:"flex",gap:"10px"}}>
                <button className="btn btn-primary" onClick={createUserSubmit}>✓ Создать</button>
                <button className="btn btn-secondary" onClick={() => setShowCreateUser(false)}>Отмена</button>
              </div>
            </div>
          )}

          <div style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"12px"}}>
            Показано: {userList.length} {userRoleFilter === "admin" ? "администраторов" : userRoleFilter === "user" ? "пользователей" : "пользователей"}
          </div>
          {userList.length === 0 && <p style={{color:"var(--rd-gray-text)"}}>Пользователи не найдены</p>}
          <div className="user-list">
            {userList.map(([username, user]) => (
              <div key={username} className="user-card">
                <div className="user-card-info">
                  <div className="user-card-name">
                    {username}
                    {user.role === "admin" && <span style={{marginLeft:"8px",fontSize:"11px",fontWeight:700,background:"var(--rd-red-light)",color:"var(--rd-red)",border:"1.5px solid rgba(199,22,24,0.2)",borderRadius:"20px",padding:"1px 8px"}}>Админ</span>}
                  </div>
                  <div className="user-card-email">{user.email}</div>
                  <div className="user-card-date">С {user.createdAt ? new Date(user.createdAt).toLocaleDateString("ru-RU") : "—"}</div>
                  {user.birthdate && !isNaN(new Date(user.birthdate)) && <div className="user-card-date" style={{color:"var(--rd-red)"}}>🎂 {new Date(user.birthdate).toLocaleDateString("ru-RU", {day:"numeric",month:"long"})}</div>}
                </div>
                <div className="user-card-balance">
                  <div className="ucb-label">Баланс</div>
                  <div className="ucb-value">{user.balance || 0}</div>
                  <div className="ucb-unit">{cName}</div>
                </div>
                <div className="user-card-controls">
                  <input className="qty-input" type="number" min="1" placeholder="Сумма"
                    value={amounts[username] || ""}
                    onChange={e => setAmounts(prev => ({...prev, [username]: e.target.value}))} />
                  <button className="btn btn-primary btn-sm" onClick={() => grant(username, 1)}>+ Начислить</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => grant(username, -1)}>− Списать</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setUserEditModal({username, user})} title="Редактировать">✏️</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => toggleAdmin(username)} title={user.role === "admin" ? "Разжаловать" : "Сделать админом"} style={{fontSize:"16px"}}>
                    {user.role === "admin" ? "👤" : "🛡️"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => deleteUser(username)} title="Удалить" style={{color:"var(--rd-red)"}}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "categories" && (
        <div>
          <div className="product-form-card" style={{marginBottom:"20px",position:"relative",top:"auto"}}>
            <div className="product-form-title">🏷️ Добавить категорию</div>
            <div style={{display:"flex",gap:"10px"}}>
              <input className="form-input" placeholder="Название категории" value={catInput} onChange={e => setCatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && catInput.trim()) { if (!categories.includes(catInput.trim())) { saveCategories([...categories, catInput.trim()]); } setCatInput(""); } }} />
              <button className="btn btn-primary" style={{flexShrink:0}} onClick={() => {
                if (!catInput.trim()) return;
                if (categories.includes(catInput.trim())) { notify("Категория уже существует", "err"); return; }
                saveCategories([...categories, catInput.trim()]);
                setCatInput("");
                notify("Категория добавлена");
              }}>Добавить</button>
            </div>
          </div>
          <div className="product-list-admin">
            {categories.map((cat, i) => (
              <div key={cat} className="product-admin-card">
                <div className="pac-img" style={{fontSize:"20px"}}>🏷️</div>
                <div className="pac-info">
                  {editCatIdx === i
                    ? <input className="form-input" value={editCatVal} onChange={e => setEditCatVal(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            const trimmed = editCatVal.trim();
                            if (!trimmed) return;
                            const newCats = categories.map((c2, j) => j === i ? trimmed : c2);
                            saveCategories(newCats);
                            setEditCatIdx(null);
                            notify("Категория обновлена");
                          }
                          if (e.key === "Escape") setEditCatIdx(null);
                        }} autoFocus />
                    : <div className="pac-name">{cat}</div>
                  }
                </div>
                <div className="pac-actions">
                  {editCatIdx === i
                    ? <>
                        <button className="btn-icon" onClick={() => {
                          const trimmed = editCatVal.trim();
                          if (!trimmed) return;
                          saveCategories(categories.map((c2, j) => j === i ? trimmed : c2));
                          setEditCatIdx(null);
                          notify("Категория обновлена");
                        }}>✓</button>
                        <button className="btn-icon" onClick={() => setEditCatIdx(null)}>✕</button>
                      </>
                    : <button className="btn-icon" onClick={() => { setEditCatIdx(i); setEditCatVal(cat); }}>✏️</button>
                  }
                  <button className="btn-icon delete" onClick={() => {
                    if (!confirm("Удалить категорию \"" + cat + "\"?")) return;
                    saveCategories(categories.filter((_, j) => j !== i));
                    notify("Категория удалена");
                  }}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {userEditModal && users[userEditModal.username] && (
        <div className="modal-overlay" onClick={() => setUserEditModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{maxWidth:"440px",padding:"32px 28px"}}>
            <button className="modal-close" onClick={() => setUserEditModal(null)}>✕</button>
            <div style={{fontWeight:800,fontSize:"20px",marginBottom:"20px"}}>Редактировать пользователя</div>
            <UserEditErrorBoundary>
              <UserEditForm username={userEditModal.username} user={users[userEditModal.username] || userEditModal.user} users={users} saveUsers={saveUsers} notify={notify} onClose={() => setUserEditModal(null)} isAdmin={isAdmin} />
            </UserEditErrorBoundary>
          </div>
        </div>
      )}

      {tab === "orders" && (
        <div className="order-list">
          {orders.length === 0 && <div className="empty-state"><div className="empty-state-icon">📦</div><div className="empty-state-text">Заказов пока нет</div></div>}
          {orders.map(order => (
            <div key={order.id} className="order-card">
              <div>
                <div className="order-id">#{order.id} · {order.date}</div>
                <div className="order-user">{order.user}</div>
                <div className="order-items">
                  {order.items.map(i => <span key={i.id} className="order-item-tag">{i.emoji} {i.name} ×{i.qty}</span>)}
                </div>
              </div>
              <div className="order-right">
                <div className="order-total">{order.total}<span>{cName}</span></div>
                <select className="order-status-select" value={order.status} onChange={e => updateStatus(order.id, e.target.value)}>
                  <option>Обрабатывается</option>
                  <option>Собирается</option>
                  <option>Отправлен</option>
                  <option>Доставлен</option>
                  <option>Отменён</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "import" && (
        <div>
          <div style={{background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius)",padding:"32px 28px",boxShadow:"var(--rd-shadow-md)",marginBottom:"20px"}}>
            <div style={{fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"var(--rd-gray-text)",marginBottom:"16px",paddingBottom:"10px",borderBottom:"1px solid var(--rd-gray-border)"}}>Загрузка файла</div>
            <p style={{fontSize:"14px",color:"var(--rd-gray-text)",marginBottom:"24px",lineHeight:1.6}}>
              Поддерживаются форматы <strong>.xlsx</strong> и <strong>.csv</strong>.<br/>
              Новые товары будут добавлены, существующие (по полю <code style={{background:"var(--rd-gray-bg)",padding:"1px 6px",borderRadius:"4px",fontSize:"12px"}}>id</code>) — обновлены.
            </p>
            <div style={{display:"flex",gap:"10px",alignItems:"center",flexWrap:"wrap"}}>
              <input type="file" accept=".csv,.xlsx,.xls" style={{display:"none"}} id="admin-import-file-input" onChange={handleImport} />
              <label htmlFor="admin-import-file-input" className="btn btn-secondary btn-sm" style={{cursor:"pointer"}}>📷 Загрузить фото</label>
            </div>
          </div>

          <div style={{background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius)",padding:"28px",boxShadow:"var(--rd-shadow)"}}>
            <div style={{fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"var(--rd-gray-text)",marginBottom:"16px",paddingBottom:"10px",borderBottom:"1px solid var(--rd-gray-border)"}}>Структура файла</div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
                <thead>
                  <tr style={{background:"var(--rd-gray-bg)"}}>
                    {["Поле","Тип","Описание","Обязательно"].map(h=>(
                      <th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:"var(--rd-dark)",borderBottom:"1.5px solid var(--rd-gray-border)",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["id","число","ID товара. Пусто — новый товар, существующий — обновление",""],
                    ["name","текст","Название товара","✓"],
                    ["category","текст","Одежда, Аксессуары, Посуда, Канцелярия…",""],
                    ["price","число","Цена","✓"],
                    ["sku","текст","Артикул",""],
                    ["emoji","символ","Эмодзи товара (напр. 👕)",""],
                    ["desc","текст","Описание товара",""],
                    ["badge","текст","hit / new / sale / excl",""],
                    ["discount","число","Скидка в % (0–90)",""],
                    ["inactive","0/1","0 = виден, 1 = скрыт",""],
                    ["sizes","текст","Размеры через запятую: S,M,L,XL",""],
                  ].map(([f,t,d,req],i)=>(
                    <tr key={f} style={{background: i%2===0?"#fff":"var(--rd-gray-bg)"}}>
                      <td style={{padding:"8px 12px",fontFamily:"monospace",fontSize:"12px",fontWeight:600,color:"var(--rd-dark)",borderBottom:"1px solid var(--rd-gray-border)",whiteSpace:"nowrap"}}>{f}</td>
                      <td style={{padding:"8px 12px",color:"var(--rd-gray-text)",borderBottom:"1px solid var(--rd-gray-border)",whiteSpace:"nowrap"}}>{t}</td>
                      <td style={{padding:"8px 12px",color:"var(--rd-dark)",borderBottom:"1px solid var(--rd-gray-border)"}}>{d}</td>
                      <td style={{padding:"8px 12px",textAlign:"center",color:"var(--rd-red)",fontWeight:700,borderBottom:"1px solid var(--rd-gray-border)"}}>{req}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "export" && (
        <div>
          <div style={{background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius)",padding:"32px 28px",boxShadow:"var(--rd-shadow-md)",marginBottom:"20px"}}>
            <div style={{fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"var(--rd-gray-text)",marginBottom:"16px",paddingBottom:"10px",borderBottom:"1px solid var(--rd-gray-border)"}}>Экспорт каталога</div>
            <p style={{fontSize:"14px",color:"var(--rd-gray-text)",marginBottom:"28px",lineHeight:1.6}}>
              Скачайте полный каталог товаров в нужном формате. Файл содержит <strong>{products.length} товаров</strong> с текущими данными.
            </p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"16px"}}>
              <div style={{border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius-sm)",padding:"24px",textAlign:"center",cursor:"pointer",transition:"all 0.15s"}}
                onClick={exportXLSX}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--rd-red)";e.currentTarget.style.boxShadow="var(--rd-shadow-md)";e.currentTarget.style.transform="translateY(-2px)"}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--rd-gray-border)";e.currentTarget.style.boxShadow="none";e.currentTarget.style.transform="none"}}>
                <div style={{fontSize:"40px",marginBottom:"12px"}}>📊</div>
                <div style={{fontWeight:800,fontSize:"17px",color:"var(--rd-dark)",marginBottom:"6px"}}>Excel (XLSX)</div>
                <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginBottom:"16px"}}>Открывается в Excel, Google Sheets, LibreOffice</div>
                <div className="btn btn-primary btn-sm btn-block">⬇ Скачать XLSX</div>
              </div>
              <div style={{border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius-sm)",padding:"24px",textAlign:"center",cursor:"pointer",transition:"all 0.15s"}}
                onClick={exportCSV}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--rd-red)";e.currentTarget.style.boxShadow="var(--rd-shadow-md)";e.currentTarget.style.transform="translateY(-2px)"}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--rd-gray-border)";e.currentTarget.style.boxShadow="none";e.currentTarget.style.transform="none"}}>
                <div style={{fontSize:"40px",marginBottom:"12px"}}>📄</div>
                <div style={{fontWeight:800,fontSize:"17px",color:"var(--rd-dark)",marginBottom:"6px"}}>CSV</div>
                <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginBottom:"16px"}}>Универсальный формат, любой текстовый редактор</div>
                <div className="btn btn-secondary btn-sm btn-block">⬇ Скачать CSV</div>
              </div>
            </div>
          </div>

          <div style={{background:"#fff",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius)",padding:"28px",boxShadow:"var(--rd-shadow)"}}>
            <div style={{fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"var(--rd-gray-text)",marginBottom:"16px",paddingBottom:"10px",borderBottom:"1px solid var(--rd-gray-border)"}}>Сводка по каталогу</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"12px"}}>
              {[
                ["Всего товаров", products.length, "🛍️"],
                ["Активных", products.filter(p=>!p.inactive).length, "✅"],
                ["Скрытых", products.filter(p=>p.inactive).length, "🚫"],
                ["Со скидкой", products.filter(p=>p.discount>0).length, "🏷️"],
                ["Категорий", [...new Set(products.map(p=>p.category))].length, "📂"],
                ["Ср. цена", products.length ? Math.round(products.reduce((s,p)=>s+(p.price||0),0)/products.length) + " " + getCurrName(appearance?.currency) : "—", "💰"],
              ].map(([label,val,icon])=>(
                <div key={label} style={{background:"var(--rd-gray-bg)",borderRadius:"var(--rd-radius-sm)",padding:"16px",textAlign:"center"}}>
                  <div style={{fontSize:"22px",marginBottom:"6px"}}>{icon}</div>
                  <div style={{fontSize:"22px",fontWeight:800,color:"var(--rd-red)",lineHeight:1}}>{val}</div>
                  <div style={{fontSize:"11px",color:"var(--rd-gray-text)",marginTop:"4px",fontWeight:600}}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "faq" && (
        <FaqAdminTab faq={faq} saveFaq={saveFaq} notify={notify} />
      )}

    </div>
  );
}

// ── PROFILE ───────────────────────────────────────────────────────────────

// ── SETTINGS ──────────────────────────────────────────────────────────────

function BannerSettingsTab({ appearance, saveAppearance, notify }) {
  
  const banner = appearance.banner || {};
  const [form, setForm] = useState({
    enabled: banner.enabled !== false,
    title: banner.title || "Корпоративный мерч для вашей команды",
    desc: banner.desc || "Эксклюзивные товары. Тратьте корпоративные баллы и собирайте стиль.",
    image: banner.image || "",
    buttonText: banner.buttonText || "Подробнее",
    buttonLink: banner.buttonLink || "",
  });

  const save = () => {
    saveAppearance({ ...appearance, banner: { ...form } });
    notify("Настройки баннера сохранены ✓");
  };

  const handleImage = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const compressed = await compressImage(ev.target.result, 1600, 600, 0.82);
      setForm(f => ({ ...f, image: compressed }));
    };
    reader.readAsDataURL(file); e.target.value = "";
  };

  return (
    <div>
      <div className="settings-card">
        <div className="settings-section-title">🖼️ Главный баннер</div>
        <div style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"24px",lineHeight:"1.7"}}>
          Баннер отображается на главной странице магазина под меню. Вы можете задать изображение, заголовок и описание.
        </div>

        {/* Enable toggle */}
        <div style={{display:"flex",alignItems:"center",gap:"14px",padding:"14px 16px",background:form.enabled?"rgba(5,150,105,0.06)":"var(--rd-gray-bg)",borderRadius:"var(--rd-radius-sm)",border:"1.5px solid",borderColor:form.enabled?"rgba(5,150,105,0.2)":"var(--rd-gray-border)",marginBottom:"24px",transition:"all 0.2s"}}>
          <div style={{position:"relative",width:"44px",height:"24px",flexShrink:0,cursor:"pointer"}} onClick={() => setForm(f=>({...f,enabled:!f.enabled}))}>
            <div style={{position:"absolute",inset:0,borderRadius:"12px",background:form.enabled?"var(--rd-green)":"var(--rd-gray-border)",transition:"background 0.2s"}} />
            <div style={{position:"absolute",top:"3px",left:form.enabled?"22px":"3px",width:"18px",height:"18px",borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}} />
          </div>
          <div>
            <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>Показывать баннер</div>
            <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"2px"}}>{form.enabled ? "Баннер виден на главной странице" : "Баннер скрыт"}</div>
          </div>
        </div>

        {/* Image upload */}
        <div className="form-field">
          <label className="form-label">Изображение баннера</label>
          {form.image ? (
            <div>
              <div style={{borderRadius:"var(--rd-radius-sm)",overflow:"hidden",marginBottom:"12px",maxHeight:"200px",border:"1.5px solid var(--rd-gray-border)"}}>
                <img src={form.image} alt="banner" style={{width:"100%",height:"200px",objectFit:"cover",display:"block"}} />
              </div>
              <div style={{display:"flex",gap:"10px"}}>
                <label className="btn btn-secondary btn-sm" style={{cursor:"pointer",position:"relative"}}>
                  🔄 Заменить
                  <input type="file" accept="image/*" style={{position:"absolute",inset:0,opacity:0,cursor:"pointer"}} onChange={handleImage} />
                </label>
                <button className="btn btn-ghost btn-sm" onClick={() => setForm(f=>({...f,image:""}))} style={{color:"var(--rd-red)"}}>✕ Удалить</button>
              </div>
            </div>
          ) : (
            <label style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"10px",border:"2px dashed var(--rd-gray-border)",borderRadius:"var(--rd-radius-sm)",padding:"36px 24px",cursor:"pointer",transition:"all 0.15s",background:"var(--rd-gray-bg)",position:"relative"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--rd-red)";e.currentTarget.style.background="var(--rd-red-light)"}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--rd-gray-border)";e.currentTarget.style.background="var(--rd-gray-bg)"}}>
              <input type="file" accept="image/*" style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",width:"100%",height:"100%"}} onChange={handleImage} />
              <div style={{fontSize:"36px"}}>🖼️</div>
              <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>Загрузить изображение</div>
              <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>JPG, PNG, WebP · Рекомендуется 1600×600 px</div>
              <div className="btn btn-primary btn-sm" style={{pointerEvents:"none"}}>Выбрать файл</div>
            </label>
          )}
        </div>

        {/* Title */}
        <div className="form-field" style={{marginTop:"20px"}}>
          <label className="form-label">Заголовок баннера</label>
          <input
            className="form-input"
            placeholder="Корпоративный мерч для вашей команды"
            value={form.title}
            onChange={e => setForm(f=>({...f, title: e.target.value}))}
            maxLength={80}
          />
          <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"4px",textAlign:"right"}}>{form.title.length}/80</div>
        </div>

        {/* Description */}
        <div className="form-field" style={{marginTop:"16px"}}>
          <label className="form-label">Описание / подзаголовок</label>
          <textarea
            className="form-input"
            rows={3}
            style={{resize:"vertical",minHeight:"80px"}}
            placeholder="Эксклюзивные товары. Тратьте корпоративные баллы и собирайте стиль."
            value={form.desc}
            onChange={e => setForm(f=>({...f, desc: e.target.value}))}
            maxLength={200}
          />
          <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"4px",textAlign:"right"}}>{form.desc.length}/200</div>
        </div>

        {/* Button */}
        <div className="form-field" style={{marginTop:"16px"}}>
          <label className="form-label">Текст кнопки «Подробнее»</label>
          <input
            className="form-input"
            placeholder="Подробнее"
            value={form.buttonText}
            onChange={e => setForm(f=>({...f, buttonText: e.target.value}))}
            maxLength={40}
          />
        </div>
        <div className="form-field" style={{marginTop:"12px"}}>
          <label className="form-label">Ссылка кнопки</label>
          <input
            className="form-input"
            placeholder="https://example.com или /catalog"
            value={form.buttonLink}
            onChange={e => setForm(f=>({...f, buttonLink: e.target.value}))}
          />
          <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"4px"}}>Оставьте пустым — кнопка не будет показана</div>
        </div>

        {/* Preview */}
        <div style={{marginTop:"24px",borderRadius:"var(--rd-radius-sm)",overflow:"hidden",border:"1.5px solid var(--rd-gray-border)"}}>
          <div style={{fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"var(--rd-gray-text)",padding:"10px 14px",background:"var(--rd-gray-bg)",borderBottom:"1px solid var(--rd-gray-border)"}}>Предпросмотр</div>
          <div style={{position:"relative",minHeight:"120px",background:form.image?"transparent":"linear-gradient(135deg,#1a0a0a 0%,#2d1a1a 100%)",display:"flex",alignItems:"center"}}>
            {form.image && <div style={{position:"absolute",inset:0,backgroundImage:`url(${form.image})`,backgroundSize:"cover",backgroundPosition:"center"}} />}
            {form.image && <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,rgba(0,0,0,0.72) 0%,rgba(0,0,0,0.2) 100%)"}} />}
            {!form.image && <div style={{position:"absolute",inset:0,overflow:"hidden"}}><div style={{position:"absolute",width:"300px",height:"300px",borderRadius:"50%",background:"radial-gradient(circle,rgba(199,22,24,0.18) 0%,transparent 70%)",top:"-100px",right:"-50px"}} /></div>}
            <div style={{position:"relative",zIndex:2,padding:"24px 28px"}}>
              <div style={{fontSize:"10px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--rd-red)",marginBottom:"8px",background:"rgba(199,22,24,0.12)",border:"1px solid rgba(199,22,24,0.25)",borderRadius:"20px",display:"inline-block",padding:"3px 10px"}}>Корпоративный магазин мерча</div>
              <div style={{fontSize:"clamp(16px,3vw,22px)",fontWeight:900,color:"#fff",lineHeight:1.2,marginBottom:"8px"}}>{form.title || "Заголовок баннера"}</div>
              <div style={{fontSize:"13px",color:"rgba(255,255,255,0.7)",marginBottom:"12px"}}>{form.desc || "Описание баннера"}</div>
              {form.buttonLink && <div style={{display:"inline-block",background:"var(--rd-red)",color:"#fff",borderRadius:"8px",padding:"7px 16px",fontWeight:700,fontSize:"12px"}}>{form.buttonText || "Подробнее"} →</div>}
            </div>
          </div>
        </div>

        <div style={{marginTop:"24px"}}>
          <button className="btn btn-primary" onClick={save}>💾 Сохранить</button>
        </div>
      </div>
    </div>
  );
}

function SeoSettingsTab({ appearance, saveAppearance, notify }) {
  
  const seo = appearance.seo || {};
  const [form, setForm] = useState({ title: seo.title || "", description: seo.description || "", favicon: seo.favicon || "" });

  const save = () => {
    saveAppearance({ ...appearance, seo: { ...form } });
    notify("SEO настройки сохранены ✓");
  };

  const handleFavicon = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const compressed = await compressImage(ev.target.result, 64, 64, 0.9);
      setForm(f => ({ ...f, favicon: compressed }));
    };
    reader.readAsDataURL(file); e.target.value = "";
  };

  return (
    <div>
      <div className="settings-card">
        <div className="settings-section-title">🔍 SEO настройки</div>
        <div style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"24px",lineHeight:"1.7"}}>
          Настройте заголовок вкладки браузера, описание страницы и значок сайта (favicon). Применяются мгновенно.
        </div>

        {/* Title */}
        <div className="form-field">
          <label className="form-label">Title — заголовок вкладки</label>
          <input
            className="form-input"
            placeholder="Corp Merch — Корпоративный магазин"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            maxLength={80}
          />
          <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"4px",display:"flex",justifyContent:"space-between"}}>
            <span>Отображается в заголовке вкладки и в результатах поиска</span>
            <span style={{color: form.title.length > 60 ? "#f59e0b" : "inherit"}}>{form.title.length}/80</span>
          </div>
        </div>

        {/* Description */}
        <div className="form-field" style={{marginTop:"20px"}}>
          <label className="form-label">Description — описание</label>
          <textarea
            className="form-input"
            placeholder="Эксклюзивные корпоративные товары для вашей команды"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={3}
            maxLength={200}
            style={{resize:"vertical",minHeight:"80px"}}
          />
          <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"4px",display:"flex",justifyContent:"space-between"}}>
            <span>Используется в мета-теге description для поисковиков и соцсетей</span>
            <span style={{color: form.description.length > 155 ? "#f59e0b" : "inherit"}}>{form.description.length}/200</span>
          </div>
        </div>

        {/* Favicon */}
        <div className="form-field" style={{marginTop:"20px"}}>
          <label className="form-label">Favicon — иконка сайта</label>
          <div style={{display:"flex",alignItems:"center",gap:"16px",flexWrap:"wrap",marginBottom:"8px"}}>
            {/* Preview */}
            <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 14px",background:"var(--rd-gray-bg)",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius-sm)"}}>
              {form.favicon
                ? <img src={form.favicon} alt="favicon preview" style={{width:"20px",height:"20px",objectFit:"contain"}} />
                : <div style={{width:"20px",height:"20px",background:"var(--rd-gray-border)",borderRadius:"4px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",color:"var(--rd-gray-text)"}}>?</div>
              }
              <span style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>Превью вкладки</span>
            </div>
            <label className="btn btn-secondary" style={{cursor:"pointer",position:"relative"}}>
              {form.favicon ? "🔄 Заменить" : "📤 Загрузить favicon"}
              <input type="file" accept="image/*,.ico" style={{position:"absolute",inset:0,opacity:0,cursor:"pointer"}} onChange={handleFavicon} />
            </label>
            {form.favicon && (
              <button className="btn btn-ghost" onClick={() => setForm(f => ({ ...f, favicon: "" }))} style={{color:"var(--rd-gray-text)"}}>
                ✕ Удалить
              </button>
            )}
          </div>
          <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>PNG, ICO, SVG · Рекомендуется 32×32 или 64×64 пикселей</div>
        </div>

        {/* Preview block */}
        {(form.title || form.description || form.favicon) && (
          <div style={{marginTop:"24px",padding:"16px",background:"#f8fafc",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius-sm)"}}>
            <div style={{fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",color:"var(--rd-gray-text)",marginBottom:"12px"}}>Превью в поиске</div>
            <div style={{display:"flex",alignItems:"flex-start",gap:"10px"}}>
              {form.favicon && <img src={form.favicon} style={{width:"16px",height:"16px",marginTop:"3px",objectFit:"contain",flexShrink:0}} alt="" />}
              <div>
                <div style={{fontSize:"18px",color:"#1a0dab",fontWeight:400,lineHeight:1.3,marginBottom:"3px"}}>{form.title || "Corp Merch — Корпоративный магазин"}</div>
                <div style={{fontSize:"13px",color:"#006621",marginBottom:"3px"}}>https://corp-merch.ru</div>
                <div style={{fontSize:"13px",color:"#545454",lineHeight:1.4}}>{form.description || "Описание страницы появится здесь..."}</div>
              </div>
            </div>
          </div>
        )}

        <div style={{marginTop:"24px"}}>
          <button className="btn btn-primary" onClick={save}>💾 Сохранить</button>
        </div>
      </div>
    </div>
  );
}

function CurrencySettingsTab({ appearance, saveAppearance, notify }) {
  
  const curr = appearance.currency || {};
  const [cForm, setCForm] = useState({ name: curr.name || "RuDeCoin", icon: curr.icon || "🪙", logo: curr.logo || "" });

  const saveCurrency = () => {
    if (!cForm.name.trim()) { notify("Введите название валюты", "err"); return; }
    saveAppearance({ ...appearance, currency: { ...cForm, name: cForm.name.trim() } });
    notify("Настройки валюты сохранены ✓");
  };
  const handleCurrencyLogo = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const compressed = await compressImage(ev.target.result, 64, 64, 0.9);
      setCForm(f => ({ ...f, logo: compressed }));
    };
    reader.readAsDataURL(file); e.target.value = "";
  };

  return (
    <div>
      <div className="settings-card">
        <div className="settings-section-title">🪙 Настройки корпоративной валюты</div>
        <div style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"20px",lineHeight:"1.7"}}>
          Настройте название и значок валюты — они применяются по всему магазину: баланс, цены, заказы, переводы.
        </div>
        {/* Preview */}
        <div style={{marginBottom:"24px"}}>
          <div style={{fontSize:"12px",fontWeight:700,color:"var(--rd-gray-text)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:"10px"}}>Превью — так выглядит в шапке сайта:</div>
          <div style={{display:"inline-flex",alignItems:"center",gap:"6px",background:"var(--rd-green-light)",border:"1px solid rgba(5,150,105,0.2)",padding:"6px 14px",borderRadius:"var(--rd-radius-sm)",fontSize:"13px",fontWeight:700,color:"var(--rd-green)"}}>
            {cForm.logo
              ? <img src={cForm.logo} alt="" style={{width:"16px",height:"16px",objectFit:"contain",verticalAlign:"middle"}} />
              : <span style={{fontSize:"14px"}}>{cForm.icon || "🪙"}</span>}
            <span>1 250 <span style={{opacity:0.85}}>{cForm.name || "RuDeCoin"}</span></span>
          </div>
        </div>
        <div className="form-field">
          <label className="form-label">Название валюты</label>
          <input className="form-input" placeholder="RuDeCoin" value={cForm.name} onChange={e => setCForm(f => ({...f, name: e.target.value}))} style={{maxWidth:"300px"}} />
          <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"4px"}}>Отображается рядом с суммами во всём интерфейсе</div>
        </div>
        <div className="form-field" style={{marginTop:"16px"}}>
          <label className="form-label">Иконка (эмодзи)</label>
          <input className="form-input" placeholder="🪙" value={cForm.icon} onChange={e => setCForm(f => ({...f, icon: e.target.value}))} style={{maxWidth:"100px",fontSize:"20px",textAlign:"center"}} maxLength={4} />
          <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"4px"}}>Используется когда нет загруженного логотипа</div>
        </div>
        <div className="form-field" style={{marginTop:"16px"}}>
          <label className="form-label">Логотип валюты (необязательно)</label>
          <div style={{display:"flex",alignItems:"center",gap:"16px",flexWrap:"wrap"}}>
            {cForm.logo && (
              <div style={{position:"relative",width:"56px",height:"56px"}}>
                <img src={cForm.logo} alt="currency logo" style={{width:"56px",height:"56px",objectFit:"contain",borderRadius:"12px",border:"1.5px solid var(--rd-gray-border)",padding:"6px",background:"#fff"}} />
                <button onClick={() => setCForm(f => ({...f, logo: ""}))} style={{position:"absolute",top:"-6px",right:"-6px",width:"18px",height:"18px",borderRadius:"50%",background:"var(--rd-red)",border:"none",cursor:"pointer",color:"#fff",fontSize:"10px",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>✕</button>
              </div>
            )}
            <label className="btn btn-secondary" style={{cursor:"pointer",position:"relative"}}>
              {cForm.logo ? "Заменить логотип" : "📤 Загрузить логотип"}
              <input type="file" accept="image/*" style={{position:"absolute",inset:0,opacity:0,cursor:"pointer"}} onChange={handleCurrencyLogo} />
            </label>
          </div>
          <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"6px"}}>PNG, SVG, JPG · Рекомендуется квадратное 64×64. Если загружен — эмодзи не используется.</div>
        </div>
        <div style={{marginTop:"24px"}}>
          <button className="btn btn-primary" onClick={saveCurrency}>💾 Сохранить</button>
        </div>
      </div>
    </div>
  );
}

function SettingsPage({ currentUser, users, saveUsers, notify, dbConfig, saveDbConfig, refreshDbConfig, pgConfig, savePgConfig, isPgActive, isAdmin, orders, saveOrders, products, saveProducts, categories, saveCategories, appearance, saveAppearance, markOrdersSeen, transfers, saveTransfers, faq, saveFaq, videos, saveVideos, tasks, saveTasks, taskSubmissions, saveTaskSubmissions, auctions, saveAuctions, lotteries, saveLotteries, polls, savePolls, deposits, saveDeposits, userDeposits, saveUserDeposits, sqliteDisabled, setSqliteDisabled }) {
  const [tab, setTab] = useState("profile");
  const setTabSafe = (t) => { if (!isAdmin && t !== "profile") return; setTab(t); };
  const [adminTab, setAdminTab] = useState("products");
  const [currencySubTab, setCurrencySubTab] = useState("currency_settings");
  const [bdBonus, setBdBonus] = useState(String(appearance.birthdayBonus ?? 100));
  const [bdEnabled, setBdEnabled] = useState(appearance.birthdayEnabled !== false);
  const [integ, setInteg] = useState(() => ({
    tgEnabled: false,
    tgBotToken: "",
    tgChatId: "",
    maxEnabled: false,
    maxBotToken: "",
    maxChatId: "",
    ...((appearance.integrations) || {})
  }));
  useEffect(() => {
    if (appearance.integrations) {
      setInteg(prev => ({ ...prev, ...appearance.integrations }));
    }
  }, [JSON.stringify(appearance.integrations)]);

  const [bitrix24, setBitrix24] = useState(() => ({
    enabled: false, clientId: "", clientSecret: "", portalUrl: "",
    ...(appearance.bitrix24 || {})
  }));
  useEffect(() => {
    if (appearance.bitrix24) setBitrix24(prev => ({ ...prev, ...appearance.bitrix24 }));
  }, [JSON.stringify(appearance.bitrix24)]);

  const [registrationEnabled, setRegistrationEnabled] = useState(appearance.registrationEnabled !== false);
  const [features, setFeatures] = useState(() => ({ auction: true, lottery: true, voting: true, bank: true, tasks: true, ...(appearance.features || {}) }));
  useEffect(() => {
    if (appearance.features) setFeatures(prev => ({ ...prev, ...appearance.features }));
  }, [JSON.stringify(appearance.features)]);
  const user = users[currentUser] || {};
  const [form, setForm] = useState({ email: user.email || "", firstName: user.firstName || "", lastName: user.lastName || "", currentPassword: "", newPassword: "", confirmPassword: "", avatar: user.avatar || "" });
  const [ap, setAp] = useState({ ...appearance });
  const [sqlConsole, setSqlConsole] = useState("");
  const [sqlResult, setSqlResult] = useState(null);
  const [sqlError, setSqlError] = useState("");
  const [importing, setImporting] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);
  const [debugLoading, setDebugLoading] = useState(false);

  const runDiag = async () => {
    setDebugLoading(true); setDebugInfo(null);
    try {
      const r = await fetch('/api/debug', { method: 'GET' });
      setDebugInfo(await r.json());
    } catch(e) { setDebugInfo({ error: e.message }); }
    setDebugLoading(false);
  };

  // PostgreSQL state
  const [pgForm, setPgForm] = useState(() => pgConfig || { host: "", port: "5432", database: "", user: "", password: "", ssl: false, enabled: false });
  // Sync pgForm when pgConfig loads asynchronously from server
  useEffect(() => {
    if (pgConfig && pgConfig.host) {
      setPgForm(prev => {
        // Only update if form is still empty (user hasn't started editing)
        if (!prev.host) return { ...pgConfig };
        return prev;
      });
    }
  }, [pgConfig]);
  const [pgTesting, setPgTesting] = useState(false);
  const [pgTestResult, setPgTestResult] = useState(null);
  const [pgActivationMode, setPgActivationMode] = useState('existing'); // 'existing' or 'new'
  const [pgSqlConsole, setPgSqlConsole] = useState("");
  const [pgSqlResult, setPgSqlResult] = useState(null);
  const [pgSqlError, setPgSqlError] = useState("");
  const [pgStats, setPgStats] = useState(null);
  const [pgStatsLoading, setPgStatsLoading] = useState(false);
  const [dbSubTab, setDbSubTab] = useState(() => {
    if (typeof window === 'undefined') return 'postgres';
    const disabled = localStorage.getItem('__sqlite_disabled__') === '1';
    return disabled ? 'postgres' : 'sqlite';
  });

  const testPgConnection = async (cfg) => {
    setPgTesting(true); setPgTestResult(null);
    try {
      const res = await fetch('/api/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pg_test', config: cfg || pgForm }),
      });
      const data = await res.json();
      setPgTestResult(data);
    } catch(err) { setPgTestResult({ ok: false, error: err.message }); }
    setPgTesting(false);
  };

  const savePgSettings = async () => {
    if (!pgForm.host || !pgForm.database || !pgForm.user) {
      notify("Заполните хост, базу данных и пользователя", "err"); return;
    }
    const cfg = { ...pgForm };
    delete cfg._passwordSaved; // remove UI meta-flag before saving
    const r = await fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pg_save', config: cfg }) });
    const result = await r.json();
    if (!result.ok) { notify("Ошибка сохранения: " + (result.error||''), "err"); return; }
    savePgConfig(cfg);
    notify("Настройки PostgreSQL сохранены на сервере ✓");
    await testPgConnection(cfg);
  };

  const enablePg = async () => {
    if (!pgForm.host || !pgForm.database || !pgForm.user) {
      notify("Сначала заполните настройки", "err"); return;
    }
    
    // Подтверждение в зависимости от режима
    if (pgActivationMode === 'new') {
      if (!confirm("⚠️ ВНИМАНИЕ!\n\nВы выбрали режим 'Создать новую БД'.\n\nВсе текущие данные в PostgreSQL будут ПЕРЕЗАПИСАНЫ данными из SQLite!\n\nПродолжить?")) {
        return;
      }
    }
    
    setPgTesting(true);
    const { _passwordSaved, ...pgFormClean } = pgForm;
    const cfg = { ...pgFormClean, enabled: true };
    
    try {
      // 1. Проверяем подключение
      const r = await fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pg_test', config: cfg }) });
      const testRes = await r.json();
      if (!testRes.ok) { 
        notify("Не удалось подключиться: " + testRes.error, "err"); 
        setPgTesting(false); 
        return; 
      }
      
      // 2. Если режим 'new' - мигрируем данные
      if (pgActivationMode === 'new') {
        notify("Миграция данных из SQLite в PostgreSQL...", "ok");
        const all = storage.all();
        const migrateRes = await fetch('/api/store', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'setMany', data: all }) 
        });
        const migrateData = await migrateRes.json();
        if (!migrateData.ok) { 
          notify("Ошибка миграции: " + migrateData.error, "err"); 
          setPgTesting(false); 
          return; 
        }
        notify("✓ Мигрировано " + Object.keys(all).length + " ключей", "ok");
      }
      
      // 3. Сохраняем конфиг и активируем PostgreSQL
      const r2 = await fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pg_save', config: cfg }) });
      const saved = await r2.json();
      if (!saved.ok) { 
        notify("Ошибка сохранения конфига: " + (saved.error||''), "err"); 
        setPgTesting(false); 
        return; 
      }
      
      savePgConfig(cfg);
      setPgForm(cfg);
      
      if (pgActivationMode === 'existing') {
        notify("PostgreSQL активирована! Подключено к существующей БД. Перезагрузка...", "ok");
      } else {
        notify("PostgreSQL активирована! Данные мигрированы. Перезагрузка...", "ok");
      }
      
      setTimeout(() => window.location.reload(), 1500);
    } catch(e) { 
      notify("Ошибка: " + e.message, "err"); 
    }
    setPgTesting(false);
  };

  const disablePg = async () => {
    await fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pg_save', config: null }) });
    savePgConfig(null);
    setPgForm({ host: "", port: "5432", database: "", user: "", password: "", ssl: false, enabled: false });
    notify("PostgreSQL отключена.");
    setTimeout(() => window.location.reload(), 1200);
  };

  const loadPgStats = async () => {
    setPgStatsLoading(true);
    try {
      const res = await fetch('/api/store', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getAll' }),
      });
      const data = await res.json();
      if (data.ok && data.data) {
        const d = data.data;
        const countOf = (v) => {
          if (!v) return 0;
          if (Array.isArray(v)) return v.length;
          if (typeof v === 'object') return Object.keys(v).length;
          return 1;
        };
        const rowCounts = {
          cm_users:      countOf(d.cm_users),
          cm_products:   countOf(d.cm_products),
          cm_orders:     countOf(d.cm_orders),
          cm_transfers:  countOf(d.cm_transfers),
          cm_categories: countOf(d.cm_categories),
          _total_keys:   Object.keys(d).length,
          _total_coins:  d.cm_users
            ? Object.values(d.cm_users).reduce((s, u) => s + (u?.balance || 0), 0)
            : 0,
        };
        let dbSize = '—';
        try {
          const dr = await fetch('/api/store', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'pg_diag' }),
          });
          const dd = await dr.json();
          if (dd.ok && dd.dbSize) dbSize = dd.dbSize;
        } catch {}
        setPgStats({ ok: true, total: rowCounts._total_keys, size: dbSize, rowCounts });
      } else {
        notify("Ошибка загрузки статистики: " + (data.error || 'нет данных'), "err");
      }
    } catch(err) { notify("Ошибка: " + err.message, "err"); }
    setPgStatsLoading(false);
  };

  const runPgSql = async () => {
    setPgSqlError(""); setPgSqlResult(null);
    try {
      const res = await fetch('/api/store', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pg_test', config: pgForm }),
      });
      // For SQL console, use pg.js which still accepts explicit config
      const res2 = await fetch('/api/pg?action=query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: pgSqlConsole.trim() }),
      });
      const data = await res2.json();
      if (data.ok) setPgSqlResult(data);
      else setPgSqlError(data.error);
    } catch(err) { setPgSqlError(err.message); }
  };

  const saveProfile = () => {
    if (!form.email.trim()) { notify("Email не может быть пустым", "err"); return; }
    if (form.newPassword || form.currentPassword) {
      if (form.currentPassword !== user.password) { notify("Неверный текущий пароль", "err"); return; }
      if (form.newPassword.length < 6) { notify("Новый пароль минимум 6 символов", "err"); return; }
      if (form.newPassword !== form.confirmPassword) { notify("Пароли не совпадают", "err"); return; }
    }
    const updated = { ...user, email: form.email.trim(), firstName: form.firstName.trim(), lastName: form.lastName.trim(), avatar: form.avatar || "" };
    if (form.newPassword) updated.password = form.newPassword;
    saveUsers({ ...users, [currentUser]: updated });
    notify("Профиль обновлён ✓");
    setForm(f => ({ ...f, currentPassword: "", newPassword: "", confirmPassword: "" }));
  };

  // Экспорт SQLite базы как .sqlite файл
  const exportSQLite = () => {
    const data = storage.exportDB();
    if (!data) { notify("База данных не инициализирована", "err"); return; }
    const blob = new Blob([data], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "merch_store.sqlite";
    a.click(); URL.revokeObjectURL(url);
    notify("База данных скачана ✓");
  };

  // Импорт SQLite файла
  const importSQLite = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      await storage.importDB(new Uint8Array(buf));
      // Перезагружаем данные
      window.location.reload();
    } catch(err) {
      notify("Ошибка импорта: " + err.message, "err");
      setImporting(false);
    }
    e.target.value = "";
  };

  // Экспорт как JSON
  const exportJSON = () => {
    const all = storage.all();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "merch_store_backup.json"; a.click();
    URL.revokeObjectURL(url);
    notify("JSON-бэкап скачан ✓");
  };

  // Импорт JSON
  const importJSON = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      Object.entries(data).forEach(([k, v]) => storage.set(k, v));
      notify("JSON импортирован. Перезагрузите страницу.", "ok");
    } catch(err) { notify("Ошибка импорта JSON: " + err.message, "err"); }
    e.target.value = "";
  };

  // Выполнить SQL из консоли
  const runSql = () => {
    setSqlError(""); setSqlResult(null);
    try {
      const res = storage.exec(sqlConsole.trim());
      setSqlResult(res);
      refreshDbConfig();
    } catch(err) { setSqlError(err.message); }
  };

  // Очистить базу (сбросить все данные)
  const clearDatabase = async () => {
    if (!confirm("Полностью очистить серверную базу данных? Все данные будут удалены без возможности восстановления!")) return;
    try {
      const allKeys = Object.keys(storage.all());
      await Promise.all(allKeys.map(k =>
        fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', key: k, pgConfig }) })
      ));
      notify("Серверная база очищена. Перезагрузите страницу.");
      setTimeout(() => window.location.reload(), 1500);
    } catch(err) { notify("Ошибка: " + err.message, "err"); }
  };

  const clearLocalSQLite = async () => {
    if (!confirm("Удалить локальную копию SQLite из этого браузера?\nСерверные данные (PostgreSQL) не будут затронуты.")) return;
    try {
      // Удаляем IndexedDB
      await new Promise((res, rej) => {
        const req = indexedDB.deleteDatabase('merch_store_sqlite');
        req.onsuccess = res;
        req.onerror = () => rej(req.error);
        req.onblocked = res;
      });
      // Удаляем localStorage ключи (уведомления, сессия и т.д.)
      Object.keys(localStorage)
        .filter(k => k.startsWith('_store_'))
        .forEach(k => localStorage.removeItem(k));
      notify("SQLite браузера очищен. Страница перезагружается...");
      setTimeout(() => window.location.reload(), 1200);
    } catch(err) { notify("Ошибка: " + err.message, "err"); }
  };

  const applyAndSave = (newAp) => { setAp(newAp); saveAppearance(newAp); notify("Внешний вид сохранён ✓"); };

  const SIDEBAR_TABS = isAdmin ? [
    { id: "profile",    icon: "👤", label: "Профиль" },
    { id: "general",    icon: "⚙️", label: "Общее" },
    { id: "appearance", icon: "🎨", label: "Внешний вид" },
    { id: "banner",     icon: "🖼️", label: "Баннер" },
    { id: "video",      icon: "🎬", label: "Видео" },
    { id: "users",      icon: "👥", label: "Пользователи" },
    { id: "currency",   icon: "🪙", label: "Валюта" },
    { id: "seo",        icon: "🔍", label: "SEO" },
    { id: "database",   icon: "🗄️", label: "База данных" },
    { id: "socials",    icon: "🌐", label: "Соц. сети" },
    { id: "faq",        icon: "❓", label: "Вопрос / Ответ" },
    { id: "tasks",      icon: "🎯", label: "Задания" },
    { id: "auction",    icon: "🔨", label: "Аукцион" },
    { id: "lottery",    icon: "🎰", label: "Лотерея" },
    { id: "voting",     icon: "🗳️", label: "Голосование" },
    { id: "bank",       icon: "🏦", label: "Банк" },
    { id: "sections",   icon: "📑", label: "Настройки разделов" },
    { id: "shop",       icon: "🛍️", label: "Управление магазином" },
    { id: "integrations", icon: "🔗", label: "Интеграции" },
  ] : [
    { id: "profile", icon: "👤", label: "Профиль" },
  ];
  const CURRENCY_SUB_TABS = isAdmin ? [
    { id: "currency_settings", icon: "✏️", label: "Настройки" },
    { id: "currency_birthday", icon: "🎂", label: "День рождения" },
    { id: "currency_bulk", icon: "💸", label: "Начисление" },
    { id: "currency_workdays", icon: "💼", label: "Трудодни" },
  ] : [
    { id: "currency_settings", icon: "✏️", label: "Настройки" },
  ];
  const ADMIN_SUB_TABS = [
    { id: "products",   icon: "🛍️", label: "Товары" },
    { id: "categories", icon: "🏷️", label: "Категории" },
    { id: "orders",     icon: "📦", label: "Заказы" },
    { id: "import",     icon: "⬆️", label: "Импорт" },
    { id: "export",     icon: "⬇️", label: "Экспорт" },
  ];

  return (
    <div className="settings-wrap page-fade">
      <div className="page-eyebrow">Аккаунт</div>
      <h2 className="page-title" style={{fontSize:"32px",marginBottom:"28px"}}>Настройки</h2>

      <div className="settings-layout">
        <div className="settings-sidebar">
          {SIDEBAR_TABS.map((t, i) => (
            <React.Fragment key={t.id}>
              {t.id === "shop" && <div className="settings-tab-divider"></div>}
              <button className={"settings-tab" + (tab===t.id?" active":"")} onClick={() => { setTabSafe(t.id); }}>
                <span className="settings-tab-icon">{t.icon}</span>
                {t.label}
              </button>
              {t.id === "currency" && tab === "currency" && (
                <div style={{marginLeft:"12px",marginTop:"2px",display:"flex",flexDirection:"column",gap:"2px"}}>
                  {CURRENCY_SUB_TABS.map(st => (
                    <button key={st.id}
                      className={"settings-tab" + (currencySubTab===st.id?" active":"")}
                      onClick={() => setCurrencySubTab(st.id)}
                      style={{fontSize:"13px",padding:"8px 12px",gap:"8px"}}>
                      <span style={{fontSize:"13px"}}>{st.icon}</span>
                      {st.label}
                    </button>
                  ))}
                </div>
              )}
              {t.id === "shop" && tab === "shop" && isAdmin && (
                <div style={{marginLeft:"12px",marginTop:"2px",display:"flex",flexDirection:"column",gap:"2px"}}>
                  {ADMIN_SUB_TABS.map(st => (
                    <button key={st.id}
                      className={"settings-tab" + (adminTab===st.id?" active":"")}
                      onClick={() => { setAdminTab(st.id); if (st.id === 'orders') markOrdersSeen(); }}
                      style={{fontSize:"13px",padding:"8px 12px",gap:"8px"}}>
                      <span style={{fontSize:"13px"}}>{st.icon}</span>
                      {st.label}
                    </button>
                  ))}
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="settings-content">

          {tab === "general" && isAdmin && (
            <div>
              <div className="settings-card" style={{marginBottom:"16px"}}>
                <div className="settings-section-title">🌐 Регистрация пользователей</div>
                <p style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"20px",lineHeight:1.6}}>
                  Управляйте возможностью самостоятельной регистрации. При отключении кнопка «Регистрация» скрывается — добавлять пользователей сможет только администратор.
                </p>
                <div style={{display:"flex",alignItems:"center",gap:"14px",padding:"14px 16px",background:registrationEnabled?"rgba(34,197,94,0.06)":"var(--rd-gray-bg)",borderRadius:"var(--rd-radius-sm)",border:"1.5px solid",borderColor:registrationEnabled?"rgba(34,197,94,0.25)":"var(--rd-gray-border)",transition:"all 0.2s",marginBottom:"20px"}}>
                  <div style={{position:"relative",width:"44px",height:"24px",flexShrink:0}}>
                    <input type="checkbox" checked={registrationEnabled} onChange={e => setRegistrationEnabled(e.target.checked)}
                      style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",zIndex:1,width:"100%",height:"100%"}} />
                    <div style={{width:"44px",height:"24px",borderRadius:"12px",background:registrationEnabled?"#22c55e":"#d1d5db",transition:"background 0.2s",display:"flex",alignItems:"center",padding:"2px"}}>
                      <div style={{width:"20px",height:"20px",borderRadius:"50%",background:"#fff",transition:"transform 0.2s",transform:registrationEnabled?"translateX(20px)":"translateX(0)",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}></div>
                    </div>
                  </div>
                  <div>
                    <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>
                      {registrationEnabled ? "Регистрация открыта" : "Регистрация закрыта"}
                    </div>
                    <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"2px"}}>
                      {registrationEnabled ? "Любой посетитель может создать аккаунт" : "Новых пользователей добавляет только администратор"}
                    </div>
                  </div>
                </div>
                <button className="btn btn-primary" onClick={() => {
                  saveAppearance({ ...appearance, registrationEnabled });
                  notify("Настройки сохранены ✓");
                }}>Сохранить</button>
              </div>

              {/* Portal version */}
              <div className="settings-card" style={{marginBottom:"16px"}}>
                <div className="settings-section-title">📋 Версия портала</div>
                <p style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"16px",lineHeight:1.6}}>
                  Текст версии отображается в подвале сайта. Например: «Версия портала 3.1» или «v2.0 beta».
                </p>
                <div className="form-field">
                  <label className="form-label">Текст версии</label>
                  <input className="form-input" placeholder="Версия портала 3"
                    value={appearance.portalVersion || ""}
                    onChange={e => saveAppearance({ ...appearance, portalVersion: e.target.value })} />
                </div>
                <button className="btn btn-primary" style={{marginTop:"8px"}} onClick={() => {
                  notify("Версия портала обновлена ✓");
                }}>Сохранить</button>
              </div>

              {/* Feature toggles */}
              <div className="settings-card" style={{marginBottom:"16px"}}>
                <div className="settings-section-title">🧩 Разделы сайта</div>
                <p style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"20px",lineHeight:1.6}}>
                  Включайте и отключайте разделы сайта. При отключении раздел скрывается из верхнего меню и становится недоступен для пользователей.
                </p>
                {[
                  { key: "auction", label: "🔨 Аукцион", desc: "Раздел аукционов" },
                  { key: "lottery", label: "🎰 Лотерея", desc: "Раздел лотерей" },
                  { key: "voting", label: "🗳️ Голосования", desc: "Раздел голосований и опросов" },
                  { key: "bank", label: "🏦 Банк", desc: "Раздел вкладов и банковских операций" },
                  { key: "tasks", label: "🎯 Задания", desc: "Раздел заданий для пользователей" },
                ].map(({ key, label, desc }) => {
                  const enabled = features[key] !== false;
                  return (
                    <div key={key} style={{display:"flex",alignItems:"center",gap:"14px",padding:"12px 16px",background:enabled?"rgba(34,197,94,0.04)":"var(--rd-gray-bg)",borderRadius:"var(--rd-radius-sm)",border:"1.5px solid",borderColor:enabled?"rgba(34,197,94,0.2)":"var(--rd-gray-border)",transition:"all 0.2s",marginBottom:"8px"}}>
                      <div style={{position:"relative",width:"44px",height:"24px",flexShrink:0}}>
                        <input type="checkbox" checked={enabled} onChange={e => setFeatures(prev => ({...prev, [key]: e.target.checked}))}
                          style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",zIndex:1,width:"100%",height:"100%"}} />
                        <div style={{width:"44px",height:"24px",borderRadius:"12px",background:enabled?"#22c55e":"#d1d5db",transition:"background 0.2s",display:"flex",alignItems:"center",padding:"2px"}}>
                          <div style={{width:"20px",height:"20px",borderRadius:"50%",background:"#fff",transition:"transform 0.2s",transform:enabled?"translateX(20px)":"translateX(0)",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}></div>
                        </div>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>{label}</div>
                        <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"2px"}}>{enabled ? desc + " — включён" : desc + " — скрыт"}</div>
                      </div>
                    </div>
                  );
                })}
                <button className="btn btn-primary" style={{marginTop:"12px"}} onClick={() => {
                  saveAppearance({ ...appearance, features });
                  notify("Настройки разделов сохранены ✓");
                }}>Сохранить</button>
              </div>
            </div>
          )}

          {tab === "profile" && (
            <div className="settings-card">
              <div style={{display:"flex",alignItems:"center",gap:"20px",marginBottom:"24px",paddingBottom:"20px",borderBottom:"1.5px solid var(--rd-gray-border)"}}>
                <div style={{position:"relative",flexShrink:0}}>
                  {form.avatar
                    ? <img src={form.avatar} alt="avatar" style={{width:"72px",height:"72px",borderRadius:"50%",objectFit:"cover",border:"2px solid rgba(199,22,24,0.25)"}} />
                    : <div style={{width:"72px",height:"72px",borderRadius:"50%",background:"var(--rd-red-light)",border:"2px solid rgba(199,22,24,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:"28px",color:"var(--rd-red)"}}>
                        {currentUser[0].toUpperCase()}
                      </div>
                  }
                  <label style={{position:"absolute",bottom:0,right:0,width:"24px",height:"24px",borderRadius:"50%",background:"var(--rd-dark)",border:"2px solid #fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"12px",color:"#fff"}} title="Изменить фото">
                    ✏️
                    <input type="file" accept="image/*" style={{display:"none"}} onChange={e => {
                      const file = e.target.files[0]; if (!file) return;
                      const reader = new FileReader();
                      reader.onload = async ev => {
                        const compressed = await compressImage(ev.target.result, 200, 200, 0.8);
                        setForm(f=>({...f,avatar:compressed}));
                      };
                      reader.readAsDataURL(file); e.target.value = "";
                    }} />
                  </label>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:800,fontSize:"18px",color:"var(--rd-dark)"}}>{currentUser}</div>
                  <div style={{fontSize:"13px",color:"var(--rd-gray-text)",marginTop:"2px"}}>{user.role==="admin"?"Администратор":"Пользователь"} · {user.balance||0} {getCurrName()}</div>
                  {form.avatar && <button onClick={() => setForm(f=>({...f,avatar:""}))} style={{marginTop:"6px",fontSize:"11px",color:"var(--rd-red)",background:"none",border:"none",cursor:"pointer",padding:0}}>Удалить фото</button>}
                </div>
              </div>
              <div className="form-field">
                <label className="form-label">Логин</label>
                <input className="form-input" value={currentUser} disabled style={{background:"var(--rd-gray-bg)",color:"var(--rd-gray-text)",cursor:"not-allowed"}} />
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
                <div className="form-field">
                  <label className="form-label">Имя</label>
                  <input className="form-input" placeholder="Иван" value={form.firstName} onChange={e => setForm(f=>({...f,firstName:e.target.value}))} />
                </div>
                <div className="form-field">
                  <label className="form-label">Фамилия</label>
                  <input className="form-input" placeholder="Петров" value={form.lastName} onChange={e => setForm(f=>({...f,lastName:e.target.value}))} />
                </div>
              </div>
              <div className="form-field">
                <label className="form-label">Email</label>
                <input className="form-input" value={form.email} onChange={e => setForm(f=>({...f,email:e.target.value}))} placeholder="email@corp.ru" />
              </div>
              <div className="form-field">
                <label className="form-label">Дата рождения</label>
                {user.birthdate
                  ? <div style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 14px",background:"var(--rd-gray-bg)",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius-sm)"}}>
                      <span style={{fontSize:"18px"}}>🎂</span>
                      <div>
                        <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)"}}>
                          {!isNaN(new Date(user.birthdate)) ? new Date(user.birthdate).toLocaleDateString("ru-RU", {day:"numeric",month:"long",year:"numeric"}) : "—"}
                        </div>
                        <div style={{fontSize:"11px",color:"var(--rd-gray-text)",marginTop:"1px"}}>Изменить может только администратор</div>
                      </div>
                    </div>
                  : <div style={{padding:"10px 14px",background:"var(--rd-gray-bg)",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius-sm)",fontSize:"13px",color:"var(--rd-gray-text)"}}>
                      Не указана — обратитесь к администратору
                    </div>
                }
              </div>
              <div className="form-field">
                <label className="form-label">Дата трудоустройства</label>
                {user.employmentDate
                  ? <div style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 14px",background:"var(--rd-gray-bg)",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius-sm)"}}>
                      <span style={{fontSize:"18px"}}>💼</span>
                      <div>
                        <div style={{fontWeight:700,fontSize:"15px",color:"var(--rd-dark)"}}>
                          {!isNaN(new Date(user.employmentDate)) ? new Date(user.employmentDate).toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric"}) : "—"}
                        </div>
                        <div style={{fontSize:"11px",color:"var(--rd-gray-text)",marginTop:"1px"}}>Изменить может только администратор</div>
                      </div>
                    </div>
                  : <div style={{padding:"10px 14px",background:"var(--rd-gray-bg)",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius-sm)",fontSize:"13px",color:"var(--rd-gray-text)"}}>
                      Не указана — обратитесь к администратору
                    </div>
                }
              </div>
              <div style={{height:"1px",background:"var(--rd-gray-border)",margin:"20px 0"}}></div>
              <div className="settings-section-title">Смена пароля</div>
              <div className="form-field">
                <label className="form-label">Текущий пароль</label>
                <input className="form-input" type="password" placeholder="Введите текущий пароль" value={form.currentPassword} onChange={e => setForm(f=>({...f,currentPassword:e.target.value}))} />
              </div>
              <div className="form-row-2">
                <div className="form-field">
                  <label className="form-label">Новый пароль</label>
                  <input className="form-input" type="password" placeholder="Минимум 6 символов" value={form.newPassword} onChange={e => setForm(f=>({...f,newPassword:e.target.value}))} />
                </div>
                <div className="form-field">
                  <label className="form-label">Повторите пароль</label>
                  <input className="form-input" type="password" placeholder="Подтвердите пароль" value={form.confirmPassword} onChange={e => setForm(f=>({...f,confirmPassword:e.target.value}))} />
                </div>
              </div>
              <button className="btn btn-primary btn-block" style={{marginTop:"4px"}} onClick={saveProfile}>Сохранить изменения</button>
            </div>
          )}

          {tab === "appearance" && (
            <div>
              <div className="settings-card">
                <div className="settings-section-title">Логотип</div>
                {ap.logo
                  ? <div style={{marginBottom:"4px"}}>
                      <div style={{background:"var(--rd-gray-bg)",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius-sm)",padding:"20px",display:"flex",justifyContent:"center",marginBottom:"14px"}}>
                        <img src={ap.logo} className="logo-preview" alt="Логотип" />
                      </div>
                      <div style={{display:"flex",gap:"10px"}}>
                        <label className="btn btn-secondary btn-sm" style={{cursor:"pointer",position:"relative"}}>
                          Заменить
                          <input type="file" accept="image/*" style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",width:"100%",height:"100%"}} onChange={e => {
                            const file = e.target.files[0]; if (!file) return;
                            const reader = new FileReader();
                            reader.onload = async ev => {
                              const compressed = await compressImage(ev.target.result, 400, 200, 0.85);
                              applyAndSave({...ap, logo: compressed});
                            };
                            reader.readAsDataURL(file); e.target.value="";
                          }} />
                        </label>
                        <button className="btn btn-ghost btn-sm" onClick={() => applyAndSave({...ap, logo:null})}>Удалить логотип</button>
                      </div>
                    </div>
                  : <div className="logo-upload-zone">
                      <input type="file" accept="image/*" onChange={e => {
                        const file = e.target.files[0]; if (!file) return;
                        const reader = new FileReader();
                        reader.onload = async ev => {
                          const compressed = await compressImage(ev.target.result, 400, 200, 0.85);
                          applyAndSave({...ap, logo: compressed});
                        };
                        reader.readAsDataURL(file); e.target.value="";
                      }} />
                      <div style={{fontSize:"32px",marginBottom:"10px"}}>🖼️</div>
                      <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)",marginBottom:"4px"}}>Загрузить логотип</div>
                      <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>PNG, SVG, JPG · Рекомендуется прозрачный фон</div>
                    </div>
                }
              </div>

              <div className="settings-card">
                <div className="settings-section-title">Цветовая тема</div>
                <p style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"16px",marginTop:"-4px"}}>Изменения применяются мгновенно</p>
                <div className="theme-grid">
                  {Object.entries(THEMES).map(([key, t]) => (
                    <div key={key}
                      className={"theme-card" + (ap.theme===key?" active":"")}
                      style={ap.theme===key ? {borderColor:t.primary} : {}}
                      onClick={() => applyAndSave({...ap, theme:key})}>
                      <div className="theme-swatch" style={{background:t.primary}}></div>
                      <div className="theme-label">{t.label}</div>
                      {ap.theme===key && <div style={{fontSize:"10px",color:t.primary,fontWeight:700,marginTop:"4px"}}>✓ Активна</div>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-section-title">Предпросмотр темы</div>
                <div style={{display:"flex",gap:"10px",flexWrap:"wrap",alignItems:"center"}}>
                  <button className="btn btn-primary btn-sm">Основная</button>
                  <button className="btn btn-secondary btn-sm">Вторичная</button>
                  <span style={{display:"inline-flex",alignItems:"center",gap:"6px",background:"var(--rd-green-light)",border:"1px solid rgba(5,150,105,0.2)",padding:"6px 14px",borderRadius:"20px",fontSize:"13px",fontWeight:700,color:"var(--rd-green)"}}>🪙 250 {getCurrName(appearance.currency)}</span>
                  <span style={{display:"inline-flex",fontSize:"11px",fontWeight:700,padding:"4px 10px",borderRadius:"20px",background:"var(--rd-red-light)",color:"var(--rd-red)",border:"1px solid rgba(199,22,24,0.15)"}}>Категория</span>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-section-title">Цвета элементов</div>
                <p style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"20px",marginTop:"-4px"}}>
                  Выберите цвет для каждой зоны. Оставьте пустым — будет использован цвет из темы.
                </p>

                {[
                  { key:"headerBg", label:"Шапка", icon:"🔝", desc:"Фон верхней навигации", default:"#ffffff" },
                  { key:"pageBg",   label:"Фон страницы", icon:"🖼️", desc:"Цвет основного фона", default:"#f7f8fa" },
                  { key:"footerBg", label:"Футер", icon:"🔻", desc:"Фон нижней части сайта", default:"#1a1a1a" },
                  { key:"accentColor", label:"Акцентный цвет", icon:"🎨", desc:"Кнопки, ссылки, выделения", default:"#c71618" },
                  { key:"shopTextColor", label:"Цвет текста в магазине", icon:"🛒", desc:"Названия и описания товаров", default:"#1a1a1a" },
                ].map(({ key, label, icon, desc, default: def }) => (
                  <div key={key} style={{display:"flex",alignItems:"center",gap:"16px",padding:"14px 0",borderBottom:"1px solid var(--rd-gray-border)"}}>
                    <div style={{width:"40px",height:"40px",borderRadius:"10px",background:ap[key]||def,border:"1.5px solid var(--rd-gray-border)",flexShrink:0,boxShadow:"inset 0 0 0 1px rgba(0,0,0,0.08)"}}></div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>{icon} {label}</div>
                      <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>{desc}</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",flexShrink:0}}>
                      <div style={{position:"relative",width:"40px",height:"40px",borderRadius:"8px",overflow:"hidden",border:"1.5px solid var(--rd-gray-border)",cursor:"pointer",flexShrink:0}}>
                        <input type="color" value={ap[key]||def}
                          onChange={e => {
                            const newAp = {...ap, [key]: e.target.value};
                            setAp(newAp); saveAppearance(newAp);
                          }}
                          style={{position:"absolute",inset:"-4px",width:"calc(100% + 8px)",height:"calc(100% + 8px)",border:"none",padding:0,cursor:"pointer",opacity:1}} />
                      </div>
                      <input type="text" value={ap[key]||""}
                        placeholder={def}
                        onChange={e => {
                          const val = e.target.value;
                          if (/^#[0-9a-fA-F]{0,6}$/.test(val) || val === "") {
                            const newAp = {...ap, [key]: val};
                            setAp(newAp);
                            if (/^#[0-9a-fA-F]{6}$/.test(val) || val === "") saveAppearance(newAp);
                          }
                        }}
                        style={{width:"90px",padding:"8px 10px",border:"1.5px solid var(--rd-gray-border)",borderRadius:"8px",fontSize:"13px",fontFamily:"'Stolzl', monospace",color:"var(--rd-dark)"}} />
                      {ap[key] && (
                        <button onClick={() => { const newAp = {...ap, [key]:""}; setAp(newAp); saveAppearance(newAp); }}
                          style={{background:"none",border:"none",cursor:"pointer",color:"var(--rd-gray-text)",fontSize:"16px",lineHeight:1,padding:"4px"}} title="Сбросить">✕</button>
                      )}
                    </div>
                  </div>
                ))}

                <div style={{marginTop:"16px",display:"flex",gap:"10px"}}>
                  <button className="btn btn-ghost btn-sm" onClick={() => {
                    const newAp = {...ap, headerBg:"", footerBg:"", pageBg:"", accentColor:"", shopTextColor:""};
                    setAp(newAp); saveAppearance(newAp);
                  }}>Сбросить все цвета</button>
                </div>
              </div>
            </div>
          )}


          {tab === "socials" && (
            <div>
              <div className="settings-card">
                <div className="settings-section-title">🌐 Ссылки на социальные сети</div>
                <p style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"24px",lineHeight:1.6}}>
                  Иконки соцсетей отображаются в футере сайта. Оставьте поле пустым — иконка не будет показана.
                </p>
                {[
                  { key:"telegram", icon:"✈️", label:"Telegram", placeholder:"https://t.me/yourchannel" },
                  { key:"max",      icon:"🎬", label:"MAX (ВКонтакте Видео+)",    placeholder:"https://max.ru/..." },
                  { key:"vk",       icon:"💙", label:"ВКонтакте",  placeholder:"https://vk.com/yourgroup" },
                  { key:"rutube",   icon:"📺", label:"Rutube",     placeholder:"https://rutube.ru/channel/..." },
                  { key:"vkvideo",  icon:"▶️", label:"VK Видео",   placeholder:"https://vkvideo.ru/..." },
                ].map(({ key, icon, label, placeholder }) => {
                  const customIcon = (appearance.socialIcons || {})[key];
                  return (
                    <div key={key} className="form-field">
                      <label className="form-label">{icon} {label}</label>
                      <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                        {/* Custom icon upload */}
                        <div style={{position:"relative",flexShrink:0}}>
                          <div style={{width:"38px",height:"38px",borderRadius:"8px",border:"1.5px dashed var(--rd-gray-border)",background:"var(--rd-gray-bg)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden",position:"relative"}}
                            title="Загрузить свою иконку">
                            {customIcon
                              ? <img src={customIcon} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={label} />
                              : <span style={{fontSize:"18px"}}>{icon}</span>
                            }
                            <input type="file" accept="image/*"
                              style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",width:"100%",height:"100%"}}
                              onChange={e => {
                                const file = e.target.files[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = async ev => {
                                  const compressed = await compressImage(ev.target.result, 64, 64, 0.8);
                                  const icons = { ...(appearance.socialIcons || {}), [key]: compressed };
                                  saveAppearance({ ...appearance, socialIcons: icons });
                                };
                                reader.readAsDataURL(file);
                                e.target.value = "";
                              }} />
                          </div>
                          {customIcon && (
                            <button onClick={() => {
                              const icons = { ...(appearance.socialIcons || {}) };
                              delete icons[key];
                              saveAppearance({ ...appearance, socialIcons: icons });
                            }} style={{position:"absolute",top:"-6px",right:"-6px",width:"16px",height:"16px",borderRadius:"50%",background:"var(--rd-red)",color:"#fff",border:"none",cursor:"pointer",fontSize:"10px",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,zIndex:1}}>✕</button>
                          )}
                        </div>
                        <input className="form-input" placeholder={placeholder}
                          value={(appearance.socials || {})[key] || ""}
                          onChange={e => {
                            const soc = { ...(appearance.socials || {}), [key]: e.target.value };
                            saveAppearance({ ...appearance, socials: soc });
                          }} />
                        {(appearance.socials || {})[key] && (
                          <a href={(appearance.socials || {})[key]} target="_blank" rel="noopener noreferrer"
                            className="btn btn-ghost btn-sm" title="Открыть">↗</a>
                        )}
                      </div>
                      {customIcon && <div style={{fontSize:"11px",color:"var(--rd-green)",marginTop:"4px"}}>✓ Своя иконка загружена</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}


          {tab === "banner" && (
            <BannerSettingsTab appearance={appearance} saveAppearance={saveAppearance} notify={notify} />
          )}

          {tab === "seo" && (
            <SeoSettingsTab appearance={appearance} saveAppearance={saveAppearance} notify={notify} />
          )}

          {tab === "currency" && currencySubTab === "currency_settings" && (
            <CurrencySettingsTab appearance={appearance} saveAppearance={saveAppearance} notify={notify} />
          )}

          {tab === "currency" && currencySubTab === "currency_birthday" && isAdmin && (() => {
            const saveBirthdaySettings = () => {
              const amount = parseInt(bdBonus);
              if (isNaN(amount) || amount < 0) { notify("Введите корректную сумму", "err"); return; }
              saveAppearance({ ...appearance, birthdayBonus: amount, birthdayEnabled: bdEnabled });
              notify("Настройки дня рождения сохранены ✓");
            };

            const runBirthdayCheck = () => {
              const amount = parseInt(bdBonus);
              if (!bdEnabled) { notify("Автоначисление отключено", "err"); return; }
              if (isNaN(amount) || amount <= 0) { notify("Укажите корректную сумму", "err"); return; }
              const nowBd = new Date();
              let count = 0;
              const updated = {...users};
              Object.entries(users).forEach(([uname, ud]) => {
                if (!ud.birthdate) return;
                const bd = new Date(ud.birthdate);
                if (!isNaN(bd) && bd.getDate() === nowBd.getDate() && bd.getMonth() === nowBd.getMonth()) {
                  updated[uname] = { ...ud, balance: (ud.balance || 0) + amount };
                  count++;
                }
              });
              if (count > 0) {
                saveUsers(updated);
                try { storage.set('cm_birthday_grant', String(nowBd.getFullYear())); } catch(e) {}
                notify(`🎂 Начислено ${amount} ${getCurrName(appearance.currency)} для ${count} ${count === 1 ? "именинника" : count < 5 ? "именинников" : "именинников"}!`);
              } else {
                notify("Сегодня именинников нет 🎂");
              }
            };

            // Count today's birthdays
            const today = new Date();
            const todayBirthdays = Object.entries(users).filter(([u, ud]) => {
              if (!ud.birthdate) return false;
              const bd = new Date(ud.birthdate);
              return !isNaN(bd) && bd.getDate() === today.getDate() && bd.getMonth() === today.getMonth();
            });

            // Upcoming birthdays (next 30 days)
            const upcoming = Object.entries(users)
              .filter(([u, ud]) => ud.birthdate && !isNaN(new Date(ud.birthdate)))
              .map(([uname, ud]) => {
                const bd = new Date(ud.birthdate);
                const thisYear = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
                if (thisYear < today) thisYear.setFullYear(today.getFullYear() + 1);
                const diff = Math.round((thisYear - today) / (1000 * 60 * 60 * 24));
                return { uname, ud, bd, diff };
              })
              .filter(x => x.diff >= 0 && x.diff <= 30)
              .sort((a, b) => a.diff - b.diff);

            return (
              <div>
                {/* Enable toggle */}
                <div className="settings-card" style={{marginBottom:"16px"}}>
                  <div className="settings-section-title">🎂 Автоначисление в день рождения</div>
                  <div style={{display:"flex",alignItems:"center",gap:"14px",padding:"14px 16px",background:bdEnabled?"rgba(5,150,105,0.06)":"var(--rd-gray-bg)",borderRadius:"var(--rd-radius-sm)",border:"1.5px solid",borderColor:bdEnabled?"rgba(5,150,105,0.2)":"var(--rd-gray-border)",transition:"all 0.2s",marginBottom:"16px"}}>
                    <div style={{position:"relative",width:"44px",height:"24px",flexShrink:0}}>
                      <input type="checkbox" checked={bdEnabled} onChange={e => setBdEnabled(e.target.checked)}
                        style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",zIndex:1,width:"100%",height:"100%"}} />
                      <div style={{width:"44px",height:"24px",borderRadius:"12px",background:bdEnabled?"var(--rd-green)":"#d1d5db",transition:"background 0.2s",display:"flex",alignItems:"center",padding:"2px"}}>
                        <div style={{width:"20px",height:"20px",borderRadius:"50%",background:"#fff",transition:"transform 0.2s",transform:bdEnabled?"translateX(20px)":"translateX(0)",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}></div>
                      </div>
                    </div>
                    <div>
                      <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>
                        {bdEnabled ? "Автоначисление включено" : "Автоначисление отключено"}
                      </div>
                      <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"2px"}}>
                        Монеты начисляются автоматически при запуске приложения в день рождения пользователя
                      </div>
                    </div>
                  </div>

                  <div className="form-field">
                    <label className="form-label">Количество монет за день рождения</label>
                    <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
                      <input className="form-input" type="number" min="0" max="99999" placeholder="100"
                        value={bdBonus} onChange={e => setBdBonus(e.target.value)}
                        style={{maxWidth:"160px",fontSize:"18px",fontWeight:700,textAlign:"center"}} />
                      <div style={{display:"flex",gap:"6px"}}>
                        {[50,100,200,500].map(v => (
                          <button key={v} onClick={() => setBdBonus(String(v))}
                            style={{padding:"6px 12px",borderRadius:"20px",fontSize:"12px",fontWeight:700,cursor:"pointer",border:"1.5px solid",
                              background:bdBonus===String(v)?"var(--rd-red)":"#fff",
                              color:bdBonus===String(v)?"#fff":"var(--rd-gray-text)",
                              borderColor:bdBonus===String(v)?"var(--rd-red)":"var(--rd-gray-border)",
                              transition:"all 0.15s"}}>
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"6px"}}>
                      Каждый пользователь получает эти монеты один раз в год в свой день рождения
                    </div>
                  </div>

                  <div style={{display:"flex",gap:"10px",marginTop:"8px",flexWrap:"wrap"}}>
                    <button className="btn btn-primary" onClick={saveBirthdaySettings}>Сохранить настройки</button>
                    <button className="btn btn-secondary" onClick={runBirthdayCheck} title="Начислить сегодняшним именинникам прямо сейчас">
                      🎁 Начислить сейчас
                    </button>
                  </div>
                </div>

                {/* Today's birthdays */}
                {todayBirthdays.length > 0 && (
                  <div className="settings-card" style={{marginBottom:"16px",background:"rgba(5,150,105,0.04)",border:"1.5px solid rgba(5,150,105,0.2)"}}>
                    <div className="settings-section-title" style={{color:"var(--rd-green)"}}>🎉 Сегодня день рождения!</div>
                    {todayBirthdays.map(([uname, ud]) => (
                      <div key={uname} style={{display:"flex",alignItems:"center",gap:"12px",padding:"10px 0",borderBottom:"1px solid rgba(5,150,105,0.1)"}}>
                        <div style={{width:"36px",height:"36px",borderRadius:"50%",background:"rgba(5,150,105,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px",flexShrink:0}}>
                          {ud.avatar ? <img src={ud.avatar} style={{width:"36px",height:"36px",borderRadius:"50%",objectFit:"cover"}} /> : "🎂"}
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>
                            {ud.firstName ? ud.firstName + " " + (ud.lastName || "") : uname}
                          </div>
                          <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>@{uname} · {!isNaN(new Date(ud.birthdate)) ? new Date(ud.birthdate).toLocaleDateString("ru-RU",{day:"numeric",month:"long"}) : "—"}</div>
                        </div>
                        <div style={{fontSize:"13px",fontWeight:700,color:"var(--rd-green)"}}>
                          🪙 {ud.balance || 0}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Upcoming birthdays */}
                <div className="settings-card">
                  <div className="settings-section-title">📅 Ближайшие дни рождения (30 дней)</div>
                  {upcoming.length === 0
                    ? <div style={{color:"var(--rd-gray-text)",textAlign:"center",padding:"20px 0",fontSize:"13px"}}>В ближайшие 30 дней именинников нет</div>
                    : upcoming.map(({uname, ud, bd, diff}) => (
                      <div key={uname} style={{display:"flex",alignItems:"center",gap:"12px",padding:"10px 0",borderBottom:"1px solid var(--rd-gray-border)"}}>
                        <div style={{width:"36px",height:"36px",borderRadius:"50%",background:"var(--rd-red-light)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px",flexShrink:0}}>
                          {ud.avatar ? <img src={ud.avatar} style={{width:"36px",height:"36px",borderRadius:"50%",objectFit:"cover"}} /> : "🎈"}
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>
                            {ud.firstName ? ud.firstName + " " + (ud.lastName || "") : uname}
                          </div>
                          <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>
                            @{uname} · {bd.toLocaleDateString("ru-RU",{day:"numeric",month:"long"})}
                          </div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          {diff === 0
                            ? <span style={{fontSize:"12px",fontWeight:800,color:"var(--rd-green)",background:"var(--rd-green-light)",padding:"3px 10px",borderRadius:"20px"}}>Сегодня! 🎉</span>
                            : diff === 1
                            ? <span style={{fontSize:"12px",fontWeight:700,color:"var(--rd-red)",background:"var(--rd-red-light)",padding:"3px 10px",borderRadius:"20px"}}>Завтра</span>
                            : <span style={{fontSize:"12px",fontWeight:600,color:"var(--rd-gray-text)"}}>через {diff} дн.</span>
                          }
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            );
          })()}

          {tab === "currency" && currencySubTab === "currency_bulk" && isAdmin && (
            <BulkAccrualTab users={users} currentUser={currentUser} notify={notify} saveUsers={saveUsers} transfers={transfers} saveTransfers={saveTransfers} appearance={appearance} />
          )}

          {tab === "currency" && currencySubTab === "currency_workdays" && isAdmin && (
            <WorkdaysTab users={users} currentUser={currentUser} notify={notify} saveUsers={saveUsers} transfers={transfers} saveTransfers={saveTransfers} appearance={appearance} saveAppearance={saveAppearance} />
          )}

          {tab === "integrations" && isAdmin && (
            <div>
              {/* Telegram */}
              <div className="settings-card" style={{marginBottom:"16px"}}>
                <div className="settings-section-title" style={{display:"flex",alignItems:"center",gap:"10px"}}>
                  <span style={{width:"32px",height:"32px",borderRadius:"8px",background:"#229ED9",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"18px"}}>✈️</span>
                  Telegram-уведомления
                </div>
                <p style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"20px",lineHeight:1.6}}>
                  При оформлении нового заказа бот автоматически отправит сообщение в указанный чат или канал.
                </p>

                {/* Enable toggle */}
                <div style={{display:"flex",alignItems:"center",gap:"14px",padding:"14px 16px",background:integ.tgEnabled?"rgba(34,158,217,0.06)":"var(--rd-gray-bg)",borderRadius:"var(--rd-radius-sm)",border:"1.5px solid",borderColor:integ.tgEnabled?"rgba(34,158,217,0.25)":"var(--rd-gray-border)",transition:"all 0.2s",marginBottom:"20px"}}>
                  <div style={{position:"relative",width:"44px",height:"24px",flexShrink:0}}>
                    <input type="checkbox" checked={!!integ.tgEnabled} onChange={e => setInteg(prev => ({...prev, tgEnabled: e.target.checked}))}
                      style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",zIndex:1,width:"100%",height:"100%"}} />
                    <div style={{width:"44px",height:"24px",borderRadius:"12px",background:integ.tgEnabled?"#229ED9":"#d1d5db",transition:"background 0.2s",display:"flex",alignItems:"center",padding:"2px"}}>
                      <div style={{width:"20px",height:"20px",borderRadius:"50%",background:"#fff",transition:"transform 0.2s",transform:integ.tgEnabled?"translateX(20px)":"translateX(0)",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}></div>
                    </div>
                  </div>
                  <div>
                    <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>
                      {integ.tgEnabled ? "Уведомления включены" : "Уведомления отключены"}
                    </div>
                    <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"2px"}}>
                      Бот: @Shop_rudesktop_bot
                    </div>
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">HTTP API токен бота</label>
                  <input className="form-input" type="password" placeholder="123456789:AAFxxxxxxx"
                    value={integ.tgBotToken || ""}
                    onChange={e => setInteg(prev => ({...prev, tgBotToken: e.target.value}))} />
                  <div style={{fontSize:"11px",color:"var(--rd-gray-text)",marginTop:"4px"}}>
                    Получить токен можно у <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" style={{color:"#229ED9"}}>@BotFather</a>
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">Chat ID (ID чата или канала)</label>
                  <input className="form-input" placeholder="-100xxxxxxxxxx или @yourchannel"
                    value={integ.tgChatId || ""}
                    onChange={e => setInteg(prev => ({...prev, tgChatId: e.target.value}))} />
                  <div style={{fontSize:"11px",color:"var(--rd-gray-text)",marginTop:"4px"}}>
                    Добавьте бота в чат/канал как администратора. Chat ID можно узнать через <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" style={{color:"#229ED9"}}>@userinfobot</a> или <a href="https://t.me/getidsbot" target="_blank" rel="noopener noreferrer" style={{color:"#229ED9"}}>@getidsbot</a>
                  </div>
                </div>

                <div style={{display:"flex",gap:"10px",marginTop:"8px",flexWrap:"wrap"}}>
                  <button className="btn btn-primary" onClick={() => {
                    saveAppearance({ ...appearance, integrations: integ });
                    notify("Настройки интеграций сохранены ✓");
                  }}>Сохранить</button>
                  <button className="btn btn-secondary" onClick={() => {
                    if (!integ.tgBotToken || !integ.tgChatId) { notify("Заполните токен и Chat ID", "err"); return; }
                    const token = integ.tgBotToken.trim();
                    const chatId = integ.tgChatId.trim();
                    const testText = "✅ <b>Тест уведомлений RuDesktop Shop</b>\nИнтеграция настроена успешно! Новые заказы будут приходить в этот чат.";
                    fetch('/api/telegram', {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ token, chat_id: chatId, text: testText, parse_mode: "HTML" })
                    })
                    .then(r => r.json())
                    .then(d => {
                      if (d.ok) notify("✅ Тест успешен! Сообщение отправлено в Telegram.");
                      else notify("❌ Ошибка Telegram: " + (d.description || "Проверьте токен и Chat ID"), "err");
                    })
                    .catch(e => notify("❌ Ошибка сети: " + e.message, "err"));
                  }}>📨 Отправить тест</button>
                </div>
              </div>

              {/* Info card */}
              <div style={{padding:"16px",background:"rgba(34,158,217,0.06)",border:"1.5px solid rgba(34,158,217,0.2)",borderRadius:"var(--rd-radius-sm)"}}>
                <div style={{fontWeight:700,fontSize:"13px",color:"#0ea5e9",marginBottom:"8px"}}>📋 Как настроить</div>
                <ol style={{fontSize:"12px",color:"var(--rd-gray-text)",lineHeight:1.8,paddingLeft:"16px",margin:0}}>
                  <li>Создайте бота через <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" style={{color:"#229ED9"}}>@BotFather</a> и скопируйте токен</li>
                  <li>Создайте канал или группу для уведомлений</li>
                  <li>Добавьте бота как администратора с правом отправки сообщений</li>
                  <li>Узнайте Chat ID через <a href="https://t.me/getidsbot" target="_blank" rel="noopener noreferrer" style={{color:"#229ED9"}}>@getidsbot</a></li>
                  <li>Вставьте токен и Chat ID, нажмите «Отправить тест»</li>
                  <li>Включите уведомления и сохраните</li>
                </ol>
              </div>

              {/* Max Messenger */}
              <div className="settings-card" style={{marginTop:"16px"}}>
                <div className="settings-section-title" style={{display:"flex",alignItems:"center",gap:"10px"}}>
                  <span style={{width:"32px",height:"32px",borderRadius:"8px",background:"#7B68EE",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"18px"}}>💬</span>
                  Max — уведомления
                </div>
                <p style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"20px",lineHeight:1.6}}>
                  При оформлении нового заказа, завершении аукциона, выполнении задания или розыгрыше лотереи бот автоматически отправит сообщение в указанный чат Max.
                </p>

                {/* Enable toggle */}
                <div style={{display:"flex",alignItems:"center",gap:"14px",padding:"14px 16px",background:integ.maxEnabled?"rgba(123,104,238,0.06)":"var(--rd-gray-bg)",borderRadius:"var(--rd-radius-sm)",border:"1.5px solid",borderColor:integ.maxEnabled?"rgba(123,104,238,0.25)":"var(--rd-gray-border)",transition:"all 0.2s",marginBottom:"20px"}}>
                  <div style={{position:"relative",width:"44px",height:"24px",flexShrink:0}}>
                    <input type="checkbox" checked={!!integ.maxEnabled} onChange={e => setInteg(prev => ({...prev, maxEnabled: e.target.checked}))}
                      style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",zIndex:1,width:"100%",height:"100%"}} />
                    <div style={{width:"44px",height:"24px",borderRadius:"12px",background:integ.maxEnabled?"#7B68EE":"#d1d5db",transition:"background 0.2s",display:"flex",alignItems:"center",padding:"2px"}}>
                      <div style={{width:"20px",height:"20px",borderRadius:"50%",background:"#fff",transition:"transform 0.2s",transform:integ.maxEnabled?"translateX(20px)":"translateX(0)",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}></div>
                    </div>
                  </div>
                  <div>
                    <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>
                      {integ.maxEnabled ? "Уведомления включены" : "Уведомления отключены"}
                    </div>
                    <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"2px"}}>
                      Мессенджер Max
                    </div>
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">Токен бота Max</label>
                  <input className="form-input" type="password" placeholder="Токен бота Max"
                    value={integ.maxBotToken || ""}
                    onChange={e => setInteg(prev => ({...prev, maxBotToken: e.target.value}))} />
                  <div style={{fontSize:"11px",color:"var(--rd-gray-text)",marginTop:"4px"}}>
                    Создайте бота в Max и скопируйте токен доступа
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">Chat ID (ID чата или канала)</label>
                  <input className="form-input" placeholder="ID чата Max"
                    value={integ.maxChatId || ""}
                    onChange={e => setInteg(prev => ({...prev, maxChatId: e.target.value}))} />
                  <div style={{fontSize:"11px",color:"var(--rd-gray-text)",marginTop:"4px"}}>
                    Добавьте бота в чат/канал Max как администратора
                  </div>
                </div>

                <div style={{display:"flex",gap:"10px",marginTop:"8px",flexWrap:"wrap"}}>
                  <button className="btn btn-primary" style={{background:"#7B68EE",borderColor:"#7B68EE"}} onClick={() => {
                    saveAppearance({ ...appearance, integrations: integ });
                    notify("Настройки Max сохранены ✓");
                  }}>Сохранить</button>
                  <button className="btn btn-secondary" onClick={() => {
                    if (!integ.maxBotToken || !integ.maxChatId) { notify("Заполните токен и Chat ID", "err"); return; }
                    const testText = "✅ Тест уведомлений RuDesktop Shop\nИнтеграция с Max настроена успешно! Новые уведомления будут приходить в этот чат.";
                    fetch('/api/max', {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ token: integ.maxBotToken.trim(), chat_id: integ.maxChatId.trim(), text: testText })
                    })
                    .then(r => r.json())
                    .then(d => {
                      if (d.ok) notify("✅ Тест успешен! Сообщение отправлено в Max.");
                      else notify("❌ Ошибка Max: " + (d.description || "Проверьте токен и Chat ID"), "err");
                    })
                    .catch(e => notify("❌ Ошибка сети: " + e.message, "err"));
                  }}>📨 Отправить тест</button>
                </div>
              </div>

              {/* Max info card */}
              <div style={{padding:"16px",background:"rgba(123,104,238,0.06)",border:"1.5px solid rgba(123,104,238,0.2)",borderRadius:"var(--rd-radius-sm)",marginTop:"12px"}}>
                <div style={{fontWeight:700,fontSize:"13px",color:"#7B68EE",marginBottom:"8px"}}>📋 Как настроить Max</div>
                <ol style={{fontSize:"12px",color:"var(--rd-gray-text)",lineHeight:1.8,paddingLeft:"16px",margin:0}}>
                  <li>Создайте бота в мессенджере Max и получите токен</li>
                  <li>Создайте чат или канал для уведомлений</li>
                  <li>Добавьте бота в чат как администратора</li>
                  <li>Узнайте Chat ID чата</li>
                  <li>Вставьте токен и Chat ID, нажмите «Отправить тест»</li>
                  <li>Включите уведомления и сохраните</li>
                </ol>
              </div>

              {/* Bitrix24 */}
              <div className="settings-card" style={{marginTop:"16px"}}>
                <div className="settings-section-title" style={{display:"flex",alignItems:"center",gap:"10px"}}>
                  <span style={{width:"32px",height:"32px",borderRadius:"8px",background:"#FF5722",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"16px",color:"#fff",fontWeight:900}}>B</span>
                  Авторизация через Битрикс24
                </div>
                <p style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"20px",lineHeight:1.6}}>
                  Позволяет пользователям входить через корпоративный портал Битрикс24 с помощью OAuth 2.0.
                </p>

                <div style={{display:"flex",alignItems:"center",gap:"14px",padding:"14px 16px",background:bitrix24.enabled?"rgba(255,87,34,0.06)":"var(--rd-gray-bg)",borderRadius:"var(--rd-radius-sm)",border:"1.5px solid",borderColor:bitrix24.enabled?"rgba(255,87,34,0.3)":"var(--rd-gray-border)",transition:"all 0.2s",marginBottom:"20px"}}>
                  <div style={{position:"relative",width:"44px",height:"24px",flexShrink:0}}>
                    <input type="checkbox" checked={!!bitrix24.enabled} onChange={e => setBitrix24(prev => ({...prev, enabled: e.target.checked}))}
                      style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",zIndex:1,width:"100%",height:"100%"}} />
                    <div style={{width:"44px",height:"24px",borderRadius:"12px",background:bitrix24.enabled?"#FF5722":"#d1d5db",transition:"background 0.2s",display:"flex",alignItems:"center",padding:"2px"}}>
                      <div style={{width:"20px",height:"20px",borderRadius:"50%",background:"#fff",transition:"transform 0.2s",transform:bitrix24.enabled?"translateX(20px)":"translateX(0)",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}></div>
                    </div>
                  </div>
                  <div>
                    <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>
                      {bitrix24.enabled ? "Вход через Битрикс24 включён" : "Вход через Битрикс24 отключён"}
                    </div>
                    <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"2px"}}>
                      Кнопка входа появится на странице авторизации
                    </div>
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">URL портала Битрикс24</label>
                  <input className="form-input" placeholder="https://company.bitrix24.ru"
                    value={bitrix24.portalUrl || ""}
                    onChange={e => setBitrix24(prev => ({...prev, portalUrl: e.target.value.replace(/\/$/, "")}))} />
                  <div style={{fontSize:"11px",color:"var(--rd-gray-text)",marginTop:"4px"}}>Например: https://mycompany.bitrix24.ru</div>
                </div>

                <div className="form-field">
                  <label className="form-label">Client ID приложения</label>
                  <input className="form-input" placeholder="local.xxxxxxxxxxxxxxxxxx"
                    value={bitrix24.clientId || ""}
                    onChange={e => setBitrix24(prev => ({...prev, clientId: e.target.value}))} />
                </div>

                <div className="form-field">
                  <label className="form-label">Client Secret</label>
                  <input className="form-input" type="password" placeholder="••••••••••••••••••••"
                    value={bitrix24.clientSecret || ""}
                    onChange={e => setBitrix24(prev => ({...prev, clientSecret: e.target.value}))} />
                </div>

                <div style={{padding:"12px 14px",background:"rgba(255,87,34,0.06)",borderRadius:"8px",border:"1.5px solid rgba(255,87,34,0.2)",marginBottom:"16px",fontSize:"12px",color:"var(--rd-gray-text)",lineHeight:1.7}}>
                  <div style={{fontWeight:700,color:"#FF5722",marginBottom:"6px"}}>📋 Как подключить</div>
                  <ol style={{paddingLeft:"16px",margin:0}}>
                    <li>В Битрикс24 перейдите в Приложения → Разработчикам → Добавить приложение</li>
                    <li>Укажите Redirect URI: <code style={{background:"rgba(0,0,0,0.06)",padding:"1px 5px",borderRadius:"4px"}}>{typeof window !== "undefined" ? window.location.origin : "https://your-site.com"}/oauth/bitrix24</code></li>
                    <li>Скопируйте Client ID и Client Secret в поля выше</li>
                    <li>При входе пользователь будет перенаправлен на портал для авторизации</li>
                  </ol>
                </div>

                <button className="btn btn-primary" onClick={() => {
                  saveAppearance({ ...appearance, bitrix24, integrations: integ });
                  notify("Настройки Битрикс24 сохранены ✓");
                }}>Сохранить</button>
              </div>

              {/* Yandex Metrika */}
              <div className="settings-card" style={{marginTop:"16px"}}>
                <div className="settings-section-title" style={{display:"flex",alignItems:"center",gap:"10px"}}>
                  <span style={{width:"32px",height:"32px",borderRadius:"8px",background:"#FC3F1D",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"16px",color:"#fff",fontWeight:900}}>Я</span>
                  Яндекс Метрика
                </div>
                <p style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"20px",lineHeight:1.6}}>
                  Вставьте номер счётчика Яндекс Метрики — скрипт будет автоматически добавлен на все страницы сайта.
                </p>

                <div style={{display:"flex",alignItems:"center",gap:"14px",padding:"14px 16px",background:integ.ymEnabled?"rgba(252,63,29,0.06)":"var(--rd-gray-bg)",borderRadius:"var(--rd-radius-sm)",border:"1.5px solid",borderColor:integ.ymEnabled?"rgba(252,63,29,0.3)":"var(--rd-gray-border)",transition:"all 0.2s",marginBottom:"20px"}}>
                  <div style={{position:"relative",width:"44px",height:"24px",flexShrink:0}}>
                    <input type="checkbox" checked={!!integ.ymEnabled} onChange={e => setInteg(prev => ({...prev, ymEnabled: e.target.checked}))}
                      style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",zIndex:1,width:"100%",height:"100%"}} />
                    <div style={{width:"44px",height:"24px",borderRadius:"12px",background:integ.ymEnabled?"#FC3F1D":"#d1d5db",transition:"background 0.2s",display:"flex",alignItems:"center",padding:"2px"}}>
                      <div style={{width:"20px",height:"20px",borderRadius:"50%",background:"#fff",transition:"transform 0.2s",transform:integ.ymEnabled?"translateX(20px)":"translateX(0)",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}></div>
                    </div>
                  </div>
                  <div>
                    <div style={{fontWeight:700,fontSize:"14px",color:"var(--rd-dark)"}}>
                      {integ.ymEnabled ? "Метрика включена" : "Метрика отключена"}
                    </div>
                    <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"2px"}}>
                      Счётчик будет загружаться на каждой странице
                    </div>
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">Номер счётчика</label>
                  <input className="form-input" placeholder="12345678"
                    value={integ.ymCounterId || ""}
                    onChange={e => setInteg(prev => ({...prev, ymCounterId: e.target.value.replace(/\D/g,"")}))} />
                  <div style={{fontSize:"11px",color:"var(--rd-gray-text)",marginTop:"4px"}}>
                    Найдите номер в <a href="https://metrika.yandex.ru" target="_blank" rel="noopener noreferrer" style={{color:"#FC3F1D"}}>Яндекс Метрике</a> → Настройки счётчика
                  </div>
                </div>

                {integ.ymEnabled && integ.ymCounterId && (
                  <div style={{padding:"12px 14px",background:"rgba(252,63,29,0.06)",borderRadius:"8px",border:"1.5px solid rgba(252,63,29,0.2)",marginBottom:"16px",fontSize:"12px",color:"var(--rd-gray-text)",lineHeight:1.7}}>
                    <div style={{fontWeight:700,color:"#FC3F1D",marginBottom:"4px"}}>✅ Скрипт подключён</div>
                    Счётчик <strong>#{integ.ymCounterId}</strong> будет загружаться на всех страницах сайта.
                  </div>
                )}

                <button className="btn btn-primary" onClick={() => {
                  saveAppearance({ ...appearance, integrations: integ });
                  notify("Настройки Яндекс Метрики сохранены ✓");
                }}>Сохранить</button>
              </div>
            </div>
          )}

          {tab === "database" && (
            <div>
              {/* Sub-tabs */}
              <div style={{display:"flex",gap:"0",marginBottom:"20px",borderBottom:"2px solid var(--rd-gray-border)"}}>
                {(!sqliteDisabled ? [["sqlite","🗄️ SQLite"],["postgres","🐘 PostgreSQL"]] : [["postgres","🐘 PostgreSQL"]]).map(([id,label]) => (
                  <button key={id} onClick={() => setDbSubTab(id)} style={{padding:"9px 20px",fontWeight:700,fontSize:"13px",background:"none",border:"none",cursor:"pointer",borderBottom:dbSubTab===id?"2.5px solid var(--rd-red)":"2.5px solid transparent",color:dbSubTab===id?"var(--rd-red)":"var(--rd-gray-text)",marginBottom:"-2px",transition:"color 0.15s",display:"flex",alignItems:"center",gap:"6px"}}>
                    {label}
                    {id==="postgres" && isPgActive && <span style={{fontSize:"10px",background:"#22c55e",color:"#fff",padding:"1px 7px",borderRadius:"10px",fontWeight:700}}>АКТИВНА</span>}
                  </button>
                ))}
              </div>

              {/* ── SQLite disable/enable banner ── */}
              {isAdmin && (
                <div style={{marginBottom:"16px",padding:"12px 16px",borderRadius:"10px",background: sqliteDisabled ? "rgba(239,68,68,0.07)" : "rgba(234,179,8,0.07)",border: sqliteDisabled ? "1.5px solid rgba(239,68,68,0.25)" : "1.5px solid rgba(234,179,8,0.3)",display:"flex",alignItems:"center",gap:"14px",flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:"200px"}}>
                    {sqliteDisabled
                      ? <><strong style={{color:"#dc2626"}}>⛔ SQLite отключён</strong> — вкладка SQLite и весь связанный код скрыты. Используется только PostgreSQL.</>
                      : <><strong style={{color:"#b45309"}}>⚠️ SQLite включён</strong> — браузерная база данных активна. Для полного перехода на PostgreSQL отключите SQLite.</>
                    }
                  </div>
                  {sqliteDisabled ? (
                    <button className="btn" style={{background:"#22c55e",color:"#fff",fontWeight:700,whiteSpace:"nowrap"}} onClick={() => { setSqliteDisabled(false); setDbSubTab('sqlite'); notify("SQLite включён. Вкладка SQLite восстановлена.", "ok"); }}>
                      ✅ Включить SQLite
                    </button>
                  ) : (
                    <button className="btn" style={{background:"#dc2626",color:"#fff",fontWeight:700,whiteSpace:"nowrap"}} onClick={() => {
                      if (!confirm("Отключить SQLite полностью?\n\nВкладка SQLite будет скрыта, браузерное хранилище не будет использоваться.\nДанные в PostgreSQL останутся. Можно включить обратно.")) return;
                      setSqliteDisabled(true);
                      setDbSubTab('postgres');
                      notify("SQLite отключён. Используется только PostgreSQL.", "ok");
                    }}>
                      🚫 Отключить SQLite
                    </button>
                  )}
                </div>
              )}

              {/* ══ SQLite Tab ══ */}
              {!sqliteDisabled && dbSubTab === "sqlite" && (
                <div>
                  <div className={"db-status-bar " + (dbConfig.connected ? "connected" : "disconnected")}>
                    <div className={"db-status-dot " + (dbConfig.connected ? "connected" : "disconnected")}></div>
                    {dbConfig.connected ? "SQLite активна · " + (dbConfig.dbSize ? (dbConfig.dbSize/1024).toFixed(1)+" КБ" : "0 КБ") : "SQLite инициализируется…"}
                    {isPgActive && <span style={{marginLeft:"12px",fontSize:"11px",background:"rgba(234,179,8,0.15)",color:"#b45309",border:"1px solid rgba(234,179,8,0.3)",padding:"2px 8px",borderRadius:"10px",fontWeight:700}}>⚠️ PostgreSQL активна — SQLite не используется</span>}
                  </div>
                  <div className="settings-card">
                    <div className="settings-section-title">🗄️ SQLite — встроенная база данных</div>
                    <div style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"16px",lineHeight:"1.7"}}>
                      Данные хранятся локально в браузере через <strong>sql.js</strong> (SQLite в WebAssembly) и персистируются в <strong>IndexedDB</strong>. Никакого сервера не требуется.
                    </div>
                    {dbConfig.rowCounts && Object.keys(dbConfig.rowCounts).length > 0 && (
                      <div>
                        <div style={{fontSize:"12px",fontWeight:700,textTransform:"uppercase",color:"var(--rd-gray-text)",marginBottom:"10px"}}>Содержимое базы</div>
                        <div className="db-tables-grid">
                          {[["cm_users","👥 Пользователи"],["cm_products","🛍️ Товары"],["cm_orders","📦 Заказы"],["cm_transfers","🪙 Переводы"],["cm_categories","🏷️ Категории"],["_total_keys","🔑 Всего ключей"]].map(([k,label]) => (
                            <div key={k} className="db-table-card">
                              <div className="db-table-name">{label}</div>
                              <div className="db-table-count">{dbConfig.rowCounts[k] ?? "—"}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{marginTop:"16px",display:"flex",gap:"10px",flexWrap:"wrap"}}>
                      <button className="btn btn-secondary" onClick={() => { refreshDbConfig(); notify("Статистика обновлена ✓"); }}>🔄 Обновить статистику</button>
                    </div>

                  </div>
                  <div className="settings-card">
                    <div className="settings-section-title">📦 Резервное копирование</div>
                    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:"13px",marginBottom:"6px"}}>Экспорт</div>
                        <div style={{display:"flex",gap:"10px",flexWrap:"wrap"}}>
                          <button className="btn btn-primary" onClick={exportSQLite}>⬇️ Скачать .sqlite</button>
                          <button className="btn btn-secondary" onClick={exportJSON}>⬇️ Скачать JSON-бэкап</button>
                        </div>
                        <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"6px"}}>.sqlite — полный дамп базы, совместим с DB Browser for SQLite.</div>
                      </div>
                      <div style={{height:"1px",background:"var(--rd-gray-border)"}}></div>
                      <div>
                        <div style={{fontWeight:700,fontSize:"13px",marginBottom:"6px"}}>Импорт</div>
                        <div style={{display:"flex",gap:"10px",flexWrap:"wrap"}}>
                          <label className="btn btn-secondary" style={{cursor:"pointer",position:"relative"}}>
                            {importing ? "⏳ Импорт..." : "⬆️ Загрузить .sqlite"}
                            <input type="file" accept=".sqlite,.db" style={{position:"absolute",inset:0,opacity:0,cursor:"pointer"}} onChange={importSQLite} disabled={importing} />
                          </label>
                          <label className="btn btn-ghost" style={{cursor:"pointer",position:"relative"}}>
                            ⬆️ Загрузить JSON
                            <input type="file" accept=".json" style={{position:"absolute",inset:0,opacity:0,cursor:"pointer"}} onChange={importJSON} />
                          </label>
                        </div>
                        <div style={{fontSize:"12px",color:"var(--rd-red)",marginTop:"6px"}}>⚠️ Импорт заменит все текущие данные.</div>
                      </div>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="settings-card">
                      <div className="settings-section-title">💻 SQL-консоль (SQLite)</div>
                      <div style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"10px"}}>Таблица <code style={{background:"var(--rd-gray-bg)",padding:"2px 6px",borderRadius:"4px",fontFamily:"monospace",fontSize:"11px"}}>kv</code> содержит поля <code style={{background:"var(--rd-gray-bg)",padding:"2px 6px",borderRadius:"4px",fontFamily:"monospace",fontSize:"11px"}}>key</code> и <code style={{background:"var(--rd-gray-bg)",padding:"2px 6px",borderRadius:"4px",fontFamily:"monospace",fontSize:"11px"}}>value</code>.</div>
                      <textarea style={{width:"100%",minHeight:"90px",fontFamily:"monospace",fontSize:"13px",padding:"10px 12px",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius-sm)",resize:"vertical",background:"#1a1a1a",color:"#e5e7eb",outline:"none"}} placeholder={"SELECT key, length(value) as bytes FROM kv ORDER BY bytes DESC LIMIT 10;"} value={sqlConsole} onChange={e => setSqlConsole(e.target.value)} onKeyDown={e => { if ((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();runSql();}}} />
                      <div style={{display:"flex",gap:"10px",marginTop:"8px",alignItems:"center"}}>
                        <button className="btn btn-primary" onClick={runSql}>▶ Выполнить <span style={{fontSize:"11px",opacity:0.7,marginLeft:"4px"}}>(Ctrl+Enter)</span></button>
                        <button className="btn btn-ghost" onClick={() => { setSqlResult(null); setSqlError(""); setSqlConsole(""); }}>Очистить</button>
                      </div>
                      {sqlError && <div style={{marginTop:"10px",padding:"10px 14px",background:"rgba(199,22,24,0.08)",border:"1px solid rgba(199,22,24,0.2)",borderRadius:"var(--rd-radius-sm)",fontSize:"13px",color:"var(--rd-red)",fontFamily:"monospace"}}>{sqlError}</div>}
                      {sqlResult && sqlResult.length > 0 && (
                        <div style={{marginTop:"10px",overflowX:"auto"}}>
                          {sqlResult.map((res, ri) => (
                            <table key={ri} style={{borderCollapse:"collapse",width:"100%",fontSize:"12px",fontFamily:"monospace"}}>
                              <thead><tr>{res.columns.map(c => <th key={c} style={{padding:"6px 10px",textAlign:"left",background:"var(--rd-gray-bg)",border:"1px solid var(--rd-gray-border)",fontWeight:700,whiteSpace:"nowrap"}}>{c}</th>)}</tr></thead>
                              <tbody>{res.values.slice(0,100).map((row,i) => <tr key={i} style={{background:i%2===0?"#fff":"var(--rd-gray-bg)"}}>{row.map((cell,j) => <td key={j} style={{padding:"5px 10px",border:"1px solid var(--rd-gray-border)",maxWidth:"300px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cell===null?<em style={{color:"var(--rd-gray-text)"}}>NULL</em>:String(cell).length>80?String(cell).substring(0,80)+"…":String(cell)}</td>)}</tr>)}</tbody>
                            </table>
                          ))}
                          <div style={{fontSize:"11px",color:"var(--rd-gray-text)",marginTop:"6px"}}>{sqlResult.reduce((s,r)=>s+r.values.length,0)} строк</div>
                        </div>
                      )}
                      {sqlResult && sqlResult.length === 0 && <div style={{marginTop:"10px",fontSize:"13px",color:"var(--rd-green)"}}>✓ Запрос выполнен (0 строк)</div>}
                    </div>
                  )}
                  {isAdmin && (
                    <div className="settings-card" style={{border:"1.5px solid rgba(199,22,24,0.25)"}}>
                      <div className="settings-section-title" style={{color:"var(--rd-red)"}}>⚠️ Опасная зона</div>
                      <div style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"14px"}}>Очистка базы данных удалит всех пользователей, товары, заказы и остальные данные без возможности восстановления.</div>
                      <div style={{display:"flex",gap:"10px",flexWrap:"wrap"}}>
                        <button className="btn" style={{background:"var(--rd-red)",color:"#fff",fontWeight:700}} onClick={clearDatabase}>🗑️ Очистить серверную БД</button>
                        <button className="btn" style={{background:"#7c3aed",color:"#fff",fontWeight:700}} onClick={clearLocalSQLite}>🧹 Очистить SQLite браузера</button>
                      </div>
                      <div style={{fontSize:"12px",color:"var(--rd-gray-text)",marginTop:"8px"}}>
                        «Очистить SQLite браузера» — удаляет локальную копию IndexedDB в <em>этом</em> браузере. Серверные данные не затрагиваются. Используйте если браузер показывает устаревшие данные.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ══ PostgreSQL Tab ══ */}
              {dbSubTab === "postgres" && (
                <div>
                  {/* Status bar */}
                  <div className={"db-status-bar " + (isPgActive ? "connected" : "disconnected")}>
                    <div className={"db-status-dot " + (isPgActive ? "connected" : "disconnected")}></div>
                    {isPgActive ? "PostgreSQL активна · " + (pgConfig.host + ":" + (pgConfig.port||5432) + "/" + pgConfig.database) : "PostgreSQL не подключена — используется SQLite"}
                  </div>

                  {/* Connection settings */}
                  <div className="settings-card">
                    <div className="settings-section-title">🐘 Настройки подключения PostgreSQL</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 120px",gap:"12px",marginBottom:"12px"}}>
                      <div>
                        <div style={{fontSize:"12px",fontWeight:700,marginBottom:"4px",color:"var(--rd-gray-text)"}}>Хост</div>
                        <input className="form-input" placeholder="localhost или IP-адрес" value={pgForm.host} onChange={e => setPgForm(f => ({...f,host:e.target.value}))} />
                      </div>
                      <div>
                        <div style={{fontSize:"12px",fontWeight:700,marginBottom:"4px",color:"var(--rd-gray-text)"}}>Порт</div>
                        <input className="form-input" placeholder="5432" value={pgForm.port} onChange={e => setPgForm(f => ({...f,port:e.target.value}))} />
                      </div>
                    </div>
                    <div style={{marginBottom:"12px"}}>
                      <div style={{fontSize:"12px",fontWeight:700,marginBottom:"4px",color:"var(--rd-gray-text)"}}>База данных</div>
                      <input className="form-input" placeholder="postgres" value={pgForm.database} onChange={e => setPgForm(f => ({...f,database:e.target.value}))} />
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px",marginBottom:"12px"}}>
                      <div>
                        <div style={{fontSize:"12px",fontWeight:700,marginBottom:"4px",color:"var(--rd-gray-text)"}}>Пользователь</div>
                        <input className="form-input" placeholder="postgres" value={pgForm.user} onChange={e => setPgForm(f => ({...f,user:e.target.value}))} />
                      </div>
                      <div>
                        <div style={{fontSize:"12px",fontWeight:700,marginBottom:"4px",color:"var(--rd-gray-text)"}}>Пароль</div>
                        <input className="form-input" type="password" placeholder={pgForm._passwordSaved && !pgForm.password ? "(пароль сохранён)" : "••••••••"} value={pgForm.password || ""} onChange={e => setPgForm(f => ({...f,password:e.target.value}))} />
                      </div>
                    </div>
                    <div style={{marginBottom:"16px",display:"flex",alignItems:"center",gap:"8px"}}>
                      <input type="checkbox" id="pg-ssl" checked={!!pgForm.ssl} onChange={e => setPgForm(f => ({...f,ssl:e.target.checked}))} style={{width:"16px",height:"16px",cursor:"pointer"}} />
                      <label htmlFor="pg-ssl" style={{fontSize:"13px",cursor:"pointer",fontWeight:600}}>Использовать SSL</label>
                      <span style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>(для облачных БД: Supabase, Neon, Railway и др.)</span>
                    </div>
                    {/* Test result */}
                    {pgTestResult && (
                      <div style={{marginBottom:"14px",padding:"10px 14px",borderRadius:"var(--rd-radius-sm)",fontSize:"13px",background:pgTestResult.ok?"rgba(34,197,94,0.08)":"rgba(199,22,24,0.08)",border:pgTestResult.ok?"1px solid rgba(34,197,94,0.25)":"1px solid rgba(199,22,24,0.25)",color:pgTestResult.ok?"#15803d":"var(--rd-red)"}}>
                        {pgTestResult.ok ? (
                          <div>✅ Подключение успешно!<br/><span style={{fontSize:"12px",opacity:0.8}}>БД: <strong>{pgTestResult.database}</strong> · Размер: {pgTestResult.size}<br/>{pgTestResult.version?.split(" ").slice(0,2).join(" ")}</span></div>
                        ) : (
                          <div>❌ Ошибка подключения:<br/><code style={{fontSize:"12px"}}>{pgTestResult.error}</code></div>
                        )}
                      </div>
                    )}
                    <div style={{display:"flex",gap:"10px",flexWrap:"wrap"}}>
                      <button className="btn btn-secondary" onClick={() => testPgConnection()} disabled={pgTesting}>{pgTesting ? "⏳ Проверка…" : "🔌 Проверить подключение"}</button>
                      <button className="btn btn-primary" onClick={savePgSettings}>💾 Сохранить</button>
                    </div>
                  </div>

                  {/* Enable / Disable */}
                  <div className="settings-card">
                    <div className="settings-section-title">⚡ Активация</div>
                    <div style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"16px",lineHeight:"1.6"}}>
                      После активации приложение будет хранить и читать все данные из PostgreSQL. SQLite останется как резервная копия до следующей загрузки страницы.
                    </div>
                    
                    {!isPgActive && (
                      <div style={{marginBottom:"20px"}}>
                        <div style={{fontSize:"12px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",color:"var(--rd-gray-text)",marginBottom:"12px"}}>Выберите режим активации</div>
                        
                        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
                          {/* Режим: Существующая БД */}
                          <label style={{display:"flex",alignItems:"flex-start",gap:"12px",padding:"14px",border:"2px solid " + (pgActivationMode === 'existing' ? "var(--rd-red)" : "var(--rd-gray-border)"),borderRadius:"var(--rd-radius-sm)",cursor:"pointer",background:pgActivationMode === 'existing' ? "rgba(199,22,24,0.04)" : "#fff",transition:"all 0.2s"}}>
                            <input type="radio" name="pgActivationMode" value="existing" checked={pgActivationMode === 'existing'} onChange={e => setPgActivationMode(e.target.value)} style={{marginTop:"2px",cursor:"pointer"}} />
                            <div style={{flex:1}}>
                              <div style={{fontWeight:700,fontSize:"14px",marginBottom:"4px",color:pgActivationMode === 'existing' ? "var(--rd-red)" : "var(--rd-dark)"}}>
                                ✅ Подключиться к существующей БД
                              </div>
                              <div style={{fontSize:"12px",color:"var(--rd-gray-text)",lineHeight:"1.5"}}>
                                Сохранить все данные в PostgreSQL. Безопасно для обновлений приложения. <strong style={{color:"#16a34a"}}>Рекомендуется!</strong>
                              </div>
                            </div>
                          </label>
                          
                          {/* Режим: Новая БД */}
                          <label style={{display:"flex",alignItems:"flex-start",gap:"12px",padding:"14px",border:"2px solid " + (pgActivationMode === 'new' ? "var(--rd-red)" : "var(--rd-gray-border)"),borderRadius:"var(--rd-radius-sm)",cursor:"pointer",background:pgActivationMode === 'new' ? "rgba(199,22,24,0.04)" : "#fff",transition:"all 0.2s"}}>
                            <input type="radio" name="pgActivationMode" value="new" checked={pgActivationMode === 'new'} onChange={e => setPgActivationMode(e.target.value)} style={{marginTop:"2px",cursor:"pointer"}} />
                            <div style={{flex:1}}>
                              <div style={{fontWeight:700,fontSize:"14px",marginBottom:"4px",color:pgActivationMode === 'new' ? "var(--rd-red)" : "var(--rd-dark)"}}>
                                🔄 Создать новую БД (мигрировать из SQLite)
                              </div>
                              <div style={{fontSize:"12px",color:"var(--rd-gray-text)",lineHeight:"1.5",marginBottom:"6px"}}>
                                Перенести данные из SQLite в PostgreSQL. Текущие данные в PostgreSQL будут перезаписаны.
                              </div>
                              {pgActivationMode === 'new' && (
                                <div style={{fontSize:"11px",background:"rgba(239,68,68,0.1)",color:"#dc2626",padding:"8px 10px",borderRadius:"6px",fontWeight:600,display:"flex",alignItems:"center",gap:"6px"}}>
                                  <span>⚠️</span>
                                  <span>ВНИМАНИЕ! Все данные в PostgreSQL будут перезаписаны!</span>
                                </div>
                              )}
                            </div>
                          </label>
                        </div>
                      </div>
                    )}
                    
                    <div style={{display:"flex",gap:"10px",flexWrap:"wrap",alignItems:"center"}}>
                      {!isPgActive ? (
                        <button className="btn btn-primary" style={{background:"#16a34a",border:"none"}} onClick={enablePg} disabled={pgTesting}>
                          {pgTesting ? "⏳ Подключение…" : "🟢 Активировать PostgreSQL"}
                        </button>
                      ) : (
                        <button className="btn" style={{background:"var(--rd-red)",color:"#fff",fontWeight:700}} onClick={disablePg}>🔴 Отключить PostgreSQL</button>
                      )}
                    </div>
                  </div>

                  {/* Stats */}
                  {isPgActive && (
                    <div className="settings-card">
                      <div className="settings-section-title">📊 Статистика PostgreSQL</div>
                      {pgStats ? (
                        <div>
                          <div style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"12px"}}>Размер БД: <strong>{pgStats.size}</strong> · Всего ключей: <strong>{pgStats.total}</strong></div>
                          <div className="db-tables-grid">
                            {[["cm_users","👥 Пользователи"],["cm_products","🛍️ Товары"],["cm_orders","📦 Заказы"],["cm_transfers","🪙 Переводы"],["cm_categories","🏷️ Категории"],["_total_coins","🪙 Всего монет"],["_total_keys","🔑 Всего ключей"]].map(([k,label]) => (
                              <div key={k} className="db-table-card">
                                <div className="db-table-name">{label}</div>
                                <div className="db-table-count">{pgStats.rowCounts?.[k] ?? "—"}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div style={{fontSize:"13px",color:"var(--rd-gray-text)"}}>Нажмите кнопку для загрузки статистики.</div>
                      )}
                      <div style={{marginTop:"14px"}}>
                        <button className="btn btn-secondary" onClick={loadPgStats} disabled={pgStatsLoading}>{pgStatsLoading ? "⏳ Загрузка…" : "🔄 Загрузить статистику"}</button>
                      </div>
                    </div>
                  )}

                  {/* PG SQL Console */}
                  {isAdmin && isPgActive && (
                    <div className="settings-card">
                      <div className="settings-section-title">💻 SQL-консоль (PostgreSQL)</div>
                      <div style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"10px"}}>Таблица <code style={{background:"var(--rd-gray-bg)",padding:"2px 6px",borderRadius:"4px",fontFamily:"monospace",fontSize:"11px"}}>kv</code> содержит поля <code style={{background:"var(--rd-gray-bg)",padding:"2px 6px",borderRadius:"4px",fontFamily:"monospace",fontSize:"11px"}}>key</code>, <code style={{background:"var(--rd-gray-bg)",padding:"2px 6px",borderRadius:"4px",fontFamily:"monospace",fontSize:"11px"}}>value</code>, <code style={{background:"var(--rd-gray-bg)",padding:"2px 6px",borderRadius:"4px",fontFamily:"monospace",fontSize:"11px"}}>updated_at</code>.</div>
                      <textarea style={{width:"100%",minHeight:"90px",fontFamily:"monospace",fontSize:"13px",padding:"10px 12px",border:"1.5px solid var(--rd-gray-border)",borderRadius:"var(--rd-radius-sm)",resize:"vertical",background:"#1a1a1a",color:"#e5e7eb",outline:"none"}} placeholder={"SELECT key, updated_at FROM kv ORDER BY updated_at DESC LIMIT 10;"} value={pgSqlConsole} onChange={e => setPgSqlConsole(e.target.value)} onKeyDown={e => { if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();runPgSql();}}} />
                      <div style={{display:"flex",gap:"10px",marginTop:"8px"}}>
                        <button className="btn btn-primary" onClick={runPgSql}>▶ Выполнить <span style={{fontSize:"11px",opacity:0.7}}>(Ctrl+Enter)</span></button>
                        <button className="btn btn-ghost" onClick={() => { setPgSqlResult(null); setPgSqlError(""); setPgSqlConsole(""); }}>Очистить</button>
                      </div>
                      {pgSqlError && <div style={{marginTop:"10px",padding:"10px 14px",background:"rgba(199,22,24,0.08)",border:"1px solid rgba(199,22,24,0.2)",borderRadius:"var(--rd-radius-sm)",fontSize:"13px",color:"var(--rd-red)",fontFamily:"monospace"}}>{pgSqlError}</div>}
                      {pgSqlResult && (
                        <div style={{marginTop:"10px",overflowX:"auto"}}>
                          <table style={{borderCollapse:"collapse",width:"100%",fontSize:"12px",fontFamily:"monospace"}}>
                            <thead><tr>{pgSqlResult.columns.map(c => <th key={c} style={{padding:"6px 10px",textAlign:"left",background:"var(--rd-gray-bg)",border:"1px solid var(--rd-gray-border)",fontWeight:700,whiteSpace:"nowrap"}}>{c}</th>)}</tr></thead>
                            <tbody>{pgSqlResult.rows.slice(0,100).map((row,i) => <tr key={i} style={{background:i%2===0?"#fff":"var(--rd-gray-bg)"}}>{pgSqlResult.columns.map((c,j) => <td key={j} style={{padding:"5px 10px",border:"1px solid var(--rd-gray-border)",maxWidth:"300px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row[c]===null||row[c]===undefined?<em style={{color:"var(--rd-gray-text)"}}>NULL</em>:String(row[c]).length>80?String(row[c]).substring(0,80)+"…":String(row[c])}</td>)}</tr>)}</tbody>
                          </table>
                          <div style={{fontSize:"11px",color:"var(--rd-gray-text)",marginTop:"6px"}}>{pgSqlResult.rowCount} строк</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Diagnostics */}
                  <div className="settings-card">
                    <div className="settings-section-title">🔍 Диагностика соединения</div>
                    <div style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"10px"}}>Проверяет что сервер реально использует PostgreSQL — видит ли он конфиг, подключается ли к БД.</div>
                    <div style={{display:"flex",gap:"10px",flexWrap:"wrap"}}>
                    <button className="btn" onClick={runDiag} disabled={debugLoading} style={{background:"#7c3aed",color:"#fff",fontWeight:700,border:"none"}}>
                      {debugLoading ? "⏳ Диагностика…" : "🔍 Запустить диагностику"}
                    </button>
                    <button className="btn" onClick={async () => {
                      if (!confirm("Перенести данные из store.json в PostgreSQL?\n\nЭто перезапишет данные в PG текущими данными из JSON-файла.")) return;
                      try {
                        const r = await fetch('/api/store', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'migrate' }) });
                        const d = await r.json();
                        if (d.ok) { notify("✅ Мигрировано " + d.migrated + " ключей в PostgreSQL", "ok"); runDiag(); }
                        else notify("Ошибка миграции: " + d.error, "err");
                      } catch(e) { notify("Ошибка: " + e.message, "err"); }
                    }} style={{background:"#0369a1",color:"#fff",fontWeight:700,border:"none"}}>
                      📤 Перенести JSON → PG
                    </button>
                    </div>
                    {debugInfo && (
                      <div style={{marginTop:"12px",background:"#0f172a",color:"#e2e8f0",borderRadius:"10px",padding:"14px 16px",fontSize:"12px",fontFamily:"monospace",lineHeight:1.8,overflowX:"auto"}}>
                        <div style={{color:"#94a3b8",marginBottom:"8px",fontWeight:700}}>── РЕЗУЛЬТАТ ──</div>
                        <div><span style={{color:"#7dd3fc"}}>ENV DATABASE_URL:</span> {debugInfo.hasEnvUrl ? "✅ задан" : "❌ нет"}</div>
                        <div><span style={{color:"#7dd3fc"}}>ENV PG_HOST:</span> {debugInfo.hasEnvHost ? "✅ задан" : "❌ нет"}</div>
                        <div><span style={{color:"#7dd3fc"}}>pg-config.json:</span> {debugInfo.hasCfgFile ? "✅ есть" : "❌ нет"}</div>
                        <div><span style={{color:"#7dd3fc"}}>Ошибка подключения:</span> {debugInfo.pgError || "нет"}</div>
                        <div style={{marginTop:"6px"}}><span style={{color:"#7dd3fc"}}>Ключи в PG ({(debugInfo.pgKeys||[]).length} шт):</span></div>
                        {(debugInfo.pgKeys||[]).map(({key, preview}) => (
                          <div key={key} style={{paddingLeft:"12px",color:"#a3e635"}}>• {key}: <span style={{color:"#94a3b8",fontSize:"11px"}}>{preview}</span></div>
                        ))}
                        {!(debugInfo.pgKeys||[]).length && <div style={{paddingLeft:"12px",color:"#f87171"}}>— пусто</div>}
                        <div style={{marginTop:"6px"}}><span style={{color:"#7dd3fc"}}>Ключи в JSON:</span> {(debugInfo.jsonKeys||[]).join(", ") || "пусто"}</div>
                        <div><span style={{color:"#7dd3fc"}}>Папка:</span> {debugInfo.cwd}</div>
                        {debugInfo.error && <div style={{color:"#f87171",marginTop:"6px"}}>❌ {debugInfo.error}</div>}
                      </div>
                    )}
                  </div>

                  {/* PG Info */}
                  <div className="settings-card" style={{background:"rgba(59,130,246,0.04)",border:"1px solid rgba(59,130,246,0.15)"}}>
                    <div className="settings-section-title" style={{color:"#2563eb"}}>ℹ️ Поддерживаемые провайдеры</div>
                    <div style={{fontSize:"13px",color:"var(--rd-gray-text)",lineHeight:"1.8"}}>
                      Работает с любым PostgreSQL 12+: <strong>Supabase</strong>, <strong>Neon</strong>, <strong>Railway</strong>, <strong>Render</strong>, локальный сервер и др.<br/>
                      Для облачных сервисов обычно требуется включить <strong>SSL</strong>. Строка подключения вида:<br/>
                      <code style={{display:"block",marginTop:"6px",background:"#1a1a1a",color:"#86efac",padding:"8px 12px",borderRadius:"6px",fontSize:"12px",fontFamily:"monospace"}}>postgresql://user:password@host:5432/database?sslmode=require</code>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

          {tab === "users" && isAdmin && (
            <div style={{marginTop:"-12px"}}>
              <AdminPage
                users={users} saveUsers={saveUsers}
                orders={orders} saveOrders={saveOrders}
                products={products} saveProducts={saveProducts}
                categories={categories} saveCategories={saveCategories}
                notify={notify} setPage={() => {}} currentUser={currentUser}
                transfers={transfers} saveTransfers={saveTransfers}
                embedded={true} activeTab="users" setActiveTab={() => {}}
                faq={faq} saveFaq={saveFaq}
              />
            </div>
          )}

          {tab === "shop" && isAdmin && (
            <div style={{marginTop:"-12px"}}>
              <AdminPage
                users={users} saveUsers={saveUsers}
                orders={orders} saveOrders={saveOrders}
                products={products} saveProducts={saveProducts}
                categories={categories} saveCategories={saveCategories}
                notify={notify} setPage={() => {}} currentUser={currentUser}
                transfers={transfers} saveTransfers={saveTransfers}
                embedded={true} activeTab={adminTab} setActiveTab={setAdminTab}
                faq={faq} saveFaq={saveFaq}
              />
            </div>
          )}

          {tab === "faq" && (
            <div className="settings-card">
              <div style={{fontWeight:700,fontSize:"18px",color:"var(--rd-dark)",marginBottom:"20px",paddingBottom:"14px",borderBottom:"1.5px solid var(--rd-gray-border)"}}>
                ❓ Вопросы и ответы
              </div>
              <FaqAdminTab faq={faq} saveFaq={saveFaq} notify={notify} />
            </div>
          )}

          {tab === "video" && (
            <div className="settings-card">
              <div style={{fontWeight:700,fontSize:"18px",color:"var(--rd-dark)",marginBottom:"20px",paddingBottom:"14px",borderBottom:"1.5px solid var(--rd-gray-border)"}}>
                🎬 Управление видео
              </div>
              <VideoAdminTab videos={videos} saveVideos={saveVideos} notify={notify} />
            </div>
          )}

          {tab === "tasks" && (
            <div className="settings-card">
              <div style={{fontWeight:700,fontSize:"18px",color:"var(--rd-dark)",marginBottom:"20px",paddingBottom:"14px",borderBottom:"1.5px solid var(--rd-gray-border)"}}>
                🎯 Задания
              </div>
              <TasksAdminTab tasks={tasks} saveTasks={saveTasks} taskSubmissions={taskSubmissions} saveTaskSubmissions={saveTaskSubmissions} notify={notify} users={users} saveUsers={saveUsers} />
            </div>
          )}

          {tab === "auction" && (
            <div className="settings-card">
              <div style={{fontWeight:700,fontSize:"18px",color:"var(--rd-dark)",marginBottom:"20px",paddingBottom:"14px",borderBottom:"1.5px solid var(--rd-gray-border)"}}>
                🔨 Управление аукционами
              </div>
              <AuctionAdminTab auctions={auctions} saveAuctions={saveAuctions} notify={notify} users={users} />
            </div>
          )}

          {tab === "lottery" && (
            <div className="settings-card">
              <div style={{fontWeight:700,fontSize:"18px",color:"var(--rd-dark)",marginBottom:"20px",paddingBottom:"14px",borderBottom:"1.5px solid var(--rd-gray-border)"}}>
                🎰 Управление лотереями
              </div>
              <LotteryAdminTab lotteries={lotteries} saveLotteries={saveLotteries} notify={notify} users={users} saveUsers={saveUsers} appearance={appearance} />
            </div>
          )}

          {tab === "voting" && (
            <div className="settings-card">
              <div style={{fontWeight:700,fontSize:"18px",color:"var(--rd-dark)",marginBottom:"20px",paddingBottom:"14px",borderBottom:"1.5px solid var(--rd-gray-border)"}}>
                🗳️ Управление голосованиями
              </div>
              <VotingAdminTab polls={polls} savePolls={savePolls} notify={notify} users={users} saveUsers={saveUsers} />
            </div>
          )}

          {tab === "bank" && (
            <div className="settings-card">
              <div style={{fontWeight:700,fontSize:"18px",color:"var(--rd-dark)",marginBottom:"20px",paddingBottom:"14px",borderBottom:"1.5px solid var(--rd-gray-border)"}}>
                🏦 Управление вкладами
              </div>
              <BankAdminTab deposits={deposits} saveDeposits={saveDeposits} notify={notify} />
            </div>
          )}

          {tab === "sections" && isAdmin && (
            <div className="settings-card">
              <div style={{fontWeight:700,fontSize:"18px",color:"var(--rd-dark)",marginBottom:"8px"}}>
                📑 Настройки разделов
              </div>
              <p style={{fontSize:"13px",color:"var(--rd-gray-text)",marginBottom:"24px",lineHeight:1.6}}>
                Настройте заголовки, описания и баннеры для каждого раздела сайта
              </p>
              <SectionsSettingsTab appearance={appearance} saveAppearance={saveAppearance} notify={notify} />
            </div>
          )}

        </div>
      </div>
    </div>
  );
}


// ── SECTIONS SETTINGS ────────────────────────────────────────────────────────

function SectionsSettingsTab({ appearance, saveAppearance, notify }) {
  const sections = [
    { id: "auction", icon: "🔨", name: "Аукцион" },
    { id: "lottery", icon: "🎰", name: "Лотерея" },
    { id: "voting", icon: "🗳️", name: "Голосование" },
    { id: "bank", icon: "🏦", name: "Банк" },
    { id: "tasks", icon: "🎯", name: "Задания" }
  ];

  const [settings, setSettings] = useState(appearance.sectionSettings || {});

  // Sync local state when appearance changes externally
  useEffect(() => {
    setSettings(appearance.sectionSettings || {});
  }, [appearance.sectionSettings]);
  
  const updateSection = (sectionId, field, value) => {
    setSettings(prev => ({
      ...prev,
      [sectionId]: {
        ...(prev[sectionId] || {}),
        [field]: value
      }
    }));
  };

  const handleImageUpload = async (sectionId, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const compressed = await compressImage(ev.target.result, 1600, 600, 0.75, 250);
        updateSection(sectionId, 'banner', compressed);
      } catch (err) {
        notify("Ошибка сжатия изображения", "err");
      }
    };
    reader.readAsDataURL(file);
  };

  const saveSettings = () => {
    saveAppearance({ ...appearance, sectionSettings: settings });
    notify("Настройки разделов сохранены ✓");
  };

  return (
    <div>
      {sections.map(section => {
        const sectionData = settings[section.id] || {};
        return (
          <div key={section.id} style={{marginBottom:"32px",paddingBottom:"32px",borderBottom:"1.5px solid var(--rd-gray-border)"}}>
            <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"20px"}}>
              <span style={{fontSize:"24px"}}>{section.icon}</span>
              <h3 style={{fontSize:"17px",fontWeight:800,color:"var(--rd-dark)"}}>{section.name}</h3>
            </div>

            <div className="form-group">
              <label className="form-label">Заголовок раздела</label>
              <input
                className="form-input"
                value={sectionData.title || ""}
                onChange={e => updateSection(section.id, 'title', e.target.value)}
                placeholder={`Например: ${section.name}`}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Описание</label>
              <textarea
                className="form-input"
                rows={2}
                value={sectionData.description || ""}
                onChange={e => updateSection(section.id, 'description', e.target.value)}
                placeholder="Краткое описание раздела"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Баннер (опционально)</label>
              <p style={{fontSize:"12px",color:"var(--rd-gray-text)",marginBottom:"10px"}}>
                Рекомендуемый размер: 1920x600px. Если баннер не загружен, будет отображаться стандартный заголовок.
              </p>
              {sectionData.banner && (
                <div style={{position:"relative",marginBottom:"12px",borderRadius:"var(--rd-radius)",overflow:"hidden",maxWidth:"600px"}}>
                  <img src={sectionData.banner} alt="Banner preview" style={{width:"100%",height:"auto",display:"block"}} />
                  <button
                    onClick={() => updateSection(section.id, 'banner', '')}
                    style={{position:"absolute",top:"10px",right:"10px",background:"rgba(0,0,0,0.7)",color:"#fff",border:"none",borderRadius:"6px",padding:"6px 10px",cursor:"pointer",fontSize:"12px",fontWeight:700}}
                  >
                    Удалить
                  </button>
                </div>
              )}
              <div style={{display:"flex",gap:"10px",alignItems:"center",flexWrap:"wrap"}}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => handleImageUpload(section.id, e)}
                  style={{display:"none"}}
                  id={`section-banner-input-${section.id}`}
                />
                <label htmlFor={`section-banner-input-${section.id}`} className="btn btn-secondary btn-sm" style={{cursor:"pointer"}}>📷 Загрузить фото</label>
              </div>
            </div>
          </div>
        );
      })}

      <button
        onClick={saveSettings}
        className="btn btn-primary"
        style={{marginTop:"20px"}}
      >
        Сохранить настройки разделов
      </button>
    </div>
  );
}

// ── LOTTERY ──────────────────────────────────────────────────────────────

// Shared countdown component
function LotteryCountdown({ endsAt, large }) {
  const [diff, setDiff] = useState(endsAt - Date.now());
  useEffect(() => {
    const t = setInterval(() => setDiff(endsAt - Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  if (diff <= 0) return <span style={{ color: "var(--rd-red)", fontWeight: 700 }}>Завершается...</span>;
  const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000);
  const fs = large ? "22px" : "15px";
  return (
    <span style={{ fontWeight: 800, fontSize: fs, color: "var(--rd-red)", fontVariantNumeric: "tabular-nums" }}>
      {d > 0 ? `${d}д ` : ""}{String(h).padStart(2,"0")}:{String(m).padStart(2,"0")}:{String(s).padStart(2,"0")}
    </span>
  );
}

function LotteryAdminTab({ lotteries, saveLotteries, notify, users, saveUsers, appearance }) {
  const list = lotteries || [];
  const emptyForm = { name: "", image: "", coins: "", participants: "", endsAt: "" };
  const [form, setForm] = useState(emptyForm);
  const [imgPreview, setImgPreview] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [historyView, setHistoryView] = useState(false);
  const drawnRef = React.useRef(new Set());
  const [adminSearch, setAdminSearch] = useState("");
  const [adminSort, setAdminSort] = useState("newest");
  const now = Date.now();
  const active = list.filter(l => l.status === "active").sort((a, b) => a.endsAt - b.endsAt);
  const ended = list.filter(l => l.status === "ended").sort((a, b) => b.endsAt - a.endsAt);
  const filteredActive = active.filter(l => !adminSearch || l.name.toLowerCase().includes(adminSearch.toLowerCase()));
  const filteredEnded = ended.filter(l => !adminSearch || l.name.toLowerCase().includes(adminSearch.toLowerCase()));

  const sendTg = (text) => {
    const integ = appearance?.integrations || {};
    if (integ.tgEnabled && integ.tgBotToken && integ.tgChatId) {
      fetch('/api/telegram', { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: integ.tgBotToken.trim(), chat_id: integ.tgChatId.trim(), text, parse_mode: "HTML" }) }).catch(() => {});
    }
    if (integ.maxEnabled && integ.maxBotToken && integ.maxChatId) {
      fetch('/api/max', { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: integ.maxBotToken.trim(), chat_id: integ.maxChatId.trim(), text }) }).catch(() => {});
    }
  };

  const doDrawWinners = (lottery, currentList) => {
    const allUserKeys = Object.keys(users).filter(u => u !== "admin");
    if (allUserKeys.length === 0) return null;
    const count = Math.min(lottery.participants, allUserKeys.length);
    const shuffled = [...allUserKeys].sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, count);
    const prizePerWinner = Math.floor(lottery.coins / count);
    const newUsers = { ...users };
    winners.forEach(w => { newUsers[w] = { ...newUsers[w], balance: (newUsers[w].balance || 0) + prizePerWinner }; });
    saveUsers(newUsers);
    const winnerList = winners.map(w => ({ user: w, prize: prizePerWinner }));
    const updated = (currentList || list).map(l => l.id === lottery.id ? { ...l, status: "ended", winners: winnerList } : l);
    saveLotteries(updated);
    const tgText = `🎰 <b>Лотерея завершена: «${lottery.name}»</b>\n\n🏆 Победители:\n` + winnerList.map((w, i) => `${i+1}. <b>${w.user}</b> — +${w.prize} 🪙`).join("\n") + `\n\n💰 Всего разыграно: ${lottery.coins} монет`;
    sendTg(tgText);
    notify(`🎰 Лотерея «${lottery.name}» завершена! Победители: ${winners.join(", ")} (+${prizePerWinner} 🪙)`);
    return winnerList;
  };

  // Auto-draw on timer expiry
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const currentList = storage.get("cm_lotteries") || list;
      const toFinish = currentList.filter(l => l.status === "active" && l.endsAt <= now && !drawnRef.current.has(l.id));
      toFinish.forEach(l => { drawnRef.current.add(l.id); doDrawWinners(l, currentList); });
    }, 5000);
    return () => clearInterval(interval);
  }, [users, list]);

  const handleImage = (e, setter, setSrc) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => { const c = await compressImage(ev.target.result, 1200, 1200, 0.85, 300); setter(f => ({ ...f, image: c })); if (setSrc) setSrc(c); };
    reader.readAsDataURL(file); e.target.value = "";
  };

  const addLottery = () => {
    if (!form.name.trim()) { notify("Введите название", "err"); return; }
    if (!form.coins || parseInt(form.coins) <= 0) { notify("Укажите количество монет", "err"); return; }
    if (!form.participants || parseInt(form.participants) <= 0) { notify("Укажите количество участников", "err"); return; }
    if (!form.endsAt) { notify("Укажите дату и время розыгрыша", "err"); return; }
    const newL = { id: Date.now(), name: form.name.trim(), image: form.image, coins: parseInt(form.coins), participants: parseInt(form.participants), endsAt: new Date(form.endsAt).getTime(), winners: [], status: "active", createdAt: Date.now() };
    saveLotteries([...list, newL]);
    setForm(emptyForm); setImgPreview("");
    notify("Лотерея создана ✓");
  };

  const startEdit = (l) => {
    const endsAtLocal = new Date(l.endsAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setEditingId(l.id);
    setEditForm({ name: l.name, image: l.image || "", coins: String(l.coins), participants: String(l.participants), endsAt: endsAtLocal });
  };
  const cancelEdit = () => { setEditingId(null); setEditForm(null); };
  const saveEdit = () => {
    if (!editForm.name.trim()) { notify("Введите название", "err"); return; }
    const updated = list.map(l => l.id === editingId ? { ...l, name: editForm.name.trim(), image: editForm.image, coins: parseInt(editForm.coins), participants: parseInt(editForm.participants), endsAt: new Date(editForm.endsAt).getTime() } : l);
    saveLotteries(updated); cancelEdit(); notify("Лотерея обновлена ✓");
  };
  const deleteLottery = (id) => { saveLotteries(list.filter(l => l.id !== id)); notify("Лотерея удалена"); };

  const inputStyle = { width: "100%", padding: "10px 14px", border: "1.5px solid var(--rd-gray-border)", borderRadius: "10px", fontSize: "14px", boxSizing: "border-box", background: "#fff" };
  const labelStyle = { fontSize: "12px", fontWeight: 700, color: "var(--rd-gray-text)", marginBottom: "6px", display: "block" };

  return (
    <div>
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
        <button onClick={() => setHistoryView(false)} style={{ padding: "8px 18px", borderRadius: "10px", border: "1.5px solid var(--rd-gray-border)", background: !historyView ? "var(--rd-red)" : "#fff", color: !historyView ? "#fff" : "var(--rd-dark)", fontWeight: 700, cursor: "pointer" }}>Управление</button>
        <button onClick={() => setHistoryView(true)} style={{ padding: "8px 18px", borderRadius: "10px", border: "1.5px solid var(--rd-gray-border)", background: historyView ? "var(--rd-red)" : "#fff", color: historyView ? "#fff" : "var(--rd-dark)", fontWeight: 700, cursor: "pointer" }}>История победителей</button>
      </div>

      {/* Search & Sort */}
      {list.length > 0 && (
        <div style={{display:"flex",gap:"10px",marginBottom:"16px",flexWrap:"wrap",alignItems:"center"}}>
          <input className="form-input" placeholder="🔍 Поиск по названию..." value={adminSearch} onChange={e => setAdminSearch(e.target.value)} style={{flex:"1 1 200px",minWidth:"160px",padding:"8px 14px",fontSize:"13px"}} />
          <select className="form-input" value={adminSort} onChange={e => setAdminSort(e.target.value)} style={{flex:"0 0 auto",padding:"8px 14px",fontSize:"13px",minWidth:"160px"}}>
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала старые</option>
          </select>
        </div>
      )}

      {!historyView && (
        <>
          <div style={{ background: "var(--rd-gray-bg)", borderRadius: "var(--rd-radius-sm)", padding: "20px", marginBottom: "24px", border: "1.5px solid var(--rd-gray-border)" }}>
            <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "16px" }}>➕ Создать лотерею</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ gridColumn: "1/-1" }}><label style={labelStyle}>Название</label><input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Новогодний розыгрыш" /></div>
              <div><label style={labelStyle}>Монет для розыгрыша</label><input type="number" style={inputStyle} value={form.coins} onChange={e => setForm(f => ({ ...f, coins: e.target.value }))} placeholder="1000" /></div>
              <div><label style={labelStyle}>Кол-во победителей</label><input type="number" style={inputStyle} value={form.participants} onChange={e => setForm(f => ({ ...f, participants: e.target.value }))} placeholder="3" /></div>
              <div style={{ gridColumn: "1/-1" }}><label style={labelStyle}>Дата и время розыгрыша</label><input type="datetime-local" style={inputStyle} value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} /></div>
              <div style={{ gridColumn: "1/-1" }}>
                <label style={labelStyle}>Фото</label>
                {imgPreview ? (
                  <div style={{ position: "relative", display: "inline-block" }}>
                    <img src={imgPreview} alt="" style={{ maxHeight: "120px", maxWidth: "100%", borderRadius: "10px", border: "1.5px solid var(--rd-gray-border)" }} />
                    <button onClick={() => { setForm(f => ({ ...f, image: "" })); setImgPreview(""); }} style={{ position: "absolute", top: "4px", right: "4px", background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: "22px", height: "22px", color: "#fff", cursor: "pointer", fontSize: "13px" }}>✕</button>
                  </div>
                ) : (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 16px", border: "1.5px dashed var(--rd-gray-border)", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "var(--rd-gray-text)" }}>
                    📷 Загрузить фото<input type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleImage(e, setForm, setImgPreview)} />
                  </label>
                )}
              </div>
            </div>
            <button onClick={addLottery} className="admin-red-btn" style={{ marginTop: "16px", background: "var(--rd-red)", color: "#fff", border: "none", borderRadius: "10px", padding: "12px 24px", fontWeight: 700, cursor: "pointer", fontSize: "14px", width: "100%" }}>🎰 Создать лотерею</button>
          </div>

          {filteredActive.length > 0 && <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "12px", color: "var(--rd-dark)" }}>Активные лотереи</div>}
          {filteredActive.map(l => (
            <div key={l.id} style={{ border: "1.5px solid var(--rd-gray-border)", borderRadius: "var(--rd-radius-sm)", padding: "16px", marginBottom: "12px", background: "#fff" }}>
              {editingId === l.id ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div style={{ gridColumn: "1/-1" }}><label style={labelStyle}>Название</label><input style={inputStyle} value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></div>
                  <div><label style={labelStyle}>Монет</label><input type="number" style={inputStyle} value={editForm.coins} onChange={e => setEditForm(f => ({ ...f, coins: e.target.value }))} /></div>
                  <div><label style={labelStyle}>Победителей</label><input type="number" style={inputStyle} value={editForm.participants} onChange={e => setEditForm(f => ({ ...f, participants: e.target.value }))} /></div>
                  <div style={{ gridColumn: "1/-1" }}><label style={labelStyle}>Дата и время</label><input type="datetime-local" style={inputStyle} value={editForm.endsAt} onChange={e => setEditForm(f => ({ ...f, endsAt: e.target.value }))} /></div>
                  <div style={{ gridColumn: "1/-1", display: "flex", gap: "8px" }}>
                    <button onClick={saveEdit} className="admin-red-btn" style={{ background: "var(--rd-red)", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 18px", fontWeight: 700, cursor: "pointer" }}>Сохранить</button>
                    <button onClick={cancelEdit} style={{ background: "var(--rd-gray-bg)", border: "1.5px solid var(--rd-gray-border)", borderRadius: "8px", padding: "8px 18px", fontWeight: 700, cursor: "pointer" }}>Отмена</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                  {l.image && <img src={l.image} alt="" style={{ width: "70px", height: "70px", objectFit: "cover", borderRadius: "10px", flexShrink: 0 }} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: "15px" }}>{l.name}</div>
                    <div style={{ fontSize: "13px", color: "var(--rd-gray-text)", marginTop: "4px" }}>💰 {l.coins} монет · 👥 {l.participants} победителей</div>
                    <div style={{ fontSize: "12px", color: "var(--rd-gray-text)", marginTop: "2px" }}>📅 {new Date(l.endsAt).toLocaleString("ru-RU")}</div>
                    {now <= l.endsAt && (
                      <div style={{ marginTop: "8px", display: "inline-flex", alignItems: "center", gap: "6px", background: "var(--rd-red-light)", padding: "4px 10px", borderRadius: "8px" }}>
                        <span style={{ fontSize: "11px", color: "var(--rd-red)", fontWeight: 600 }}>⏱ До розыгрыша:</span>
                        <LotteryCountdown endsAt={l.endsAt} />
                      </div>
                    )}
                    {now > l.endsAt && <div style={{ fontSize: "12px", color: "var(--rd-red)", fontWeight: 700, marginTop: "4px" }}>⏰ Завершается автоматически...</div>}
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                    <button onClick={() => startEdit(l)} style={{ background: "var(--rd-gray-bg)", border: "1.5px solid var(--rd-gray-border)", borderRadius: "8px", padding: "8px 12px", cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>✏️</button>
                    <button onClick={() => deleteLottery(l.id)} style={{ background: "#fff0f0", border: "1.5px solid #fecaca", borderRadius: "8px", padding: "8px 12px", cursor: "pointer", fontSize: "13px", color: "var(--rd-red)", fontWeight: 700 }}>🗑️</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {filteredActive.length === 0 && <div style={{ color: "var(--rd-gray-text)", textAlign: "center", padding: "20px", fontSize: "14px" }}>Нет активных лотерей</div>}
        </>
      )}

      {historyView && (
        <div>
          {filteredEnded.length === 0 && <div style={{ color: "var(--rd-gray-text)", textAlign: "center", padding: "40px", fontSize: "14px" }}>История пуста</div>}
          {filteredEnded.map(l => (
            <div key={l.id} style={{ border: "1.5px solid var(--rd-gray-border)", borderRadius: "var(--rd-radius-sm)", padding: "16px", marginBottom: "12px", background: "#fff" }}>
              <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                {l.image && <img src={l.image} alt="" style={{ width: "60px", height: "60px", objectFit: "cover", borderRadius: "10px", flexShrink: 0 }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "15px" }}>{l.name}</div>
                  <div style={{ fontSize: "12px", color: "var(--rd-gray-text)", marginTop: "2px" }}>📅 {new Date(l.endsAt).toLocaleString("ru-RU")}</div>
                  <div style={{ marginTop: "10px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--rd-gray-text)", marginBottom: "6px" }}>🏆 ПОБЕДИТЕЛИ:</div>
                    {(l.winners || []).map((w, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: "8px", marginBottom: "4px", fontSize: "13px" }}>
                        <span>🥇</span><span style={{ fontWeight: 700 }}>{w.user}</span><span style={{ marginLeft: "auto", fontWeight: 700, color: "var(--rd-red)" }}>+{w.prize} 🪙</span>
                      </div>
                    ))}
                  </div>
                </div>
                <button onClick={() => deleteLottery(l.id)} style={{ background: "#fff0f0", border: "1.5px solid #fecaca", borderRadius: "8px", padding: "8px 12px", cursor: "pointer", fontSize: "13px", color: "var(--rd-red)", fontWeight: 700, flexShrink: 0 }}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LotteryPage({ lotteries, currentUser, currency, appearance }) {
  const list = lotteries || [];
  const active = list.filter(l => l.status === "active").sort((a, b) => a.endsAt - b.endsAt);
  const ended = list.filter(l => l.status === "ended").sort((a, b) => b.endsAt - a.endsAt);
  const sectionSettings = appearance?.sectionSettings?.lottery || {};
  const title = sectionSettings.title || "Лотерея";
  const description = sectionSettings.description || "Участвуйте в розыгрышах и выигрывайте призы";
  const bannerImage = sectionSettings.banner || "";

  return (
    <div style={{ minHeight: "60vh" }}>
      {bannerImage ? (
        <div className="section-banner-wrap">
          <div className="hero-banner">
            <div className="hero-banner-bg" style={{backgroundImage:`url(${bannerImage})`}} />
            <div className="hero-banner-overlay" />
            <div className="hero-banner-content" style={{padding:"48px 24px"}}>
              <h1 className="hero-banner-title" style={{fontSize:"clamp(26px,5vw,40px)",marginBottom:"12px"}}>{title}</h1>
              <p className="hero-banner-desc">{description}</p>
            </div>
          </div>
          {list.length > 0 && (
            <div className="section-banner-stats-overlay">
              <div className="section-banner-stat">
                <div className="section-banner-stat-num" style={{color:"#ff6b6b"}}>{active.length}</div>
                <div className="section-banner-stat-label">Активных</div>
              </div>
              <div className="section-banner-stat">
                <div className="section-banner-stat-num" style={{color:"#fff"}}>{ended.length}</div>
                <div className="section-banner-stat-label">Завершённых</div>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {!bannerImage && (
        <div style={{background:"#fff",borderBottom:"1.5px solid var(--rd-gray-border)",padding:"40px 0 32px"}}>
          <div className="container">
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"12px"}}>
              <div>
                <h1 style={{fontSize:"clamp(26px,5vw,40px)",fontWeight:900,color:"var(--rd-dark)",letterSpacing:"-0.02em"}}>{title}</h1>
                <p style={{fontSize:"15px",color:"var(--rd-gray-text)",marginTop:"6px"}}>{description}</p>
              </div>
              {list.length > 0 && (
                <div style={{display:"flex",gap:"16px",flexWrap:"wrap",marginLeft:"auto"}}>
                  <div style={{textAlign:"center",background:"var(--rd-gray-bg)",borderRadius:"12px",padding:"12px 20px"}}>
                    <div style={{fontSize:"22px",fontWeight:900,color:"var(--rd-red)"}}>{active.length}</div>
                    <div style={{fontSize:"11px",color:"var(--rd-gray-text)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Активных</div>
                  </div>
                  <div style={{textAlign:"center",background:"var(--rd-gray-bg)",borderRadius:"12px",padding:"12px 20px"}}>
                    <div style={{fontSize:"22px",fontWeight:900,color:"var(--rd-dark)"}}>{ended.length}</div>
                    <div style={{fontSize:"11px",color:"var(--rd-gray-text)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Завершённых</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="container auction-page">
        {active.length === 0 && ended.length === 0 && (
          <div className="empty-state"><div className="empty-state-icon">🎰</div><div className="empty-state-text">Лотерей пока нет</div></div>
        )}
        {active.length > 0 && (
          <>
            <div style={{fontSize:"13px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--rd-gray-text)",marginBottom:"16px"}}>Активные розыгрыши</div>
            <div className="auction-grid" style={{marginBottom:"40px"}}>
              {active.map(l => (
                <div key={l.id} className="auction-card">
                  {l.image && <div className="auction-img"><img src={l.image} alt={l.name} /></div>}
                  {!l.image && <div className="auction-img"><span>🎰</span></div>}
                  <div className="auction-body">
                    <div className="auction-name">{l.name}</div>
                    {/* Prize block */}
                    <div style={{background:"linear-gradient(135deg, var(--rd-red-light), rgba(199,22,24,0.04))",border:"1.5px solid rgba(199,22,24,0.2)",borderRadius:"12px",padding:"12px 16px",display:"flex",alignItems:"center",gap:"12px"}}>
                      <span style={{fontSize:"28px"}}>🪙</span>
                      <div>
                        <div style={{fontWeight:900,fontSize:"26px",color:"var(--rd-red)",lineHeight:1}}>{l.coins}</div>
                        <div style={{fontSize:"12px",color:"var(--rd-gray-text)",fontWeight:600}}>монет разыгрывается</div>
                      </div>
                      <div style={{marginLeft:"auto",textAlign:"center",background:"#fff",borderRadius:"10px",padding:"8px 14px",border:"1px solid var(--rd-gray-border)"}}>
                        <div style={{fontWeight:900,fontSize:"22px",color:"var(--rd-dark)"}}>{l.participants}</div>
                        <div style={{fontSize:"11px",color:"var(--rd-gray-text)",fontWeight:600}}>победителей</div>
                      </div>
                    </div>
                    {/* Countdown */}
                    <div className="auction-timer-block">
                      <div className="auction-timer-label">⏱ До розыгрыша</div>
                      <LotteryCountdown endsAt={l.endsAt} large />
                      <div style={{fontSize:"11px",color:"rgba(255,255,255,0.4)",marginTop:"4px"}}>{new Date(l.endsAt).toLocaleString("ru-RU")}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {ended.length > 0 && (
          <>
            <div style={{fontSize:"13px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--rd-gray-text)",marginBottom:"16px"}}>Завершённые розыгрыши</div>
            <div className="auction-grid">
              {ended.map(l => (
                <div key={l.id} className="auction-card ended">
                  {l.image && <div className="auction-img"><img src={l.image} alt={l.name} /></div>}
                  {!l.image && <div className="auction-img"><span>🎰</span></div>}
                  <div className="auction-body">
                    <div className="auction-name">{l.name}</div>
                    <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>📅 {new Date(l.endsAt).toLocaleString("ru-RU")}</div>
                    <div style={{fontWeight:700,fontSize:"12px",color:"var(--rd-gray-text)",marginBottom:"4px"}}>🏆 ПОБЕДИТЕЛИ:</div>
                    <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                      {(l.winners || []).map((w, i) => (
                        <div key={i} style={{display:"flex",alignItems:"center",gap:"6px",padding:"6px 12px",background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.2)",borderRadius:"20px",fontSize:"13px"}}>
                          <span>🥇</span><span style={{fontWeight:700}}>{w.user}</span><span style={{color:"var(--rd-red)",fontWeight:700,marginLeft:"auto"}}>+{w.prize} 🪙</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── VOTING ──────────────────────────────────────────────────────────────

function VoteCountdown({ endsAt }) {
  const [diff, setDiff] = React.useState(endsAt - Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setDiff(endsAt - Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  if (diff <= 0) return <span style={{ color: "var(--rd-red)", fontWeight: 700 }}>Завершается...</span>;
  const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000);
  return (
    <span style={{ fontWeight: 800, fontSize: "22px", color: "var(--rd-red)", fontVariantNumeric: "tabular-nums" }}>
      {d > 0 ? `${d}д ` : ""}{String(h).padStart(2,"0")}:{String(m).padStart(2,"0")}:{String(s).padStart(2,"0")}
    </span>
  );
}

// PollFields is defined OUTSIDE VotingAdminTab to prevent cursor loss on re-render
function PollFields({ f, onUpdate, onAddOption, onRemoveOption, onImgChange, onMainImgChange }) {
  const iS = { width: "100%", padding: "10px 14px", border: "1.5px solid var(--rd-gray-border)", borderRadius: "10px", fontSize: "14px", boxSizing: "border-box", background: "#fff" };
  const lS = { fontSize: "12px", fontWeight: 700, color: "var(--rd-gray-text)", marginBottom: "6px", display: "block" };
  return (
    <div style={{ background: "var(--rd-gray-bg)", borderRadius: "var(--rd-radius-sm)", padding: "20px", marginBottom: "16px", border: "1.5px solid var(--rd-gray-border)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div style={{ gridColumn: "1/-1" }}>
          <label style={lS}>Заголовок голосования</label>
          <input style={iS} value={f.title} onChange={e => onUpdate("title", e.target.value)} placeholder="Лучший проект квартала" />
        </div>
        <div style={{ gridColumn: "1/-1" }}>
          <label style={lS}>Описание голосования</label>
          <textarea style={{ ...iS, minHeight: "80px", resize: "vertical" }} value={f.description || ""} onChange={e => onUpdate("description", e.target.value)} placeholder="Подробное описание голосования..." />
        </div>
        <div style={{ gridColumn: "1/-1" }}>
          <label style={lS}>Обложка голосования</label>
          {f.image ? (
            <div style={{ position: "relative", display: "inline-block" }}>
              <img src={f.image} alt="" style={{ maxHeight: "120px", maxWidth: "100%", borderRadius: "10px", border: "1.5px solid var(--rd-gray-border)" }} />
              <button onClick={() => onUpdate("image", "")} style={{ position: "absolute", top: "4px", right: "4px", background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: "22px", height: "22px", color: "#fff", cursor: "pointer", fontSize: "13px" }}>✕</button>
            </div>
          ) : (
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 16px", border: "1.5px dashed var(--rd-gray-border)", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "var(--rd-gray-text)" }}>
              📷 Загрузить фото<input type="file" accept="image/*" style={{ display: "none" }} onChange={e => { if (onMainImgChange) onMainImgChange(e.target.files[0]); e.target.value = ""; }} />
            </label>
          )}
        </div>
        <div>
          <label style={lS}>Голосов у пользователя</label>
          <input type="number" min="1" style={iS} value={f.maxVotes} onChange={e => onUpdate("maxVotes", e.target.value)} />
        </div>
        <div>
          <label style={lS}>Победителей (вариантов)</label>
          <input type="number" min="1" style={iS} value={f.winners} onChange={e => onUpdate("winners", e.target.value)} />
        </div>
        <div>
          <label style={lS}>Монет победителям</label>
          <input type="number" min="0" style={iS} value={f.prize} onChange={e => onUpdate("prize", e.target.value)} />
        </div>
        <div>
          <label style={lS}>Дата завершения</label>
          <input type="datetime-local" style={iS} value={f.endsAt} onChange={e => onUpdate("endsAt", e.target.value)} />
        </div>
        <div style={{ gridColumn: "1/-1" }}>
          <label style={lS}>Варианты</label>
          {f.options.map((opt, idx) => (
            <div key={idx} style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
              <input
                style={{ ...iS, flex: 1 }}
                value={opt.text}
                onChange={e => { const opts = [...f.options]; opts[idx] = { ...opts[idx], text: e.target.value }; onUpdate("options", opts); }}
                placeholder={`Вариант ${idx + 1}`}
              />
              {opt.image ? (
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <img src={opt.image} alt="" style={{ width: "44px", height: "44px", objectFit: "cover", borderRadius: "8px" }} />
                  <button onClick={() => { const opts = [...f.options]; opts[idx] = { ...opts[idx], image: "" }; onUpdate("options", opts); }} style={{ position: "absolute", top: "-6px", right: "-6px", background: "var(--rd-red)", border: "none", borderRadius: "50%", width: "18px", height: "18px", color: "#fff", cursor: "pointer", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                </div>
              ) : (
                <label style={{ width: "44px", height: "44px", border: "1.5px dashed var(--rd-gray-border)", borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", flexShrink: 0 }}>
                  🖼️<input type="file" accept="image/*" style={{ display: "none" }} onChange={e => { onImgChange(idx, e.target.files[0]); e.target.value = ""; }} />
                </label>
              )}
              {f.options.length > 2 && <button onClick={() => onRemoveOption(idx)} style={{ background: "#fff0f0", border: "1.5px solid #fecaca", borderRadius: "8px", padding: "6px 10px", cursor: "pointer", color: "var(--rd-red)", fontWeight: 700, flexShrink: 0 }}>✕</button>}
            </div>
          ))}
          <button onClick={onAddOption} style={{ background: "var(--rd-gray-bg)", border: "1.5px dashed var(--rd-gray-border)", borderRadius: "8px", padding: "8px 16px", cursor: "pointer", fontSize: "13px", fontWeight: 700, width: "100%" }}>+ Добавить вариант</button>
        </div>
      </div>
    </div>
  );
}

function VotingAdminTab({ polls, savePolls, notify, users, saveUsers }) {
  const list = polls || [];
  const emptyForm = { title: "", description: "", image: "", options: [{ text: "", image: "" }, { text: "", image: "" }], maxVotes: 1, winners: 1, prize: 100, endsAt: "" };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminSort, setAdminSort] = useState("newest");

  const handleImgChange = async (setter, idx, file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = async ev => { const c = await compressImage(ev.target.result, 800, 600, 0.82); setter(f => { const opts = [...f.options]; opts[idx] = { ...opts[idx], image: c }; return { ...f, options: opts }; }); };
    r.readAsDataURL(file);
  };

  const handleMainImg = async (setter, file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = async ev => { const c = await compressImage(ev.target.result, 1200, 800, 0.85, 300); setter(f => ({ ...f, image: c })); };
    r.readAsDataURL(file);
  };

  // Stable callbacks via useCallback to prevent focus loss on re-render
  const formUpdate = React.useCallback((key, val) => setForm(f => ({ ...f, [key]: val })), []);
  const formAddOpt = React.useCallback(() => setForm(f => ({ ...f, options: [...f.options, { text: "", image: "" }] })), []);
  const formRemOpt = React.useCallback((idx) => setForm(f => ({ ...f, options: f.options.filter((_, i) => i !== idx) })), []);
  const formImgChg = React.useCallback((idx, file) => handleImgChange(setForm, idx, file), []);
  const formMainImgChg = React.useCallback((file) => handleMainImg(setForm, file), []);

  const editUpdate = React.useCallback((key, val) => setEditForm(f => f ? ({ ...f, [key]: val }) : f), []);
  const editAddOpt = React.useCallback(() => setEditForm(f => f ? ({ ...f, options: [...f.options, { text: "", image: "" }] }) : f), []);
  const editRemOpt = React.useCallback((idx) => setEditForm(f => f ? ({ ...f, options: f.options.filter((_, i) => i !== idx) }) : f), []);
  const editImgChg = React.useCallback((idx, file) => handleImgChange(setEditForm, idx, file), []);
  const editMainImgChg = React.useCallback((file) => handleMainImg(setEditForm, file), []);

  const createPoll = () => {
    if (!form.title.trim()) { notify("Введите заголовок", "err"); return; }
    if (form.options.some(o => !o.text.trim())) { notify("Заполните все варианты", "err"); return; }
    if (!form.endsAt) { notify("Укажите дату завершения", "err"); return; }
    const newPoll = { id: Date.now(), title: form.title.trim(), description: form.description || "", image: form.image || "", options: form.options.map((o, i) => ({ ...o, id: i, votes: [] })), maxVotes: parseInt(form.maxVotes) || 1, winners: parseInt(form.winners) || 1, prize: parseInt(form.prize) || 0, endsAt: new Date(form.endsAt).getTime(), status: "active", winnersAwarded: false, createdAt: Date.now() };
    savePolls([...list, newPoll]);
    setForm(emptyForm);
    notify("Голосование создано ✓");
  };

  const saveEdit = () => {
    if (!editForm || !editForm.title.trim()) { notify("Введите заголовок", "err"); return; }
    const updated = list.map(p => p.id === editingId ? { ...p, title: editForm.title, description: editForm.description || "", image: editForm.image || "", options: editForm.options.map((o, i) => ({ ...o, id: i, votes: p.options[i]?.votes || [] })), maxVotes: parseInt(editForm.maxVotes), winners: parseInt(editForm.winners), prize: parseInt(editForm.prize), endsAt: new Date(editForm.endsAt).getTime() } : p);
    savePolls(updated); setEditingId(null); setEditForm(null); notify("Голосование обновлено ✓");
  };

  const deletePoll = (id) => { savePolls(list.filter(p => p.id !== id)); notify("Голосование удалено"); };

  const awardWinners = (poll) => {
    const sorted = [...poll.options].sort((a, b) => (b.votes || []).length - (a.votes || []).length);
    if (!sorted[0]?.votes?.length) { notify("Никто не проголосовал", "err"); return; }
    const winnerOptions = sorted.slice(0, poll.winners);
    const allWinners = winnerOptions.flatMap(o => o.votes || []);
    const unique = [...new Set(allWinners)];
    const prizePerUser = unique.length > 0 ? Math.floor(poll.prize / unique.length) : 0;
    if (prizePerUser > 0) {
      const newUsers = { ...users };
      unique.forEach(u => { if (newUsers[u]) newUsers[u] = { ...newUsers[u], balance: (newUsers[u].balance || 0) + prizePerUser }; });
      saveUsers(newUsers);
    }
    savePolls(list.map(p => p.id === poll.id ? { ...p, status: "ended", winnersAwarded: true, awardedUsers: unique, prizePerUser } : p));
    notify(`Монеты начислены ${unique.length} победителям (+${prizePerUser} 🪙)`);
    // Telegram + Max notification
    try {
      const ap = storage.get("cm_appearance") || {};
      const integ2 = ap.integrations || {};
      const msg = `🗳️ <b>Голосование завершено!</b>\n\n📋 ${poll.title}\n🏆 Победители: ${unique.join(", ")}\n💰 Награда: +${prizePerUser} монет каждому\n📅 ${new Date().toLocaleString("ru-RU")}`;
      if (integ2.tgEnabled && integ2.tgBotToken && integ2.tgChatId) {
        fetch('/api/telegram', { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ token: integ2.tgBotToken.trim(), chat_id: integ2.tgChatId.trim(), text: msg, parse_mode: "HTML" }) }).catch(() => {});
      }
      if (integ2.maxEnabled && integ2.maxBotToken && integ2.maxChatId) {
        fetch('/api/max', { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ token: integ2.maxBotToken.trim(), chat_id: integ2.maxChatId.trim(), text: msg }) }).catch(() => {});
      }
    } catch {}
  };

  const now = Date.now();

  const filteredList = list.filter(p => !adminSearch || p.title.toLowerCase().includes(adminSearch.toLowerCase()))
    .sort((a, b) => adminSort === "newest" ? (b.createdAt || b.id) - (a.createdAt || a.id) : (a.createdAt || a.id) - (b.createdAt || b.id));

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "16px" }}>➕ Создать голосование</div>
      <PollFields
        f={form}
        onUpdate={formUpdate}
        onAddOption={formAddOpt}
        onRemoveOption={formRemOpt}
        onImgChange={formImgChg}
        onMainImgChange={formMainImgChg}
      />
      <button onClick={createPoll} className="admin-red-btn" style={{ marginBottom: "28px", background: "var(--rd-red)", color: "#fff", border: "none", borderRadius: "10px", padding: "12px 24px", fontWeight: 700, cursor: "pointer", fontSize: "14px", width: "100%" }}>🗳️ Создать голосование</button>

      {list.length > 0 && (
        <div style={{display:"flex",gap:"10px",marginBottom:"16px",flexWrap:"wrap",alignItems:"center"}}>
          <input className="form-input" placeholder="🔍 Поиск по названию..." value={adminSearch} onChange={e => setAdminSearch(e.target.value)} style={{flex:"1 1 200px",minWidth:"160px",padding:"8px 14px",fontSize:"13px"}} />
          <select className="form-input" value={adminSort} onChange={e => setAdminSort(e.target.value)} style={{flex:"0 0 auto",padding:"8px 14px",fontSize:"13px",minWidth:"160px"}}>
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала старые</option>
          </select>
        </div>
      )}

      {filteredList.length === 0 && list.length > 0 && <div style={{ color: "var(--rd-gray-text)", textAlign: "center", padding: "20px", fontSize: "14px" }}>Ничего не найдено</div>}
      {list.length === 0 && <div style={{ color: "var(--rd-gray-text)", textAlign: "center", padding: "20px", fontSize: "14px" }}>Голосований пока нет</div>}
      {filteredList.map(poll => (
        <div key={poll.id} style={{ border: "1.5px solid var(--rd-gray-border)", borderRadius: "var(--rd-radius-sm)", padding: "16px", marginBottom: "12px", background: "#fff" }}>
          {editingId === poll.id && editForm ? (
            <div>
              <PollFields
                f={editForm}
                onUpdate={editUpdate}
                onAddOption={editAddOpt}
                onRemoveOption={editRemOpt}
                onImgChange={editImgChg}
                onMainImgChange={editMainImgChg}
              />
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={saveEdit} className="admin-red-btn" style={{ background: "var(--rd-red)", color: "#fff", border: "none", borderRadius: "8px", padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Сохранить</button>
                <button onClick={() => { setEditingId(null); setEditForm(null); }} style={{ background: "var(--rd-gray-bg)", border: "1.5px solid var(--rd-gray-border)", borderRadius: "8px", padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Отмена</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "15px" }}>{poll.title}</div>
                  {poll.description && <div style={{ fontSize: "13px", color: "var(--rd-gray-text)", marginTop: "2px" }}>{poll.description}</div>}
                  <div style={{ fontSize: "12px", color: "var(--rd-gray-text)", marginTop: "4px" }}>📅 {new Date(poll.endsAt).toLocaleString("ru-RU")} · {poll.maxVotes} голос(а) · 🏆 {poll.winners} победителей · 💰 {poll.prize} монет</div>
                  <div style={{ fontSize: "12px", color: poll.status === "active" ? "#22c55e" : "var(--rd-gray-text)", fontWeight: 700, marginTop: "4px" }}>{poll.status === "active" ? "✅ Активно" : "🏁 Завершено"}</div>
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                  {poll.status === "active" && now > poll.endsAt && !poll.winnersAwarded && (
                    <button onClick={() => awardWinners(poll)} className="admin-red-btn" style={{ background: "var(--rd-red)", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: "13px" }}>🏆 Наградить</button>
                  )}
                  {poll.status === "active" && (
                    <button onClick={() => { const endsAtLocal = new Date(poll.endsAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16); setEditingId(poll.id); setEditForm({ title: poll.title, description: poll.description || "", image: poll.image || "", options: poll.options.map(o => ({ text: o.text, image: o.image || "" })), maxVotes: String(poll.maxVotes), winners: String(poll.winners), prize: String(poll.prize), endsAt: endsAtLocal }); }} style={{ background: "var(--rd-gray-bg)", border: "1.5px solid var(--rd-gray-border)", borderRadius: "8px", padding: "8px 12px", cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>✏️</button>
                  )}
                  <button onClick={() => deletePoll(poll.id)} style={{ background: "#fff0f0", border: "1.5px solid #fecaca", borderRadius: "8px", padding: "8px 12px", cursor: "pointer", fontSize: "13px", color: "var(--rd-red)", fontWeight: 700 }}>🗑️</button>
                </div>
              </div>
              <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "8px" }}>
                {poll.options.map((opt, i) => {
                  const total = poll.options.reduce((s, o) => s + (o.votes || []).length, 0);
                  const pct = total > 0 ? Math.round(((opt.votes || []).length / total) * 100) : 0;
                  return (
                    <div key={i} style={{ border: "1px solid var(--rd-gray-border)", borderRadius: "8px", padding: "10px", background: "var(--rd-gray-bg)", fontSize: "13px" }}>
                      {opt.image && <img src={opt.image} alt="" style={{ width: "100%", height: "60px", objectFit: "cover", borderRadius: "6px", marginBottom: "6px" }} />}
                      <div style={{ fontWeight: 600 }}>{opt.text}</div>
                      <div style={{ fontSize: "11px", color: "var(--rd-gray-text)", marginTop: "4px" }}>{(opt.votes || []).length} голосов ({pct}%)</div>
                      <div style={{ height: "4px", background: "#e5e7eb", borderRadius: "2px", marginTop: "6px" }}><div style={{ height: "100%", width: `${pct}%`, background: "var(--rd-red)", borderRadius: "2px" }} /></div>
                    </div>
                  );
                })}
              </div>
              {poll.winnersAwarded && (
                <div style={{ marginTop: "10px", padding: "10px 14px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: "8px", fontSize: "13px" }}>
                  🏆 Награда выдана: {(poll.awardedUsers || []).join(", ")} (+{poll.prizePerUser} 🪙 каждому)
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function VotingPage({ polls, savePolls, currentUser, users, saveUsers, notify, currency, appearance }) {
  const list = polls || [];
  const now = Date.now();
  const active = list.filter(p => p.status === "active").sort((a, b) => a.endsAt - b.endsAt);
  const ended = list.filter(p => p.status === "ended").sort((a, b) => b.endsAt - a.endsAt);
  const [openPollId, setOpenPollId] = useState(null);
  const sectionSettings = appearance?.sectionSettings?.voting || {};
  const title = sectionSettings.title || "Голосование";
  const description = sectionSettings.description || "Участвуйте в опросах и влияйте на решения";
  const bannerImage = sectionSettings.banner || "";

  const getUserVotes = (poll) => {
    if (!currentUser) return [];
    return poll.options.reduce((acc, opt) => { if ((opt.votes || []).includes(currentUser)) acc.push(opt.id); return acc; }, []);
  };

  const vote = (poll, optionId) => {
    if (!currentUser) { notify("Войдите, чтобы голосовать", "err"); return; }
    if (now > poll.endsAt) { notify("Голосование завершено", "err"); return; }
    const myVotes = getUserVotes(poll);
    const isVoted = myVotes.includes(optionId);
    if (!isVoted && myVotes.length >= poll.maxVotes) { notify(`У вас только ${poll.maxVotes} голос(а)`, "err"); return; }
    const updated = list.map(p => {
      if (p.id !== poll.id) return p;
      const newOptions = p.options.map(o => {
        if (o.id !== optionId) return o;
        const votes = o.votes || [];
        return { ...o, votes: isVoted ? votes.filter(v => v !== currentUser) : [...votes, currentUser] };
      });
      return { ...p, options: newOptions };
    });
    savePolls(updated);
    if (!isVoted) notify("Голос принят ✓");
  };

  const openPoll = openPollId ? list.find(p => p.id === openPollId) : null;

  return (
    <div style={{ minHeight: "60vh" }}>
      {bannerImage ? (
        <div className="section-banner-wrap">
          <div className="hero-banner">
            <div className="hero-banner-bg" style={{backgroundImage:`url(${bannerImage})`}} />
            <div className="hero-banner-overlay" />
            <div className="hero-banner-content" style={{padding:"48px 24px"}}>
              <h1 className="hero-banner-title" style={{fontSize:"clamp(26px,5vw,40px)",marginBottom:"12px"}}>{title}</h1>
              <p className="hero-banner-desc">{description}</p>
            </div>
          </div>
          {list.length > 0 && (
            <div className="section-banner-stats-overlay">
              <div className="section-banner-stat">
                <div className="section-banner-stat-num" style={{color:"#ff6b6b"}}>{active.length}</div>
                <div className="section-banner-stat-label">Активных</div>
              </div>
              <div className="section-banner-stat">
                <div className="section-banner-stat-num" style={{color:"#fff"}}>{ended.length}</div>
                <div className="section-banner-stat-label">Завершённых</div>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {!bannerImage && (
        <div style={{background:"#fff",borderBottom:"1.5px solid var(--rd-gray-border)",padding:"40px 0 32px"}}>
          <div className="container">
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"12px"}}>
              <div>
                <h1 style={{fontSize:"clamp(26px,5vw,40px)",fontWeight:900,color:"var(--rd-dark)",letterSpacing:"-0.02em"}}>{title}</h1>
                <p style={{fontSize:"15px",color:"var(--rd-gray-text)",marginTop:"6px"}}>{description}</p>
              </div>
              {list.length > 0 && (
                <div style={{display:"flex",gap:"16px",flexWrap:"wrap",marginLeft:"auto"}}>
                  <div style={{textAlign:"center",background:"var(--rd-gray-bg)",borderRadius:"12px",padding:"12px 20px"}}>
                    <div style={{fontSize:"22px",fontWeight:900,color:"var(--rd-red)"}}>{active.length}</div>
                    <div style={{fontSize:"11px",color:"var(--rd-gray-text)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Активных</div>
                  </div>
                  <div style={{textAlign:"center",background:"var(--rd-gray-bg)",borderRadius:"12px",padding:"12px 20px"}}>
                    <div style={{fontSize:"22px",fontWeight:900,color:"var(--rd-dark)"}}>{ended.length}</div>
                    <div style={{fontSize:"11px",color:"var(--rd-gray-text)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Завершённых</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="container auction-page">
        {active.length === 0 && ended.length === 0 && (
          <div className="empty-state"><div className="empty-state-icon">🗳️</div><div className="empty-state-text">Голосований пока нет</div></div>
        )}
        {active.length > 0 && (
          <>
            <div style={{fontSize:"13px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--rd-gray-text)",marginBottom:"16px"}}>Активные голосования</div>
            <div className="auction-grid" style={{marginBottom:"40px"}}>
              {active.map(poll => {
                const total = poll.options.reduce((s, o) => s + (o.votes || []).length, 0);
                return (
                  <div key={poll.id} className="auction-card" style={{cursor:"pointer"}} onClick={() => setOpenPollId(poll.id)}>
                    {poll.image ? <div className="auction-img"><img src={poll.image} alt={poll.title} /></div> : <div className="auction-img"><span>🗳️</span></div>}
                    <div className="auction-body">
                      <div className="auction-name">{poll.title}</div>
                      {poll.description && <div style={{fontSize:"13px",color:"var(--rd-gray-text)",lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{poll.description}</div>}
                      <div style={{display:"flex",gap:"12px",fontSize:"12px",color:"var(--rd-gray-text)"}}>
                        <span><CurrencyIcon currency={currency} size={14} /> {poll.prize} {getCurrName(currency)}</span>
                        <span>🗳️ {total} голосов</span>
                        <span>📊 {poll.options.length} вариантов</span>
                      </div>
                      <div className="auction-timer-block">
                        <div className="auction-timer-label">⏱ До завершения</div>
                        <VoteCountdown endsAt={poll.endsAt} />
                      </div>
                      <button className="btn btn-primary" style={{width:"100%"}} onClick={e => { e.stopPropagation(); setOpenPollId(poll.id); }}>Подробнее</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {ended.length > 0 && (
          <>
            <div style={{fontSize:"13px",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--rd-gray-text)",marginBottom:"16px"}}>Завершённые голосования</div>
            <div className="auction-grid">
              {ended.map(poll => {
                const total = poll.options.reduce((s, o) => s + (o.votes || []).length, 0);
                const sorted = [...poll.options].sort((a, b) => (b.votes || []).length - (a.votes || []).length);
                return (
                  <div key={poll.id} className="auction-card ended" style={{cursor:"pointer"}} onClick={() => setOpenPollId(poll.id)}>
                    {poll.image ? <div className="auction-img"><img src={poll.image} alt={poll.title} /></div> : <div className="auction-img"><span>🗳️</span></div>}
                    <div className="auction-body">
                      <div className="auction-name">{poll.title}</div>
                      <div style={{fontSize:"12px",color:"var(--rd-gray-text)"}}>📅 Завершено {new Date(poll.endsAt).toLocaleString("ru-RU")}</div>
                      {poll.winnersAwarded && (
                        <div style={{padding:"8px 12px",background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.2)",borderRadius:"8px",fontSize:"12px"}}>
                          🏆 {(poll.awardedUsers || []).join(", ")} (+{poll.prizePerUser} {getCurrName(currency)})
                        </div>
                      )}
                      <button className="btn btn-secondary" style={{width:"100%"}} onClick={e => { e.stopPropagation(); setOpenPollId(poll.id); }}>Подробнее</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Modal for voting */}
      {openPoll && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}} onClick={() => setOpenPollId(null)}>
          <div style={{background:"#fff",borderRadius:"var(--rd-radius)",maxWidth:"680px",width:"100%",maxHeight:"90vh",overflow:"auto",boxShadow:"0 25px 50px rgba(0,0,0,0.25)"}} onClick={e => e.stopPropagation()}>
            {openPoll.image && <img src={openPoll.image} alt="" style={{width:"100%",height:"220px",objectFit:"cover",display:"block",borderRadius:"var(--rd-radius) var(--rd-radius) 0 0"}} />}
            <div style={{padding:"28px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"16px"}}>
                <div>
                  <div style={{fontWeight:900,fontSize:"22px",color:"var(--rd-dark)"}}>{openPoll.title}</div>
                  {openPoll.description && <div style={{fontSize:"14px",color:"var(--rd-gray-text)",marginTop:"6px",lineHeight:1.6}}>{openPoll.description}</div>}
                </div>
                <button onClick={() => setOpenPollId(null)} style={{background:"var(--rd-gray-bg)",border:"none",borderRadius:"50%",width:"36px",height:"36px",cursor:"pointer",fontSize:"18px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>✕</button>
              </div>
              {(() => {
                const myVotes = getUserVotes(openPoll);
                const total = openPoll.options.reduce((s, o) => s + (o.votes || []).length, 0);
                const votesLeft = openPoll.maxVotes - myVotes.length;
                const isEnded = openPoll.status !== "active";
                const optionsToShow = isEnded ? [...openPoll.options].sort((a, b) => (b.votes || []).length - (a.votes || []).length) : openPoll.options;
                return (
                  <>
                    {!isEnded && (
                      <div style={{display:"flex",gap:"10px",marginBottom:"20px",flexWrap:"wrap"}}>
                        <div style={{padding:"8px 14px",background:"linear-gradient(135deg, var(--rd-red-light), rgba(199,22,24,0.04))",border:"1.5px solid rgba(199,22,24,0.25)",borderRadius:"8px",fontSize:"13px",fontWeight:700}}><CurrencyIcon currency={currency} size={14} /> {openPoll.prize} {getCurrName(currency)}</div>
                        <div style={{padding:"8px 14px",background:votesLeft>0?"rgba(34,197,94,0.08)":"var(--rd-gray-bg)",border:`1.5px solid ${votesLeft>0?"rgba(34,197,94,0.3)":"var(--rd-gray-border)"}`,borderRadius:"8px",fontSize:"13px",fontWeight:700}}>🗳️ {votesLeft} / {openPoll.maxVotes} голосов</div>
                      </div>
                    )}
                    {openPoll.winnersAwarded && (
                      <div style={{padding:"12px 16px",background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.2)",borderRadius:"10px",fontSize:"14px",marginBottom:"20px"}}>
                        🏆 Награда выдана: {(openPoll.awardedUsers || []).join(", ")} (+{openPoll.prizePerUser} {getCurrName(currency)})
                      </div>
                    )}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))",gap:"12px"}}>
                      {optionsToShow.map((opt, idx) => {
                        const isVoted = myVotes.includes(opt.id);
                        const voteCnt = (opt.votes || []).length;
                        const pct = total > 0 ? Math.round((voteCnt / total) * 100) : 0;
                        const canVote = !isVoted && votesLeft > 0 && !isEnded;
                        const isWinner = isEnded && idx < openPoll.winners;
                        return (
                          <div key={opt.id} style={{border:`2px solid ${isWinner?"gold":isVoted?"var(--rd-red)":"var(--rd-gray-border)"}`,borderRadius:"14px",overflow:"hidden",background:isWinner?"rgba(250,204,21,0.05)":isVoted?"var(--rd-red-light)":"#fff",transition:"all 0.2s"}}>
                            {opt.image && <img src={opt.image} alt="" style={{width:"100%",height:"100px",objectFit:"cover",display:"block"}} />}
                            <div style={{padding:"12px"}}>
                              <div style={{fontWeight:700,fontSize:"14px",marginBottom:"8px"}}>{isWinner?"🥇 ":""}{opt.text}</div>
                              <div style={{marginBottom:"10px"}}>
                                <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px",color:"var(--rd-gray-text)",marginBottom:"4px"}}>
                                  <span>{voteCnt} голосов</span><span>{pct}%</span>
                                </div>
                                <div style={{height:"6px",background:"#e5e7eb",borderRadius:"3px"}}>
                                  <div style={{height:"100%",width:`${pct}%`,background:isWinner?"#eab308":isVoted?"var(--rd-red)":"#94a3b8",borderRadius:"3px",transition:"width 0.4s"}} />
                                </div>
                              </div>
                              {!isEnded && (isVoted ? (
                                <button onClick={() => vote(openPoll, opt.id)} style={{width:"100%",padding:"8px",background:"var(--rd-red)",color:"#fff",border:"none",borderRadius:"8px",fontWeight:700,fontSize:"13px",cursor:"pointer"}}>
                                  ✓ Отменить
                                </button>
                              ) : (
                                <button onClick={() => vote(openPoll, opt.id)} disabled={!canVote} style={{width:"100%",padding:"8px",background:canVote?"var(--rd-dark)":"#e5e7eb",color:canVote?"#fff":"#9ca3af",border:"none",borderRadius:"8px",fontWeight:700,fontSize:"13px",cursor:canVote?"pointer":"not-allowed",transition:"all 0.2s"}}
                                  onMouseEnter={e=>{if(canVote)e.currentTarget.style.background="var(--rd-red)"}}
                                  onMouseLeave={e=>{if(canVote)e.currentTarget.style.background="var(--rd-dark)"}}>
                                  🗳️ Голосовать
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BANK ──────────────────────────────────────────────────────────────

function BankAdminTab({ deposits, saveDeposits, notify }) {
  const [form, setForm] = useState({ name: "", duration: "", rate: "", image: "" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [historyView, setHistoryView] = useState(false);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminSort, setAdminSort] = useState("newest");

  const handleImage = async (e, setter) => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = async ev => {
      const compressed = await compressImage(ev.target.result, 1200, 800, 0.85, 250);
      setter(compressed);
    };
    r.readAsDataURL(file);
    e.target.value = "";
  };

  const createDeposit = () => {
    if (!form.name.trim()) { notify("Введите название вклада", "err"); return; }
    if (!form.duration || parseInt(form.duration) <= 0) { notify("Введите срок вклада (в днях)", "err"); return; }
    if (!form.rate || parseFloat(form.rate) <= 0) { notify("Введите процентную ставку", "err"); return; }
    const newDeposit = {
      id: Date.now(),
      name: form.name.trim(),
      duration: parseInt(form.duration),
      rate: parseFloat(form.rate),
      image: form.image || "",
      createdAt: Date.now()
    };
    saveDeposits([...deposits, newDeposit]);
    setForm({ name: "", duration: "", rate: "", image: "" });
    notify("Вклад создан ✓");
  };

  const saveEdit = () => {
    if (!editForm || !editForm.name.trim()) { notify("Введите название", "err"); return; }
    const updated = deposits.map(d => d.id === editingId ? { ...d, name: editForm.name, duration: parseInt(editForm.duration), rate: parseFloat(editForm.rate), image: editForm.image || "" } : d);
    saveDeposits(updated);
    setEditingId(null);
    setEditForm(null);
    notify("Вклад обновлён ✓");
  };

  const deleteDeposit = (id) => {
    if (!confirm("Удалить этот вклад?")) return;
    saveDeposits(deposits.filter(d => d.id !== id));
    notify("Вклад удалён");
  };

  const sorted = [...deposits].sort((a, b) => adminSort === "newest" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt);
  const filtered = sorted.filter(d => !adminSearch || d.name.toLowerCase().includes(adminSearch.toLowerCase()));

  const inputStyle = { width: "100%", padding: "10px 14px", border: "1.5px solid var(--rd-gray-border)", borderRadius: "10px", fontSize: "14px", boxSizing: "border-box", background: "#fff" };
  const labelStyle = { fontSize: "12px", fontWeight: 700, color: "var(--rd-gray-text)", marginBottom: "6px", display: "block" };

  return (
    <div>
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
        <button onClick={() => setHistoryView(false)} style={{ padding: "8px 18px", borderRadius: "10px", border: "1.5px solid var(--rd-gray-border)", background: !historyView ? "var(--rd-red)" : "#fff", color: !historyView ? "#fff" : "var(--rd-dark)", fontWeight: 700, cursor: "pointer" }}>Управление</button>
        <button onClick={() => setHistoryView(true)} style={{ padding: "8px 18px", borderRadius: "10px", border: "1.5px solid var(--rd-gray-border)", background: historyView ? "var(--rd-red)" : "#fff", color: historyView ? "#fff" : "var(--rd-dark)", fontWeight: 700, cursor: "pointer" }}>Все вклады</button>
      </div>

      {deposits.length > 0 && (
        <div style={{display:"flex",gap:"10px",marginBottom:"16px",flexWrap:"wrap",alignItems:"center"}}>
          <input className="form-input" placeholder="🔍 Поиск по названию..." value={adminSearch} onChange={e => setAdminSearch(e.target.value)} style={{flex:"1 1 200px",minWidth:"160px",padding:"8px 14px",fontSize:"13px"}} />
          <select className="form-input" value={adminSort} onChange={e => setAdminSort(e.target.value)} style={{flex:"0 0 auto",padding:"8px 14px",fontSize:"13px",minWidth:"160px"}}>
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала старые</option>
          </select>
        </div>
      )}

      {!historyView && (
        <>
          <div style={{ background: "var(--rd-gray-bg)", borderRadius: "var(--rd-radius-sm)", padding: "20px", marginBottom: "24px", border: "1.5px solid var(--rd-gray-border)" }}>
            <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "16px" }}>➕ Создать вклад</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ gridColumn: "1/-1" }}><label style={labelStyle}>Название вклада</label><input style={inputStyle} placeholder="Премиальный вклад" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><label style={labelStyle}>Срок (дней)</label><input type="number" style={inputStyle} placeholder="30" value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })} /></div>
              <div><label style={labelStyle}>Ставка (%)</label><input type="number" step="0.1" style={inputStyle} placeholder="5.0" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} /></div>
              <div style={{ gridColumn: "1/-1" }}>
                <label style={labelStyle}>Фото</label>
                {form.image ? (
                  <div style={{ position: "relative", display: "inline-block" }}>
                    <img src={form.image} alt="" style={{ maxHeight: "120px", maxWidth: "100%", borderRadius: "10px", border: "1.5px solid var(--rd-gray-border)" }} />
                    <button onClick={() => setForm(f => ({ ...f, image: "" }))} style={{ position: "absolute", top: "4px", right: "4px", background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: "22px", height: "22px", color: "#fff", cursor: "pointer", fontSize: "13px" }}>✕</button>
                  </div>
                ) : (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 16px", border: "1.5px dashed var(--rd-gray-border)", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "var(--rd-gray-text)" }}>
                    📷 Загрузить фото
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleImage(e, img => setForm(f => ({ ...f, image: img })))} />
                  </label>
                )}
              </div>
            </div>
            <button onClick={createDeposit} className="admin-red-btn" style={{ marginTop: "16px", background: "var(--rd-red)", color: "#fff", border: "none", borderRadius: "10px", padding: "12px 24px", fontWeight: 700, cursor: "pointer", fontSize: "14px", width: "100%" }}>
              🏦 Создать вклад
            </button>
          </div>

          {filtered.length > 0 && <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "12px", color: "var(--rd-dark)" }}>Активные вклады</div>}
          {filtered.map(deposit => (
            <div key={deposit.id} style={{ border: "1.5px solid var(--rd-gray-border)", borderRadius: "var(--rd-radius-sm)", padding: "16px", marginBottom: "12px", background: "#fff" }}>
              {editingId === deposit.id && editForm ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div style={{ gridColumn: "1/-1" }}><label style={labelStyle}>Название</label><input style={inputStyle} value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></div>
                  <div><label style={labelStyle}>Срок (дней)</label><input type="number" style={inputStyle} value={editForm.duration} onChange={e => setEditForm({ ...editForm, duration: e.target.value })} /></div>
                  <div><label style={labelStyle}>Ставка (%)</label><input type="number" step="0.1" style={inputStyle} value={editForm.rate} onChange={e => setEditForm({ ...editForm, rate: e.target.value })} /></div>
                  <div style={{ gridColumn: "1/-1" }}>
                    {editForm.image ? (
                      <div style={{ position: "relative", display: "inline-block" }}>
                        <img src={editForm.image} alt="" style={{ maxHeight: "100px", maxWidth: "100%", borderRadius: "10px", border: "1.5px solid var(--rd-gray-border)" }} />
                        <button onClick={() => setEditForm(f => ({ ...f, image: "" }))} style={{ position: "absolute", top: "4px", right: "4px", background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: "22px", height: "22px", color: "#fff", cursor: "pointer", fontSize: "13px" }}>✕</button>
                      </div>
                    ) : (
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 14px", border: "1.5px dashed var(--rd-gray-border)", borderRadius: "10px", cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "var(--rd-gray-text)" }}>
                        📷 Загрузить фото
                        <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleImage(e, img => setEditForm(f => ({ ...f, image: img })))} />
                      </label>
                    )}
                  </div>
                  <div style={{ gridColumn: "1/-1", display: "flex", gap: "8px" }}>
                    <button onClick={saveEdit} className="admin-red-btn" style={{ background: "var(--rd-red)", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 18px", fontWeight: 700, cursor: "pointer" }}>Сохранить</button>
                    <button onClick={() => { setEditingId(null); setEditForm(null); }} style={{ background: "var(--rd-gray-bg)", border: "1.5px solid var(--rd-gray-border)", borderRadius: "8px", padding: "8px 18px", fontWeight: 700, cursor: "pointer" }}>Отмена</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                  {deposit.image ? <img src={deposit.image} alt="" style={{ width: "70px", height: "70px", objectFit: "cover", borderRadius: "10px", flexShrink: 0 }} /> : <div style={{ width: "56px", height: "40px", background: "var(--rd-gray-bg)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px" }}>🏦</div>}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: "15px" }}>{deposit.name}</div>
                    <div style={{ fontSize: "13px", color: "var(--rd-gray-text)", marginTop: "4px" }}>
                      📅 {deposit.duration} дней · 📈 {deposit.rate}% годовых
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                    <button onClick={() => { setEditingId(deposit.id); setEditForm({ name: deposit.name, duration: String(deposit.duration), rate: String(deposit.rate), image: deposit.image || "" }); }} style={{ background: "var(--rd-gray-bg)", border: "1.5px solid var(--rd-gray-border)", borderRadius: "8px", padding: "8px 12px", cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>✏️</button>
                    <button onClick={() => deleteDeposit(deposit.id)} style={{ background: "#fff0f0", border: "1.5px solid #fecaca", borderRadius: "8px", padding: "8px 12px", cursor: "pointer", fontSize: "13px", color: "var(--rd-red)", fontWeight: 700 }}>🗑️</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && <div style={{ color: "var(--rd-gray-text)", textAlign: "center", padding: "20px", fontSize: "14px" }}>Вкладов пока нет</div>}
        </>
      )}

      {historyView && (
        <div>
          {filtered.length === 0 && <div style={{ color: "var(--rd-gray-text)", textAlign: "center", padding: "40px", fontSize: "14px" }}>Вкладов пока нет</div>}
          {filtered.map(deposit => (
            <div key={deposit.id} style={{ border: "1.5px solid var(--rd-gray-border)", borderRadius: "var(--rd-radius-sm)", padding: "16px", marginBottom: "12px", background: "#fff" }}>
              <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                {deposit.image ? <img src={deposit.image} alt="" style={{ width: "70px", height: "70px", objectFit: "cover", borderRadius: "10px", flexShrink: 0 }} /> : <div style={{ width: "56px", height: "40px", background: "var(--rd-gray-bg)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px" }}>🏦</div>}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "15px" }}>{deposit.name}</div>
                  <div style={{ fontSize: "13px", color: "var(--rd-gray-text)", marginTop: "4px" }}>📅 {deposit.duration} дней · 📈 {deposit.rate}% годовых</div>
                  <div style={{ fontSize: "12px", color: "var(--rd-gray-text)", marginTop: "2px" }}>🕐 Создан: {new Date(deposit.createdAt).toLocaleString("ru-RU")}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BankPage({ deposits, userDeposits, saveUserDeposits, currentUser, users, saveUsers, notify, currency, appearance }) {
  const [modalDeposit, setModalDeposit] = useState(null); // deposit object shown in modal
  const [amount, setAmount] = useState("");
  const cName = getCurrName(currency);
  const myBalance = users[currentUser]?.balance || 0;
  const sectionSettings = appearance?.sectionSettings?.bank || {};
  const bankTitle = sectionSettings.title || "Банк";
  const bankDescription = sectionSettings.description || "Откройте вклад и получайте проценты";
  const bankBannerImage = sectionSettings.banner || "";

  // Проверяем и завершаем истекшие вклады
  React.useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const toComplete = userDeposits.filter(ud => ud.status === "active" && now >= ud.endsAt);
      if (toComplete.length > 0) {
        const newUsers = { ...users };
        const completed = [];
        toComplete.forEach(ud => {
          if (newUsers[ud.user]) {
            const profit = Math.round(ud.amount * ud.rate / 100);
            const total = ud.amount + profit;
            newUsers[ud.user].balance = (newUsers[ud.user].balance || 0) + total;
            completed.push({ ...ud, status: "completed", completedAt: now });
          }
        });
        if (completed.length > 0) {
          saveUsers(newUsers);
          const updated = userDeposits.map(ud => {
            const comp = completed.find(c => c.id === ud.id);
            return comp || ud;
          });
          saveUserDeposits(updated);
          notify(`Вклад завершён! Начислено ${completed.reduce((s, c) => s + Math.round(c.amount * c.rate / 100) + c.amount, 0)} ${cName}`, "success");
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [userDeposits, users]);

  const myActiveDeposits = userDeposits.filter(ud => ud.user === currentUser && ud.status === "active");
  const myCompletedDeposits = userDeposits.filter(ud => ud.user === currentUser && ud.status === "completed");

  const openDeposit = () => {
    if (!modalDeposit) return;
    const amt = parseInt(amount);
    if (!amt || amt <= 0) { notify("Введите сумму", "err"); return; }
    if (amt > myBalance) { notify("Недостаточно средств", "err"); return; }

    const newDep = {
      id: Date.now(),
      user: currentUser,
      depositId: modalDeposit.id,
      depositName: modalDeposit.name,
      amount: amt,
      rate: modalDeposit.rate,
      duration: modalDeposit.duration,
      createdAt: Date.now(),
      endsAt: Date.now() + (modalDeposit.duration * 86400000),
      status: "active"
    };

    const newUsers = { ...users };
    newUsers[currentUser].balance -= amt;
    saveUsers(newUsers);
    saveUserDeposits([...userDeposits, newDep]);
    setModalDeposit(null);
    setAmount("");
    notify("Вклад открыт ✓");
  };

  const modalEndsAt = amount && parseInt(amount) > 0 && modalDeposit
    ? new Date(Date.now() + modalDeposit.duration * 86400000).toLocaleDateString("ru-RU")
    : null;
  const modalProfit = amount && parseInt(amount) > 0 && modalDeposit
    ? Math.round(parseInt(amount) * modalDeposit.rate / 100)
    : 0;

  return (
    <div style={{ minHeight: "60vh" }}>
      {/* Модальное окно открытия вклада */}
      {modalDeposit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }} onClick={() => { setModalDeposit(null); setAmount(""); }}>
          <div style={{ background: "#fff", borderRadius: "var(--rd-radius)", padding: "28px", maxWidth: "420px", width: "100%", boxShadow: "var(--rd-shadow-lg)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: "20px", color: "var(--rd-dark)", marginBottom: "4px" }}>{modalDeposit.name}</div>
                <div style={{ fontSize: "13px", color: "var(--rd-gray-text)" }}>📅 {modalDeposit.duration} дней · 📈 {modalDeposit.rate}% годовых</div>
              </div>
              <button onClick={() => { setModalDeposit(null); setAmount(""); }} style={{ background: "var(--rd-gray-bg)", border: "1.5px solid var(--rd-gray-border)", borderRadius: "8px", width: "34px", height: "34px", cursor: "pointer", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label className="form-label">Сумма вклада</label>
              <input
                className="form-input"
                type="number"
                placeholder={`Ваш баланс: ${myBalance} ${cName}`}
                value={amount}
                onChange={e => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            {amount && parseInt(amount) > 0 && (
              <div style={{ padding: "16px", background: "linear-gradient(135deg, var(--rd-red-light), rgba(199,22,24,0.04))", border: "1.5px solid rgba(199,22,24,0.2)", borderRadius: "12px", marginBottom: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <div style={{ fontSize: "11px", color: "var(--rd-gray-text)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Дата окончания</div>
                    <div style={{ fontWeight: 700, fontSize: "15px", color: "var(--rd-dark)" }}>{modalEndsAt}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: "var(--rd-gray-text)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Доход</div>
                    <div style={{ fontWeight: 800, fontSize: "20px", color: "var(--rd-red)" }}>+{modalProfit} {cName}</div>
                  </div>
                </div>
                <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid rgba(199,22,24,0.15)", fontSize: "13px", color: "var(--rd-gray-text)" }}>
                  Итого к получению: <strong style={{ color: "var(--rd-dark)" }}>{parseInt(amount) + modalProfit} {cName}</strong>
                </div>
              </div>
            )}
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={openDeposit}>Открыть вклад</button>
          </div>
        </div>
      )}

      {bankBannerImage ? (
        <div className="section-banner-wrap">
          <div className="hero-banner">
            <div className="hero-banner-bg" style={{backgroundImage:`url(${bankBannerImage})`}} />
            <div className="hero-banner-overlay" />
            <div className="hero-banner-content" style={{padding:"48px 24px"}}>
              <h1 className="hero-banner-title" style={{fontSize:"clamp(26px,5vw,40px)",marginBottom:"12px"}}>{bankTitle}</h1>
              <p className="hero-banner-desc">{bankDescription}</p>
            </div>
          </div>
          {deposits.length > 0 && (
            <div className="section-banner-stats-overlay">
              <div className="section-banner-stat">
                <div className="section-banner-stat-num" style={{color:"#fff"}}>{deposits.length}</div>
                <div className="section-banner-stat-label">Вкладов</div>
              </div>
              <div className="section-banner-stat">
                <div className="section-banner-stat-num" style={{color:"#7ee8a2"}}>{myActiveDeposits.length}</div>
                <div className="section-banner-stat-label">Активных</div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: "#fff", borderBottom: "1.5px solid var(--rd-gray-border)", padding: "40px 0 32px" }}>
          <div className="container">
            <h1 style={{ fontSize: "clamp(26px,5vw,40px)", fontWeight: 900, color: "var(--rd-dark)", letterSpacing: "-0.02em" }}>{bankTitle}</h1>
            <p style={{ fontSize: "15px", color: "var(--rd-gray-text)", marginTop: "6px" }}>{bankDescription}</p>
          </div>
        </div>
      )}

      <div className="container auction-page" style={{ padding: "32px 0" }}>
        {/* Карточки вкладов */}
        {deposits.length > 0 && (
          <div style={{ marginBottom: "40px" }}>
            <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "20px" }}>Доступные вклады</div>
            <div className="auction-grid">
              {deposits.map(deposit => (
                <div key={deposit.id} className="auction-card">
                  <div className="auction-img">
                    {deposit.image ? <img src={deposit.image} alt={deposit.name} /> : <span>🏦</span>}
                  </div>
                  <div className="auction-body">
                    <div className="auction-name">{deposit.name}</div>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <div style={{ flex: 1, background: "var(--rd-gray-bg)", borderRadius: "10px", padding: "12px 14px" }}>
                        <div style={{ fontSize: "11px", color: "var(--rd-gray-text)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Срок</div>
                        <div style={{ fontWeight: 800, fontSize: "20px", color: "var(--rd-dark)" }}>{deposit.duration} <span style={{ fontSize: "13px", fontWeight: 600 }}>дней</span></div>
                      </div>
                      <div style={{ flex: 1, background: "var(--rd-red-light)", borderRadius: "10px", padding: "12px 14px", border: "1.5px solid rgba(199,22,24,0.15)" }}>
                        <div style={{ fontSize: "11px", color: "var(--rd-gray-text)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Ставка</div>
                        <div style={{ fontWeight: 800, fontSize: "20px", color: "var(--rd-red)" }}>{deposit.rate}<span style={{ fontSize: "13px", fontWeight: 600 }}>%</span></div>
                      </div>
                    </div>
                    <button
                      className="btn btn-primary"
                      style={{ width: "100%", marginTop: "auto" }}
                      onClick={() => { setModalDeposit(deposit); setAmount(""); }}
                    >
                      Открыть вклад
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Активные вклады */}
        {myActiveDeposits.length > 0 && (
          <div style={{ marginBottom: "40px" }}>
            <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "20px" }}>Активные вклады</div>
            <div style={{ display: "grid", gap: "12px" }}>
              {myActiveDeposits.map(ud => {
                const timeLeft = ud.endsAt - Date.now();
                const daysLeft = Math.ceil(timeLeft / 86400000);
                const profit = Math.round(ud.amount * ud.rate / 100);
                return (
                  <div key={ud.id} style={{ background: "#fff", border: "1.5px solid var(--rd-gray-border)", borderRadius: "var(--rd-radius)", padding: "20px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "8px" }}>{ud.depositName}</div>
                        <div style={{ fontSize: "13px", color: "var(--rd-gray-text)", display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div>💰 Сумма: {ud.amount} {cName}</div>
                          <div>📈 Ставка: {ud.rate}%</div>
                          <div>⏳ Осталось: {daysLeft} {daysLeft === 1 ? "день" : daysLeft < 5 ? "дня" : "дней"}</div>
                          <div>📅 Завершение: {new Date(ud.endsAt).toLocaleDateString("ru-RU")}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "13px", color: "var(--rd-gray-text)", marginBottom: "4px" }}>Доход</div>
                        <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--rd-green)" }}>+{profit} {cName}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Архив */}
        {myCompletedDeposits.length > 0 && (
          <div>
            <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "20px" }}>Архив</div>
            <div style={{ display: "grid", gap: "12px" }}>
              {myCompletedDeposits.map(ud => {
                const profit = Math.round(ud.amount * ud.rate / 100);
                return (
                  <div key={ud.id} style={{ background: "var(--rd-gray-bg)", border: "1.5px solid var(--rd-gray-border)", borderRadius: "var(--rd-radius)", padding: "20px", opacity: 0.7 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "4px" }}>{ud.depositName}</div>
                        <div style={{ fontSize: "13px", color: "var(--rd-gray-text)" }}>
                          {ud.amount} {cName} · {ud.rate}% · Завершён {new Date(ud.completedAt).toLocaleDateString("ru-RU")}
                        </div>
                      </div>
                      <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--rd-green)" }}>
                        ✓ +{profit} {cName}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {deposits.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">🏦</div>
            <div className="empty-state-text">Вклады пока недоступны</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── TRANSFER ──────────────────────────────────────────────────────────────

function TransferPage({ currentUser, users, saveUsers, transfers, saveTransfers, notify, setPage, currency }) {
  const cName = getCurrName(currency);
  const [toInput, setToInput] = useState("");
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const myBalance = users[currentUser]?.balance || 0;

  const otherUsers = Object.keys(users).filter(u => u !== currentUser && u !== "admin");
  const suggestions = toInput.length > 0
    ? otherUsers.filter(u => u.toLowerCase().includes(toInput.toLowerCase())).slice(0, 6)
    : [];

  const myTransfers = transfers.filter(t => t.from === currentUser || t.to === currentUser)
    .sort((a, b) => b.date - a.date);

  const doTransfer = () => {
    const amt = parseInt(amount);
    if (!toInput.trim()) { notify("Укажите получателя", "err"); return; }
    if (!users[toInput]) { notify("Пользователь не найден", "err"); return; }
    if (toInput === currentUser) { notify("Нельзя переводить самому себе", "err"); return; }
    if (!amt || amt <= 0) { notify("Введите сумму перевода", "err"); return; }
    if (amt > myBalance) { notify("Недостаточно " + getCurrName(cProps.currency) + " на балансе", "err"); return; }

    const newUsers = {
      ...users,
      [currentUser]: { ...users[currentUser], balance: myBalance - amt },
      [toInput]: { ...users[toInput], balance: (users[toInput].balance || 0) + amt }
    };
    saveUsers(newUsers);

    const tr = {
      id: Date.now(),
      from: currentUser,
      to: toInput,
      amount: amt,
      comment: comment.trim(),
      date: Date.now(),
      dateStr: new Date().toLocaleString("ru-RU")
    };
    saveTransfers([tr, ...transfers]);

    notify("Перевод выполнен! " + amt + " " + cName + " → " + toInput);
    setToInput("");
    setAmount("");
    setComment("");
  };

  return (
    <div className="transfer-wrap page-fade">
      <div className="page-eyebrow">{cName}</div>
      <h2 className="page-title" style={{fontSize:"32px",marginBottom:"24px"}}>{`Перевод ${cName}`}</h2>

      <div className="transfer-card">
        <div className="transfer-balance">
          <div className="transfer-balance-icon">🪙</div>
          <div>
            <div className="transfer-balance-label">Ваш баланс</div>
            <div style={{display:"flex",alignItems:"baseline",gap:"6px"}}>
              <span className="transfer-balance-val">{myBalance}</span>
              <span className="transfer-balance-unit">{cName}</span>
            </div>
          </div>
        </div>

        <div className="form-field" style={{position:"relative"}}>
          <label className="form-label">Получатель</label>
          <input
            className="form-input"
            placeholder="Введите логин пользователя"
            value={toInput}
            autoComplete="off"
            onChange={e => { setToInput(e.target.value); setShowSuggest(true); }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
          />
          {showSuggest && suggestions.length > 0 && (
            <div className="user-suggest-list">
              {suggestions.map(u => (
                <div key={u} className="user-suggest-item" onMouseDown={() => { setToInput(u); setShowSuggest(false); }}>
                  <div className="user-suggest-avatar">{u[0].toUpperCase()}</div>
                  <div className="user-suggest-info">
                    <div className="user-suggest-name">{u}</div>
                    <div className="user-suggest-balance">{users[u]?.balance || 0} {cName}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="form-field">
          <label className="form-label">Сумма (<span style={{textTransform:"none"}}>{cName}</span>)</label>
          <input
            className="form-input"
            type="number"
            min="1"
            max={myBalance}
            placeholder={"Максимум " + myBalance}
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
          <div style={{display:"flex",gap:"8px",marginTop:"8px",flexWrap:"wrap"}}>
            {[10, 25, 50, 100, 250].filter(v => v <= myBalance).map(v => (
              <button key={v} className="btn btn-ghost btn-sm" onClick={() => setAmount("" + v)}>{v}</button>
            ))}
            {myBalance > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setAmount("" + myBalance)}>Всё</button>}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">Комментарий (необязательно)</label>
          <input className="form-input" placeholder="За что переводите..." value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => e.key === "Enter" && doTransfer()} />
        </div>

        <button className="btn btn-primary btn-block" style={{marginTop:"8px"}} onClick={doTransfer}>
          Отправить {cName}
        </button>
      </div>

      {myTransfers.length > 0 && (
        <div>
          <h3 style={{fontWeight:800,fontSize:"18px",marginBottom:"16px",color:"var(--rd-dark)"}}>История переводов</h3>
          <div className="transfer-card" style={{padding:"8px 24px"}}>
            {myTransfers.map(t => {
              const isOut = t.from === currentUser;
              return (
                <div key={t.id} className="transfer-history-item">
                  <div className={"thi-icon " + (isOut ? "out" : "in")}>{isOut ? "↑" : "↓"}</div>
                  <div className="thi-info">
                    <div className="thi-title">
                      {isOut ? ("\u0414\u043b\u044f " + t.to) : ("\u041e\u0442 " + t.from)}
                      {t.comment ? <span style={{fontWeight:400,color:"var(--rd-gray-text)",marginLeft:"8px",fontSize:"12px"}}>{"\"" + t.comment + "\""}</span> : null}
                    </div>
                    <div className="thi-date">{t.dateStr}</div>
                  </div>
                  <div className={"thi-amount " + (isOut ? "out" : "in")}>
                    {isOut ? "-" : "+"}{t.amount}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {myTransfers.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🪙</div>
          <div className="empty-state-text">Переводов пока не было</div>
        </div>
      )}
    </div>
  );
}

// ── ORDERS ────────────────────────────────────────────────────────────────

function OrdersPage({ orders, currency }) {
  const cName = getCurrName(currency);
  const SC = { "Обрабатывается":"#b07d2e","Собирается":"#2563eb","Отправлен":"#059669","Доставлен":"#047857","Отменён":"#c71618" };
  return (
    <div className="page-inner">
      <div className="page-eyebrow">Мои заказы</div>
      <h2 className="page-title">История покупок</h2>
      {orders.length === 0
        ? <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <div className="empty-state-text">Заказов пока нет</div>
          </div>
        : <div className="order-list">
            {orders.map(order => (
              <div key={order.id} className="order-card">
                <div>
                  <div className="order-id">{order.date}</div>
                  <div className="order-items" style={{marginTop:"8px"}}>
                    {order.items.map(i => <span key={i.id} className="order-item-tag">{i.emoji} {i.name} ×{i.qty}</span>)}
                  </div>
                </div>
                <div className="order-right">
                  <div className="order-total">{order.total}<span>{cName}</span></div>
                  <span className="status-badge" style={{color: SC[order.status]||"#888", borderColor: SC[order.status]||"#888"}}>{order.status}</span>
                </div>
              </div>
            ))}
          </div>
      }
    </div>
  );
}


export default App;
