import '../styles/globals.css';
import { HeroUIProvider } from '@heroui/react';

export default function MyApp({ Component, pageProps }) {
  return (
    <HeroUIProvider>
      <Component {...pageProps} />
    </HeroUIProvider>
  );
}
