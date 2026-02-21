import Image from "next/image"
import Link from "next/link"
import { ArrowRight, Wrench, Truck, Shield, Factory } from "lucide-react"
import { NewsCard } from "@/components/news-card"
import { catalogData } from "@/lib/catalog-data"

const newsItems = [
  {
    date: "20.06.2022",
    title: "Обвес TTE для Toyota Aristo JZS160/161",
    description:
      "Стеклопластиковая копия обвеса TTE для Toyota Aristo JZS160/161, Lexus GS300 S16. В комплекте накладки на бамперы, шильд и спойлер.",
    image: "/images/news-aristo.jpg",
    href: "/news",
  },
  {
    date: "07.06.2022",
    title: "Расширение Toyota Mark II JZX100",
    description:
      "Стеклопластиковая копия расширителей арок, фендеров для Toyota Mark II 100.",
    image: "/images/news-mark2.jpg",
    href: "/news",
  },
  {
    date: "04.10.2017",
    title: "Новинка для Toyota Verossa",
    description:
      "Стеклопластиковая копия опционального обвеса для Toyota Verossa от InStyle.PRO! Матрицируем с оригинала! В комплекте накладки на бамперы и пороги.",
    image: "/images/news-verossa.jpg",
    href: "/news",
  },
]

const features = [
  {
    icon: Factory,
    title: "Собственное производство",
    description: "Все детали изготовлены из стеклопластика по технологии контактного формования",
  },
  {
    icon: Shield,
    title: "Высокое качество",
    description: "Матрицы сняты с оригинальных деталей, импортные материалы и многолетний опыт",
  },
  {
    icon: Wrench,
    title: "Установка и ремонт",
    description: "Профессиональный установочный центр и услуги по ремонту обвесов любой сложности",
  },
  {
    icon: Truck,
    title: "Доставка по России и СНГ",
    description: "Сотрудничество с крупными логистическими компаниями для быстрой доставки",
  },
]

export default function HomePage() {
  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative h-[70vh] min-h-[500px] overflow-hidden">
        <Image
          src="/images/hero-car.jpg"
          alt="Аэродинамический обвес на автомобиль"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/70 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-4 h-full flex items-center">
          <div className="max-w-xl flex flex-col gap-6">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight text-balance">
              Аэродинамические обвесы
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Производство, продажа и установка обвесов из стеклопластика для японских и европейских автомобилей. Работаем с 2007 года.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/catalog"
                className="flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-lg hover:bg-primary/90 transition-colors"
              >
                Каталог
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="tel:+79237023555"
                className="flex items-center gap-2 border border-border text-foreground font-semibold px-6 py-3 rounded-lg hover:bg-secondary transition-colors"
              >
                +7 (923) 702-3555
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 border-b border-border">
        <div className="mx-auto max-w-7xl px-4">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="bg-card border border-border rounded-lg p-6 flex flex-col gap-3"
              >
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">
                  {feature.title}
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Catalog Brands */}
      <section className="py-16 border-b border-border">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold text-foreground">Каталог по маркам</h2>
            <Link
              href="/catalog"
              className="text-sm text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
            >
              Все марки
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {catalogData.filter(b => b.slug !== "universal").map((brand) => (
              <Link
                key={brand.slug}
                href={`/catalog/${brand.slug}`}
                className="bg-card border border-border rounded-lg p-4 flex flex-col items-center gap-2 hover:border-primary/50 transition-colors group"
              >
                <span className="text-2xl font-bold text-muted-foreground group-hover:text-primary transition-colors">
                  {brand.name.charAt(0)}
                </span>
                <span className="text-xs font-semibold text-foreground text-center">
                  {brand.name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {brand.models.length} {'моделей'}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* News */}
      <section className="py-16 border-b border-border">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold text-foreground">Новости</h2>
            <Link
              href="/news"
              className="text-sm text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
            >
              Все новости
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {newsItems.map((item) => (
              <NewsCard key={item.title} {...item} />
            ))}
          </div>
        </div>
      </section>

      {/* About Section */}
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4">
          <div className="grid gap-8 lg:grid-cols-2 items-center">
            <div className="flex flex-col gap-6">
              <h2 className="text-2xl font-bold text-foreground">
                О компании InStyle.PRO
              </h2>
              <div className="flex flex-col gap-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Компания InStyle.PRO - это мастерская по автотюнингу экстерьера. С момента основания в 2007 году специализация нашей компании - производство, продажа, установка и ремонт аэродинамических обвесов, элементов интерьера и композитных деталей кузова для автоспорта.
                </p>
                <p>
                  За время своего существования мы приобрели десятки партнеров в различных городах России и Казахстана. В каталоге представлены реплики деталей таких мировых брендов, как Veil Side, Vertex, Wald, Bomex, Trial, Liberal, C-West, Hippo Sleek и др.
                </p>
                <p>
                  Все детали изготовлены из композитных материалов по специально адаптированной технологии контактного формования, позволяющей получить эластичный, легкий и очень прочный обвес из стеклопластика.
                </p>
              </div>
              <Link
                href="/technology"
                className="text-sm text-primary hover:text-primary/80 flex items-center gap-1 transition-colors w-fit"
              >
                Подробнее о технологии
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="relative aspect-[4/3] rounded-lg overflow-hidden">
              <Image
                src="/images/workshop.jpg"
                alt="Мастерская InStyle.PRO"
                fill
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Address */}
      <section className="py-12 bg-card border-t border-border">
        <div className="mx-auto max-w-7xl px-4 text-center">
          <h2 className="text-xl font-bold text-foreground mb-2">Наш адрес</h2>
          <p className="text-sm text-muted-foreground">
            г. Новосибирск, ул. Станционная, дом 59
          </p>
          <a
            href="tel:+79237023555"
            className="inline-block mt-4 text-primary font-bold text-lg hover:text-primary/80 transition-colors"
          >
            +7 (923) 702-3555
          </a>
        </div>
      </section>
    </div>
  )
}
