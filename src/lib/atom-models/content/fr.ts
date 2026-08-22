import type { AtomModelsLocaleBundle } from "../types";

const fr: AtomModelsLocaleBundle = {
  ui: {
    nav_atom_models: "Modèles Atomiques",
    atom_models_badge: "Histoire de l'Atome",
    atom_models_title: "Évolution des Modèles Atomiques",
    atom_models_subtitle:
      "Parcourez cinq siècles de découvertes scientifiques — des sphères solides de Dalton au nuage quantique probabiliste.",
    atom_models_label_timeline: "Chronologie Historique",
    atom_models_label_history: "Contexte Historique",
    atom_models_label_postulates: "Idées Fondamentales",
    atom_models_label_limitations: "Limites Scientifiques",
    atom_models_label_scientist: "Figure Clé",
  },
  models: {
    dalton: {
      name: "Modèle de Sphère Solide de Dalton",
      scientist: "John Dalton",
      year: "1803",
      history:
        "Au début du XIXe siècle, John Dalton relance l'ancienne idée d'atomes indivisibles et donne à la chimie son premier cadre quantitatif. Il propose que chaque élément consiste en particules identiques et indestructibles de masse caractéristique, et que les composés se forment lorsque les atomes se combinent en proportions entières simples.",
      postulates:
        "Toute matière est composée d'atomes extrêmement petits et indivisibles. Les atomes d'un élément donné sont identiques en masse et en propriétés. Les atomes se combinent en proportions fixes pour former des composés. Les réactions chimiques réarrangent les atomes sans jamais les créer ni les détruire.",
      limitations:
        "Dalton traitait les atomes comme des sphères lisses, sans structure interne, semblables à des billes de billard. Le modèle ne pouvait expliquer les phénomènes électriques, les raies spectrales, la radioactivité, ni pourquoi certains éléments existent sous plusieurs formes de masses différentes (isotopes).",
    },
    thomson: {
      name: "Modèle du Pudding aux Pruneaux de Thomson",
      scientist: "J. J. Thomson",
      year: "1904",
      history:
        "Après la découverte de l'électron en 1897, Thomson propose que les atomes ne sont pas indivisibles. Il imagine une sphère diffuse de charge positive — comme un pudding — avec des électrons négatifs incrustés, rendant l'atome globalement neutre.",
      postulates:
        "Les électrons sont bien plus légers que l'atome entier et portent une charge négative. La charge positive est répartie uniformément dans le volume atomique. Les électrons se trouvent dans cette sphère positive comme des raisins dans un pudding, équilibrant la charge jusqu'à la neutralité.",
      limitations:
        "Le modèle ne pouvait prédire les résultats de diffusion de Rutherford : la plupart des particules alpha traversaient la feuille d'or sans déviation. Il n'expliquait pas les spectres atomiques discrets et ne laissait aucune place à un noyau central dense.",
    },
    rutherford: {
      name: "Modèle Nucléaire de Rutherford",
      scientist: "Ernest Rutherford",
      year: "1911",
      history:
        "L'expérience de la feuille d'or de Rutherford montre qu'un noyau minuscule, dense et positivement chargé contient presque toute la masse atomique, tandis que les électrons occupent un espace largement vide, loin de lui. Cela renverse l'image du pudding et établit l'atome nucléaire de type planétaire.",
      postulates:
        "Presque toute la masse et toute la charge positive résident dans un noyau central environ 10⁵ fois plus petit que l'atome. Les électrons orbitent le noyau comme des planètes autour du Soleil. L'atome est en grande partie vide.",
      limitations:
        "La physique classique prédit que des électrons chargés en orbite devraient rayonner de l'énergie, spiraler vers l'intérieur et faire s'effondrer l'atome en nanosecondes. Le modèle n'explique pas pourquoi les électrons occupent des niveaux d'énergie stables et discrets ni produisent des spectres de raies.",
    },
    bohr: {
      name: "Modèle de Bohr",
      scientist: "Niels Bohr",
      year: "1913",
      history:
        "Bohr fusionne le noyau de Rutherford avec les idées quantiques de Planck et Einstein. Il postule que les électrons n'occupent que certaines orbites autorisées à énergie fixe, sautant entre elles en absorbant ou émettant des photons — expliquant les raies spectrales de l'hydrogène avec une précision remarquable.",
      postulates:
        "Les électrons se déplacent sur des orbites circulaires fixes sans rayonner d'énergie. Chaque orbite possède un moment cinétique quantifié (n = 1, 2, 3…). La lumière n'est émise ou absorbée que lorsque les électrons sautent entre orbites, avec une énergie E = hν.",
      limitations:
        "Le modèle de Bohr fonctionne bien pour les atomes de type hydrogène mais échoue pour les atomes multielectroniques, les liaisons moléculaires et les détails spectraux fins. Il mélange orbites classiques et règles quantiques sans fondement théorique pleinement cohérent.",
    },
    quantum: {
      name: "Modèle Mécanique Quantique",
      scientist: "Schrödinger, Heisenberg, Born",
      year: "années 1920",
      history:
        "La mécanique quantique moderne remplace les trajectoires définies des électrons par des distributions de probabilité. L'équation de Schrödinger produit des orbitales — régions tridimensionnelles où un électron est le plus probablement trouvé. Le principe d'incertitude de Heisenberg interdit de connaître simultanément position et quantité de mouvement avec exactitude.",
      postulates:
        "Les électrons se comportent à la fois comme particules et ondes. Leur état est décrit par une fonction d'onde ψ ; |ψ|² donne la densité de probabilité. Les orbitales (s, p, d, f) définissent des emplacements probables, non des trajectoires fixes. L'énergie et le moment cinétique sont quantifiés par des nombres quantiques.",
      limitations:
        "Le modèle est mathématiquement abstrait et visuellement moins intuitif. Les solutions exactes n'existent que pour des systèmes simples ; les atomes multielectroniques nécessitent des méthodes d'approximation. Probabilité ne signifie pas que l'électron est étalé — une mesure trouve toujours une particule localisée.",
    },
  },
};

export default fr;
