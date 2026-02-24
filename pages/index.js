import dynamic from 'next/dynamic';
import Head from 'next/head';

const App = dynamic(() => import('../components/App'), { ssr: false });

export default function Home() {
  return (
    <>
      <Head>
        <title>Corp Merch — Корпоративный магазин</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <App />
    </>
  );
}
