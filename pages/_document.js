import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="ru">
      <Head>
        <meta charSet="UTF-8" />
        <meta name="description" content="Корпоративный магазин мерча" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="stylesheet" href="https://cdn.lineicons.com/5.0/lineicons.css" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
