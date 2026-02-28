// instrumentation.js — Next.js server lifecycle hook
// Запускается ОДИН РАЗ при старте сервера, до первого HTTP-запроса.
// Логика вынесена в lib/server-init.js чтобы webpack не тянул pg в клиентский бандл.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Динамический импорт — webpack не трассирует зависимости внутри
  const { runServerInit } = await import('./lib/server-init.js');
  await runServerInit();
}
