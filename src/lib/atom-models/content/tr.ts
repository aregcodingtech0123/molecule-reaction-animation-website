import type { AtomModelsLocaleBundle } from "../types";

const tr: AtomModelsLocaleBundle = {
  ui: {
    nav_atom_models: "Atom Modelleri",
    atom_models_badge: "Atomun Tarihi",
    atom_models_title: "Atom Modellerinin Evrimi",
    atom_models_subtitle:
      "Beş yüzyıllık bilimsel keşif yolculuğuna çıkın — Dalton'un katı kürelerinden olasılıksal kuantum bulutuna kadar.",
    atom_models_label_timeline: "Tarihsel Zaman Çizelgesi",
    atom_models_label_history: "Tarihsel Bağlam",
    atom_models_label_postulates: "Temel Fikirler",
    atom_models_label_limitations: "Bilimsel Sınırlamalar",
    atom_models_label_scientist: "Önemli İsim",
  },
  models: {
    dalton: {
      name: "Dalton'un Katı Küre Modeli",
      scientist: "John Dalton",
      year: "1803",
      history:
        "19. yüzyılın başında John Dalton, antik bölünemez atom fikrini yeniden canlandırdı ve kimyaya ilk nicel çerçeveyi kazandırdı. Her elementin karakteristik kütleye sahip özdeş, yok edilemez parçacıklardan oluştuğunu ve bileşiklerin atomların basit tam sayı oranlarında birleşmesiyle oluştuğunu öne sürdü.",
      postulates:
        "Tüm madde son derece küçük, bölünemez atomlardan oluşur. Belirli bir elementin atomları kütle ve özellik bakımından özdeştir. Atomlar bileşik oluşturmak için sabit oranlarda birleşir. Kimyasal tepkimeler atomları yeniden düzenler ancak onları asla yaratmaz veya yok etmez.",
      limitations:
        "Dalton atomları iç yapısı olmayan, özelliksiz bilardo topu küreleri olarak ele aldı. Model elektriksel olguları, spektral çizgileri, radyoaktiviteyi veya bazı elementlerin neden farklı kütlelerde birden fazla biçimde (izotop) bulunduğunu açıklayamadı.",
    },
    thomson: {
      name: "Thomson'un Erikli Puding Modeli",
      scientist: "J. J. Thomson",
      year: "1904",
      history:
        "1897'de elektronu keşfettikten sonra Thomson, atomların bölünemez olmadığını öne sürdü. Pozitif yükün yaygın bir küre — puding gibi — içinde negatif yüklü elektronların gömülü olduğu ve atomun genel olarak nötr kaldığı bir yapı hayal etti.",
      postulates:
        "Elektronlar atomun tamamından çok daha hafiftir ve negatif yük taşır. Pozitif yük atom hacmi boyunca eşit biçimde dağılmıştır. Elektronlar, yükü dengeleyerek nötrlük sağlayan puding içindeki kuru üzüm gibi bu pozitif kürenin içinde durur.",
      limitations:
        "Model Rutherford'un saçılma sonuçlarını öngöremedi: alfa parçacıklarının çoğu altın folyodan sapmadan geçti. Ayrık atom spektrumlarını açıklayamadı ve yoğun merkezi bir çekirdek için yer bırakmadı.",
    },
    rutherford: {
      name: "Rutherford'un Çekirdek Modeli",
      scientist: "Ernest Rutherford",
      year: "1911",
      history:
        "Rutherford'un altın folyo deneyi, atom kütlesinin neredeyse tamamını taşıyan küçük, yoğun, pozitif yüklü bir çekirdeğin varlığını gösterdi; elektronlar ise büyük ölçüde boş alanda uzakta bulunur. Bu, erikli puding görüntüsünü yıktı ve gezegen benzeri çekirdekli atomu kurdu.",
      postulates:
        "Kütlenin ve pozitif yükün neredeyse tamamı, atomdan yaklaşık 10⁵ kat daha küçük merkezi bir çekirdekte bulunur. Elektronlar Güneş etrafındaki gezegenler gibi çekirdeğin etrafında döner. Atom büyük ölçüde boşluktan oluşur.",
      limitations:
        "Klasik fizik, yörüngedeki yüklü elektronların enerji yayması, içe doğru spiral çizmesi ve atomu nanosaniyeler içinde çökertmesi gerektiğini öngörür. Model elektronların neden kararlı, ayrık enerji düzeylerinde bulunduğunu veya çizgi spektrumları ürettiğini açıklayamaz.",
    },
    bohr: {
      name: "Bohr Modeli",
      scientist: "Niels Bohr",
      year: "1913",
      history:
        "Bohr, Rutherford'un çekirdeğini Planck ve Einstein'dan gelen kuantum fikirleriyle birleştirdi. Elektronların yalnızca belirli izin verilen yörüngelerde sabit enerjiyle bulunduğunu; foton emerek veya soğurarak aralarında atladığını öne sürdü — hidrojenin spektral çizgilerini olağanüstü bir doğrulukla açıkladı.",
      postulates:
        "Elektronlar enerji yaymadan sabit dairesel yörüngelerde hareket eder. Her yörüngenin nicelenmiş açısal momentumu vardır (n = 1, 2, 3…). Işık yalnızca elektronlar yörüngeler arasında atladığında yayılır veya soğurulur; enerji E = hν'dir.",
      limitations:
        "Bohr modeli hidrojen benzeri atomlar için iyi çalışır ancak çok elektronlu atomlar, moleküler bağlanma ve ince spektral ayrıntılar için başarısız olur. Klasik yörüngeleri kuantum kurallarıyla karıştırır ve tam tutarlı bir kuramsal temele sahip değildir.",
    },
    quantum: {
      name: "Kuantum Mekanik Modeli",
      scientist: "Schrödinger, Heisenberg, Born",
      year: "1920'ler",
      history:
        "Modern kuantum mekaniği belirli elektron yollarının yerine olasılık dağılımlarını koyar. Schrödinger denklemi, elektronun bulunma olasılığının en yüksek olduğu üç boyutlu bölgeler olan orbitalleri verir. Heisenberg'in belirsizlik ilkesi konum ve momentumun aynı anda kesin bilinmesini yasaklar.",
      postulates:
        "Elektronlar hem parçacık hem dalga gibi davranır. Durumları ψ dalga fonksiyonuyla tanımlanır; |ψ|² olasılık yoğunluğunu verir. Orbitaler (s, p, d, f) sabit izler değil, olası konumları tanımlar. Enerji ve açısal momentum kuantum sayılarıyla nicelenir.",
      limitations:
        "Model matematiksel olarak soyuttur ve görsel olarak daha az sezgiseldir. Kesin çözümler yalnızca basit sistemler için vardır; çok elektronlu atomlar yaklaşım yöntemleri gerektirir. Olasılık, elektronun yayılı olduğu anlamına gelmez — ölçüm yine de yerelleşmiş bir parçacık bulur.",
    },
  },
};

export default tr;
