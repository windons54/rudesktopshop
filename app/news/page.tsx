import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { NewsCard } from "@/components/news-card"

const allNews = [
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
  {
    date: "15.03.2017",
    title: "Обвес Vertex для Toyota Mark II JZX100",
    description:
      "Полный комплект обвеса в стиле Vertex для Toyota Mark II JZX100. Передний бампер, накладки на пороги, задний бампер. Стеклопластик высокого качества.",
    image: "/images/news-mark2.jpg",
    href: "/news",
  },
  {
    date: "20.01.2017",
    title: "Накладки C-West для Nissan Silvia S15",
    description:
      "Стеклопластиковая копия передней губы и накладок на пороги в стиле C-West для Nissan Silvia S15. Точная копия с оригинала.",
    image: "/images/hero-car.jpg",
    href: "/news",
  },
  {
    date: "10.11.2016",
    title: "Расширение для Subaru Impreza GDB",
    description:
      "Широкие расширители арок для Subaru Impreza GDA/GDB WRX STI. Стеклопластик, матрицированы с оригинальных деталей.",
    image: "/images/technology.jpg",
    href: "/news",
  },
]

export default function NewsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
        <Link href="/" className="hover:text-primary transition-colors">Главная</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Новости</span>
      </nav>

      <h1 className="text-3xl font-bold text-foreground mb-8">Новости</h1>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {allNews.map((item, i) => (
          <NewsCard key={i} {...item} />
        ))}
      </div>
    </div>
  )
}
