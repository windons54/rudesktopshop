export interface CatalogModel {
  name: string
  slug: string
  subModels?: { name: string; slug: string }[]
}

export interface CatalogBrand {
  name: string
  slug: string
  models: CatalogModel[]
}

export const catalogData: CatalogBrand[] = [
  {
    name: "BMW",
    slug: "bmw",
    models: [
      { name: "5-Series E39", slug: "5-series-e39" },
      { name: "X5 E53", slug: "x5-e53" },
    ],
  },
  {
    name: "Honda",
    slug: "honda",
    models: [
      { name: "Accord 6", slug: "accord-6" },
      { name: "Accord 7", slug: "accord-7" },
      { name: "Accord 8", slug: "accord-8" },
      { name: "Accord 9", slug: "accord-9" },
      { name: "Civic EK", slug: "civic-ek" },
      { name: "Civic 4D", slug: "civic-4d" },
      { name: "Integra DC2", slug: "integra-dc2" },
      { name: "Integra DC5", slug: "integra-dc5" },
      { name: "Fit GD", slug: "fit-gd" },
      { name: "Prelude 5", slug: "prelude-5" },
      { name: "Torneo", slug: "torneo" },
    ],
  },
  {
    name: "Hyundai",
    slug: "hyundai",
    models: [{ name: "Solaris Sedan", slug: "solaris-sedan" }],
  },
  {
    name: "Infiniti",
    slug: "infiniti",
    models: [{ name: "FX35 QX70", slug: "fx35-qx70" }],
  },
  {
    name: "Lexus",
    slug: "lexus",
    models: [
      { name: "GS 300", slug: "gs-300" },
      { name: "GS250/350/450h", slug: "gs250-350-450h" },
      { name: "GX 470", slug: "gx-470" },
      { name: "LS 430", slug: "ls-430" },
      { name: "LX 570", slug: "lx-570" },
      { name: "RX 300", slug: "rx-300" },
      { name: "RX 330", slug: "rx-330" },
      { name: "RX 270/350/450h", slug: "rx-270-350-450h" },
    ],
  },
  {
    name: "Mazda",
    slug: "mazda",
    models: [{ name: "Atenza GH", slug: "atenza-gh" }],
  },
  {
    name: "Mitsubishi",
    slug: "mitsubishi",
    models: [
      { name: "Lancer X", slug: "lancer-x" },
      { name: "EVO CE9A", slug: "evo-ce9a" },
      { name: "EVO CP9A", slug: "evo-cp9a" },
      { name: "EVO CT9A", slug: "evo-ct9a" },
      { name: "Galant", slug: "galant" },
    ],
  },
  {
    name: "Mercedes-Benz",
    slug: "mercedes-benz",
    models: [{ name: "W210", slug: "w210" }],
  },
  {
    name: "Nissan",
    slug: "nissan",
    models: [
      { name: "Cefiro A32", slug: "cefiro-a32" },
      { name: "Cefiro A33", slug: "cefiro-a33" },
      { name: "Skyline R33", slug: "skyline-r33" },
      { name: "Skyline R34", slug: "skyline-r34" },
      { name: "Skyline V35", slug: "skyline-v35" },
      { name: "Silvia S15", slug: "silvia-s15" },
    ],
  },
  {
    name: "Subaru",
    slug: "subaru",
    models: [
      { name: "Impreza GC", slug: "impreza-gc" },
      { name: "Impreza GDA/GDB", slug: "impreza-gda-gdb" },
      { name: "Forester SF", slug: "forester-sf" },
      { name: "Forester SG", slug: "forester-sg" },
      { name: "Forester SH", slug: "forester-sh" },
      { name: "Legacy B4 BE", slug: "legacy-b4-be" },
      { name: "Legacy B4 BL", slug: "legacy-b4-bl" },
    ],
  },
  {
    name: "Toyota",
    slug: "toyota",
    models: [
      { name: "Allion 240", slug: "allion-240" },
      { name: "Allion 260", slug: "allion-260" },
      { name: "Altezza", slug: "altezza" },
      {
        name: "Aristo",
        slug: "aristo",
        subModels: [
          { name: "JZS147", slug: "jzs147" },
          { name: "JZS161", slug: "jzs161" },
        ],
      },
      {
        name: "Camry",
        slug: "camry",
        subModels: [
          { name: "XV40", slug: "xv40" },
          { name: "XV50", slug: "xv50" },
        ],
      },
      { name: "Carina 210", slug: "carina-210" },
      { name: "Carina ED", slug: "carina-ed" },
      {
        name: "Chaser",
        slug: "chaser",
        subModels: [
          { name: "JZX90", slug: "jzx90" },
          { name: "JZX100", slug: "jzx100" },
        ],
      },
      {
        name: "Caldina",
        slug: "caldina",
        subModels: [
          { name: "ST190", slug: "st190" },
          { name: "ST215", slug: "st215" },
        ],
      },
      {
        name: "Corona Exiv",
        slug: "corona-exiv",
        subModels: [{ name: "ST190", slug: "st190" }],
      },
      {
        name: "Cresta",
        slug: "cresta",
        subModels: [
          { name: "JZX90", slug: "jzx90" },
          { name: "JZX100", slug: "jzx100" },
        ],
      },
      {
        name: "Harrier",
        slug: "harrier",
        subModels: [
          { name: "ACU10", slug: "acu10" },
          { name: "ACU30", slug: "acu30" },
        ],
      },
      { name: "Ist", slug: "ist" },
      {
        name: "Land Cruiser",
        slug: "land-cruiser",
        subModels: [{ name: "LC 200", slug: "lc-200" }],
      },
      {
        name: "Land Cruiser Prado",
        slug: "land-cruiser-prado",
        subModels: [
          { name: "Prado 120", slug: "prado-120" },
          { name: "Prado 150", slug: "prado-150" },
        ],
      },
      { name: "Levin Trueno AE111", slug: "levin-trueno-ae111" },
      {
        name: "Mark II",
        slug: "mark-ii",
        subModels: [
          { name: "JZX81", slug: "jzx81" },
          { name: "JZX90", slug: "jzx90" },
          { name: "JZX100", slug: "jzx100" },
          { name: "JZX110", slug: "jzx110" },
        ],
      },
      { name: "Mark X", slug: "mark-x" },
      { name: "Premio 210", slug: "premio-210" },
      { name: "Premio 240", slug: "premio-240" },
      { name: "Verossa", slug: "verossa" },
      { name: "Vitz", slug: "vitz" },
    ],
  },
  {
    name: "Универсальные детали",
    slug: "universal",
    models: [{ name: "Уплотнительная резинка", slug: "seal-rubber" }],
  },
]

export interface Product {
  id: string
  name: string
  brand: string
  model: string
  price: number
  image: string
  description: string
  category: string
}

export const sampleProducts: Product[] = [
  {
    id: "1",
    name: "Передний бампер TTE Style",
    brand: "toyota",
    model: "aristo",
    price: 12000,
    image: "/images/news-aristo.jpg",
    description: "Стеклопластиковая копия переднего бампера TTE для Toyota Aristo JZS160/161, Lexus GS300 S16.",
    category: "Бамперы",
  },
  {
    id: "2",
    name: "Расширители арок (фендеры)",
    brand: "toyota",
    model: "mark-ii",
    price: 15000,
    image: "/images/news-mark2.jpg",
    description: "Стеклопластиковая копия расширителей арок, фендеров для Toyota Mark II JZX100.",
    category: "Расширители",
  },
  {
    id: "3",
    name: "Комплект обвеса Optional Style",
    brand: "toyota",
    model: "verossa",
    price: 25000,
    image: "/images/news-verossa.jpg",
    description: "Стеклопластиковая копия опционального обвеса для Toyota Verossa. В комплекте накладки на бамперы и пороги.",
    category: "Комплекты",
  },
  {
    id: "4",
    name: "Накладка на передний бампер Mugen",
    brand: "honda",
    model: "accord-7",
    price: 8000,
    image: "/images/hero-car.jpg",
    description: "Стеклопластиковая копия накладки на передний бампер в стиле Mugen для Honda Accord 7.",
    category: "Бамперы",
  },
  {
    id: "5",
    name: "Спойлер на крышку багажника",
    brand: "subaru",
    model: "impreza-gda-gdb",
    price: 7500,
    image: "/images/technology.jpg",
    description: "Стеклопластиковая копия спойлера для Subaru Impreza GDA/GDB WRX STI.",
    category: "Спойлеры",
  },
  {
    id: "6",
    name: "Передняя губа C-West",
    brand: "nissan",
    model: "silvia-s15",
    price: 9000,
    image: "/images/workshop.jpg",
    description: "Стеклопластиковая копия передней губы в стиле C-West для Nissan Silvia S15.",
    category: "Бамперы",
  },
  {
    id: "7",
    name: "Комплект обвеса Vertex",
    brand: "toyota",
    model: "mark-ii",
    price: 35000,
    image: "/images/news-mark2.jpg",
    description: "Полный комплект обвеса в стиле Vertex для Toyota Mark II JZX100. Передний бампер, пороги, задний бампер.",
    category: "Комплекты",
  },
  {
    id: "8",
    name: "Накладки на пороги Wald",
    brand: "lexus",
    model: "gs-300",
    price: 10000,
    image: "/images/news-aristo.jpg",
    description: "Стеклопластиковые накладки на пороги в стиле Wald для Lexus GS 300.",
    category: "Пороги",
  },
]
