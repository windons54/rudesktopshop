import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { CartProvider } from '@/lib/cart-context'
import './globals.css'

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter" })

export const metadata: Metadata = {
  title: 'InStyle.PRO - Производство аэродинамических обвесов',
  description: 'Интернет-магазин аэродинамических обвесов из стеклопластика. Производство, продажа, установка и ремонт обвесов для Toyota, Honda, Nissan, Subaru, Lexus, BMW и других марок.',
  keywords: 'обвесы, аэродинамические обвесы, тюнинг, стеклопластик, бамперы, спойлеры, Toyota, Honda, Nissan, Subaru, Lexus',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru">
      <body className={`${inter.variable} font-sans antialiased`}>
        <CartProvider>
          <div className="min-h-screen flex flex-col">
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
        </CartProvider>
        <Analytics />
      </body>
    </html>
  )
}
