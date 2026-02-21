"use client"

import Link from "next/link"
import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { catalogData } from "@/lib/catalog-data"

export function CatalogSidebar({ activeBrand, activeModel }: { activeBrand?: string; activeModel?: string }) {
  const [expandedBrands, setExpandedBrands] = useState<string[]>(
    activeBrand ? [activeBrand] : []
  )
  const [expandedModels, setExpandedModels] = useState<string[]>(
    activeModel ? [activeModel] : []
  )

  const toggleBrand = (slug: string) => {
    setExpandedBrands((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    )
  }

  const toggleModel = (slug: string) => {
    setExpandedModels((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    )
  }

  return (
    <aside className="w-full lg:w-64 shrink-0">
      <div className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-lg font-bold text-foreground mb-4 border-b border-border pb-3">
          Каталог
        </h2>
        <nav className="flex flex-col gap-0.5">
          {catalogData.map((brand) => (
            <div key={brand.slug}>
              <button
                onClick={() => toggleBrand(brand.slug)}
                className={`flex items-center justify-between w-full text-left text-sm py-2 px-2 rounded transition-colors ${
                  activeBrand === brand.slug
                    ? "text-primary bg-primary/10 font-semibold"
                    : "text-foreground hover:text-primary hover:bg-secondary"
                }`}
              >
                <span>{brand.name}</span>
                {expandedBrands.includes(brand.slug) ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
              </button>

              {expandedBrands.includes(brand.slug) && (
                <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-3">
                  {brand.models.map((model) => (
                    <div key={model.slug}>
                      {model.subModels ? (
                        <>
                          <button
                            onClick={() => toggleModel(`${brand.slug}-${model.slug}`)}
                            className={`flex items-center justify-between w-full text-left text-xs py-1.5 px-2 rounded transition-colors ${
                              activeModel === model.slug
                                ? "text-primary font-semibold"
                                : "text-muted-foreground hover:text-primary"
                            }`}
                          >
                            <span>{model.name}</span>
                            {expandedModels.includes(`${brand.slug}-${model.slug}`) ? (
                              <ChevronDown className="h-3 w-3 shrink-0" />
                            ) : (
                              <ChevronRight className="h-3 w-3 shrink-0" />
                            )}
                          </button>
                          {expandedModels.includes(`${brand.slug}-${model.slug}`) && (
                            <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-3">
                              {model.subModels.map((sub) => (
                                <Link
                                  key={sub.slug}
                                  href={`/catalog/${brand.slug}/${model.slug}/${sub.slug}`}
                                  className="text-xs text-muted-foreground hover:text-primary py-1 px-2 rounded transition-colors"
                                >
                                  {sub.name}
                                </Link>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <Link
                          href={`/catalog/${brand.slug}/${model.slug}`}
                          className={`block text-xs py-1.5 px-2 rounded transition-colors ${
                            activeModel === model.slug
                              ? "text-primary font-semibold"
                              : "text-muted-foreground hover:text-primary"
                          }`}
                        >
                          {model.name}
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  )
}
