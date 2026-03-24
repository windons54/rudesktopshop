// instrumentation.js — Next.js server lifecycle hook
// Вызывается один раз при старте Node.js процесса до первого HTTP-запроса.
//
// /* webpackIgnore: true */ — говорит webpack'у НЕ трассировать этот импорт,
// поэтому pg и его Node.js-зависимости (dns, net, crypto) не попадают в бандл.
// В runtime (Node.js) этот комментарий игнорируется, импорт работает нормально.
//
// ВАЖНО: Next.js копирует этот файл в .next/server/ при билде, поэтому
// относительный путь ./lib/server-init.js ломается (ищет .next/server/lib/).
// Собираем file:// URL от корня проекта без top-level Node.js imports,
// чтобы webpack не пытался резолвить built-in модуль path в клиентском графе.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const cwd = process.cwd().replace(/\\/g, '/').replace(/\/$/, '');
  const initUrl = new URL(`file://${cwd}/lib/server-init.js`);
  const { runServerInit } = await import(/* webpackIgnore: true */ initUrl.href);
  await runServerInit();
}
