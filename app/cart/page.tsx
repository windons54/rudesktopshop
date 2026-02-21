"use client"

import Link from "next/link"
import Image from "next/image"
import { ChevronRight, Trash2, ShoppingCart } from "lucide-react"
import { useCart } from "@/lib/cart-context"

export default function CartPage() {
  const { items, removeItem, clearCart, totalPrice } = useCart()

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
        <Link href="/" className="hover:text-primary transition-colors">Главная</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Корзина</span>
      </nav>

      <h1 className="text-3xl font-bold text-foreground mb-8">Корзина</h1>

      {items.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <ShoppingCart className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">Ваша корзина пуста</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Добавьте товары из каталога для оформления заказа
          </p>
          <Link
            href="/catalog"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-lg hover:bg-primary/90 transition-colors"
          >
            Перейти в каталог
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="bg-card border border-border rounded-lg p-4 flex items-center gap-4"
              >
                <div className="relative h-20 w-20 rounded overflow-hidden shrink-0">
                  <Image
                    src={item.image}
                    alt={item.name}
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground truncate">
                    {item.name}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {'Количество:'} {item.quantity}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-foreground">
                    {(item.price * item.quantity).toLocaleString("ru-RU")} &#8381;
                  </p>
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  className="p-2 text-muted-foreground hover:text-primary transition-colors shrink-0"
                  aria-label={`Удалить ${item.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border rounded-lg p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-sm text-muted-foreground">Итого:</span>
              <span className="text-2xl font-bold text-foreground ml-3">
                {totalPrice.toLocaleString("ru-RU")} &#8381;
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={clearCart}
                className="text-sm text-muted-foreground hover:text-primary transition-colors px-4 py-2 border border-border rounded-lg"
              >
                Очистить
              </button>
              <a
                href="tel:+79237023555"
                className="flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-lg hover:bg-primary/90 transition-colors"
              >
                Оформить заказ
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
