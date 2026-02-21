import Link from "next/link"
import { ChevronRight, Phone, Mail, MapPin, Clock } from "lucide-react"

export default function ContactsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
        <Link href="/" className="hover:text-primary transition-colors">Главная</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Контакты</span>
      </nav>

      <h1 className="text-3xl font-bold text-foreground mb-8">Контакты</h1>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Contact info */}
        <div className="flex flex-col gap-6">
          <div className="bg-card border border-border rounded-lg p-6 flex flex-col gap-6">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <MapPin className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Адрес</h3>
                <p className="text-sm text-muted-foreground">
                  630096, г. Новосибирск, ул. Станционная 59
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Phone className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Телефон</h3>
                <a
                  href="tel:+79237023555"
                  className="text-sm text-primary hover:text-primary/80 transition-colors font-medium"
                >
                  +7 (923) 702-3555
                </a>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Электронная почта</h3>
                <a
                  href="mailto:in-style.pro@mail.ru"
                  className="text-sm text-primary hover:text-primary/80 transition-colors"
                >
                  in-style.pro@mail.ru
                </a>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Режим работы</h3>
                <p className="text-sm text-muted-foreground">
                  Пн-Пт: 10:00 - 19:00
                </p>
                <p className="text-sm text-muted-foreground">
                  Сб: 10:00 - 16:00
                </p>
                <p className="text-sm text-muted-foreground">
                  Вс: выходной
                </p>
              </div>
            </div>
          </div>

          {/* Social links */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-sm font-semibold text-foreground mb-4">Мы в сети</h3>
            <div className="flex flex-col gap-3">
              {[
                { name: "VKontakte", url: "https://vk.com" },
                { name: "Drive2.ru", url: "https://drive2.ru" },
                { name: "Drom.ru", url: "https://drom.ru" },
              ].map((social) => (
                <a
                  key={social.name}
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  {social.name}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Map placeholder */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="aspect-square flex items-center justify-center bg-secondary">
            <div className="text-center p-8">
              <MapPin className="h-12 w-12 text-primary mx-auto mb-4" />
              <h3 className="text-lg font-bold text-foreground mb-2">
                Схема проезда
              </h3>
              <p className="text-sm text-muted-foreground mb-1">
                г. Новосибирск, ул. Станционная 59
              </p>
              <p className="text-xs text-muted-foreground">
                Рядом с остановкой общественного транспорта
              </p>
              <a
                href="https://maps.google.com/?q=Новосибирск+Станционная+59"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-4 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                Открыть на карте
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
