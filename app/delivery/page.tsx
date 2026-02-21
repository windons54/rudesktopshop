import Link from "next/link"
import { ChevronRight, CreditCard, Truck, Package, Clock, MapPin, ShieldCheck } from "lucide-react"

const paymentMethods = [
  {
    icon: CreditCard,
    title: "Банковский перевод",
    description: "Оплата на расчетный счет компании. Для юридических и физических лиц.",
  },
  {
    icon: CreditCard,
    title: "Наличный расчет",
    description: "Оплата наличными при получении товара в нашей мастерской.",
  },
  {
    icon: CreditCard,
    title: "Перевод на карту",
    description: "Перевод на банковскую карту Сбербанк. Удобно для физических лиц.",
  },
]

const deliveryMethods = [
  {
    icon: MapPin,
    title: "Самовывоз",
    description: "Бесплатный самовывоз из нашей мастерской по адресу: г. Новосибирск, ул. Станционная 59.",
  },
  {
    icon: Truck,
    title: "Транспортные компании",
    description: "Доставка транспортными компаниями (ПЭК, Деловые Линии, ЖелДорЭкспедиция и др.) по всей России и в Казахстан.",
  },
  {
    icon: Package,
    title: "Курьерская доставка",
    description: "Курьерская доставка по Новосибирску. Стоимость рассчитывается индивидуально.",
  },
]

const deliveryInfo = [
  {
    icon: Clock,
    title: "Сроки отгрузки",
    description: "Отгрузка товара осуществляется в течение 1-3 рабочих дней после подтверждения оплаты.",
  },
  {
    icon: Package,
    title: "Упаковка",
    description: "Все детали тщательно упаковываются в пузырчатую пленку и гофрокартон для безопасной транспортировки.",
  },
  {
    icon: ShieldCheck,
    title: "Гарантия",
    description: "Гарантия на все изделия - 12 месяцев. В случае обнаружения брака производим замену или возврат.",
  },
]

export default function DeliveryPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
        <Link href="/" className="hover:text-primary transition-colors">Главная</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Оплата и доставка</span>
      </nav>

      <h1 className="text-3xl font-bold text-foreground mb-8">Оплата и доставка</h1>

      {/* Payment */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-foreground mb-6">Способы оплаты</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {paymentMethods.map((method) => (
            <div
              key={method.title}
              className="bg-card border border-border rounded-lg p-6 flex flex-col gap-3"
            >
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <method.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">{method.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {method.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Delivery */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-foreground mb-6">Способы доставки</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {deliveryMethods.map((method) => (
            <div
              key={method.title}
              className="bg-card border border-border rounded-lg p-6 flex flex-col gap-3"
            >
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <method.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">{method.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {method.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Additional info */}
      <section>
        <h2 className="text-xl font-bold text-foreground mb-6">Дополнительная информация</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {deliveryInfo.map((info) => (
            <div
              key={info.title}
              className="bg-card border border-border rounded-lg p-6 flex flex-col gap-3"
            >
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <info.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">{info.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {info.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <div className="mt-12 bg-card border border-border rounded-lg p-8 text-center">
        <h2 className="text-lg font-bold text-foreground mb-2">
          Есть вопросы по доставке?
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Свяжитесь с нами для расчета стоимости доставки в ваш город
        </p>
        <a
          href="tel:+79237023555"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-lg hover:bg-primary/90 transition-colors"
        >
          +7 (923) 702-3555
        </a>
      </div>
    </div>
  )
}
