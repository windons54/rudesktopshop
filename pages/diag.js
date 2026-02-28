import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';

const STATUS_COLOR = {
  healthy:  { bg: '#0f2a1a', border: '#22c55e', text: '#4ade80', dot: '#22c55e' },
  degraded: { bg: '#2a1f0a', border: '#f59e0b', text: '#fbbf24', dot: '#f59e0b' },
  critical: { bg: '#2a0f0f', border: '#ef4444', text: '#f87171', dot: '#ef4444' },
};

const SEVERITY_COLOR = {
  critical: '#f87171',
  warning:  '#fbbf24',
  info:     '#60a5fa',
};

function Badge({ severity, children }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      background: SEVERITY_COLOR[severity] + '22',
      color: SEVERITY_COLOR[severity],
      border: `1px solid ${SEVERITY_COLOR[severity]}44`,
    }}>{children}</span>
  );
}

function MetricCard({ label, value, sub, highlight, warn }) {
  return (
    <div style={{
      background: '#0d1117',
      border: `1px solid ${warn ? '#f59e0b44' : '#21262d'}`,
      borderRadius: 8,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 11, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: warn ? '#fbbf24' : (highlight ? '#4ade80' : '#e6edf3'), fontFamily: 'monospace', lineHeight: 1 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 12, color: '#6e7681', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #21262d' }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, mono, warn, ok }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #161b22' }}>
      <span style={{ fontSize: 13, color: '#8b949e' }}>{label}</span>
      <span style={{
        fontSize: 13,
        fontFamily: mono ? 'monospace' : 'inherit',
        color: warn ? '#fbbf24' : (ok ? '#4ade80' : '#e6edf3'),
        fontWeight: warn || ok ? 600 : 400,
      }}>{value ?? '—'}</span>
    </div>
  );
}

function Timeline({ items }) {
  if (!items?.length) return null;
  const total = items[items.length - 1]?.ms || 1;
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
      {items.map((item, i) => {
        const prev = i > 0 ? items[i - 1].ms : 0;
        const delta = item.ms - prev;
        const width = Math.max(2, Math.round((delta / total) * 100));
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
            <span style={{ color: '#6e7681', width: 140, flexShrink: 0 }}>{item.label}</span>
            <div style={{ flex: 1, height: 16, background: '#161b22', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${width}%`, height: '100%', background: delta > 100 ? '#f59e0b' : '#238636', borderRadius: 3, minWidth: 3 }} />
            </div>
            <span style={{ color: delta > 100 ? '#fbbf24' : '#4ade80', width: 55, textAlign: 'right', flexShrink: 0 }}>+{delta}ms</span>
            <span style={{ color: '#6e7681', width: 55, textAlign: 'right', flexShrink: 0 }}>{item.ms}ms</span>
          </div>
        );
      })}
    </div>
  );
}

export default function DiagPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [clientTimings, setClientTimings] = useState(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    try {
      const res = await fetch('/api/diag');
      const fetchMs = Math.round(performance.now() - t0);
      const json = await res.json();
      const parseMs = Math.round(performance.now() - t0) - fetchMs;
      setData(json);
      setClientTimings({ fetchMs, parseMs, totalMs: fetchMs + parseMs });
      setHistory(prev => [{
        ts: new Date().toLocaleTimeString('ru-RU'),
        score: json.diagnosis?.score,
        dbPingMs: json.db?.pingMs,
        diagMs: json.totalDiagMs,
        fetchMs,
      }, ...prev.slice(0, 9)]);
    } catch(e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { run(); }, [run]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(run, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, run]);

  const score = data?.diagnosis?.score;
  const sc = STATUS_COLOR[score] || STATUS_COLOR.degraded;

  return (
    <>
      <Head>
        <title>Диагностика — Corp Merch</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div style={{ minHeight: '100vh', background: '#010409', color: '#e6edf3', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

        {/* Header */}
        <div style={{ borderBottom: '1px solid #21262d', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#010409', zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.03em' }}>⚡ Диагностика</span>
            {score && (
              <span style={{ padding: '3px 10px', borderRadius: 20, border: `1px solid ${sc.border}`, background: sc.bg, color: sc.text, fontSize: 12, fontWeight: 700 }}>
                <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: sc.dot, marginRight: 6, verticalAlign: 'middle', boxShadow: `0 0 6px ${sc.dot}` }} />
                {score === 'healthy' ? 'Норма' : score === 'degraded' ? 'Есть проблемы' : 'Критично'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: '#6e7681', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ cursor: 'pointer' }} />
              Авто (5s)
            </label>
            <button
              onClick={run}
              disabled={loading}
              style={{ padding: '6px 16px', background: loading ? '#21262d' : '#238636', border: '1px solid #2ea043', borderRadius: 6, color: '#fff', cursor: loading ? 'default' : 'pointer', fontSize: 13, fontWeight: 600 }}
            >
              {loading ? '⟳ Запуск...' : '▶ Запустить'}
            </button>
          </div>
        </div>

        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px' }}>

          {error && (
            <div style={{ background: '#2a0f0f', border: '1px solid #ef4444', borderRadius: 8, padding: '12px 16px', marginBottom: 24, color: '#f87171', fontSize: 14 }}>
              ❌ Ошибка: {error}
            </div>
          )}

          {!data && !loading && !error && (
            <div style={{ textAlign: 'center', padding: 80, color: '#6e7681' }}>Нажмите «Запустить» для диагностики</div>
          )}

          {data && (
            <>
              {/* Проблемы */}
              {data.diagnosis?.issues?.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                  {data.diagnosis.issues.map((issue, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12,
                      background: issue.severity === 'critical' ? '#2a0f0f' : issue.severity === 'warning' ? '#2a1f0a' : '#0d1b2a',
                      border: `1px solid ${SEVERITY_COLOR[issue.severity]}44`,
                      borderRadius: 8, padding: '12px 16px', marginBottom: 8,
                    }}>
                      <Badge severity={issue.severity}>{issue.severity}</Badge>
                      <span style={{ fontSize: 13, color: '#e6edf3', flex: 1 }}>{issue.msg}</span>
                    </div>
                  ))}
                  {data.diagnosis.recommendations?.map((rec, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#60a5fa', padding: '6px 0 6px 16px', borderLeft: '2px solid #1d4ed8' + '66', marginBottom: 4 }}>
                      💡 {rec}
                    </div>
                  ))}
                </div>
              )}

              {/* Ключевые метрики */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 28 }}>
                <MetricCard label="DB Ping" value={data.db?.ping} sub="запрос SELECT 1" warn={data.db?.pingMs > 100} highlight={data.db?.pingMs <= 20} />
                <MetricCard label="Пул готов" value={data.pool?.ready ? '✓ Да' : '✗ Нет'} sub={data.pool?.exists ? 'пул создан' : 'пул отсутствует'} highlight={data.pool?.ready} warn={!data.pool?.ready} />
                <MetricCard label="Соединения" value={data.pool?.totalCount ?? '—'} sub={`idle: ${data.pool?.idleCount ?? '—'} / wait: ${data.pool?.waitingCount ?? '—'}`} />
                <MetricCard label="Ключей в БД" value={data.db?.keyCount ?? '—'} sub={data.db?.totalValueKB ? `данных: ${data.db.totalValueKB}` : null} />
                <MetricCard label="Диагностика" value={data.totalDiagMs + 'ms'} sub={`fetch: ${clientTimings?.fetchMs}ms`} />
                <MetricCard label="Uptime сервера" value={data.process?.uptime} sub={data.process?.nodeVersion} />
              </div>

              {/* Timeline */}
              <Section title="Timeline диагностики">
                <Timeline items={data.timeline} />
              </Section>

              {/* Pool */}
              <Section title="PostgreSQL Pool">
                <Row label="Пул создан"       value={data.pool?.exists  ? '✓ Да' : '✗ Нет'} ok={data.pool?.exists} />
                <Row label="Пул готов"         value={data.pool?.ready   ? '✓ Да' : '✗ Нет'} ok={data.pool?.ready} warn={!data.pool?.ready} />
                <Row label="Инициализируется"  value={data.pool?.initPending ? '⟳ Да' : 'Нет'} warn={data.pool?.initPending} />
                <Row label="Прогрев запущен"   value={data.pool?.warmupStarted ? '✓ Да' : '✗ Нет'} ok={data.pool?.warmupStarted} warn={!data.pool?.warmupStarted} />
                <Row label="Таблица создана"   value={data.pool?.tableEnsured ? '✓ Да' : 'Нет'} ok={data.pool?.tableEnsured} />
                <Row label="Соединений всего"  value={data.pool?.totalCount} mono />
                <Row label="Idle"              value={data.pool?.idleCount} mono />
                <Row label="Ожидают"           value={data.pool?.waitingCount} mono warn={data.pool?.waitingCount > 5} />
                <Row label="Последняя ошибка"  value={data.pool?.lastError} warn={!!data.pool?.lastError} />
                <Row label="Ошибка была"       value={data.pool?.lastErrorAgo} />
                <Row label="Кэш getAll"        value={data.pool?.cacheValid ? `✓ Активен (${data.pool?.cacheExpiry} осталось)` : 'Пустой'} ok={data.pool?.cacheValid} />
                <Row label="Data version"      value={data.pool?.dataVersion} mono />
              </Section>

              {/* DB */}
              <Section title="База данных">
                <Row label="Версия"         value={data.db?.version} mono />
                <Row label="Ping (SELECT 1)"value={data.db?.ping} mono warn={data.db?.pingMs > 100} ok={data.db?.pingMs <= 20} />
                <Row label="Ошибка"         value={data.db?.error} warn={!!data.db?.error} />
                <Row label="Размер БД"      value={data.db?.dbSize} mono />
                <Row label="Кол-во ключей"  value={data.db?.keyCount} mono />
                <Row label="Объём данных"   value={data.db?.totalValueKB} mono warn={data.db?.totalValueBytes > 500*1024} />
                {data.db?.coldStartMs != null && <Row label="Холодный старт" value={data.db.coldStartMs + 'ms'} mono warn={data.db.coldStartMs > 1000} />}
              </Section>

              {/* Тяжёлые ключи */}
              {data.db?.heaviestKeys?.length > 0 && (
                <Section title="Самые тяжёлые ключи">
                  {data.db.heaviestKeys.map((k, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #161b22', fontSize: 13 }}>
                      <span style={{ color: '#8b949e', fontFamily: 'monospace' }}>{k.key}</span>
                      <span style={{ color: k.bytes > 100*1024 ? '#fbbf24' : '#e6edf3', fontFamily: 'monospace', fontWeight: 600 }}>{k.kb}</span>
                    </div>
                  ))}
                </Section>
              )}

              {/* Процесс */}
              <Section title="Сервер">
                <Row label="Node.js"   value={data.process?.nodeVersion} mono />
                <Row label="Uptime"    value={data.process?.uptime} mono />
                <Row label="Heap used" value={data.process?.memory?.heapUsed} mono warn={parseInt(data.process?.memory?.heapUsed) > 400} />
                <Row label="RSS"       value={data.process?.memory?.rss} mono />
                <Row label="ENV"       value={data.process?.env} mono />
                <Row label="PID"       value={data.process?.pid} mono />
              </Section>

              {/* ENV */}
              <Section title="Переменные окружения">
                <Row label="DATABASE_URL" value={data.env?.DATABASE_URL ? '✓ Задан' : '✗ Не задан'} ok={data.env?.DATABASE_URL} warn={!data.env?.DATABASE_URL} />
                <Row label="PG_HOST"      value={data.env?.PG_HOST      ? '✓ Задан' : '✗ Не задан'} ok={data.env?.PG_HOST} />
                <Row label="PG_PORT"      value={data.env?.PG_PORT || '—'} mono />
                <Row label="NODE_ENV"     value={data.env?.NODE_ENV} mono />
                <Row label="PORT"         value={data.env?.PORT} mono />
                <Row label="pg-config.json" value={data.fs?.hasPgConfig ? '✓ Есть' : '✗ Нет'} ok={data.fs?.hasPgConfig} />
                <Row label="store.json"   value={data.fs?.hasStoreJson ? `✓ Есть (${data.fs?.storeJsonKB})` : 'Нет'} />
              </Section>

              {/* История */}
              {history.length > 1 && (
                <Section title="История запусков">
                  <div style={{ display: 'grid', gridTemplateColumns: '80px 90px 80px 80px 80px', gap: 0, fontSize: 12 }}>
                    {['Время', 'Статус', 'DB Ping', 'Диагн.', 'Fetch'].map(h => (
                      <div key={h} style={{ color: '#6e7681', padding: '4px 8px', borderBottom: '1px solid #21262d', textTransform: 'uppercase', fontSize: 10 }}>{h}</div>
                    ))}
                    {history.map((h, i) => {
                      const sc2 = STATUS_COLOR[h.score] || STATUS_COLOR.degraded;
                      return [
                        <div key={`t${i}`}  style={{ padding: '5px 8px', color: '#8b949e', fontFamily: 'monospace', fontSize: 11 }}>{h.ts}</div>,
                        <div key={`s${i}`}  style={{ padding: '5px 8px', color: sc2.text, fontFamily: 'monospace', fontSize: 11 }}>{h.score}</div>,
                        <div key={`p${i}`}  style={{ padding: '5px 8px', color: h.dbPingMs > 100 ? '#fbbf24' : '#4ade80', fontFamily: 'monospace', fontSize: 11 }}>{h.dbPingMs != null ? h.dbPingMs + 'ms' : '—'}</div>,
                        <div key={`d${i}`}  style={{ padding: '5px 8px', color: '#e6edf3', fontFamily: 'monospace', fontSize: 11 }}>{h.diagMs}ms</div>,
                        <div key={`f${i}`}  style={{ padding: '5px 8px', color: '#e6edf3', fontFamily: 'monospace', fontSize: 11 }}>{h.fetchMs}ms</div>,
                      ];
                    })}
                  </div>
                </Section>
              )}

              {/* Кнопка копирования */}
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #21262d' }}>
                <button
                  onClick={() => navigator.clipboard?.writeText(JSON.stringify(data, null, 2))}
                  style={{ padding: '8px 16px', background: '#161b22', border: '1px solid #30363d', borderRadius: 6, color: '#8b949e', cursor: 'pointer', fontSize: 13 }}
                >
                  📋 Скопировать JSON для отправки в поддержку
                </button>
                <span style={{ fontSize: 11, color: '#6e7681', marginLeft: 12 }}>
                  Отправьте этот JSON разработчику для точной диагностики
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
