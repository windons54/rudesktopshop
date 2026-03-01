// instrumentation.js — Next.js server lifecycle hook
// Запускается ОДИН РАЗ при старте сервера (Node.js runtime), до первого HTTP-запроса.
//
// ВАЖНО: webpack трассирует import() с литеральными путями даже в динамической форме.
// Поэтому используем path через переменную — webpack не может статически разрешить
// такой импорт и не включает server-init (и pg) в бандл.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Строим путь динамически, чтобы webpack не трассировал зависимость.
  const mod = './lib/server-init' + '.js';
  const { runServerInit } = await import(/* webpackIgnore: true */ mod);
  await runServerInit();
}
