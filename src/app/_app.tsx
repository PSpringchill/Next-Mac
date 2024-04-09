
import { AppProps } from 'next/app';
import { OrderBookProvider } from './api/Page';
import Layout from './layout'; // Import your layout component here

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <OrderBookProvider>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </OrderBookProvider>
  );
}

export default MyApp;
