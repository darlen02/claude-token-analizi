// Saf hesaplama: $ kullanmaz, test edilebilir.
import type { SessionContextBreakdown } from 'claude-code'

import type { Bilesen, BilesenTuru, HamVeri, Oneri, UsageToplam } from '../types'

export type Bilesim = Record<string, { tur: BilesenTuru; token: number }>

export type StatikBilgi = {
  /** Mesajlar dışındaki her şey: sistem istemi, araç şemaları, MCP, skill listesi, bellek… */
  statik: Bilesim
  /** Motorun "Messages" satırı. */
  mesajToken: number
  mcpSunucuSema: Record<string, number>
  mcpSunucu: number
  mcpArac: number
  skill: number
  skillAciklama: Record<string, number>
  ajanTanimi: Record<string, number>
  bellek: Record<string, number>
}

export function bosToplam(): UsageToplam {
  return { giris: 0, okunan: 0, yazilan: 0, cikti: 0, istek: 0 }
}

export function bosHam(): HamVeri {
  return {
    ana: bosToplam(),
    ajan: bosToplam(),
    tahminiUsd: 0,
    tuketim: {},
    pencere: {},
    araclar: {},
    skillYukleme: {},
    tekrarToken: 0,
    tekrarSayi: 0,
    hookToken: 0,
    ajanTuru: {},
    ajanCagri: {},
    gecmis: [],
  }
}

/** Karakterden token tahmini (Claude tokenizer'ı için ortalama ≈3,7 karakter). */
export function tahminiToken(karakter: number): number {
  return Math.ceil(karakter / 3.7)
}

type Blok = { type: string; [alan: string]: unknown }

/** Bir içerik bloğu listesinin modele giden metin uzunluğu (karakter) ve görsel sayısı. */
export function icerikUzunlugu(bloklar: readonly Blok[]): number {
  let n = 0
  for (const b of bloklar) {
    if (b.type === 'text' && typeof b.text === 'string') n += b.text.length
    else if (b.type === 'tool_use') n += JSON.stringify(b.input ?? {}).length + 40
    else if (b.type === 'tool_result') {
      const c = b.content
      if (typeof c === 'string') n += c.length
      else if (Array.isArray(c)) n += icerikUzunlugu(c as Blok[])
    } else if (b.type === 'image') n += 1600 * 3.7
    else if (b.type === 'document') n += 3000 * 3.7
    else if (b.type === 'thinking' && typeof b.thinking === 'string') n += b.thinking.length
  }
  return n
}

/** tool_result bloğunun metni (tekrar tespiti için). */
export function sonucMetni(b: Blok): string {
  const c = b.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return (c as Blok[]).map(x => (typeof x.text === 'string' ? x.text : x.type)).join('\n')
  }
  return ''
}

/** FNV-1a 32 bit: içerik tekrarını yakalamak için. */
export function ozet(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + ':' + s.length
}

/** mcp__sunucu__arac → { sunucu, arac } */
export function mcpAyristir(arac: string): { sunucu: string; arac: string } | null {
  if (!arac.startsWith('mcp__')) return null
  const parca = arac.slice(5).split('__')
  const sunucu = parca.shift() ?? '?'
  return { sunucu, arac: parca.join('__') || '?' }
}

/** Uzun kimlik biçimindeki sunucu adlarını kısaltır (ör. UUID). */
export function kisaSunucu(s: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) ? `${s.slice(0, 8)}…` : s
}

/** Bir aracın sonucunun hangi bileşene yazılacağı. */
export function aracBileseni(arac: string, ajanTuru?: string): { ad: string; tur: BilesenTuru } {
  const m = mcpAyristir(arac)
  if (m) return { ad: `Bağlı araç: ${kisaSunucu(m.sunucu)}`, tur: 'mcp' }
  if (arac === 'Agent' || arac === 'Task') return { ad: `Yardımcı Claude sonucu: ${ajanTuru ?? 'genel'}`, tur: 'agent' }
  if (arac === 'Skill') return { ad: 'Beceri kullanımı', tur: 'skill' }
  return { ad: `Araç: ${arac}`, tur: 'arac' }
}

const FIYATLAR: ReadonlyArray<[RegExp, number, number, number]> = [
  // desen, girdi, okuma, çıktı ($/milyon token, API liste fiyatı)
  [/(fable|mythos)-5-2/, 8, 0.2, 40],
  [/(fable|mythos)-5/, 10, 1, 50],
  [/opus-5-5/, 4, 0.2, 20],
  [/opus-(5|4-[5-9])/, 5, 0.5, 25],
  [/opus/, 15, 1.5, 75],
  [/sonnet-5-5/, 2, 0.1, 10],
  [/sonnet-5/, 2, 0.2, 10],
  [/sonnet/, 3, 0.3, 15],
  [/haiku-5-5/, 0.1, 0.01, 0.5],
  [/haiku/, 1, 0.1, 5],
]

export function fiyat(model: string): { girdi: number; okuma: number; cikti: number } {
  for (const [d, girdi, okuma, cikti] of FIYATLAR) if (d.test(model)) return { girdi, okuma, cikti }
  return { girdi: 5, okuma: 0.5, cikti: 25 }
}

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model: string
}

/** Bir isteğin liste fiyatıyla maliyeti: girdi tarafı ve çıktı ayrı. Yazma 1,25× sayılır. */
export function istekMaliyeti(u: Usage): { girdiUsd: number; ciktiUsd: number } {
  const f = fiyat(u.model)
  const girdiUsd =
    (u.input_tokens * f.girdi +
      u.cache_creation_input_tokens * f.girdi * 1.25 +
      u.cache_read_input_tokens * f.okuma) /
    1e6
  return { girdiUsd, ciktiUsd: (u.output_tokens * f.cikti) / 1e6 }
}

function dosyaAdi(yol: string): string {
  return yol.split(/[\\/]/).slice(-2).join('/')
}

/** /context dökümünü bileşenlere çevirir; her token yalnızca bir bileşene yazılır. */
export function statikBilesim(d: SessionContextBreakdown): StatikBilgi {
  const statik: Bilesim = {}
  const ekle = (ad: string, tur: BilesenTuru, token: number) => {
    if (token <= 0) return
    const v = statik[ad] ?? { tur, token: 0 }
    v.token += token
    statik[ad] = v
  }
  const mcpSunucuSema: Record<string, number> = {}
  const sunucular = new Set<string>()
  let mcpArac = 0
  for (const t of d.mcpTools) {
    sunucular.add(t.serverName)
    if (!t.isLoaded) continue
    mcpArac++
    mcpSunucuSema[t.serverName] = (mcpSunucuSema[t.serverName] ?? 0) + t.tokens
  }
  const skillAciklama: Record<string, number> = {}
  for (const s of d.skills?.skillFrontmatter ?? []) skillAciklama[s.name] = s.tokens
  const ajanTanimi: Record<string, number> = {}
  for (const a of d.agents) ajanTanimi[a.agentType] = a.tokens
  const bellek: Record<string, number> = {}
  for (const m of d.memoryFiles) bellek[dosyaAdi(m.path)] = m.tokens

  let mesajToken = 0
  for (const c of d.categories) {
    if (c.kind !== 'used') continue
    const ad = c.name.toLowerCase()
    if (ad.includes('message')) {
      mesajToken += c.tokens
    } else if (ad.includes('mcp')) {
      const top = Object.values(mcpSunucuSema).reduce((a, b) => a + b, 0)
      for (const [s, tk] of Object.entries(mcpSunucuSema)) {
        ekle(`Bağlı araç: ${kisaSunucu(s)}`, 'mcp', top > 0 ? Math.round((c.tokens * tk) / top) : 0)
      }
      if (top === 0) ekle('Bağlı araçların tanıtımı', 'mcp', c.tokens)
    } else if (ad.includes('skill')) {
      ekle('Beceri listesi', 'skill', c.tokens)
    } else if (ad.includes('agent')) {
      ekle('Yardımcı Claude tanımları', 'agent', c.tokens)
    } else if (ad.includes('memory')) {
      const top = Object.values(bellek).reduce((a, b) => a + b, 0)
      for (const [f, tk] of Object.entries(bellek)) {
        ekle(`Not dosyası: ${f}`, 'bellek', top > 0 ? Math.round((c.tokens * tk) / top) : 0)
      }
      if (top === 0) ekle('Not dosyaları', 'bellek', c.tokens)
    } else if (ad.includes('system prompt')) {
      ekle("Claude'un temel talimatları", 'sistem', c.tokens)
    } else if (ad.includes('system tool')) {
      ekle("Claude'un kendi araçlarının tanıtımı", 'sistem', c.tokens)
    } else if (ad.includes('command')) {
      ekle('Komut listesi', 'sistem', c.tokens)
    } else {
      ekle(c.name, 'diger', c.tokens)
    }
  }
  return {
    statik,
    mesajToken,
    mcpSunucuSema,
    mcpSunucu: sunucular.size,
    mcpArac,
    skill: d.skills?.includedSkills ?? 0,
    skillAciklama,
    ajanTanimi,
    bellek,
  }
}

/**
 * Bir ana iş parçacığı isteğinin gerçek girdisini bileşenlere dağıtır: statik
 * kısımlar /context'teki boyutlarıyla, mesaj kısmı penceredeki tahmini paylarla
 * ölçeklenir. Toplam her zaman isteğin gerçek girdisine eşittir.
 */
export function dagit(
  gercekGirdi: number,
  statik: Bilesim,
  pencere: Bilesim,
): Bilesim {
  const sonuc: Bilesim = {}
  let statikTop = 0
  for (const v of Object.values(statik)) statikTop += v.token
  // Statik kısım gerçek girdiden büyük görünürse (tahmin hatası) orantılı küçült.
  const statikOran = statikTop > gercekGirdi && statikTop > 0 ? gercekGirdi / statikTop : 1
  for (const [ad, v] of Object.entries(statik)) {
    sonuc[ad] = { tur: v.tur, token: v.token * statikOran }
  }
  const kalan = Math.max(0, gercekGirdi - statikTop * statikOran)
  let pencereTop = 0
  for (const v of Object.values(pencere)) pencereTop += v.token
  if (kalan > 0) {
    if (pencereTop > 0) {
      for (const [ad, v] of Object.entries(pencere)) {
        const onceki = sonuc[ad]
        const pay = (kalan * v.token) / pencereTop
        sonuc[ad] = { tur: v.tur, token: (onceki?.token ?? 0) + pay }
      }
    } else {
      sonuc['Konuşma (ayrıştırılamadı)'] = { tur: 'mesaj', token: kalan }
    }
  }
  return sonuc
}

export function tokenYaz(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`
  return String(Math.round(n))
}

export function dolar(x: number): string {
  if (x < 0.01) return '<$0.01'
  return `$${x < 10 ? x.toFixed(2) : x.toFixed(1)}`
}

const BLOKLAR = '▁▂▃▄▅▆▇█'

export function kivilcim(degerler: readonly number[], genislik: number): string {
  const d = degerler.slice(-genislik)
  if (d.length === 0) return ''
  const enb = Math.max(...d)
  const enk = Math.min(...d)
  const aralik = enb - enk || 1
  return d.map(v => BLOKLAR[Math.round(((v - enk) / aralik) * (BLOKLAR.length - 1))]).join('')
}

export type OneriGirdisi = {
  ham: HamVeri
  bilgi: StatikBilgi | null
  baglamYuzde: number | null
}

/** Ölçümlerden öneriler üretir; her öneride tasarruf tahmini vardır. */
export function oneriUret(g: OneriGirdisi): Oneri[] {
  const o: Oneri[] = []
  const istek = Math.max(1, g.ham.ana.istek)
  const b = g.bilgi

  if (b) {
    // Kullanılmadığı hâlde bağlamda duran MCP sunucuları.
    for (const [sunucu, sema] of Object.entries(b.mcpSunucuSema)) {
      const cagri = Object.entries(g.ham.araclar)
        .filter(([a]) => mcpAyristir(a)?.sunucu === sunucu)
        .reduce((t, [, v]) => t + v.cagri, 0)
      if (cagri === 0 && sema >= 300 && g.ham.ana.istek >= 3) {
        o.push({
          baslik: `"${kisaSunucu(sunucu)}" aracı hiç kullanılmadı`,
          ayrinti: `Bağlı olduğu için kendini her mesajda tanıtıyor (${tokenYaz(sema)} token; bu sohbette toplam ≈${tokenYaz(sema * istek)}). Bu projede gerekmiyorsa kapatabilirsin.`,
          tasarruf: sema,
          birim: 'istek',
        })
      }
    }
    // Uzun skill açıklamaları.
    const uzun = Object.entries(b.skillAciklama)
      .filter(([, t]) => t > 200)
      .sort((x, y) => y[1] - x[1])
    if (uzun.length > 0) {
      const fazla = uzun.reduce((t, [, n]) => t + (n - 80), 0)
      o.push({
        baslik: `${uzun.length} becerinin açıklaması uzun`,
        ayrinti: `En uzunları: ${uzun
          .slice(0, 3)
          .map(([a, t]) => `${a} (${t})`)
          .join(', ')}. Bu açıklamalar her mesajda okunur; kullanmadığın becerileri kapatabilirsin.`,
        tasarruf: fazla,
        birim: 'istek',
      })
    }
    // Hiç çağrılmayan özel agent tanımları.
    const kullanilmayan = Object.entries(b.ajanTanimi).filter(
      ([tur, t]) => t > 150 && !(g.ham.ajanCagri[tur] ?? 0),
    )
    const ajanTop = kullanilmayan.reduce((t, [, n]) => t + n, 0)
    if (ajanTop > 600 && g.ham.ana.istek >= 5) {
      o.push({
        baslik: `${kullanilmayan.length} yardımcı Claude tanımı hiç kullanılmadı`,
        ayrinti: `Her mesajda ${tokenYaz(ajanTop)} token yer kaplıyorlar. Gereksizleri kapatabilirsin.`,
        tasarruf: ajanTop,
        birim: 'istek',
      })
    }
    // Büyük bellek dosyaları.
    for (const [dosya, t] of Object.entries(b.bellek)) {
      if (t > 4000) {
        o.push({
          baslik: `Not dosyası çok uzun: ${dosya}`,
          ayrinti: `${tokenYaz(t)} token her mesajda okunuyor. Kısaltmak ya da parçalara bölmek tasarruf sağlar.`,
          tasarruf: t - 2000,
          birim: 'istek',
        })
      }
    }
  }

  // Fazla çıktı üreten araçlar (MCP ve yerleşik).
  for (const [arac, v] of Object.entries(g.ham.araclar)) {
    const ort = v.token / Math.max(1, v.cagri)
    if (v.cagri > 0 && (ort > 4000 || v.enBuyuk > 12000)) {
      const m = mcpAyristir(arac)
      o.push({
        baslik: `"${m ? `${kisaSunucu(m.sunucu)} › ${m.arac}` : arac}" çok uzun sonuç döndürüyor`,
        ayrinti: `${v.cagri} kez kullanıldı, her seferinde ortalama ~${tokenYaz(ort)} token (en uzunu ~${tokenYaz(v.enBuyuk)}). Bu sonuçlar sohbette kalıp sonraki her cevapta yeniden okunuyor; daha dar sorgu (daha az satır/sayfa) iyi olur.`,
        tasarruf: Math.max(0, Math.round(v.token - v.cagri * 1500)),
        birim: 'kez',
      })
    }
  }

  // Tekrar tekrar yüklenen skill'ler.
  for (const [skill, v] of Object.entries(g.ham.skillYukleme)) {
    if (v.sayi > 1) {
      o.push({
        baslik: `"${skill}" becerisi ${v.sayi} kez yüklendi`,
        ayrinti: `Her yüklemede aynı metin (~${tokenYaz(v.token / v.sayi)} token) sohbete yeniden eklendi.`,
        tasarruf: Math.round((v.token / v.sayi) * (v.sayi - 1)),
        birim: 'kez',
      })
    }
  }

  // Aynı içeriğin tekrar gönderilmesi.
  if (g.ham.tekrarToken > 1500) {
    o.push({
      baslik: `Aynı içerik ${g.ham.tekrarSayi} kez tekrar okundu`,
      ayrinti: `Örneğin aynı dosya birkaç kez okunmuş; ~${tokenYaz(g.ham.tekrarToken)} token boşa gitti.`,
      tasarruf: g.ham.tekrarToken,
      birim: 'kez',
    })
  }

  // Hook'ların eklediği bağlam.
  if (g.ham.hookToken > 3000) {
    o.push({
      baslik: 'Otomatik eklentiler (hook) sohbete çok yazı ekliyor',
      ayrinti: `Toplam ~${tokenYaz(g.ham.hookToken)} token eklediler. Daha kısa yazmaları tasarruf sağlar.`,
      tasarruf: Math.round(g.ham.hookToken * 0.6),
      birim: 'kez',
    })
  }

  // Ağır agent'lar.
  const ajanTop = g.ham.ajan.giris + g.ham.ajan.okunan + g.ham.ajan.yazilan + g.ham.ajan.cikti
  const anaTop = g.ham.ana.giris + g.ham.ana.okunan + g.ham.ana.yazilan + g.ham.ana.cikti
  if (ajanTop > 200_000 && ajanTop > anaTop * 0.3) {
    const enAgir = Object.entries(g.ham.tuketim)
      .filter(([, v]) => v.tur === 'agent' && v.kesin)
      .sort((x, y) => y[1].token - x[1].token)[0]
    o.push({
      baslik: `Yardımcı Claude'lar harcamanın %${Math.round((ajanTop / (ajanTop + anaTop)) * 100)}'ini yaptı`,
      ayrinti: `${enAgir ? `En çok harcayan: ${enAgir[0]} (${tokenYaz(enAgir[1].token)}). ` : ''}Onlara daha kısa ve net görevler vermek harcamayı azaltır.`,
      tasarruf: Math.round(ajanTop * 0.3),
      birim: 'kez',
    })
  }

  // Bağlam doluluğu.
  if (g.baglamYuzde !== null && g.baglamYuzde >= 60 && b) {
    o.push({
      baslik: `Claude'un hafızası %${g.baglamYuzde} dolu`,
      ayrinti: `/compact yazarsan Claude sohbeti özetler; her cevapta yeniden okunan ~${tokenYaz(b.mesajToken)} token büyük ölçüde küçülür. Ya da yeni bir sohbete geçebilirsin.`,
      tasarruf: Math.round(b.mesajToken * 0.7),
      birim: 'istek',
    })
  }

  // Her istekteki tasarrufu, kalan istek sayısını bilmeden kıyaslamak için ×10 ağırlıklandır.
  return o
    .sort((x, y) => (y.birim === 'istek' ? y.tasarruf * 10 : y.tasarruf) - (x.birim === 'istek' ? x.tasarruf * 10 : x.tasarruf))
    .slice(0, 8)
}

/** Bir ekin (attachment) türünden bileşeni. */
export function ekBileseni(tur: string): { ad: string; tur: BilesenTuru } {
  const t = tur.toLowerCase()
  if (t.includes('hook')) return { ad: 'Otomatik eklentilerin (hook) notları', tur: 'hook' }
  if (t.includes('skill')) return { ad: 'Beceri listesi (ek)', tur: 'skill' }
  if (t.includes('mcp')) return { ad: 'Bağlı araç talimatları', tur: 'mcp' }
  if (t.includes('deferred_tools') || t.includes('agent_listing')) {
    return { ad: 'Araç listeleri', tur: 'sistem' }
  }
  if (t.includes('memory') || t.includes('instructions') || t.includes('claude_md')) {
    return { ad: 'Not ve talimat ekleri', tur: 'bellek' }
  }
  return { ad: 'Uygulamanın eklediği bilgiler', tur: 'sistem' }
}

type Satir = {
  type?: string
  isSidechain?: boolean
  isMeta?: boolean
  isCompactSummary?: boolean
  subtype?: string
  sourceToolUseID?: string
  rendered?: unknown
  attachment?: { type?: string }
  message?: {
    id?: string
    model?: string
    content?: unknown
    usage?: Partial<Usage>
  }
}

/**
 * Transcript'i (JSONL) okuyup oturum başından beri gerçek usage toplamlarını,
 * istek geçmişini, araç istatistiklerini ve şu anki pencerenin bileşimini çıkarır.
 * Mod oturumun ortasında yüklendiğinde (ya da --resume) kullanılır.
 */
export function transcriptAyristir(
  metin: string,
  h: HamVeri,
): { girdiUsd: number; ciktiUsd: number } {
  let girdiUsd = 0
  let ciktiUsd = 0
  const araclar = new Map<string, { ad: string; ajanTuru?: string; skill?: string }>()
  const goruldu = new Set<string>()
  const tekrar = new Map<string, number>()
  const pencereEkle = (ad: string, tur: BilesenTuru, tk: number) => {
    if (tk <= 0) return
    const v = h.pencere[ad] ?? { tur, token: 0 }
    v.token += tk
    h.pencere[ad] = v
  }
  for (const satir of metin.split('\n')) {
    if (!satir) continue
    let o: Satir
    try {
      o = JSON.parse(satir) as Satir
    } catch {
      continue
    }
    if (o.isSidechain) continue
    const icerik = o.message?.content
    const bloklar: Blok[] =
      typeof icerik === 'string'
        ? [{ type: 'text', text: icerik }]
        : Array.isArray(icerik)
          ? (icerik as Blok[])
          : []

    if (o.type === 'system' && o.subtype === 'compact_boundary') {
      h.pencere = {}
      continue
    }
    if (o.type === 'assistant') {
      for (const b of bloklar) {
        if (b.type !== 'tool_use') continue
        const ad = String(b.name ?? '?')
        const girdi = (b.input ?? {}) as Record<string, unknown>
        const kayit: { ad: string; ajanTuru?: string; skill?: string } = { ad }
        if (ad === 'Agent' || ad === 'Task') {
          kayit.ajanTuru = String(girdi.subagent_type ?? 'general-purpose')
          h.ajanCagri[kayit.ajanTuru] = (h.ajanCagri[kayit.ajanTuru] ?? 0) + 1
        }
        if (ad === 'Skill') kayit.skill = String(girdi.skill ?? '?')
        araclar.set(String(b.id), kayit)
        const a = h.araclar[ad] ?? { cagri: 0, token: 0, enBuyuk: 0 }
        a.cagri += 1
        h.araclar[ad] = a
      }
      pencereEkle('Claude yanıtları (bağlamda)', 'mesaj', tahminiToken(icerikUzunlugu(bloklar)))
      const u = o.message?.usage
      const id = o.message?.id
      if (u && id && !goruldu.has(id) && o.message?.model && !o.message.model.startsWith('<')) {
        goruldu.add(id)
        const tam: Usage = {
          input_tokens: u.input_tokens ?? 0,
          output_tokens: u.output_tokens ?? 0,
          cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
          model: o.message.model,
        }
        h.ana.giris += tam.input_tokens
        h.ana.okunan += tam.cache_read_input_tokens
        h.ana.yazilan += tam.cache_creation_input_tokens
        h.ana.cikti += tam.output_tokens
        h.ana.istek += 1
        const m = istekMaliyeti(tam)
        h.tahminiUsd += m.girdiUsd + m.ciktiUsd
        girdiUsd += m.girdiUsd
        ciktiUsd += m.ciktiUsd
        h.gecmis.push(tam.input_tokens + tam.cache_read_input_tokens + tam.cache_creation_input_tokens)
      }
      continue
    }
    if (o.type === 'user') {
      const sonuclar = bloklar.filter(b => b.type === 'tool_result')
      if (sonuclar.length > 0) {
        for (const b of sonuclar) {
          const k = araclar.get(String(b.tool_use_id))
          const ad = k?.ad ?? '?'
          const tk = tahminiToken(icerikUzunlugu([b]))
          const a = h.araclar[ad] ?? { cagri: 0, token: 0, enBuyuk: 0 }
          a.token += tk
          a.enBuyuk = Math.max(a.enBuyuk, tk)
          h.araclar[ad] = a
          const s = sonucMetni(b)
          if (s.length > 400) {
            const oz = ozet(s)
            const n = (tekrar.get(oz) ?? 0) + 1
            tekrar.set(oz, n)
            if (n > 1) {
              h.tekrarToken += tk
              h.tekrarSayi += 1
            }
          }
          const bil = aracBileseni(ad, k?.ajanTuru)
          pencereEkle(bil.ad, bil.tur, tk)
        }
        continue
      }
      const tk = tahminiToken(icerikUzunlugu(bloklar))
      if (o.isCompactSummary) pencereEkle('Eski sohbetin özeti', 'mesaj', tk)
      else if (o.sourceToolUseID) {
        const k = araclar.get(o.sourceToolUseID)
        if (k?.skill) {
          pencereEkle(`Skill: ${k.skill}`, 'skill', tk)
          const s = h.skillYukleme[k.skill] ?? { sayi: 0, token: 0 }
          s.sayi += 1
          s.token += tk
          h.skillYukleme[k.skill] = s
        } else {
          const bil = aracBileseni(k?.ad ?? '?')
          pencereEkle(bil.ad, bil.tur, tk)
        }
      } else if (o.isMeta) pencereEkle('Uygulama notları', 'sistem', tk)
      else pencereEkle('Senin mesajların', 'mesaj', tk)
      continue
    }
    if (o.type === 'attachment' && o.rendered !== undefined) {
      const tur = String(o.attachment?.type ?? '')
      const tk = tahminiToken(JSON.stringify(o.rendered).length)
      const bil = ekBileseni(tur)
      if (bil.tur === 'hook') h.hookToken += tk
      pencereEkle(bil.ad, bil.tur, tk)
    }
  }
  return { girdiUsd, ciktiUsd }
}

/** Bir alt agent transcript'inin gerçek usage toplamı. */
export function ajanTranscripti(metin: string): { usage: UsageToplam; usd: number } {
  const t = bosToplam()
  let usd = 0
  const goruldu = new Set<string>()
  for (const satir of metin.split('\n')) {
    if (!satir.includes('"usage"')) continue
    let o: Satir
    try {
      o = JSON.parse(satir) as Satir
    } catch {
      continue
    }
    const u = o.message?.usage
    const id = o.message?.id
    if (o.type !== 'assistant' || !u || !id || goruldu.has(id) || !o.message?.model) continue
    goruldu.add(id)
    const tam: Usage = {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      model: o.message.model,
    }
    t.giris += tam.input_tokens
    t.okunan += tam.cache_read_input_tokens
    t.yazilan += tam.cache_creation_input_tokens
    t.cikti += tam.output_tokens
    t.istek += 1
    const m = istekMaliyeti(tam)
    usd += m.girdiUsd + m.ciktiUsd
  }
  return { usage: t, usd }
}

/** Tüketim sözlüğünü sıralı, küçükleri "Diğer"de toplanmış listeye çevirir. */
export function sirala(
  s: Record<string, { tur: BilesenTuru; token: number; usd: number; kesin: boolean }>,
  enFazla: number,
): Bilesen[] {
  const liste = Object.entries(s)
    .map(([ad, v]) => ({ ad, tur: v.tur, token: Math.round(v.token), usd: v.usd, kesin: v.kesin }))
    .filter(b => b.token > 0)
    .sort((a, b) => b.token - a.token)
  if (liste.length <= enFazla) return liste
  const bas = liste.slice(0, enFazla - 1)
  const kuyruk = liste.slice(enFazla - 1)
  bas.push({
    ad: `Diğer (${kuyruk.length})`,
    tur: 'diger',
    token: kuyruk.reduce((t, b) => t + b.token, 0),
    usd: kuyruk.reduce((t, b) => t + b.usd, 0),
    kesin: kuyruk.every(b => b.kesin),
  })
  return bas
}
