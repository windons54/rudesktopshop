"use client"

import { use } from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { CatalogSidebar } from "@/components/catalog-sidebar"
import { ProductCard } from "@/components/product-card"
import { catalogData, sampleProducts } from "@/lib/catalog-data"

export default function BrandPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandSlug } = use(params)
  const brand = catalogData.find((b) => b.slug === brandSlug)

  if (!brand) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <p className="text-muted-foreground">Марка не найдена</p>
      </div>
    )
  }

  const brandProducts = sampleProducts.filter((p) => p.brand === brandSlug)

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
        <Link href="/" className="hover:text-primary transition-colors">Главная</Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/catalog" className="hover:text-primary transition-colors">Каталог</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">{brand.name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-foreground mb-6">
        Обвесы для {brand.name}
      </h1>

      <div className="flex flex-col lg:flex-row gap-8">
        <CatalogSidebar activeBrand={brandSlug} />
        <div className="flex-1">
          {/* Models grid */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-4">Модели</h2>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
              {brand.models.map((model) => (
                <Link
                  key={model.slug}
                  href={`/catalog/${brandSlug}/${model.slug}`}
                  className="bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors text-center"
                >
                  <span className="text-sm font-semibold text-foreground">{model.name}</span>
                  {model.subModels && (
                    <span className="block text-[10px] text-muted-foreground mt-1">
                      {model.subModels.length} {'вариантов'}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>

          {/* Products */}
          {brandProducts.length > 0 && (
            <>
              <h2 className="text-lg font-semibold text-foreground mb-4">Товары</h2>
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {brandProducts.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            </>
          )}

          {brandProducts.length === 0 && (
            <div className="bg-card border border-border rounded-lg p-8 text-center">
              <p className="text-muted-foreground text-sm">
                Выберите модель из списка слева для просмотра товаров
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
