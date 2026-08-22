import type { AtomModelsLocaleBundle } from "../types";

const en: AtomModelsLocaleBundle = {
  ui: {
    nav_atom_models: "Atom Models",
    atom_models_badge: "History of the Atom",
    atom_models_title: "Evolution of Atomic Models",
    atom_models_subtitle:
      "Travel through five centuries of scientific discovery — from Dalton's solid spheres to the probabilistic quantum cloud.",
    atom_models_label_timeline: "Historical Timeline",
    atom_models_label_history: "Historical Context",
    atom_models_label_postulates: "Core Ideas",
    atom_models_label_limitations: "Scientific Limitations",
    atom_models_label_scientist: "Key Figure",
  },
  models: {
    dalton: {
      name: "Dalton's Solid Sphere Model",
      scientist: "John Dalton",
      year: "1803",
      history:
        "At the dawn of the 19th century, John Dalton revived the ancient idea of indivisible atoms and gave chemistry its first quantitative framework. He proposed that each element consists of identical, indestructible particles with characteristic mass, and that compounds form when atoms combine in simple whole-number ratios.",
      postulates:
        "All matter is composed of extremely small, indivisible atoms. Atoms of a given element are identical in mass and properties. Atoms combine in fixed ratios to form compounds. Chemical reactions rearrange atoms but never create or destroy them.",
      limitations:
        "Dalton treated atoms as featureless, billiard-ball spheres with no internal structure. The model could not explain electrical phenomena, spectral lines, radioactivity, or why some elements exist in multiple forms with different masses (isotopes).",
    },
    thomson: {
      name: "Thomson's Plum Pudding Model",
      scientist: "J. J. Thomson",
      year: "1904",
      history:
        "After discovering the electron in 1897, Thomson proposed that atoms are not indivisible. He imagined a diffuse sphere of positive charge — like pudding — with negatively charged electrons embedded throughout, giving an overall neutral atom.",
      postulates:
        "Electrons are much lighter than the atom as a whole and carry negative charge. Positive charge is spread uniformly through the atomic volume. Electrons sit inside this positive sphere like raisins in pudding, balancing the charge to neutrality.",
      limitations:
        "The model could not predict Rutherford's scattering results: most alpha particles passed through gold foil undeflected. It failed to explain discrete atomic spectra and offered no place for a dense central nucleus.",
    },
    rutherford: {
      name: "Rutherford's Nuclear Model",
      scientist: "Ernest Rutherford",
      year: "1911",
      history:
        "Rutherford's gold-foil experiment showed that a tiny, dense, positively charged nucleus contains nearly all atomic mass, while electrons occupy mostly empty space far away. This overturned the plum pudding picture and established the planetary-like nuclear atom.",
      postulates:
        "Almost all mass and all positive charge reside in a central nucleus roughly 10⁵ times smaller than the atom. Electrons orbit the nucleus like planets around the Sun. The atom is mostly empty space.",
      limitations:
        "Classical physics predicts that orbiting charged electrons should radiate energy, spiral inward, and collapse the atom within nanoseconds. The model could not explain why electrons occupy stable, discrete energy levels or produce line spectra.",
    },
    bohr: {
      name: "Bohr Model",
      scientist: "Niels Bohr",
      year: "1913",
      history:
        "Bohr merged Rutherford's nucleus with quantum ideas from Planck and Einstein. He postulated that electrons occupy only certain allowed orbits with fixed energy, jumping between them by absorbing or emitting photons — explaining hydrogen's spectral lines with remarkable accuracy.",
      postulates:
        "Electrons move in fixed circular orbits without radiating energy. Each orbit has a quantized angular momentum (n = 1, 2, 3…). Light is emitted or absorbed only when electrons jump between orbits, with energy E = hν.",
      limitations:
        "Bohr's model works well for hydrogen-like atoms but fails for multi-electron atoms, molecular bonding, and fine spectral details. It mixes classical orbits with quantum rules without a fully consistent theoretical foundation.",
    },
    quantum: {
      name: "Quantum Mechanical Model",
      scientist: "Schrödinger, Heisenberg, Born",
      year: "1920s",
      history:
        "Modern quantum mechanics replaces definite electron paths with probability distributions. The Schrödinger equation yields orbitals — three-dimensional regions where an electron is most likely to be found. Heisenberg's uncertainty principle forbids simultaneous exact knowledge of position and momentum.",
      postulates:
        "Electrons behave as both particles and waves. Their state is described by a wavefunction ψ; |ψ|² gives probability density. Orbitals (s, p, d, f) define probable locations, not fixed tracks. Energy and angular momentum are quantized through quantum numbers.",
      limitations:
        "The model is mathematically abstract and less intuitive visually. Exact solutions exist only for simple systems; multi-electron atoms require approximation methods. Probability does not mean the electron is smeared — measurement still finds a localized particle.",
    },
  },
};

export default en;
