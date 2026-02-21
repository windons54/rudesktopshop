import Link from "next/link"
import { Phone, Mail, MapPin } from "lucide-react"

export function SiteFooter() {
  return (
    <footer className="bg-secondary border-t border-border">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="grid gap-8 md:grid-cols-3">
          {/* Company info */}
          <div className="flex flex-col gap-4">
            <Link href="/" className="flex flex-col">
              <span className="text-xl font-bold tracking-tight text-foreground">
                InStyle<span className="text-primary">.PRO</span>
              </span>
              <span className="text-xs text-muted-foreground">
                Производство аэродинамических обвесов
              </span>
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Мастерская по автотюнингу экстерьера. Производство, продажа, установка и ремонт аэродинамических обвесов с 2007 года.
            </p>
          </div>

          {/* Navigation */}
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              Навигация
            </h3>
            <nav className="flex flex-col gap-2">
              {[
                { href: "/catalog", label: "Каталог" },
                { href: "/services", label: "Услуги" },
                { href: "/delivery", label: "Оплата и доставка" },
                { href: "/technology", label: "Технология" },
                { href: "/contacts", label: "Контакты" },
                { href: "/news", label: "Новости" },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Contact info */}
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              Контакты
            </h3>
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span className="text-sm text-muted-foreground">
                  630096, г. Новосибирск, ул. Станционная 59
                </span>
              </div>
              <a
                href="tel:+79237023555"
                className="flex items-center gap-3 text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                <Phone className="h-4 w-4 text-primary shrink-0" />
                +7 (923) 702-3555
              </a>
              <a
                href="mailto:in-style.pro@mail.ru"
                className="flex items-center gap-3 text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                <Mail className="h-4 w-4 text-primary shrink-0" />
                in-style.pro@mail.ru
              </a>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">
            {'Copyright 2013-2026 InStyle.PRO. Все права защищены.'}
          </p>
        </div>
      </div>
    </footer>
  )
}
