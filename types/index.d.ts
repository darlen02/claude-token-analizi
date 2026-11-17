/** Bir bileşenin türü: sıralamada ikon ve gruplama için. */
export type BilesenTuru =
  | 'skill'
  | 'mcp'
  | 'arac'
  | 'agent'
  | 'hook'
  | 'sistem'
  | 'bellek'
  | 'mesaj'
  | 'cikti'
  | 'diger'

/** Oturum boyunca bir bileşene düşen token ve maliyet. */
export type Bilesen = {
  ad: string
  tur: BilesenTuru
  token: number
  usd: number
  /** true: API usage'ından doğrudan ölçüldü. false: tahmini dağılım. */
  kesin: boolean
}

/** Bir optimizasyon önerisi. */
export type Oneri = {
  baslik: string
  ayrinti: string
  /** Tahmini tasarruf (token). */
  tasarruf: number
  /** Tasarrufun birimi: bir kez mi, her istekte mi. */
  birim: 'kez' | 'istek'
}

/** API'nin döndürdüğü gerçek usage toplamları. */
export type UsageToplam = {
  giris: number
  okunan: number
  yazilan: number
  cikti: number
  istek: number
}

/** Panelin ve barın çizdiği hazır analiz. */
export type Analiz = {
  ana: UsageToplam
  ajan: UsageToplam
  /** Motorun kendi maliyet defteri (/cost); yoksa null. */
  defterUsd: number | null
  /** Liste fiyatıyla bizim hesapladığımız. */
  tahminiUsd: number
  baglam: { yuzde: number; token: number; pencere: number } | null
  /** Oturum boyunca tüketim (her istekte yeniden gönderilenler dahil), büyükten küçüğe. */
  bilesenler: Bilesen[]
  /** Şu anki bağlam penceresinin bileşimi. */
  pencere: Bilesen[]
  mcpSunucu: number
  mcpArac: number
  skill: number
  /** Ana iş parçacığında istek başına bağlam boyutu (son 60). */
  gecmis: number[]
  oneriler: Oneri[]
  onceki: { oturum: number; ortToken: number; ortUsd: number } | null
  dokumZamani: number | null
  guncellendi: number
}

/** Yeniden yüklemede kaybolmasın diye saklanan ham sayaçlar. */
export type HamVeri = {
  ana: UsageToplam
  ajan: UsageToplam
  tahminiUsd: number
  tuketim: Record<string, { tur: BilesenTuru; token: number; usd: number; kesin: boolean }>
  pencere: Record<string, { tur: BilesenTuru; token: number }>
  araclar: Record<string, { cagri: number; token: number; enBuyuk: number }>
  skillYukleme: Record<string, { sayi: number; token: number }>
  tekrarToken: number
  tekrarSayi: number
  hookToken: number
  ajanTuru: Record<string, string>
  ajanCagri: Record<string, number>
  gecmis: number[]
  /** true: sayaçlar oturum başından (transcript'ten) yüklendi. */
  bastan?: boolean
  /** Bileşen adlarının sürümü (adlar değişince eski kayıt baştan kurulur). */
  surum?: number
}

export type Sekme = 'ozet' | 'bilesen' | 'oneri' | 'gecmis'

declare module 'claude-code' {
  interface PluginState {
    'token-analizi': {
      analiz: Analiz | null
      ham: HamVeri | null
      sekme: Sekme
      widgetAcildi: boolean
    }
  }
}
