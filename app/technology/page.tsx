import Image from "next/image"
import Link from "next/link"
import { ChevronRight, CheckCircle2 } from "lucide-react"

const advantages = [
  "Высокая прочность и эластичность при малом весе",
  "Водоотталкивающие и антикоррозионные свойства",
  "Стойкость к ультрафиолету",
  "Диэлектрическая, химическая и термическая стойкости",
  "Низкая теплопроводность",
  "Эксплуатация в широком диапазоне температур - от -70 до +140 градусов",
  "Простота эксплуатации и ремонта",
]

export default function TechnologyPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
        <Link href="/" className="hover:text-primary transition-colors">Главная</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Технология</span>
      </nav>

      <h1 className="text-3xl font-bold text-foreground mb-8">Технология производства</h1>

      <div className="grid gap-8 lg:grid-cols-2 items-start mb-12">
        <div className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Все детали InStyle.PRO изготовлены из стеклопластика. Обвесы легкие, прочные и пластичные.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Стеклопластик - композитный материал, состоящий из стекловолокнистого наполнителя и связующего вещества. При изготовлении стеклопластика используется полиэфирная смола. Смола в жидком виде смешивается с катализатором, акселератором и полимеризуется.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Молекулы пластика образуют друг с другом связи, превращаясь в жесткую структуру, представляя собой одну молекулярную цепь. Создание детали происходит с помощью укладки чередующихся слоев стекломата в подготовленную матрицу.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Технологическая оснастка для производства обвесов изготовлена с оригинальных элементов, профессиональное оборудование, импортные материалы и многолетний опыт производства гарантируют высокое качество наших изделий и минимальные трудозатраты при установке.
          </p>
        </div>

        <div className="relative aspect-[4/3] rounded-lg overflow-hidden">
          <Image
            src="/images/technology.jpg"
            alt="Технология производства стеклопластиковых обвесов"
            fill
            className="object-cover"
          />
        </div>
      </div>

      {/* Advantages */}
      <div className="bg-card border border-border rounded-lg p-8 mb-12">
        <h2 className="text-xl font-bold text-foreground mb-6">
          Преимущества стеклопластика
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {advantages.map((advantage) => (
            <div key={advantage} className="flex items-start gap-3">
              <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span className="text-sm text-muted-foreground">{advantage}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Gallery */}
      <h2 className="text-xl font-bold text-foreground mb-6">
        Детали, изготовленные мастерами InStyle.PRO
      </h2>
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
        {[
          "/images/news-aristo.jpg",
          "/images/news-mark2.jpg",
          "/images/news-verossa.jpg",
          "/images/hero-car.jpg",
          "/images/workshop.jpg",
          "/images/technology.jpg",
        ].map((src, i) => (
          <div key={i} className="relative aspect-[4/3] rounded-lg overflow-hidden">
            <Image
              src={src}
              alt={`Работа мастеров InStyle.PRO ${i + 1}`}
              fill
              className="object-cover hover:scale-105 transition-transform duration-300"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
