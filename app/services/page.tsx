import Image from "next/image"
import Link from "next/link"
import { ChevronRight, Wrench, PaintBucket, Settings, Car } from "lucide-react"

const services = [
  {
    icon: Car,
    title: "Установка аэродинамических обвесов",
    description:
      "Специалисты нашего установочного центра окажут Вам квалифицированные услуги по установке любых деталей кузовного тюнинга и интерьера вашего автомобиля: установка аэродинамических обвесов, подиумов для дополнительных приборов, накладок на бамперы и пороги, бамперов, расширителей кузова и многое другое.",
  },
  {
    icon: Wrench,
    title: "Ремонт обвесов и других деталей",
    description:
      "Компания InStyle.PRO предлагает услуги по ремонту и восстановлению композитных деталей кузовного тюнинга любой сложности: от сколов и трещин до изготовления недостающих элементов. В случае невозможности ремонта, специалисты нашей компании помогут подобрать Вам альтернативный вариант внешнего или внутреннего тюнинга.",
  },
  {
    icon: PaintBucket,
    title: "Покраска деталей",
    description:
      "Профессиональная покраска аэродинамических обвесов и отдельных элементов в цвет кузова автомобиля или любой другой цвет. Используем качественные материалы и оборудование для получения идеального результата.",
  },
  {
    icon: Settings,
    title: "Изготовление на заказ",
    description:
      "Изготовление аэродинамических обвесов и кузовных элементов на заказ по образцу или чертежам. Матрицирование с оригинальных деталей. Возможность изготовления эксклюзивных комплектов.",
  },
]

export default function ServicesPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
        <Link href="/" className="hover:text-primary transition-colors">Главная</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Услуги</span>
      </nav>

      <h1 className="text-3xl font-bold text-foreground mb-8">Услуги</h1>

      <div className="grid gap-8 lg:grid-cols-2 mb-12">
        {services.map((service) => (
          <div
            key={service.title}
            className="bg-card border border-border rounded-lg p-6 flex flex-col gap-4"
          >
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <service.icon className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">{service.title}</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {service.description}
            </p>
          </div>
        ))}
      </div>

      {/* Workshop image */}
      <div className="relative aspect-[21/9] rounded-lg overflow-hidden">
        <Image
          src="/images/workshop.jpg"
          alt="Мастерская InStyle.PRO"
          fill
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent flex items-end p-8">
          <div>
            <h2 className="text-xl font-bold text-foreground mb-2">
              Мастерская InStyle.PRO
            </h2>
            <p className="text-sm text-muted-foreground">
              г. Новосибирск, ул. Станционная 59 | +7 (923) 702-3555
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
