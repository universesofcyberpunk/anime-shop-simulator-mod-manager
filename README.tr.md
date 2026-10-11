# Mod Yöneticisi

Bütün modların derleme / test / paket / yayın durumunu tek yerde tutar.
Tek kaynak: `ModDev\Files\mod_durum.json`. `NEXUS_YAYINLANANLAR.txt` ve `YAYINLANACAKLAR.md` bundan otomatik yazılır (eski halleri `Files\_yedek`).

## Klasör düzeni

Araç `ModDev` altında iki seviye içeride durur (ör. `ModDev\Tools\ModYoneticisi`); modlar `ModDev\Mods`, zip'ler `ModDev\Release`. Farklı bir düzen için `config.example.json` dosyasını `config.json` adıyla kopyalayıp yolları, Nexus profilini, yazar adını ve portu değiştir. Node.js 18+ yeter, npm paketi yok.

## Açmak

- Sayfa: `Baslat.bat` çift tık, `http://localhost:5170` açılır (sadece bu bilgisayar).
- Komut satırı: `node mod.js yardim`. Sunucu açıksa komutlar ona gider (günlük sayfada da akar), kapalıysa kendisi yapar.

## Bir modun yolu

Yeni → **Derle** → (oyunda dene) → **Çalışıyor ✓** → **Paketle** (zip `Release\<klasör>`, durum "Yayın bekliyor") → **Yayınlandı** + Nexus URL (klasör `Yayınlanan Modlar`'a taşınır).

- Kaynak değişince adımlar kendiliğinden eskir: test işareti geçersiz olur, yayındaki mod "güncellendi" olur ve klasörü `Release`'e geri taşınır.
- Paketle değişmemiş modu atlar. "Çalışıyor ✓" olmadan paketlemez.
- Değişiklik dosya tarihiyle değil içerikle (SHA) anlaşılır. Girdiler: `ModDev\Mods\<Mod>` (bin/obj/derle.bat/paketle.bat hariç) + paketin aldığı `UserData\<klasör>` (oyunun yazdığı catalog.txt, _market_done.txt, renderers.txt gibi dosyalar hariç). Bir modun girdileri: sayfada mod adına tıkla ya da `node mod.js durum <Mod>`.

## Toplu işlem ve gereksinimler

- Soldaki "Toplu" kutusu: işaretli modlar "Seçilileri derle" / "Seçilileri paketle" düğmelerine girer (komut satırı: `derle --tumu`, `paketle --tumu`, kutu: `toplu <Mod> --haric|--dahil`). Seçilileri paketle değişmeyen ve "Çalışıyor ✓" olmayanları yine atlar.
- Gereksinimler paketteki README'nin "Requirements" bölümünden okunur (gerekli / önerilen / birlikte olmaz, "1.4.0 or newer" = en az sürüm). Gerekli bir mod yayında değilse ya da sürümü düşükse ⚠ çıkar; "Gereksinim uyarısı" filtresi bunları listeler. Elle düzeltmek: `gereksinim <Mod> "ModMarket>=1.4.0; ?ModSettings; !PlayAsMint"` (boş = README'ye dön). Mod adına tıklayınca "Buna ihtiyaç duyanlar" da görünür.

## Claude için

- Yeni mod yaptığında: `node mod.js ekle <Klasör> --ad "Görünen ad"`.
- Kodu değiştirdiğinde: `node mod.js derle <Mod>`, sonra `node mod.js not <Mod> "ne değişti"`.
- `calisiyor` işaretini sadece kullanıcı oyunda denediğini söylerse koy.
- Kullanıcı "yayınladım" deyince: `node mod.js yayinlandi <Mod> <nexus-url>`.
- `NEXUS_YAYINLANANLAR.txt` / `YAYINLANACAKLAR.md` dosyalarını elle düzenleme, klasörleri elle taşıma; bir sonraki işlemde üzerine yazılır.
- Kaynağı `Mods` altında olmayan paketler (resim paketleri, araç): `node mod.js ekle <ReleaseKlasörü> --tur paket`, girdileri `node mod.js ayar <id> girdiler "yol1;yol2"` (oyun klasörüne göre).

## Dosyalar

`core.js` (işlemler), `mod.js` (komut satırı), `server.js` + `index.html` (sayfa), `kurulum.js` (ilk listeyi bir kez kurdu; tekrar çalıştırma), `.ozet_onbellek.json` (özet hızlandırma, silinebilir).

## Lisans

MIT (`LICENSE`). Kodu kullanırsan **Fabianens**'e atıf ver.
