import type { AtomModelsLocaleBundle } from "../types";

const es: AtomModelsLocaleBundle = {
  ui: {
    nav_atom_models: "Modelos Atómicos",
    atom_models_badge: "Historia del Átomo",
    atom_models_title: "Evolución de los Modelos Atómicos",
    atom_models_subtitle:
      "Recorra cinco siglos de descubrimiento científico — desde las esferas sólidas de Dalton hasta la nube cuántica probabilística.",
    atom_models_label_timeline: "Línea Temporal Histórica",
    atom_models_label_history: "Contexto Histórico",
    atom_models_label_postulates: "Ideas Fundamentales",
    atom_models_label_limitations: "Limitaciones Científicas",
    atom_models_label_scientist: "Figura Clave",
  },
  models: {
    dalton: {
      name: "Modelo de Esfera Sólida de Dalton",
      scientist: "John Dalton",
      year: "1803",
      history:
        "A principios del siglo XIX, John Dalton revivió la antigua idea de átomos indivisibles y dio a la química su primer marco cuantitativo. Propuso que cada elemento consiste en partículas idénticas e indestructibles con masa característica, y que los compuestos se forman cuando los átomos se combinan en proporciones enteras simples.",
      postulates:
        "Toda la materia está compuesta de átomos extremadamente pequeños e indivisibles. Los átomos de un elemento dado son idénticos en masa y propiedades. Los átomos se combinan en proporciones fijas para formar compuestos. Las reacciones químicas reordenan átomos pero nunca los crean ni destruyen.",
      limitations:
        "Dalton trató los átomos como esferas lisas, como bolas de billar, sin estructura interna. El modelo no pudo explicar fenómenos eléctricos, líneas espectrales, radiactividad ni por qué algunos elementos existen en múltiples formas con masas diferentes (isótopos).",
    },
    thomson: {
      name: "Modelo del Pudín de Ciruelas de Thomson",
      scientist: "J. J. Thomson",
      year: "1904",
      history:
        "Tras descubrir el electrón en 1897, Thomson propuso que los átomos no son indivisibles. Imaginó una esfera difusa de carga positiva — como un pudín — con electrones de carga negativa incrustados en su interior, manteniendo el átomo globalmente neutro.",
      postulates:
        "Los electrones son mucho más ligeros que el átomo en su conjunto y llevan carga negativa. La carga positiva se distribuye uniformemente por todo el volumen atómico. Los electrones se sitúan dentro de esta esfera positiva como pasas en un pudín, equilibrando la carga hasta la neutralidad.",
      limitations:
        "El modelo no pudo predecir los resultados de dispersión de Rutherford: la mayoría de las partículas alfa atravesaron la lámina de oro sin desviarse. No explicó espectros atómicos discretos ni dejó lugar para un núcleo central denso.",
    },
    rutherford: {
      name: "Modelo Nuclear de Rutherford",
      scientist: "Ernest Rutherford",
      year: "1911",
      history:
        "El experimento de la lámina de oro de Rutherford demostró que un núcleo diminuto, denso y positivamente cargado contiene casi toda la masa atómica, mientras que los electrones ocupan un espacio mayoritariamente vacío lejos de él. Esto derribó la imagen del pudín y estableció el átomo nuclear tipo planetario.",
      postulates:
        "Casi toda la masa y toda la carga positiva residen en un núcleo central unas 10⁵ veces más pequeño que el átomo. Los electrones orbitan el núcleo como planetas alrededor del Sol. El átomo es en su mayor parte espacio vacío.",
      limitations:
        "La física clásica predice que los electrones cargados en órbita deberían irradiar energía, espiralizar hacia adentro y colapsar el átomo en nanosegundos. El modelo no explicó por qué los electrones ocupan niveles de energía estables y discretos ni producen espectros de líneas.",
    },
    bohr: {
      name: "Modelo de Bohr",
      scientist: "Niels Bohr",
      year: "1913",
      history:
        "Bohr fusionó el núcleo de Rutherford con ideas cuánticas de Planck y Einstein. Postuló que los electrones ocupan solo ciertas órbitas permitidas con energía fija, saltando entre ellas al absorber o emitir fotones — explicando las líneas espectrales del hidrógeno con notable precisión.",
      postulates:
        "Los electrones se mueven en órbitas circulares fijas sin irradiar energía. Cada órbita tiene un momento angular cuantizado (n = 1, 2, 3…). La luz se emite o absorbe solo cuando los electrones saltan entre órbitas, con energía E = hν.",
      limitations:
        "El modelo de Bohr funciona bien para átomos tipo hidrógeno pero falla en átomos multielectrónicos, enlaces moleculares y detalles espectrales finos. Mezcla órbitas clásicas con reglas cuánticas sin una base teórica plenamente coherente.",
    },
    quantum: {
      name: "Modelo Mecánico Cuántico",
      scientist: "Schrödinger, Heisenberg, Born",
      year: "años 1920",
      history:
        "La mecánica cuántica moderna reemplaza trayectorias definidas de electrones con distribuciones de probabilidad. La ecuación de Schrödinger produce orbitales — regiones tridimensionales donde es más probable encontrar un electrón. El principio de incertidumbre de Heisenberg prohíbe conocer simultáneamente posición y momento con exactitud.",
      postulates:
        "Los electrones se comportan como partículas y ondas. Su estado se describe con una función de onda ψ; |ψ|² da la densidad de probabilidad. Los orbitales (s, p, d, f) definen ubicaciones probables, no trayectorias fijas. La energía y el momento angular están cuantizados mediante números cuánticos.",
      limitations:
        "El modelo es matemáticamente abstracto y visualmente menos intuitivo. Las soluciones exactas existen solo para sistemas simples; los átomos multielectrónicos requieren métodos de aproximación. Probabilidad no significa que el electrón esté extendido — la medición aún encuentra una partícula localizada.",
    },
  },
};

export default es;
