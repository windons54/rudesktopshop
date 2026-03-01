// instrumentation.js — Next.js server lifecycle hook
// Вызывается один раз при старте Node.js процесса до первого HTTP-запроса.
//
// ВАЖНО: Next.js компилирует этот файл в .next/server/instrumentation.js
// Поэтому путь к server-init должен быть '../../lib/server-init.js'
// (относительно .next/server/, а не корня проекта)
//
// Инициализация запускается в фоне — не блокирует старт HTTP-сервера.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { runServerInit } = await import(/* webpackIgnore: true */ '../../lib/server-init.js');
    runServerInit().catch(e => console.warn('[instrumentation] init error:', e.message));
  } catch (e) {
    console.warn('[instrumentation] failed to load server-init:', e.message);
  }
}
