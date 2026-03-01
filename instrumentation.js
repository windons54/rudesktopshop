// instrumentation.js — Next.js server lifecycle hook
// Вызывается один раз при старте Node.js процесса до первого HTTP-запроса.
//
// /* webpackIgnore: true */ — говорит webpack'у НЕ трассировать этот импорт,
// поэтому pg и его Node.js-зависимости (dns, net, crypto) не попадают в бандл.
// В runtime (Node.js) этот комментарий игнорируется, импорт работает нормально.
//
// ВАЖНО: Next.js копирует этот файл в .next/server/ при билде, поэтому
// относительный путь ./lib/server-init.js ломается (ищет .next/server/lib/).
// Используем path.join(process.cwd(), ...) для абсолютного пути от корня проекта.
import path from 'path';
import { pathToFileURL } from 'url';

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const initPath = path.join(process.cwd(), 'lib', 'server-init.js');
  const { runServerInit } = await import(/* webpackIgnore: true */ pathToFileURL(initPath).href);
  await runServerInit();
}
