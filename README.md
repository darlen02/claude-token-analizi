# 📊 Token Analizi — Claude Code modu

Claude metni küçük parçalar halinde okur ve yazar; bu parçalara **token** denir (kabaca 1 token ≈ yarım kelime). Claude her cevapta sohbetin **tamamını yeniden okur**, yani sohbet uzadıkça her mesaj daha çok token harcar — taksimetre gibi.

Bu mod, yazı kutusunun üstüne tek satırlık bir sayaç ekler ve tokenların **nereye gittiğini** gösterir:

```
📊 4,2M token harcandı · $8,75 · hafıza %34 dolu · en çok: Senin mesajların · 27 araç · 257 beceri
```

| Yazı | Anlamı |
|---|---|
| **4,2M token harcandı** | Bu sohbette okunan + yazılan toplam |
| **$8,75** | Tahmini maliyet (abonelikle kullanıyorsanız cebinizden çıkmaz; ne kadar iş yapıldığını gösterir) |
| **hafıza %34 dolu** | Claude'un aklında tutabileceği alanın ne kadarı dolu. %80'i geçince `/compact` yazın ya da yeni sohbete geçin |
| **en çok: …** | Tokenların en büyük kısmını yiyen şey |
| **27 araç · 257 beceri** | Bağlı ek araçlar (MCP) ve yüklü beceriler (Skill); her biri her mesajda biraz yer kaplar |

**Banda tıklayın** (ya da `/tokenlar` yazın), 4 sekmeli bir panel açılır:

- **Özet** — toplam harcama, hafıza doluluğu, tokenların nereye gittiği (tekrar okunan / ilk kez okunan / Claude'un yazdığı) ve en çok para harcatan 5 şey.
- **Neye gitti?** — her bileşenin (Claude'un talimatları, bağlı araçlar, beceriler, not dosyaları, mesajlarınız, yardımcı Claude'lar…) ne kadar yediği, çubuklarla.
- **Tasarruf** — somut ipuçları ve her birinin tahmini kazancı. Örnek: *"'xyz' aracı hiç kullanılmadı; kapatırsan her mesajda 9k token kazanırsın."*
- **Geçmiş** — her cevapta okunan miktarın küçük grafiği ve önceki sohbetlerinizle karşılaştırma.

`~` işaretli sayılar tahmindir; toplamlar ise Claude'un bildirdiği **kesin** ölçümlerdir.

## Kurulum

Claude Code **2.1.275 veya üstü** gerekir.

**Terminalde Claude Code açıkken** yazı kutusuna şunu yazın:

```
/plugin install token-analizi --marketplace darlen02/claude-token-analizi
```

1. "Add marketplace?" sorusuna `y` deyin.
2. Kapsam olarak ilk seçeneği (kullanıcı / user) Enter ile seçin.
3. Ayar ekranı gelirse varsayılanları bırakıp devam edin.
4. "Installed token-analizi" yazısını görünce sayaç hemen çalışmaya başlar.

**Komut satırından (Claude Code açık değilken):**

```bash
claude plugin install token-analizi --marketplace darlen02/claude-token-analizi
```

**Claude masaüstü uygulamasında:** yazı kutusunun yanındaki **+** düğmesi → **Plugins** → **Add marketplace** → `darlen02/claude-token-analizi` → **Add plugin**.

Terminalden "user" kapsamıyla kurulan mod, masaüstü uygulamasının Code sekmesinde de çalışır.

## Ayarlar

`/config` → **token-analizi**

| Ayar | Anlamı | Varsayılan |
|---|---|---|
| Alt barı göster (`bantGoster`) | Kapatınca panel yalnızca `/tokenlar` ile açılır | açık |
| Yan sütunda widget (`widget`) | Masaüstü uygulamasında özeti küçük bir kutu olarak da açar | kapalı |

## Nasıl ölçüyor? (meraklısına)

| Değer | Kaynak | Tür |
|---|---|---|
| Toplam token; ilk kez okunan / tekrar okunan / yazılan | Her cevabın API `usage` bilgisi | **Kesin** |
| Yardımcı Claude'ların (alt agent) harcaması | Onların kendi `usage` bilgisi | **Kesin** |
| Maliyet | Claude Code'un `/cost` defteri (yoksa API liste fiyatıyla hesap) | Kesin / tahmini |
| Hafıza doluluğu | Son cevabın okuduğu miktar ÷ hafıza boyutu | **Kesin** |
| Bileşenlerin payı (talimatlar, araçlar, beceriler, not dosyaları, mesajlar…) | `/context` dökümü + sohbete eklenen her parçanın boyutu | Tahmini (`~`) |

Her cevabın kesin token sayısı, o anki sohbet bileşimine göre bileşenlere paylaştırılır; böylece hiçbir token iki kez sayılmaz ve payların toplamı gerçek toplama eşittir. Mod sohbetin ortasında kurulursa, o ana kadarki harcama sohbet kaydından okunur. Hiçbir ek API çağrısı yapmaz.

## Kaldırma

```
/plugin uninstall token-analizi
```
