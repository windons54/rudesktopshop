"use client"

import { use } from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { CatalogSidebar } from "@/components/catalog-sidebar"
import { ProductCard } from "@/components/product-card"
import { catalogData, sampleProducts } from "@/lib/catalog-data"

export default function ModelPage({
  params,
}: {
  params: Promise<{ brand: string; model: string }>
}) {
  const { brand: brandSlug, model: modelSlug } = use(params)
  const brand = catalogData.find((b) => b.slug === brandSlug)
  const model = brand?.models.find((m) => m.slug === modelSlug)

  if (!brand || !model) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <p className="text-muted-foreground">Модель не найдена</p>
      </div>
    )
  }

  const modelProducts = sampleProducts.filter(
    (p) => p.brand === brandSlug && p.model === modelSlug
  )

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6 flex-wrap">
        <Link href="/" className="hover:text-primary transition-colors">Главная</Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/catalog" className="hover:text-primary transition-colors">Каталог</Link>
        <ChevronRight className="h-3 w-3" />
        <Link href={`/catalog/${brandSlug}`} className="hover:text-primary transition-colors">
          {brand.name}
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">{model.name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-foreground mb-6">
        {brand.name} {model.name}
      </h1>

      <div className="flex flex-col lg:flex-row gap-8">
        <CatalogSidebar activeBrand={brandSlug} activeModel={modelSlug} />
        <div className="flex-1">
          {/* Sub-models */}
          {model.subModels && model.subModels.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-foreground mb-4">Варианты</h2>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                {model.subModels.map((sub) => (
                  <Link
                    key={sub.slug}
                    href={`/catalog/${brandSlug}/${modelSlug}/${sub.slug}`}
                    className="bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors text-center"
                  >
                    <span className="text-sm font-semibold text-foreground">{sub.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Products */}
          {modelProducts.length > 0 ? (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {modelProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-lg p-8 text-center">
              <p className="text-muted-foreground text-sm mb-2">
                Товары для {brand.name} {model.name} скоро появятся в каталоге
              </p>
              <p className="text-xs text-muted-foreground">
                Для заказа свяжитесь с нами по телефону{" "}
                <a href="tel:+79237023555" className="text-primary hover:text-primary/80">
                  +7 (923) 702-3555
                </a>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
