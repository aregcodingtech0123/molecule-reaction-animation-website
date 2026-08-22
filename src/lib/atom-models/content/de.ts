import type { AtomModelsLocaleBundle } from "../types";

const de: AtomModelsLocaleBundle = {
  ui: {
    nav_atom_models: "Atommodelle",
    atom_models_badge: "Geschichte des Atoms",
    atom_models_title: "Evolution der Atommodelle",
    atom_models_subtitle:
      "Reisen Sie durch fünf Jahrhunderte wissenschaftlicher Entdeckungen — von Daltons festen Kugeln bis zur probabilistischen Quantenwolke.",
    atom_models_label_timeline: "Historische Zeitleiste",
    atom_models_label_history: "Historischer Kontext",
    atom_models_label_postulates: "Grundideen",
    atom_models_label_limitations: "Wissenschaftliche Grenzen",
    atom_models_label_scientist: "Schlüsselfigur",
  },
  models: {
    dalton: {
      name: "Daltons Kugelmodell",
      scientist: "John Dalton",
      year: "1803",
      history:
        "Zu Beginn des 19. Jahrhunderts belebt John Dalton die antike Idee unteilbarer Atome wieder und gibt der Chemie ihren ersten quantitativen Rahmen. Er schlägt vor, dass jedes Element aus identischen, unzerstörbaren Teilchen mit charakteristischer Masse besteht und Verbindungen entstehen, wenn Atome in einfachen ganzzahligen Verhältnissen zusammentreten.",
      postulates:
        "Alle Materie besteht aus extrem kleinen, unteilbaren Atomen. Atome eines Elements sind in Masse und Eigenschaften identisch. Atome verbinden sich in festen Verhältnissen zu Verbindungen. Chemische Reaktionen ordnen Atome neu, erzeugen oder vernichten sie aber nie.",
      limitations:
        "Dalton behandelte Atome als formlose Billardkugeln ohne innere Struktur. Das Modell konnte elektrische Phänomene, Spektrallinien, Radioaktivität oder erklären, warum manche Elemente in mehreren Formen mit unterschiedlicher Masse existieren (Isotope).",
    },
    thomson: {
      name: "Thomsons Plumpudding-Modell",
      scientist: "J. J. Thomson",
      year: "1904",
      history:
        "Nach der Entdeckung des Elektrons 1897 schlug Thomson vor, dass Atome nicht unteilbar sind. Er stellte sich eine diffuse Kugel positiver Ladung vor — wie Pudding — mit darin eingebetteten negativ geladenen Elektronen, sodass das Atom insgesamt neutral bleibt.",
      postulates:
        "Elektronen sind viel leichter als das Atom als Ganzes und tragen negative Ladung. Positive Ladung ist gleichmäßig im Atomvolumen verteilt. Elektronen sitzen wie Rosinen im Pudding in dieser positiven Kugel und balancieren die Ladung zur Neutralität.",
      limitations:
        "Das Modell konnte Rutherfords Streuergebnisse nicht vorhersagen: Die meisten Alphateilchen passierten Goldfolie unabgelenkt. Es erklärte keine diskreten Atomenspektren und bot keinen Platz für einen dichten zentralen Kern.",
    },
    rutherford: {
      name: "Rutherfords Kernmodell",
      scientist: "Ernest Rutherford",
      year: "1911",
      history:
        "Rutherfords Goldfolienexperiment zeigte, dass ein winziger, dichter, positiv geladener Kern fast die gesamte Atommasse enthält, während Elektronen weit entfernt in überwiegend leerem Raum existieren. Dies stürzte das Plumpudding-Bild und etablierte das planetenähnliche Kernatom.",
      postulates:
        "Fast die gesamte Masse und alle positive Ladung befinden sich in einem zentralen Kern, der etwa 10⁵-mal kleiner ist als das Atom. Elektronen kreisen wie Planeten um die Sonne um den Kern. Das Atom besteht größtenteils aus leerem Raum.",
      limitations:
        "Die klassische Physik sagt voraus, dass kreisende geladene Elektronen Energie abstrahlen, nach innen spiralförmig fallen und das Atom innerhalb von Nanosekunden kollabieren sollten. Das Modell erklärt nicht, warum Elektronen stabile, diskrete Energieniveaus einnehmen oder Linienspektren erzeugen.",
    },
    bohr: {
      name: "Bohr-Modell",
      scientist: "Niels Bohr",
      year: "1913",
      history:
        "Bohr verband Rutherfords Kern mit Quantenideen von Planck und Einstein. Er postulierte, dass Elektronen nur bestimmte erlaubte Bahnen mit fester Energie einnehmen und durch Absorption oder Emission von Photonen zwischen ihnen springen — und erklärte damit Wasserstoffs Spektrallinien mit bemerkenswerter Genauigkeit.",
      postulates:
        "Elektronen bewegen sich auf festen Kreisbahnen, ohne Energie abzustrahlen. Jede Bahn hat einen quantisierten Drehimpuls (n = 1, 2, 3…). Licht wird nur emittiert oder absorbiert, wenn Elektronen zwischen Bahnen springen, mit Energie E = hν.",
      limitations:
        "Bohrs Modell funktioniert gut für wasserstoffähnliche Atome, versagt aber bei Mehrelektronenatomen, molekularen Bindungen und feinen Spektraldetails. Es mischt klassische Bahnen mit Quantenregeln ohne vollständig konsistente theoretische Grundlage.",
    },
    quantum: {
      name: "Quantenmechanisches Modell",
      scientist: "Schrödinger, Heisenberg, Born",
      year: "1920er",
      history:
        "Die moderne Quantenmechanik ersetzt bestimmte Elektronenbahnen durch Wahrscheinlichkeitsverteilungen. Die Schrödinger-Gleichung liefert Orbitale — dreidimensionale Bereiche, in denen ein Elektron am wahrscheinlichsten gefunden wird. Heisenbergs Unschärferelation verbietet gleichzeitiges exaktes Wissen über Ort und Impuls.",
      postulates:
        "Elektronen verhalten sich sowohl als Teilchen als auch als Wellen. Ihr Zustand wird durch eine Wellenfunktion ψ beschrieben; |ψ|² gibt die Wahrscheinlichkeitsdichte. Orbitale (s, p, d, f) definieren wahrscheinliche Orte, keine festen Bahnen. Energie und Drehimpuls sind durch Quantenzahlen quantisiert.",
      limitations:
        "Das Modell ist mathematisch abstrakt und visuell weniger intuitiv. Exakte Lösungen existieren nur für einfache Systeme; Mehrelektronenatome erfordern Näherungsverfahren. Wahrscheinlichkeit bedeutet nicht, dass das Elektron verschmiert ist — eine Messung findet dennoch ein lokalisiertes Teilchen.",
    },
  },
};

export default de;
