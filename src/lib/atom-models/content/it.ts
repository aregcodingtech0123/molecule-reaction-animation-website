import type { AtomModelsLocaleBundle } from "../types";

const it: AtomModelsLocaleBundle = {
  ui: {
    nav_atom_models: "Modelli Atomici",
    atom_models_badge: "Storia dell'Atomo",
    atom_models_title: "Evoluzione dei Modelli Atomici",
    atom_models_subtitle:
      "Percorre cinque secoli di scoperte scientifiche — dalle sfere solide di Dalton alla nube quantistica probabilistica.",
    atom_models_label_timeline: "Cronologia Storica",
    atom_models_label_history: "Contesto Storico",
    atom_models_label_postulates: "Idee Fondamentali",
    atom_models_label_limitations: "Limiti Scientifici",
    atom_models_label_scientist: "Figura Chiave",
  },
  models: {
    dalton: {
      name: "Modello della Sfera Solida di Dalton",
      scientist: "John Dalton",
      year: "1803",
      history:
        "All'inizio del XIX secolo, John Dalton riprese l'antica idea di atomi indivisibili e diede alla chimica il suo primo quadro quantitativo. Propose che ogni elemento consista in particelle identiche e indestructibili con massa caratteristica, e che i composti si formino quando gli atomi si combinano in semplici rapporti numerici interi.",
      postulates:
        "Tutta la materia è composta di atomi estremamente piccoli e indivisibili. Gli atomi di un dato elemento sono identici in massa e proprietà. Gli atomi si combinano in rapporti fissi per formare composti. Le reazioni chimiche riorganizzano gli atomi ma non li creano né distruggono mai.",
      limitations:
        "Dalton trattava gli atomi come sfere lisce, simili a palle da biliardo, senza struttura interna. Il modello non poteva spiegare fenomeni elettrici, linee spettrali, radioattività o perché alcuni elementi esistono in più forme con masse diverse (isotopi).",
    },
    thomson: {
      name: "Modello del Plum Pudding di Thomson",
      scientist: "J. J. Thomson",
      year: "1904",
      history:
        "Dopo la scoperta dell'elettrone nel 1897, Thomson propose che gli atomi non siano indivisibili. Immaginò una sfera diffusa di carica positiva — come un budino — con elettroni di carica negativa incorporati, mantenendo l'atomo complessivamente neutro.",
      postulates:
        "Gli elettroni sono molto più leggeri dell'atomo nel suo insieme e portano carica negativa. La carica positiva è distribuita uniformemente nel volume atomico. Gli elettroni si trovano dentro questa sfera positiva come uvetta in un budino, bilanciando la carica fino alla neutralità.",
      limitations:
        "Il modello non poteva prevedere i risultati di diffusione di Rutherford: la maggior parte delle particelle alfa attraversò la lamina d'oro senza deviazione. Non spiegò spettri atomici discreti e non lasciava spazio a un nucleo centrale denso.",
    },
    rutherford: {
      name: "Modello Nucleare di Rutherford",
      scientist: "Ernest Rutherford",
      year: "1911",
      history:
        "L'esperimento della lamina d'oro di Rutherford mostrò che un nucleo minuscolo, denso e positivamente carico contiene quasi tutta la massa atomica, mentre gli elettroni occupano uno spazio in gran parte vuoto, lontano da esso. Questo rovesciò l'immagine del budino e stabilì l'atomo nucleare di tipo planetario.",
      postulates:
        "Quasi tutta la massa e tutta la carica positiva risiedono in un nucleo centrale circa 10⁵ volte più piccolo dell'atomo. Gli elettroni orbitano il nucleo come pianeti intorno al Sole. L'atomo è per lo più spazio vuoto.",
      limitations:
        "La fisica classica prevede che elettroni carichi in orbita dovrebbero irradiare energia, spiraleggiare verso l'interno e collassare l'atomo in nanosecondi. Il modello non spiegò perché gli elettroni occupano livelli di energia stabili e discreti né producono spettri a linee.",
    },
    bohr: {
      name: "Modello di Bohr",
      scientist: "Niels Bohr",
      year: "1913",
      history:
        "Bohr unì il nucleo di Rutherford con le idee quantistiche di Planck ed Einstein. Postulò che gli elettroni occupino solo certe orbite consentite con energia fissa, saltando tra di esse assorbendo o emettendo fotoni — spiegando le linee spettrali dell'idrogeno con notevole precisione.",
      postulates:
        "Gli elettroni si muovono in orbite circolari fisse senza irradiare energia. Ogni orbita ha un momento angolare quantizzato (n = 1, 2, 3…). La luce è emessa o assorbita solo quando gli elettroni saltano tra orbite, con energia E = hν.",
      limitations:
        "Il modello di Bohr funziona bene per atomi simili all'idrogeno ma fallisce per atomi multielettronici, legami molecolari e dettagli spettrali fini. Mescola orbite classiche e regole quantistiche senza una base teorica pienamente coerente.",
    },
    quantum: {
      name: "Modello Meccanico Quantistico",
      scientist: "Schrödinger, Heisenberg, Born",
      year: "anni '20",
      history:
        "La meccanica quantistica moderna sostituisce traiettorie definite degli elettroni con distribuzioni di probabilità. L'equazione di Schrödinger produce orbitali — regioni tridimensionali dove un elettrone è più probabilmente trovato. Il principio di indeterminazione di Heisenberg vieta di conoscere simultaneamente posizione e quantità di moto con esattezza.",
      postulates:
        "Gli elettroni si comportano sia come particelle sia come onde. Il loro stato è descritto da una funzione d'onda ψ; |ψ|² dà la densità di probabilità. Gli orbitali (s, p, d, f) definiscono posizioni probabili, non traiettorie fisse. Energia e momento angolare sono quantizzati tramite numeri quantici.",
      limitations:
        "Il modello è matematicamente astratto e visivamente meno intuitivo. Le soluzioni esatte esistono solo per sistemi semplici; gli atomi multielettronici richiedono metodi di approssimazione. Probabilità non significa che l'elettrone sia spalmato — la misura trova comunque una particella localizzata.",
    },
  },
};

export default it;
