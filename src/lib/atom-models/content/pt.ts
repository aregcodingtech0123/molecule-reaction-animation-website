import type { AtomModelsLocaleBundle } from "../types";

const pt: AtomModelsLocaleBundle = {
  ui: {
    nav_atom_models: "Modelos Atômicos",
    atom_models_badge: "História do Átomo",
    atom_models_title: "Evolução dos Modelos Atômicos",
    atom_models_subtitle:
      "Percorra cinco séculos de descoberta científica — das esferas sólidas de Dalton à nuvem quântica probabilística.",
    atom_models_label_timeline: "Linha do Tempo Histórica",
    atom_models_label_history: "Contexto Histórico",
    atom_models_label_postulates: "Ideias Fundamentais",
    atom_models_label_limitations: "Limitações Científicas",
    atom_models_label_scientist: "Figura Central",
  },
  models: {
    dalton: {
      name: "Modelo de Esfera Sólida de Dalton",
      scientist: "John Dalton",
      year: "1803",
      history:
        "No início do século XIX, John Dalton reviveu a antiga ideia de átomos indivisíveis e deu à química seu primeiro quadro quantitativo. Propôs que cada elemento consiste em partículas idênticas e indestrutíveis com massa característica, e que os compostos se formam quando átomos se combinam em proporções inteiras simples.",
      postulates:
        "Toda a matéria é composta de átomos extremamente pequenos e indivisíveis. Átomos de um dado elemento são idênticos em massa e propriedades. Átomos combinam-se em proporções fixas para formar compostos. Reações químicas rearranjam átomos, mas nunca os criam ou destroem.",
      limitations:
        "Dalton tratou os átomos como esferas lisas, como bolas de bilhar, sem estrutura interna. O modelo não pôde explicar fenômenos elétricos, linhas espectrais, radioatividade ou por que alguns elementos existem em múltiplas formas com massas diferentes (isótopos).",
    },
    thomson: {
      name: "Modelo do Pudim de Passas de Thomson",
      scientist: "J. J. Thomson",
      year: "1904",
      history:
        "Após descobrir o elétron em 1897, Thomson propôs que os átomos não são indivisíveis. Imaginou uma esfera difusa de carga positiva — como um pudim — com elétrons de carga negativa embutidos, mantendo o átomo globalmente neutro.",
      postulates:
        "Os elétrons são muito mais leves que o átomo como um todo e carregam carga negativa. A carga positiva está distribuída uniformemente pelo volume atômico. Os elétrons ficam dentro dessa esfera positiva como passas no pudim, equilibrando a carga até a neutralidade.",
      limitations:
        "O modelo não pôde prever os resultados de espalhamento de Rutherford: a maioria das partículas alfa atravessou a folha de ouro sem desvio. Não explicou espectros atômicos discretos e não reservou lugar para um núcleo central denso.",
    },
    rutherford: {
      name: "Modelo Nuclear de Rutherford",
      scientist: "Ernest Rutherford",
      year: "1911",
      history:
        "A experiência da folha de ouro de Rutherford mostrou que um núcleo minúsculo, denso e positivamente carregado contém quase toda a massa atômica, enquanto os elétrons ocupam um espaço em grande parte vazio, longe dele. Isso derrubou a imagem do pudim e estabeleceu o átomo nuclear semelhante a um sistema planetário.",
      postulates:
        "Quase toda a massa e toda a carga positiva residem em um núcleo central cerca de 10⁵ vezes menor que o átomo. Os elétrons orbitam o núcleo como planetas ao redor do Sol. O átomo é em grande parte espaço vazio.",
      limitations:
        "A física clássica prevê que elétrons carregados em órbita deveriam irradiar energia, espiralizar para dentro e colapsar o átomo em nanossegundos. O modelo não explicou por que os elétrons ocupam níveis de energia estáveis e discretos nem produzem espectros de linhas.",
    },
    bohr: {
      name: "Modelo de Bohr",
      scientist: "Niels Bohr",
      year: "1913",
      history:
        "Bohr uniu o núcleo de Rutherford com ideias quânticas de Planck e Einstein. Postulou que os elétrons ocupam apenas certas órbitas permitidas com energia fixa, saltando entre elas ao absorver ou emitir fótons — explicando as linhas espectrais do hidrogênio com notável precisão.",
      postulates:
        "Os elétrons movem-se em órbitas circulares fixas sem irradiar energia. Cada órbita tem momento angular quantizado (n = 1, 2, 3…). A luz é emitida ou absorvida apenas quando os elétrons saltam entre órbitas, com energia E = hν.",
      limitations:
        "O modelo de Bohr funciona bem para átomos semelhantes ao hidrogênio, mas falha em átomos multielétronicos, ligações moleculares e detalhes espectrais finos. Mistura órbitas clássicas com regras quânticas sem uma base teórica plenamente coerente.",
    },
    quantum: {
      name: "Modelo Mecânico Quântico",
      scientist: "Schrödinger, Heisenberg, Born",
      year: "década de 1920",
      history:
        "A mecânica quântica moderna substitui trajetórias definidas de elétrons por distribuições de probabilidade. A equação de Schrödinger produz orbitais — regiões tridimensionais onde é mais provável encontrar um elétron. O princípio da incerteza de Heisenberg proíbe conhecer simultaneamente posição e momento com exatidão.",
      postulates:
        "Os elétrons comportam-se como partículas e ondas. Seu estado é descrito por uma função de onda ψ; |ψ|² dá a densidade de probabilidade. Orbitais (s, p, d, f) definem locais prováveis, não trajetórias fixas. Energia e momento angular são quantizados por números quânticos.",
      limitations:
        "O modelo é matematicamente abstrato e visualmente menos intuitivo. Soluções exatas existem apenas para sistemas simples; átomos multielétronicos requerem métodos de aproximação. Probabilidade não significa que o elétron esteja espalhado — a medição ainda encontra uma partícula localizada.",
    },
  },
};

export default pt;
