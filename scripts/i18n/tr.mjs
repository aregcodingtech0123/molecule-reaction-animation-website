/** Turkish (tr) content for src/lib/i18n/content/tr.json */
const molecules = {
  water: {
    name: "Su",
    description: "Bilinen tüm yaşam biçimleri için gerekli evrensel çözücü.",
    category: "simple",
    disciplineTag: null,
    bondTypes: ["Polar Kovalent", "Hidrojen Bağı"],
    uses: [
      "Evrensel biyolojik çözücü",
      "Endüstriyel soğutma sistemleri",
      "Hidroelektrik enerji üretimi",
      "Kimyasal reaksiyon ortamı",
    ],
    funFacts: [
      "Su, Dünya'da normal olarak bulunan sıcaklıklarda üç fiziksel hâlde de var olan tek doğal maddedir.",
      "Bir su molekülü atmosferde yalnızca yaklaşık 9 gün kalır, ardından yağış olarak yeryüzüne iner.",
      "Sıcak su soğuk sudan daha hızlı donabilir — buna Mpemba etkisi denir.",
    ],
  },
  methane: {
    name: "Metan",
    description: "En basit hidrokarbon ve güçlü bir sera gazı.",
    category: "organic",
    disciplineTag: null,
    bondTypes: ["Apolar Kovalent", "Tetrahedral"],
    uses: [
      "Isınma ve pişirme için doğal gaz yakıtı",
      "Santrallerde elektrik üretimi",
      "Hidrojen gazı üretimi",
      "Kimyasal sentez hammadde",
    ],
    funFacts: [
      "Metan, 20 yıllık dönemde CO₂'ye kıyasla sera etkisi açısından 80 kat daha güçlüdür.",
      "Mükemmel tetrahedral geometrisi dört C–H bağının da eşit uzunlukta (1,09 Å) olmasını sağlar.",
      "Metanojen arkeler okyanus çökellerinde ve sığır sindirim sisteminde metan üretir.",
    ],
  },
  glucose: {
    name: "Glukoz",
    description: "Hücreler için birincil enerji kaynağı ve biyolojide temel bir şeker.",
    category: "organic",
    disciplineTag: null,
    bondTypes: ["Kovalent", "Polar C–O bağları", "Halka Yapısı"],
    uses: [
      "Glikoliz yoluyla birincil hücresel enerji kaynağı",
      "Tıbbi bakımda IV glukoz serumları",
      "Spor ve enerji içecekleri",
      "Etanol ve CO₂ üretimi için fermantasyon",
    ],
    funFacts: [
      "Beyniniz günde yaklaşık 120 g glukoz tüketir — toplam glukoz kullanımınızın kabaca %60'ı.",
      "Glukoz iki biçimde bulunur: α-glukoz ve β-glukoz; yalnızca bir hidroksil grubunun yönü farklıdır.",
      "Bir gram glukoz metabolize edildiğinde yaklaşık 4 kalori enerji açığa çıkar.",
    ],
  },
  caffeine: {
    name: "Kafein",
    description: "Kahve ve çayda bulunan merkezi sinir sistemi uyarıcısı.",
    category: "organic",
    disciplineTag: null,
    bondTypes: ["Aromatik Halka", "Amid C=O", "N-metilasyon"],
    uses: [
      "Kahve, çay ve enerji içeceklerinde uyarıcı",
      "Ağrı kesici ilaçlar (aspirinle birlikte)",
      "Prematüre bebeklerde apne tedavisi",
      "Dayanıklılık sporlarında performans artırıcı",
    ],
    funFacts: [
      "Kafein beyinde adenozin reseptörlerini bloke ederek yorgunluk hissini engeller.",
      "Ortalama bir espresso fincanında yaklaşık 63 mg kafein vardır — ölümcül doz için çok hızlı tüketilerek ~80 fincan gerekir.",
      "Kafein dünyada en yaygın tüketilen psikoaktif maddedir.",
    ],
  },
  "dna-fragment": {
    name: "DNA Baz Çifti",
    description: "DNA çift sarmalının basamaklarını oluşturan hidrojen bağıyla bağlı baz çifti.",
    category: "biological",
    disciplineTag: null,
    bondTypes: ["Aromatik", "Hidrojen Bağı (×2 A–T)", "Glikozidik Bağ"],
    uses: [
      "Tüm canlılarda genetik bilgi depolama",
      "mRNA transkripsiyonu için şablon",
      "CRISPR-Cas9 gen düzenleme hedef bölgeleri",
      "Adli bilimde DNA parmak izi",
    ],
    funFacts: [
      "Adenin her zaman Timin ile 2 hidrojen bağı kurar — bu Watson-Crick baz eşleşmesidir.",
      "Tüm hücrelerinizdeki DNA açılıp uç uca dizilse Dünya'dan Güneş'e gidip ~600 kez dönecek kadar uzun olurdu.",
      "İnsan genomu yaklaşık 3 milyar baz çifti içerir.",
    ],
  },
  "protein-fragment": {
    name: "Peptit Bağı",
    description: "Temel peptit bağı bağlantısını gösteren bir dipeptit parçası.",
    category: "biological",
    disciplineTag: null,
    bondTypes: ["Peptit Bağı (C–N)", "Amid Rezonansı", "α-Karbon Bağları"],
    uses: [
      "Tüm protein yapılarının temel birimi",
      "Sentetik peptit ilaç tasarımı için şablon",
      "Peptit hormonlarıyla hücre sinyalleşmesi",
      "Gıda aroma vericileri (ör. aspartam bir dipeptittir)",
    ],
    funFacts: [
      "Peptit bağı rezonans nedeniyle kısmi çift bağ karakterine sahiptir — düzlemseldir ve serbestçe dönmez.",
      "20 standart amino asit vardır; yaşam bunların kombinasyonlarıyla 100.000'den fazla insan proteini üretir.",
      "Ribozom yaklaşık her 0,05 saniyede yeni bir peptit bağı sentezler.",
    ],
  },
  ethanol: {
    name: "Etanol",
    description:
      "Bira, şarap ve antiseptik jellerin arkasındaki tanıdık iki karbonlu alkol — küçük, polar ve kimya laboratuvarları ile sosyal ortamlarda şaşırtıcı derecede etkili.",
    category: "organic",
    disciplineTag: "GÜNLÜK YAŞAM",
    bondTypes: [
      "Polar kovalent (C–O, O–H)",
      "Apolar C–C / C–H",
      "Hidrojen bağı (moleküller arası)",
    ],
    uses: [
      "Alkollü içecekler (seyreltik çözeltiler)",
      "Laboratuvar ve tentürlerde çözücü",
      "Antiseptik ve biyoyakıt katkıları",
    ],
    funFacts: [
      "Karaciğeriniz etanolü önce asetaldehite, ardından asetata dönüştürür — tempo önemlidir.",
      "Etanol zar akışkanlığını ve protein yapısını bozar; bu da onu geniş kapsamlı bir biyolojik çözücü yapar.",
    ],
  },
  aspirin: {
    name: "Aspirin",
    description:
      "Asetilsalisilik asit: trombosit kimyasını geri dönüşümsüz değiştiren klasik bir ağrı kesici — tıp, tarih ve organik sentez tek küçük tablette.",
    category: "organic",
    disciplineTag: "TIBB",
    bondTypes: ["Aromatik (benzen halkası)", "Ester bağı", "Karboksilik asit"],
    uses: [
      "Analjezik (ağrı) ve antipiretik (ateş)",
      "Anti-enflamatuar (NSAID)",
      "Düşük doz antitrombosit tedavisi (tıbbi gözetimle)",
    ],
    funFacts: [
      "Söğüt kabuğundaki salisin, bu sentetik süperstarın bitki dünyasındaki atasıdır.",
      "Asetil grubu, yalnız salisilik asitten daha iyi mide asidine dayanmasına yardım eder.",
    ],
  },
  capsaicin: {
    name: "Kapsaisin",
    description:
      "Biberlerin acısını veren ateşli vanilloid — memeliler için evrimsel caydırıcı ve nörobilimcilerin favori TRPV1 konuşma açıcısı.",
    category: "organic",
    disciplineTag: "ORGANİK",
    bondTypes: [
      "Fenolik aromatik çekirdek",
      "Amid bağı",
      "Eter (metoksi) ve alifatik zincir",
    ],
    uses: [
      "Mutfak acılığı ve kapsaisinoid karışımları",
      "Topikal analjezik kremler (TRPV1 modülasyonu)",
      "Haşere caydırıcı formülasyonlar",
    ],
    funFacts: [
      "Kuşlar genelde memelilerin sahip olduğu reseptör duyarlılığına sahip değildir — biber tohumları daha uzağa yayılır.",
      "Baharat \"acılığı\" dil haritasında bir tat değildir; nosiseptör tiyatrosudur.",
    ],
  },
  serotonin: {
    name: "Serotonin",
    description:
      "5-HT: ruh hâli, uyku ve bağırsak motilitesine uzanan bir monoamin sinyali — tek bir iskeletin birçok biyolojik şapka takabileceğinin kanıtı.",
    category: "biological",
    disciplineTag: "NÖROBİLİM",
    bondTypes: ["Aromatik indol", "Birincil amin", "Fenolik hidroksil"],
    uses: [
      "Nörotransmisyon ve nöromodülasyon",
      "Farmakoloji hedefleri (ör. SSRI'lar yukarı akış yollarda etkilidir)",
      "Enterik sinir sisteminde periferik roller",
    ],
    funFacts: [
      "Vücudunuzdaki serotoninun çoğu \"ruh hâlinizde\" değildir — büyük bir pay bağırsak ve trombositlerle ilişkilidir.",
      "Adı, damarlarda ilk kez daralma etkisi gözlendiği kandan gelir.",
    ],
  },
  dopamine: {
    name: "Dopamin",
    description:
      "Katekol halkasına bağlı cesur bir etilamin kuyruğuyla inşa edilmiş bir katekolamin — motivasyon, hareket ve mezolimbik mitler bu yapının etrafında döner.",
    category: "biological",
    disciplineTag: "NÖROBİLİM",
    bondTypes: ["Aromatik (katekol)", "Birincil amin", "Fenolik O–H"],
    uses: [
      "Ödül ve motor yollarında nörotransmitter",
      "Klinik şok desteği (hidroklorür tuzu, IV, tıbbi gözetimle)",
      "GPCR ve taşıyıcı biyolojisi için öğretim ligandı",
    ],
    funFacts: [
      "Parkinson patolojisi substantia nigra'daki dopamin nöron kaybıyla sıkı bağlantılıdır.",
      "Serbest dopamin yeterince polardır; kan-beyin bariyerini keyfi geçmez.",
    ],
  },
  adrenaline: {
    name: "Adrenalin",
    description:
      "Epinefrin: çalılıkta bir şey sıçradığında nabzın yükselmesinin arkasındaki molekül — sempatik kimyanın üç oksijenli aciliyete damıtılmış hâli.",
    category: "biological",
    disciplineTag: "NÖROBİLİM",
    bondTypes: ["Aromatik (katekol)", "İkincil amin (benzilik substitüsyon)", "Birincil alkol"],
    uses: [
      "Anafilaksi kurtarma oto-enjektörleri (klinik eğitim/endikasyonla)",
      "Lokal anestezi yardımcıları (vazokonstriktif gerekçeyle)",
      "Savaş ya da kaç sinyalleşmesi fizyoloji gösterimleri",
    ],
    funFacts: [
      "\"Adrenalin\" ile \"epinefrin\" çoğunlukla UK/ABD adlandırması farkıdır — aynı sabırsız küçük hormondur.",
      "α ve β-adrenerjik reseptörlere etki eder; hem vazokonstriksiyon hem bronkodilatör kullanımlarını açıklar.",
    ],
  },
  buckminsterfullerene: {
    name: "Buckminsterfullerene",
    description:
      "Saf karbonun futbol topu simetrisi — aromatikliğin düz altıgen gerektirmediğini öğreten Nobel ödüllü bir kafes.",
    category: "macro",
    disciplineTag: "NANOTEKNOLOJİ",
    bondTypes: [
      "Sp²-benzeri karbon ağı (kesik ikosahedron)",
      "Eğri yüzeylerde delokalize π sistemleri",
    ],
    uses: [
      "Malzeme bilimi prototipleri (ince filmler, kompozitler)",
      "Organik elektronik araştırmada elektron kabulcü motifleri",
      "Nanoskala karbon allotropu öğretim aracı",
    ],
    funFacts: [
      "12 beşgen ve 20 altıgen — Euler'in grafitin vahşi kuzeniyle tokalaşması.",
      "Jeodezik kubbeleri popülerleştiren mimar Buckminster Fuller'dan adını alır.",
    ],
  },
  "heme-group": {
    name: "Hemoglobin Heme Grubu",
    description:
      "Hemoglobini oksijen taşıyıcısına dönüştüren demir şelatlayan porfirin prostetik grubu: protein allosterisi sahne arkasında geri dönüşümlü O₂ bağlanması.",
    category: "biological",
    disciplineTag: "BİYOLOJİK",
    bondTypes: [
      "Aromatik porfirin makrosikli",
      "Metal koordinasyonu (Fe–N)",
      "Propiyonat/karboksilat benzeri substituentler (bağlama bağlı protonasyon)",
    ],
    uses: [
      "Hemoproteinlerde O₂ taşınması ve depolanması",
      "Enzim aktif bölgeleri (ör. katalaz, sitokromlar)",
      "Ligand alanı ve kooperatif bağlanma için biyokimya öğretimi",
    ],
    funFacts: [
      "Hemoglobindeki dört heme ünitesi kooperatif bağlanmayı sağlar — sigmoidal eğriler kimya trivia değil, fizyolojidir.",
      "Aksiyel histidin çekişmesi oksijen afinitesini CO rekabetine karşı ince ayarlar.",
    ],
  },
};

const reactions = {
  "methane-combustion": {
    name: "Metanın Yanması",
    description:
      "Klasik bir oksidasyon: metan oksijenle buluşur; radikal adımlarından oluşan zincir çok ısı açığa çıkarır ve karbondioksit ile su üretir.",
    reactionType: "Yanma",
    category: "ORGANIC",
    reactants: [
      { name: "Metan", formula: "CH₄" },
      { name: "Oksijen", formula: "O₂" },
    ],
    products: [
      { name: "Karbondioksit", formula: "CO₂" },
      { name: "Su", formula: "H₂O" },
    ],
    quickFacts: {
      summary:
        "Metanın tam yanması güçlü ekzotermiktir ve kimyasal potansiyel enerjiyi ısı ve ışığa dönüştürür.",
      energyProfile: "Yüksek ekzotermik (dengeli reaksiyon için ΔH << 0)",
      conditions: "Başlatma enerjisi (kıvılcım/alev); sürekli O₂ beslemesi",
      mechanism:
        "Radikal zincir mekanizması: başlatma → yayılma (·OH, ·CH₃ vb.) → sonlanma; 3B görünüm temsili türleri vurgular.",
      highlight:
        "Her dengeli yanma hikâyesi daha iyi CO₂ muhasebesi ve açık alevlerin dikkatli kullanımıyla sonlanır.",
    },
    steps: [
      { caption: "Yakıt — metan" },
      { caption: "Ürün odağı — su" },
    ],
  },
  "water-formation": {
    name: "Suyun Oluşumu",
    description:
      "Hidrojen oksijende yanarak su oluşturur — basit stokiyometri, devasa endüstriyel ve roket bilimi önemi.",
    reactionType: "Sentez / yanma",
    category: "SYNTHESIS",
    reactants: [
      { name: "Hidrojen", formula: "H₂" },
      { name: "Oksijen", formula: "O₂" },
    ],
    products: [{ name: "Su", formula: "H₂O" }],
    quickFacts: {
      summary:
        "Bu reaksiyon H₂ gramı başına çok fazla enerji açığa çıkarır; bu yüzden temiz enerji tartışmalarını besler.",
      energyProfile: "Ekzotermik; termodinamik olarak çok elverişli",
      conditions: "Ateşleme veya katalizör (ör. Pt); güvenlik için H₂ : O₂ oranı kritiktir",
      mechanism:
        "Gaz fazında genelde radikal aracılı; 3B görünüm redoks ortaklığından doğan polar ürünü gösterir.",
      highlight: "Suyun bükük geometrisi oksijendeki yalnız çiftlerin itişmesinin doğrudan sonucudur.",
    },
    steps: [{ caption: "Ürün — su (H₂O)" }],
  },
  "glucose-fermentation": {
    name: "Glukozun Fermantasyonu",
    description:
      "Maya dostu biyokimya: glukoz etanol ve karbondioksite bölünür — ekmeğin kabarmasının ve şarabın var olma nedeni.",
    reactionType: "Biyokimyasal / anaerobik",
    category: "METABOLIC",
    reactants: [{ name: "Glukoz", formula: "C₆H₁₂O₆" }],
    products: [
      { name: "Etanol", formula: "C₂H₅OH" },
      { name: "Karbondioksit", formula: "CO₂" },
    ],
    quickFacts: {
      summary:
        "Glikoliz ve fermantasyon NAD⁺'ı yeniler; oksijen azken glikoliz devam edebilir.",
      energyProfile: "Kısmi oksidasyon — solunuma kıyasla mütevazı ATP",
      conditions: "Maya veya bakteri; anaerobik veya mikroaerobik ortam",
      mechanism: "Piruvat → asetaldehit → etanol; CO₂ küçük molekül olarak ayrılır.",
      highlight: "Aynı yol ailesi bira, ekmek ve biyoyakıt araştırmasını birbirine bağlar.",
    },
    steps: [
      { caption: "Başlangıç şekeri" },
      { caption: "Etanol ürünü" },
    ],
  },
  "haber-bosch": {
    name: "Haber-Bosch Süreci",
    description:
      "Endüstriyel azot fiksasyonu: atmosferik N₂ ve H₂ amonyağa dönüştürülür — küresel gübre üretiminin omurgası.",
    reactionType: "Endüstriyel sentez",
    category: "SYNTHESIS",
    reactants: [
      { name: "Azot", formula: "N₂" },
      { name: "Hidrojen", formula: "H₂" },
    ],
    products: [{ name: "Amonyak", formula: "NH₃" }],
    quickFacts: {
      summary:
        "Azot fiksasyonunun endüstriyel uygulaması; atmosferik azotu küresel gıda üretimini sürdüren gübrelere dönüşen amonyağa çevirir.",
      energyProfile: "Ekzotermik (ΔH = −92,4 kJ/mol).",
      conditions: "Yüksek basınç (150–250 bar), yüksek sıcaklık (400–500°C) ve demir (Fe) katalizörü.",
      mechanism:
        "N₂ ve H₂ gazlarının demir katalizör yüzeyinde ayrışıcı adsorpsiyonu, ardından azot atomlarının kademeli hidrojenlenmesi.",
      highlight: "",
    },
    steps: [{ caption: "Yer tutucu sahne — NH₃ animasyon koordinatları bekleniyor" }],
  },
  photosynthesis: {
    name: "Fotosentez (Basitleştirilmiş)",
    description:
      "Işıkla yönlendirilen karbon fiksasyonu: altı CO₂ ve altı su molekülü bir glukoz halkasına dönüşürken oksijen açığa çıkar — biyosferin metabolik motoru.",
    reactionType: "Metabolik / ışıkla yönlendirilen",
    category: "METABOLIC",
    reactants: [
      { name: "Karbondioksit", formula: "CO₂" },
      { name: "Su", formula: "H₂O" },
    ],
    products: [
      { name: "Glukoz", formula: "C₆H₁₂O₆" },
      { name: "Oksijen", formula: "O₂" },
    ],
    quickFacts: {
      summary:
        "Bitkilerin, alglerin ve bazı bakterilerin ışık enerjisini kimyasal enerjiye (glukoz) dönüştürdüğü, yan ürün olarak oksijen salan temel biyokimyasal süreç.",
      energyProfile:
        "Endotermik / endergonik (foton enerjisi gerekir; basitleştirilmiş genel denklem için ΔH = +2803 kJ/mol).",
      conditions: "Güneş ışığı (fotonlar), klorofil pigmentleri, ortam sıcaklıkları.",
      mechanism:
        "Işığa bağımlı reaksiyonlar suyu bölerek ATP ve NADPH üretir; ardından Calvin döngüsü CO₂'yi 6 karbonlu şekere sabitler.",
      highlight: "",
    },
    steps: [
      { caption: "Ürün — glukoz (C₆H₁₂O₆)" },
      { caption: "Reaktif / ürün — su" },
    ],
  },
  "neutralization-hcl-naoh": {
    name: "Nötrleşme (HCl + NaOH)",
    description:
      "Ders kitabı Arrhenius nötrleşmesi: güçlü asit ve güçlü baz tuz ve su oluşturur — her giriş kimyası öğrencisinin ilk karşılaştığı proton transfer reaksiyonu.",
    reactionType: "Asit–baz",
    category: "ACID-BASE",
    reactants: [
      { name: "Hidroklorik asit", formula: "HCl" },
      { name: "Sodyum hidroksit", formula: "NaOH" },
    ],
    products: [
      { name: "Sodyum klorür", formula: "NaCl" },
      { name: "Su", formula: "H₂O" },
    ],
    quickFacts: {
      summary:
        "Güçlü asit ve güçlü bazın birbirini nötrleştirerek tuz (sodyum klorür) ve su ürettiği klasik Arrhenius asit-baz reaksiyonu.",
      energyProfile: "Ekzotermik (nötrleşme ısısı, ΔH ≈ −57,3 kJ/mol).",
      conditions: "Sulu çözelti, oda sıcaklığı.",
      mechanism:
        "Asitten H⁺ iyonlarının bazdan OH⁻ iyonlarıyla birleşerek kararlı kovalent H₂O molekülleri oluşturduğu proton transferi; Na⁺ ve Cl⁻ seyirci iyon veya buharlaşmada kristal örgü olarak kalır.",
      highlight: "",
    },
    steps: [{ caption: "Ürün — su (H₂O)" }],
  },
  "esterification-ethyl-acetate": {
    name: "Esterleşme (Etil Asetat)",
    description:
      "Fischer esterleşmesi: karboksilik asit ve alkol meyveli bir ester artı suya yoğunlaşır — biraz sülfürik asit ve ısıyla denge kimyası.",
    reactionType: "Yoğunlaşma / organik",
    category: "ORGANIC",
    reactants: [
      { name: "Asetik asit", formula: "CH₃COOH" },
      { name: "Etanol", formula: "C₂H₅OH" },
    ],
    products: [
      { name: "Etil asetat", formula: "CH₃COOC₂H₅" },
      { name: "Su", formula: "H₂O" },
    ],
    quickFacts: {
      summary:
        "Organik asit (asetik asit) ile alkol (etanol) arasında ester (tatlı, meyveli kokulu etil asetat) ve su üreten yoğunlaşma reaksiyonu.",
      energyProfile: "Hafif ekzotermik, geri dönüşümlü denge reaksiyonu.",
      conditions: "Asit katalizörü (genelde konsantre H₂SO₄) ve reflux altında ısı.",
      mechanism:
        "Nükleofilik asil substitüsyonu. Karboksilik asidin karbonil oksijeni protonlanır; alkolün hidroksil grubunun nükleofilik saldırısı ve bir su molekülünün eliminasyonuyla sonuçlanır.",
      highlight: "",
    },
    steps: [
      { caption: "Reaktif — etanol" },
      { caption: "Eş ürün — su" },
    ],
  },
};

const categories = {
  simple: "Basit",
  organic: "Organik",
  biological: "Biyolojik",
  macro: "Makro",
  SYNTHESIS: "Sentez",
  ORGANIC: "Organik Kimya",
  METABOLIC: "Metabolik",
  "ACID-BASE": "Asit–Baz",
};

const ui = {
  nav_explore: "Keşfet",
  nav_learn: "Öğren",
  nav_showcase: "Vitrin",
  tab_molecules: "Moleküller",
  tab_reactions: "Reaksiyonlar",
  label_quick_facts: "Hızlı Bilgiler",
  label_molecular_weight: "Molekül Ağırlığı",
  label_state: "Hâl",
  label_bond_types: "Bağ Türleri",
  state_gas: "Gaz",
  state_liquid: "Sıvı",
  state_solid: "Katı",
  state_plasma: "Plazma",
  difficulty_beginner: "Başlangıç",
  difficulty_intermediate: "Orta",
  difficulty_expert: "İleri",
  title_molecule_explorer: "Moleküller",
  subtitle_molecule_explorer:
    "Moleküller arasında gezin, herhangi bir atoma tıklayarak incele ve zengin eğitim içeriği için öğren panelini aç.",
  button_start_exploring: "Keşfe Başla",
  button_play_reaction: "Oynat",
  fact_overview: "Genel Bakış",
  fact_energy: "Enerji",
  fact_conditions: "Koşullar",
  fact_mechanism: "Mekanizma",
  subtitle_reaction:
    "Bir reaksiyon seç, 3B diziyi çalıştırmak için Oynat'a bas ve Hızlı Bilgiler sütununda bağların nasıl yeniden düzenlendiğini oku.",
  title_reaction_lab: "Reaksiyon Laboratuvarı",
  badge_interactive_studio: "Etkileşimli 3B Stüdyo",
  badge_reaction_animation: "Reaksiyon animasyonu",
  button_playing: "Oynatılıyor…",
  label_equation: "Denklem",
  label_reactants: "Reaktifler",
  label_products: "Ürünler",
  aria_molecules_reactions: "Moleküller ve reaksiyonlar",
  aria_select_language: "Dil seç",
  aria_footer: "Alt bilgi",
  label_discipline: "Disiplin",
  label_boiling_point: "Kaynama Noktası",
  label_melting_point: "Erime Noktası",
  label_reaction_type: "Reaksiyon Türü",
  label_highlight: "Öne Çıkan",
  reaction_animation_placeholder:
    "3B enterpolasyon: koordinatlar bekleniyor ({key}).",
  reaction_animation_ready: "Tam atom enterpolasyonu mevcut — Oynat'a basın.",
  hero_badge: "Yeni Nesil Etkileşimli Öğrenme",
  hero_title_prefix: "Geleceği",
  hero_title_highlight: "Moleküler Mimari",
  hero_subtitle:
    "Evrenin yapı taşlarını nefes kesici 3B'de keşfedin. Kimyayı sezgisel ve güzel kılmak için tasarlanmış sinematik, premium bir eğitim platformu.",
  hero_launch_studio: "Stüdyoyu Başlat",
  hero_view_showcase: "Vitrini Gör",
  hero_scroll: "Kaydır",
  featured_title_prefix: "Öne Çıkan",
  featured_title_highlight: "Moleküller",
  featured_subtitle:
    "Basit sudan karmaşık biyolojik makromoleküllere — hepsini etkileşimli 3B stüdyomuzda keşfedin.",
  card_atoms_bonds: "{atoms} atom · {bonds} bağ",
  card_explore: "Keşfet",
  elements_title_prefix: "Keşfedin:",
  elements_title_highlight: "Elementler",
  elements_subtitle:
    "Yüksek doğruluklu WebGL render motorumuzla atomlar, bileşikler ve karmaşık moleküler yapılarla etkileşin.",
  feature_atomic_title: "Atomik Yapı",
  feature_atomic_desc: "Atom altı düzeye inin ve yörüngeleri gerçek zamanlı gözlemleyin.",
  feature_crystal_title: "Kristal Örgüler",
  feature_crystal_desc: "Katı maddenin oluşumundaki tekrarlayan geometrik örüntüleri keşfedin.",
  feature_macro_title: "Makromoleküller",
  feature_macro_desc: "Proteinler, DNA ve karmaşık biyolojik yapıları görselleştirin.",
  showcase_title_prefix: "Sinematik",
  showcase_title_suffix: "Bilim Eğitimi",
  showcase_body:
    "Modern oyun render tekniklerini bilimsel doğrulukla birleştirerek benzersiz bir öğrenme ortamı oluşturduk. Değişkenleri manipüle edin, reaksiyonları gözlemleyin ve kimyayı görsel olarak anlayın.",
  showcase_bullet_1: "Gerçek zamanlı moleküler dinamik simülasyonu",
  showcase_bullet_2: "Doğru uzay-doldurma ve top-çubuk modelleri",
  showcase_bullet_3: "Etkileşimli elektron bulutu görselleştirmesi",
  compare_title_prefix: "Karşılaştır",
  compare_title_highlight: "Yan Yana",
  compare_subtitle:
    "Herhangi iki molekülü yan yana yerleştirin ve yapısal farkları bir bakışta keşfedin.",
  footer_brand: "MoleculeArchitectureStudio",
  footer_copyright: "© {year} Molecule Studio. Tüm hakları saklıdır.",
  footer_about: "Hakkında",
  footer_github: "GitHub Deposu",
  footer_canvas_guide: "Etkileşimli Canvas Kılavuzu",
  footer_tech_badge: "Next.js, Three.js ve Tailwind CSS ile geliştirildi",
  panel_tab_overview: "Genel Bakış",
  panel_tab_structure: "Yapı",
  panel_tab_uses: "Kullanımlar",
  panel_tab_fun_facts: "İlginç Bilgiler",
  panel_stat_weight: "Ağırlık",
  panel_stat_atoms: "Atomlar",
  panel_stat_bonds: "Bağlar",
  panel_stat_total: "toplam",
  panel_state_room_temp: "Oda Sıcaklığındaki Hâl",
  panel_no_education: "Bu molekül için eğitim verisi mevcut değil.",
  panel_single_bonds: "Tekli bağlar (σ)",
  panel_double_bonds: "Çiftli bağlar (σ+π)",
  panel_triple_bonds: "Üçlü bağlar (σ+2π)",
  panel_element_composition: "Element Bileşimi",
  viewer_show_labels: "Etiketler",
  viewer_auto_rotate: "Otomatik döndür",
  viewer_learn_panel: "Öğren",
  viewer_prev: "Önceki",
  viewer_next: "Sonraki",
  viewer_close_atom: "Atom detayını kapat",
  discipline_daily_life: "Günlük Yaşam",
  discipline_medicine: "Tıp",
  discipline_organic: "Organik Kimya",
  discipline_neuroscience: "Nörobilim",
  discipline_nanotech: "Nanoteknoloji",
  discipline_biological: "Biyolojik",
};

export default { molecules, reactions, categories, ui };
