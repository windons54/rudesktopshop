import Image from "next/image"
import Link from "next/link"

interface NewsCardProps {
  date: string
  title: string
  description: string
  image: string
  href: string
}

export function NewsCard({ date, title, description, image, href }: NewsCardProps) {
  return (
    <Link
      href={href}
      className="bg-card border border-border rounded-lg overflow-hidden group hover:border-primary/50 transition-colors flex flex-col"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <Image
          src={image}
          alt={title}
          fill
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </div>
      <div className="p-4 flex flex-col gap-2 flex-1">
        <span className="text-xs text-primary font-medium">{date}</span>
        <h3 className="text-sm font-semibold text-foreground leading-snug">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
          {description}
        </p>
      </div>
    </Link>
  )
}
