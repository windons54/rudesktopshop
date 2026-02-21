"use client"

import Link from "next/link"
import { Phone, Menu, X, ShoppingCart } from "lucide-react"
import { useState } from "react"
import { useCart } from "@/lib/cart-context"

const navLinks = [
  { href: "/catalog", label: "Каталог" },
  { href: "/services", label: "Услуги" },
  { href: "/delivery", label: "Оплата и доставка" },
  { href: "/technology", label: "Технология" },
  { href: "/contacts", label: "Контакты" },
  { href: "/news", label: "Новости" },
]

export function SiteHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { items } = useCart()
  const totalItems = items.reduce((acc, item) => acc + item.quantity, 0)

  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="mx-auto max-w-7xl px-4">
        {/* Top bar */}
        <div className="flex items-center justify-between py-2 border-b border-border">
          <a
            href="tel:+79237023555"
            className="flex items-center gap-2 text-primary font-bold text-sm"
          >
            <Phone className="h-4 w-4" />
            +7 (923) 702-3555
          </a>
          <Link href="/cart" className="relative flex items-center gap-2 text-foreground hover:text-primary transition-colors text-sm">
            <ShoppingCart className="h-5 w-5" />
            <span className="hidden sm:inline">Корзина</span>
            {totalItems > 0 && (
              <span className="absolute -top-1 -right-2 bg-primary text-primary-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center">
                {totalItems}
              </span>
            )}
          </Link>
        </div>

        {/* Main header */}
        <div className="flex items-center justify-between py-4">
          <Link href="/" className="flex flex-col">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              InStyle<span className="text-primary">.PRO</span>
            </span>
            <span className="text-xs text-muted-foreground">
              Производство аэродинамических обвесов
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-foreground hover:text-primary transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Mobile menu toggle */}
          <button
            className="lg:hidden p-2 text-foreground hover:text-primary"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Закрыть меню" : "Открыть меню"}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile nav */}
        {mobileMenuOpen && (
          <nav className="lg:hidden py-4 border-t border-border">
            <div className="flex flex-col gap-3">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-foreground hover:text-primary transition-colors py-1"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </div>
    </header>
  )
}
