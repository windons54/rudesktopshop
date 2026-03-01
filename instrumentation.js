// instrumentation.js — Next.js server lifecycle hook
// Вызывается один раз при старте Node.js процесса до первого HTTP-запроса.
//
// /* webpackIgnore: true */ — говорит webpack'у НЕ трассировать этот импорт,
// поэтому pg и его Node.js-зависимости (dns, net, crypto) не попадают в бандл.
// В runtime (Node.js) этот комментарий игнорируется, импорт работает нормально.
//
// ИСПРАВЛЕНИЕ: убран блокирующий await — сервер стартует немедленно,
// инициализация пула идёт в фоне. Ранее await вызывал 502 / белый экран.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { runServerInit } = await import(/* webpackIgnore: true */ './lib/server-init.js');
  // Не ждём — пул инициализируется в фоне после старта сервера
  runServerInit().catch(e => console.warn('[instrumentation] init error:', e.message));
}
