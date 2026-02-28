import dynamic from 'next/dynamic';
import Head from 'next/head';

const App = dynamic(() => import('../components/App'), { ssr: false });

export default function Home({ initialData, initialVersion }) {
  return (
    <>
      <Head>
        <title>Corp Merch — Корпоративный магазин</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <App initialData={initialData} initialVersion={initialVersion} />
    </>
  );
}

// Загружаем данные прямо при рендере страницы на сервере.
// Клиент получает их мгновенно вместе с HTML — нет отдельного API-запроса при старте.
// Это устраняет задержку 1-3s при обновлении страницы.
export async function getServerSideProps() {
  try {
    const storeModule = await import('./api/store.js');

    let resolvedData = null;
    let resolvedVersion = null;

    await new Promise((resolve) => {
      const req = {
        method: 'POST',
        body: { action: 'getAll' },
        query: {},
      };
      const res = {
        status: () => res,
        end: () => resolve(),
        setHeader: () => {},
        json: (data) => {
          if (data.ok && data.data) {
            resolvedData = data.data;
            resolvedVersion = data.version || null;
          }
          resolve();
        },
      };
      storeModule.default(req, res).catch(() => resolve());
    });

    return {
      props: {
        initialData: resolvedData,
        initialVersion: resolvedVersion,
      },
    };
  } catch (e) {
    console.warn('[getServerSideProps] Error:', e.message);
    return {
      props: {
        initialData: null,
        initialVersion: null,
      },
    };
  }
}
