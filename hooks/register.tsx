import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Analiz, Bilesen, BilesenTuru, HamVeri, Sekme, UsageToplam } from '../types'
import {
  aracBileseni,
  bosHam,
  dagit,
  dolar,
  icerikUzunlugu,
  istekMaliyeti,
  kivilcim,
  oneriUret,
  ozet,
  sirala,
  sonucMetni,
  statikBilesim,
  ajanTranscripti,
  tahminiToken,
  tokenYaz,
  transcriptAyristir,
} from './analiz'
import type { Bilesim, StatikBilgi } from './analiz'

const analizA = atom({ plugin: 'token-analizi', key: 'analiz' } as const, null)
const hamA = atom({ plugin: 'token-analizi', key: 'ham' } as const, null)
const sekmeA = atom({ plugin: 'token-analizi', key: 'sekme' } as const, 'ozet')
const widgetA = atom({ plugin: 'token-analizi', key: 'widgetAcildi' } as const, false)

type Dolar = EngineInterface

const PANEL = 'token-analizi'
const DOKUM_ARALIGI = 60_000 // /context dökümünü en sık dakikada bir yenile
const CIKTI = "Claude'un yazdıkları (cevap + düşünme)"

/** Bileşen adları değişince artırılır; eski adlı kayıt transcript'ten yeniden kurulur. */
const SURUM = 2

const IKON: Record<BilesenTuru, string> = {
  skill: '🧩',
  mcp: '🔌',
  arac: '🛠',
  agent: '🤖',
  hook: '🪝',
  sistem: '⚙',
  bellek: '📄',
  mesaj: '💬',
  cikti: '✍',
  diger: '·',
}

const YESIL = '#10B981'
const VURGU = '#F59E0B'

// Modülün belleği: yeniden yüklemede sıfırlanır, session.start'ta $.state'ten geri yüklenir.
let ham: HamVeri = bosHam()
let bilgi: StatikBilgi | null = null
let dokumZamani: number | null = null
let sonGirdi = 0
let sonSkill: string | null = null
let bantAcik = true
let widgetIstegi = true
/** Mod yüklenmeden önceki isteklerin girdileri: ilk /context dökümünden sonra dağıtılır. */
let onYukleme: { girdiler: number[]; girdiUsd: number } | null = null
/** Transcript okunamadıysa açıklanamayan konuşma payı ayrı gösterilir. */
let oncekiBilinmiyor = false
let zamanlayiciKurulu = false
const aracKaydi = new Map<string, { arac: string; ajan?: string; ajanTuru?: string }>()
const gorulenler = new Map<string, number>()

function toplamToken(u: UsageToplam): number {
  return u.giris + u.okunan + u.yazilan + u.cikti
}

function topla(
  hedef: string,
  tur: BilesenTuru,
  token: number,
  usd: number,
  kesin: boolean,
) {
  const v = ham.tuketim[hedef] ?? { tur, token: 0, usd: 0, kesin }
  v.token += token
  v.usd += usd
  v.kesin = v.kesin && kesin
  ham.tuketim[hedef] = v
}

function pencereyeEkle(ad: string, tur: BilesenTuru, token: number) {
  if (token <= 0) return
  const v = ham.pencere[ad] ?? { tur, token: 0 }
  v.token += token
  ham.pencere[ad] = v
}

/** Değişiklikleri biriktirip 2 sn sonra tek seferde işler. */
function kirlet($: Dolar) {
  if (zamanlayiciKurulu) return
  zamanlayiciKurulu = true
  $.clock.after(2000, () => {
    zamanlayiciKurulu = false
    void isle($, false).catch(() => undefined)
  })
}

/** Analizi yeniden hesaplar ve barın/panelin okuduğu state'e yazar. */
async function isle($: Dolar, dokumIste: boolean) {
  const simdi = await $.clock.now()
  const dokumGerek =
    dokumIste || bilgi === null || dokumZamani === null || simdi - dokumZamani > DOKUM_ARALIGI
  const u = dokumGerek ? await $.session.usage({ breakdown: 'summary' }) : await $.session.usage()
  if (u.context.breakdown) {
    bilgi = statikBilesim(u.context.breakdown)
    dokumZamani = simdi
  }
  if (bilgi && oncekiBilinmiyor) {
    oncekiBilinmiyor = false
    let bilinen = 0
    for (const v of Object.values(ham.pencere)) bilinen += v.token
    pencereyeEkle('Önceki sohbet (ayrıntı yok)', 'mesaj', bilgi.mesajToken - bilinen)
  }
  if (bilgi && onYukleme) {
    // Yükleme öncesi istekler: şimdiki bileşime göre dağıtılır (tahmini).
    const { girdiler, girdiUsd } = onYukleme
    onYukleme = null
    const top = girdiler.reduce((t, g) => t + g, 0)
    for (const g of girdiler) {
      for (const [ad, v] of Object.entries(dagit(g, bilgi.statik, ham.pencere))) {
        topla(ad, v.tur, v.token, top > 0 ? (girdiUsd * v.token) / top : 0, false)
      }
    }
  }

  const baglam =
    u.context.tokens !== undefined
      ? {
          yuzde: u.context.percent ?? Math.round((u.context.tokens / u.context.window) * 100),
          token: u.context.tokens,
          pencere: u.context.window,
        }
      : null

  // Şu anki pencerenin bileşimi: son isteğin gerçek girdisi bileşenlere dağıtılır.
  let statikTop = 0
  for (const v of Object.values(bilgi?.statik ?? {})) statikTop += v.token
  let pencereTop = 0
  for (const v of Object.values(ham.pencere)) pencereTop += v.token
  const hedef = baglam?.token ?? (sonGirdi || statikTop + pencereTop)
  const anlik: Bilesim = dagit(hedef, bilgi?.statik ?? {}, ham.pencere)
  const pencereListe: Bilesen[] = Object.entries(anlik)
    .map(([ad, v]) => ({ ad, tur: v.tur, token: Math.round(v.token), usd: 0, kesin: false }))
    .filter(b => b.token > 0)
    .sort((a, b) => b.token - a.token)
    .slice(0, 8)

  const onceki = await oncekiOturumlar($)

  const analiz: Analiz = {
    ana: { ...ham.ana },
    ajan: { ...ham.ajan },
    defterUsd: u.cost?.usd ?? null,
    tahminiUsd: ham.tahminiUsd,
    baglam,
    bilesenler: sirala(ham.tuketim, 14),
    pencere: pencereListe,
    mcpSunucu: bilgi?.mcpSunucu ?? 0,
    mcpArac: bilgi?.mcpArac ?? 0,
    skill: bilgi?.skill ?? 0,
    gecmis: ham.gecmis.slice(-60),
    oneriler: oneriUret({ ham, bilgi, baglamYuzde: baglam?.yuzde ?? null }),
    onceki,
    dokumZamani,
    guncellendi: simdi,
  }
  await update($, analizA, () => analiz)
  await update($, hamA, () => JSON.parse(JSON.stringify(ham)) as HamVeri)
}

type OturumOzeti = { id: string; t: number; token: number; usd: number; tepe: number }

async function oncekiOturumlar($: Dolar) {
  const liste = ((await $.store.get('oturumlar')) as OturumOzeti[] | undefined) ?? []
  const id = await $.session.id()
  const diger = liste.filter(o => o.id !== id && o.token > 0).slice(-10)
  if (diger.length === 0) return null
  return {
    oturum: diger.length,
    ortToken: diger.reduce((t, o) => t + o.token, 0) / diger.length,
    ortUsd: diger.reduce((t, o) => t + o.usd, 0) / diger.length,
  }
}

async function oturumuKaydet($: Dolar) {
  const toplam = toplamToken(ham.ana) + toplamToken(ham.ajan)
  if (toplam === 0) return
  const id = await $.session.id()
  const a = await read($, analizA)
  const liste = ((await $.store.get('oturumlar')) as OturumOzeti[] | undefined) ?? []
  const kayit: OturumOzeti = {
    id,
    t: await $.clock.now(),
    token: toplam,
    usd: a?.defterUsd ?? ham.tahminiUsd,
    tepe: Math.max(0, ...ham.gecmis),
  }
  const yeni = [...liste.filter(o => o.id !== id), kayit].slice(-30)
  await $.store.set('oturumlar', yeni)
}

async function ajanTuruBul($: Dolar, ajanId: string): Promise<string> {
  const bilinen = ham.ajanTuru[ajanId]
  if (bilinen) return bilinen
  try {
    for (const a of await $.agent.list()) ham.ajanTuru[a.id] = a.type
  } catch {
    // listelenemezse genel ad kullanılır
  }
  return ham.ajanTuru[ajanId] ?? 'alt agent'
}

async function paneliAc($: Dolar) {
  await $.ui.open({ id: PANEL, title: 'Token analizi' })
  await isle($, true)
}

/** 4 MiB'a kadar doğrudan okur; büyük dosyayı `type`/`cat` çıktısından akış olarak toplar. */
async function dosyaOku($: Dolar, yol: string, boyut: number): Promise<string | null> {
  if (boyut <= 4_000_000) return $.fs.read(yol)
  if (boyut > 64_000_000) return null
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  const argv = windows ? ['cmd', '/d', '/c', 'type', yol.replace(/\//g, '\\')] : ['cat', yol]
  const parcalar: string[] = []
  for await (const { stream, text } of $.process.spawn({ argv })) {
    if (stream === 'stdout') parcalar.push(text)
  }
  const metin = parcalar.join('')
  return metin.length > 0 ? metin : null
}

/** Oturum başından bu yana olanı transcript'ten yükler (mod ortada yüklendiyse / --resume). */
async function baslangicYukle($: Dolar, cwd: string) {
  const ev = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  const konfig = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (ev ? `${ev}/.claude` : null)
  if (!konfig) return
  const id = await $.session.id()
  const klasor = `${konfig}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}`
  const yol = `${klasor}/${id}.jsonl`
  if (!(await $.fs.exists(yol).catch(() => false))) return
  const st = await $.fs.stat(yol)
  if (st.kind !== 'file' || st.size === 0) return
  const metin = await dosyaOku($, yol, st.size).catch(() => null)
  if (metin === null) {
    oncekiBilinmiyor = true
    return
  }
  const h = bosHam()
  const { girdiUsd, ciktiUsd } = transcriptAyristir(metin, h)
  const ajanKlasoru = `${klasor}/${id}/subagents`
  if (await $.fs.exists(ajanKlasoru).catch(() => false)) {
    for (const g of await $.fs.list(ajanKlasoru)) {
      if (g.kind !== 'file' || !g.name.endsWith('.jsonl')) continue
      const ajanMetni = await dosyaOku($, `${ajanKlasoru}/${g.name}`, g.size).catch(() => null)
      if (ajanMetni === null) continue
      const t = ajanTranscripti(ajanMetni)
      let tur = 'genel'
      try {
        const meta = JSON.parse(
          await $.fs.read(`${ajanKlasoru}/${g.name.replace(/\.jsonl$/, '.meta.json')}`),
        ) as { agentType?: string }
        if (meta.agentType) tur = meta.agentType
      } catch {
        // meta yoksa genel ad
      }
      h.ajan.giris += t.usage.giris
      h.ajan.okunan += t.usage.okunan
      h.ajan.yazilan += t.usage.yazilan
      h.ajan.cikti += t.usage.cikti
      h.ajan.istek += t.usage.istek
      h.tahminiUsd += t.usd
      const anahtar = `Yardımcı Claude: ${tur}`
      const v = h.tuketim[anahtar] ?? { tur: 'agent' as const, token: 0, usd: 0, kesin: true }
      v.token += t.usage.giris + t.usage.okunan + t.usage.yazilan + t.usage.cikti
      v.usd += t.usd
      h.tuketim[anahtar] = v
    }
  }
  h.bastan = true
  h.surum = SURUM
  ham = h
  sonGirdi = h.gecmis[h.gecmis.length - 1] ?? 0
  topla(CIKTI, 'cikti', h.ana.cikti, ciktiUsd, true)
  onYukleme = { girdiler: [...h.gecmis], girdiUsd }
  if (h.gecmis.length > 120) h.gecmis.splice(0, h.gecmis.length - 120)
}

export const register: Register = (on, options) => {
  bantAcik = options.bantGoster !== false
  widgetIstegi = options.widget === true

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    try {
      const saklanan = await read($, hamA)
      if (saklanan?.bastan && saklanan.surum === SURUM) ham = { ...bosHam(), ...saklanan }
      else {
        // Kayıt yok ya da mod oturum ortasında yüklendi: oturum başından transcript'ten kur.
        await baslangicYukle($, e.cwd).catch(() => undefined)
        if (!ham.bastan && saklanan?.surum === SURUM) ham = { ...bosHam(), ...saklanan }
      }
      await $.command.register({
        name: 'tokenlar',
        description: 'Token harcamasının ayrıntısını göster (neye ne kadar gitti, nasıl tasarruf edilir)',
        immediate: true,
      })
      kirlet($)
      if (widgetIstegi && e.surface === 'desktop' && !(await read($, widgetA))) {
        await update($, widgetA, () => true)
        await $.ui.open({ id: PANEL, title: 'Token analizi', placement: 'widget' })
      }
    } catch {
      // kurulum hatası oturumu etkilemez
    }
    return r
  })

  // Gerçek ölçüm: her model isteğinin API usage'ı.
  on('turn.step', async function* ($, e, next) {
    const sonuc = yield* next(e)
    try {
      const u = sonuc.usage
      if (u) {
        const { girdiUsd, ciktiUsd } = istekMaliyeti(u)
        const girdi = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
        const hedef = e.agentId === undefined ? ham.ana : ham.ajan
        hedef.giris += u.input_tokens
        hedef.okunan += u.cache_read_input_tokens
        hedef.yazilan += u.cache_creation_input_tokens
        hedef.cikti += u.output_tokens
        hedef.istek += 1
        ham.tahminiUsd += girdiUsd + ciktiUsd

        if (e.agentId !== undefined) {
          // Alt agent'ın kendi bağlamı: tamamı o agent'a yazılır (ölçülmüş).
          const tur = await ajanTuruBul($, e.agentId)
          topla(`Yardımcı Claude: ${tur}`, 'agent', girdi + u.output_tokens, girdiUsd + ciktiUsd, true)
        } else {
          // Ana konuşma: gerçek girdiyi bağlamdaki bileşenlere dağıt (tahmini pay).
          const pay = dagit(girdi, bilgi?.statik ?? {}, ham.pencere)
          for (const [ad, v] of Object.entries(pay)) {
            topla(ad, v.tur, v.token, girdi > 0 ? (girdiUsd * v.token) / girdi : 0, false)
          }
          topla(CIKTI, 'cikti', u.output_tokens, ciktiUsd, true)
          sonGirdi = girdi
          ham.gecmis.push(girdi)
          if (ham.gecmis.length > 120) ham.gecmis.splice(0, ham.gecmis.length - 120)
        }
        kirlet($)
      }
    } catch {
      // ölçüm hatası yanıtı etkilemez
    }
    return sonuc
  })

  // Hangi araç çağrısının hangi bileşene ait olduğunu kaydet (yalnızca gözlem).
  on('tool.call', async ($, e, next) => {
    const arac = String(e.tool)
    let ajanTuru: string | undefined
    if (arac === 'Agent' || arac === 'Task') {
      ajanTuru = String((e as { subagent_type?: unknown }).subagent_type ?? 'general-purpose')
      ham.ajanCagri[ajanTuru] = (ham.ajanCagri[ajanTuru] ?? 0) + 1
    }
    aracKaydi.set(e.tool_use_id, { arac, ajan: e.agentId, ajanTuru })
    const a = ham.araclar[arac] ?? { cagri: 0, token: 0, enBuyuk: 0 }
    a.cagri += 1
    ham.araclar[arac] = a
    return next(e)
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    const r = await next(e)
    try {
      sonSkill = e.skill
      const s = ham.skillYukleme[e.skill] ?? { sayi: 0, token: 0 }
      s.sayi += 1
      s.token += tahminiToken(e.text.length)
      ham.skillYukleme[e.skill] = s
    } catch {
      // yok say
    }
    return r
  }).catch(($, e, next) => next(e))

  // Konuşmaya eklenen her satır: bağlamdaki içeriğin kaynağına göre (tahmini) boyutu.
  on('session.append', async ($, e, next) => {
    const r = await next(e)
    try {
      const m = e.message
      if (!m.role && e.door !== 'compaction') return r
      const anaKonusma = e.agentId === undefined
      const bloklar = m.content as unknown as { type: string; [k: string]: unknown }[]

      if (e.door === 'compaction') {
        if (anaKonusma) {
          ham.pencere = {}
          pencereyeEkle('Eski sohbetin özeti', 'mesaj', tahminiToken(icerikUzunlugu(bloklar)))
        }
      } else if (e.door === 'tool-result') {
        for (const b of bloklar) {
          if (b.type !== 'tool_result') continue
          const kayit = aracKaydi.get(String(b.tool_use_id))
          const arac =
            kayit?.arac ?? (e.origin.kind === 'tool' ? (e.origin as { tool: string }).tool : '?')
          const tk = tahminiToken(icerikUzunlugu([b]))
          const a = ham.araclar[arac] ?? { cagri: 0, token: 0, enBuyuk: 0 }
          a.token += tk
          a.enBuyuk = Math.max(a.enBuyuk, tk)
          ham.araclar[arac] = a
          const metin = sonucMetni(b)
          if (metin.length > 400) {
            const h = ozet(metin)
            const n = (gorulenler.get(h) ?? 0) + 1
            gorulenler.set(h, n)
            if (n > 1) {
              ham.tekrarToken += tk
              ham.tekrarSayi += 1
            }
          }
          if (anaKonusma) {
            const bil = aracBileseni(arac, kayit?.ajanTuru)
            pencereyeEkle(bil.ad, bil.tur, tk)
          }
        }
      } else if (anaKonusma) {
        const tk = tahminiToken(icerikUzunlugu(bloklar))
        const o = e.origin as { kind: string; tool?: string; event?: string }
        if (e.door === 'tool-message') {
          if (o.tool === 'Skill') pencereyeEkle(`Skill: ${sonSkill ?? '?'}`, 'skill', tk)
          else {
            const bil = aracBileseni(o.tool ?? '?')
            pencereyeEkle(bil.ad, bil.tur, tk)
          }
        } else if (e.door === 'response') {
          pencereyeEkle('Claude yanıtları (bağlamda)', 'mesaj', tk)
        } else if (e.door === 'prompt' || e.door === 'delivery') {
          pencereyeEkle('Senin mesajların', 'mesaj', tk)
        } else if (e.door === 'command') {
          pencereyeEkle('Komutlar ve çıktıları', 'mesaj', tk)
        } else if (e.door === 'hook-context' || o.kind === 'hook') {
          ham.hookToken += tk
          pencereyeEkle(`Hook: ${o.event ?? 'bağlam'}`, 'hook', tk)
        } else if (e.door === 'attachment') {
          const ad = (m.name ?? '').toLowerCase()
          if (o.kind === 'plugin') pencereyeEkle('Mod/eklenti ekleri', 'diger', tk)
          else if (ad.includes('skill')) pencereyeEkle('Skill listesi (ek)', 'skill', tk)
          else if (ad.includes('memory') || ad.includes('claude')) pencereyeEkle('Not dosyası ekleri', 'bellek', tk)
          else if (ad.includes('mcp')) pencereyeEkle('MCP talimatları', 'mcp', tk)
          else pencereyeEkle('Uygulamanın eklediği bilgiler', 'sistem', tk)
        } else {
          pencereyeEkle('Uygulama notları', 'sistem', tk)
        }
      }
    } catch {
      // gözlem hatası satırı etkilemez
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      void isle($, false)
        .then(() => oturumuKaydet($))
        .catch(() => undefined)
    }
    return r
  })

  on('session.end', async ($, e, next) => {
    await oturumuKaydet($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'tokenlar' }, async $ => {
    await paneliAc($)
    return { text: 'Token analizi paneli açıldı.' }
  })

  // Alt bar: tek satır, tıklanınca panel.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const a = await read($, analizA)
    if (!bantAcik || e.props.hasSurvey) return next(e)
    const toplam = a ? toplamToken(a.ana) + toplamToken(a.ajan) : 0
    const { Button, Text } = $.ui.resolve(e)
    if (!a || toplam === 0) {
      return (
        <Button key="ac" plain onPress={() => void paneliAc($)}>
          <Text dimColor>📊 Token sayacı · Claude'un ilk cevabı bekleniyor</Text>
        </Button>
      )
    }
    const enCok = a.bilesenler.find(b => b.tur !== 'cikti') ?? a.bilesenler[0]
    const maliyet = a.defterUsd !== null ? dolar(a.defterUsd) : `≈${dolar(a.tahminiUsd)}`
    // Önem sırasına göre; dar ekranda sondan atılır.
    const parcalar = [
      maliyet,
      a.baglam ? `hafıza %${a.baglam.yuzde} dolu` : null,
      enCok ? `en çok: ${enCok.ad}` : null,
      `${a.mcpSunucu} araç · ${a.skill} beceri`,
    ].filter((x): x is string => x !== null)
    const genislik = e.props.bodyColumns ?? 100
    let ek = parcalar.join(' · ')
    while (ek.length + 28 > genislik && parcalar.length > 1) {
      parcalar.pop()
      ek = parcalar.join(' · ')
    }

    return (
      <Button key="ac" plain onPress={() => void paneliAc($)}>
        <Text color={VURGU}>📊 {tokenYaz(toplam)} token harcandı</Text>
        <Text dimColor> · {ek}</Text>
      </Button>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Button, Progress, Text } = $.ui.resolve(e)
    const a = await read($, analizA)
    const sekme = (await read($, sekmeA)) ?? 'ozet'
    const genislik = e.props.bodyColumns

    const sekmeler: [Sekme, string][] = [
      ['ozet', 'Özet'],
      ['bilesen', 'Neye gitti?'],
      ['oneri', `Tasarruf${a?.oneriler.length ? ` (${a.oneriler.length})` : ''}`],
      ['gecmis', 'Geçmiş'],
    ]
    const ust = (
      <Box flexDirection="row" gap={1}>
        {sekmeler.map(([id, ad]) => (
          <Button
            key={`s-${id}`}
            label={ad}
            variant={sekme === id ? 'primary' : 'secondary'}
            onPress={() => void update($, sekmeA, () => id)}
          />
        ))}
      </Box>
    )

    if (!a) {
      return (
        <Box flexDirection="column">
          {ust}
          <Text dimColor>Henüz bir şey yok: Claude ilk cevabı verince dolacak.</Text>
        </Box>
      )
    }

    const toplam = toplamToken(a.ana) + toplamToken(a.ajan)
    const maliyet = a.defterUsd !== null ? dolar(a.defterUsd) : `≈${dolar(a.tahminiUsd)}`
    const hafizaRengi = (y: number) => (y >= 80 ? '#DC2626' : y >= 60 ? VURGU : YESIL)
    const hafiza = a.baglam && (
      <Progress
        label="Claude'un hafızası"
        value={a.baglam.yuzde / 100}
        valueText={`%${a.baglam.yuzde} dolu`}
        color={hafizaRengi(a.baglam.yuzde)}
      />
    )

    if (e.props.placement === 'widget') {
      const enCok = a.bilesenler.find(b => b.tur !== 'cikti')
      return (
        <Box flexDirection="column">
          <Text>
            <Text color={VURGU}>📊 {tokenYaz(toplam)} token</Text>
            <Text dimColor> · {maliyet}</Text>
          </Text>
          {hafiza}
          {enCok && (
            <Text dimColor wrap="truncate-end">
              en çok: {enCok.ad}
            </Text>
          )}
          {a.oneriler.length > 0 && <Text dimColor>{a.oneriler.length} tasarruf ipucu var</Text>}
        </Box>
      )
    }

    const pay = (n: number) => (toplam > 0 ? Math.round((n / toplam) * 1000) / 10 : 0)
    const satir = (b: Bilesen, oranTabani: number) => (
      <Progress
        label={`${IKON[b.tur]} ${b.ad}`}
        value={oranTabani > 0 ? b.token / oranTabani : 0}
        valueText={`${b.kesin ? '' : '~'}${tokenYaz(b.token)} · %${oranTabani > 0 ? Math.round((b.token / oranTabani) * 100) : 0}`}
        color={b.kesin ? VURGU : '#64748B'}
      />
    )

    let govde
    if (sekme === 'ozet') {
      const pahali = [...a.bilesenler].sort((x, y) => y.usd - x.usd).slice(0, 5)
      const y = a.baglam?.yuzde ?? 0
      const yorum =
        y >= 80
          ? 'Neredeyse dolu: /compact yaz ya da yeni sohbete geç.'
          : y >= 60
            ? 'Dolmaya başladı.'
            : 'Rahat, sorun yok.'
      govde = (
        <Box flexDirection="column">
          <Text weight="semibold">
            Bu sohbette {tokenYaz(toplam)} token harcandı · {maliyet}
          </Text>
          <Text dimColor>Abonelikle kullanıyorsan bu para cebinden çıkmaz; ne kadar iş yapıldığını gösterir.</Text>
          {hafiza}
          {a.baglam && (
            <Text dimColor>
              {yorum} ({tokenYaz(a.baglam.token)} / {tokenYaz(a.baglam.pencere)})
            </Text>
          )}
          <Text weight="semibold">Tokenlar nereye gitti?</Text>
          <Text>
            ♻ Tekrar okunan (ucuz): {tokenYaz(a.ana.okunan + a.ajan.okunan)}
          </Text>
          <Text>
            📥 İlk kez okunan: {tokenYaz(a.ana.giris + a.ana.yazilan + a.ajan.giris + a.ajan.yazilan)}
          </Text>
          <Text>
            ✍ Claude'un yazdığı (en pahalı): {tokenYaz(a.ana.cikti + a.ajan.cikti)}
          </Text>
          {a.ajan.istek > 0 && (
            <Text>
              🤖 Bunun {tokenYaz(toplamToken(a.ajan))} kadarı yardımcı Claude'lardan
            </Text>
          )}
          <Text dimColor>
            Claude {a.ana.istek} kez cevap üretti. Her seferinde sohbetin tamamını yeniden okur;
            daha önce okuduğu kısım ucuza gelir.
          </Text>
          <Text weight="semibold">En çok para harcatan 5 şey</Text>
          {pahali.map(b => (
            <Text key={`p-${b.ad}`}>
              {IKON[b.tur]} {b.ad} <Text dimColor>{b.kesin ? '' : '~'}{dolar(b.usd)} · %{pay(b.token)}</Text>
            </Text>
          ))}
          <Text dimColor>~ işaretli sayılar tahmindir; toplamlar kesin ölçümdür.</Text>
        </Box>
      )
    } else if (sekme === 'bilesen') {
      govde = (
        <Box flexDirection="column">
          <Text weight="semibold">Sohbet boyunca neye ne kadar gitti ({tokenYaz(toplam)})</Text>
          {a.bilesenler.map(b => satir(b, toplam))}
          <Text weight="semibold">Şu an Claude'un hafızasını dolduranlar</Text>
          {a.pencere.map(b =>
            satir(
              b,
              a.pencere.reduce((t, x) => t + x.token, 0),
            ),
          )}
          <Text dimColor>~ işaretli sayılar tahmindir, diğerleri kesin ölçümdür.</Text>
        </Box>
      )
    } else if (sekme === 'oneri') {
      govde = (
        <Box flexDirection="column">
          {a.oneriler.length === 0 && <Text dimColor>Şu an tasarruf edilecek belirgin bir şey yok. 👍</Text>}
          {a.oneriler.map((o, i) => (
            <Box key={`o-${i}`} flexDirection="column">
              <Text>
                <Text color={YESIL}>
                  ▲ {tokenYaz(o.tasarruf)} tasarruf{o.birim === 'istek' ? ' (her mesajda)' : ''}
                </Text>{' '}
                <Text weight="semibold">{o.baslik}</Text>
              </Text>
              <Text dimColor>{o.ayrinti}</Text>
            </Box>
          ))}
          {a.oneriler.length > 0 && (
            <Text dimColor>
              Sayılar tahminidir. "Her mesajda" yazanlar, sohbet sürdükçe tekrar tekrar kazandırır.
            </Text>
          )}
        </Box>
      )
    } else {
      const g = a.gecmis
      const iz = kivilcim(g, Math.max(10, Math.min(60, genislik - 4)))
      govde = (
        <Box flexDirection="column">
          <Text weight="semibold">Claude'un her cevapta okuduğu miktar (son {g.length} cevap)</Text>
          <Text color={VURGU}>{iz || '—'}</Text>
          {g.length > 0 && (
            <Text dimColor>
              en az {tokenYaz(Math.min(...g))} · en çok {tokenYaz(Math.max(...g))} · şimdi{' '}
              {tokenYaz(g[g.length - 1] ?? 0)}
            </Text>
          )}
          <Text dimColor>Çizgi yükseldikçe sohbet büyüyor; ani düşüş, sohbetin özetlendiği yerdir.</Text>
          <Text weight="semibold">Önceki sohbetlerle karşılaştırma</Text>
          {a.onceki ? (
            <Text>
              Bu sohbet {tokenYaz(toplam)} token · önceki {a.onceki.oturum} sohbetin ortalaması{' '}
              {tokenYaz(a.onceki.ortToken)} ({dolar(a.onceki.ortUsd)})
            </Text>
          ) : (
            <Text dimColor>Karşılaştırmak için henüz kayıtlı eski sohbet yok.</Text>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {ust}
        {govde}
      </Box>
    )
  })
}
