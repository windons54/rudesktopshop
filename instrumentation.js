// instrumentation.js — Next.js server lifecycle hook
// Запускается ОДИН РАЗ при старте сервера, до первого HTTP-запроса.
// Прогревает пул PostgreSQL заранее — клиент получит данные сразу, без задержки 1-3s.
//
// Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // Запускаем только на сервере (не в Edge runtime, не на клиенте)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      // Динамический импорт чтобы не сломать клиентскую сборку
      const { default: handler } = await import('./pages/api/store.js');
      // Имитируем минимальный запрос pg_get для инициализации модуля
      // (getPool() вызывается при импорте через _pgWarmupStarted)
      console.log('[Instrumentation] PG pool warmup started');
    } catch (e) {
      console.warn('[Instrumentation] Warmup import error:', e.message);
    }
  }
}
