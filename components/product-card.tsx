"use client"

import Image from "next/image"
import { ShoppingCart } from "lucide-react"
import type { Product } from "@/lib/catalog-data"
import { useCart } from "@/lib/cart-context"

export function ProductCard({ product }: { product: Product }) {
  const { addItem } = useCart()

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden group hover:border-primary/50 transition-colors">
      <div className="relative aspect-[4/3] overflow-hidden">
        <Image
          src={product.image}
          alt={product.name}
          fill
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute top-2 right-2">
          <span className="bg-primary text-primary-foreground text-xs font-semibold px-2 py-1 rounded">
            {product.category}
          </span>
        </div>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2">
          {product.name}
        </h3>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {product.description}
        </p>
        <div className="flex items-center justify-between mt-auto pt-2">
          <span className="text-lg font-bold text-foreground">
            {product.price.toLocaleString("ru-RU")} &#8381;
          </span>
          <button
            onClick={() => addItem(product)}
            className="flex items-center gap-2 bg-primary text-primary-foreground text-xs font-semibold px-3 py-2 rounded hover:bg-primary/90 transition-colors"
            aria-label={`Добавить ${product.name} в корзину`}
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            В корзину
          </button>
        </div>
      </div>
    </div>
  )
}
