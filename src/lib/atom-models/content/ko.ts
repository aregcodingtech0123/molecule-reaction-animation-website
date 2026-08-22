import type { AtomModelsLocaleBundle } from "../types";

const ko: AtomModelsLocaleBundle = {
  ui: {
    nav_atom_models: "원자 모형",
    atom_models_badge: "원자의 역사",
    atom_models_title: "원자 모형의 진화",
    atom_models_subtitle:
      "Dalton의 고체 구에서 확률적 양자 구름까지 — 5세기에 걸친 과학적 발견의 여정을 따라가 보세요.",
    atom_models_label_timeline: "역사적 타임라인",
    atom_models_label_history: "역사적 배경",
    atom_models_label_postulates: "핵심 개념",
    atom_models_label_limitations: "과학적 한계",
    atom_models_label_scientist: "주요 인물",
  },
  models: {
    dalton: {
      name: "Dalton의 고체 구 모형",
      scientist: "John Dalton",
      year: "1803",
      history:
        "19세기 초 John Dalton은 고대의 나눌 수 없는 원자 개념을 되살리고 화학에 최초의 정량적 틀을 마련했습니다. 각 원소는 특징적인 질량을 가진 동일하고 파괴되지 않는 입자로 이루어져 있으며, 화합물은 원자가 간단한 정수비로 결합할 때 형성된다고 제안했습니다.",
      postulates:
        "모든 물질은 극히 작고 나눌 수 없는 원자로 구성된다. 특정 원소의 원자는 질량과 성질이 동일하다. 원자는 고정된 비율로 결합하여 화합물을 만든다. 화학 반응은 원자를 재배열할 뿐, 원자를 만들거나 파괴하지 않는다.",
      limitations:
        "Dalton은 원자를 내부 구조가 없는 매끄러운 당구공 같은 구로 취급했습니다. 이 모형은 전기 현상, 스펙트럼 선, 방사능, 또는 일부 원소가 서로 다른 질량의 여러 형태(동위원소)로 존재하는 이유를 설명하지 못했습니다.",
    },
    thomson: {
      name: "톰슨의 건포도 푸딩 모형",
      scientist: "J. J. Thomson",
      year: "1904",
      history:
        "1897년 전자를 발견한 후 Thomson은 원자가 나눌 수 없지 않다고 주장했습니다. 그는 푸딩처럼 퍼져 있는 양전하 구 안에 음전하를 띤 전자가 박혀 있어 전체적으로 중성인 원자를 상상했습니다.",
      postulates:
        "전자는 원자 전체보다 훨씬 가볍고 음전하를 띤다. 양전하는 원자 전체 부피에 고르게 퍼져 있다. 전자는 푸딩 속 건포도처럼 이 양전하 구 안에 있으며, 전하를 상쇄하여 중성을 이룬다.",
      limitations:
        "이 모형은 Rutherford의 산란 실험 결과를 예측하지 못했습니다. 대부분의 알파 입자가 금박을 통과했기 때문입니다. 또한 이산적인 원자 스펙트럼을 설명하지 못했고, 밀집된 중심 핵을 위한 자리를 두지 않았습니다.",
    },
    rutherford: {
      name: "Rutherford의 핵 모형",
      scientist: "Ernest Rutherford",
      year: "1911",
      history:
        "Rutherford의 금박 실험은 원자 질량의 거의 전부를 담은 작고 밀도 높은 양전하 핵이 존재함을 보여 주었고, 전자는 멀리 떨어진 대부분 빈 공간에 있다는 사실을 밝혔습니다. 이는 푸딩 모형을 무너뜨리고 행성형 핵 원자를 확립했습니다.",
      postulates:
        "질량과 양전하의 거의 전부는 원자보다 약 10⁵배 작은 중심 핵에 있다. 전자는 태양 주위의 행성처럼 핵 주위를 돈다. 원자는 대부분 빈 공간이다.",
      limitations:
        "고전 물리학에 따르면 궤도를 도는 대전하 전자는 에너지를 방출하고 안쪽으로 나선형으로 떨어져 나노초 안에 원자가 붕괴해야 합니다. 이 모형은 전자가 안정적이고 이산적인 에너지 준위에 있는 이유나 선 스펙트럼을 설명하지 못했습니다.",
    },
    bohr: {
      name: "Bohr 모형",
      scientist: "Niels Bohr",
      year: "1913",
      history:
        "Bohr는 Rutherford의 핵과 Planck·Einstein의 양자 개념을 결합했습니다. 전자는 고정된 에너지를 가진 특정 허용 궤도에만 존재하며, 광자를 흡수하거나 방출하면서 궤도 사이를 점프한다고 가정했습니다. 이로써 수소의 스펙트럼 선을 놀라운 정확도로 설명했습니다.",
      postulates:
        "전자는 에너지를 방출하지 않고 고정된 원형 궤도를 돈다. 각 궤도는 양자화된 각운동량을 가진다(n = 1, 2, 3…). 빛은 전자가 궤도 사이를 점프할 때만 방출되거나 흡수되며, 에너지는 E = hν이다.",
      limitations:
        "Bohr 모형은 수소형 원자에는 잘 맞지만, 다전자 원자, 분자 결합, 미세한 스펙트럼 세부에는 실패합니다. 고전 궤도와 양자 규칙을 섞었을 뿐 완전히 일관된 이론적 토대가 없습니다.",
    },
    quantum: {
      name: "양자역학적 모형",
      scientist: "Schrödinger, Heisenberg, Born",
      year: "1920년대",
      history:
        "현대 양자역학은 확정된 전자 경로 대신 확률 분포를 사용합니다. Schrödinger 방정식은 전자가 발견될 가능성이 가장 높은 3차원 영역인 오비탈을 제공합니다. Heisenberg의 불확정성 원리는 위치와 운동량을 동시에 정확히 알 수 없음을 규정합니다.",
      postulates:
        "전자는 입자이면서 동시에 파동처럼 행동한다. 상태는 파동함수 ψ로 기술되며, |ψ|²는 확률 밀도를 준다. 오비탈(s, p, d, f)은 고정된 궤적이 아니라 가능한 위치를 정의한다. 에너지와 각운동량은 양자수를 통해 양자화된다.",
      limitations:
        "이 모형은 수학적으로 추상적이며 시각적으로 덜 직관적입니다. 정확한 해는 단순한 계통에만 존재하며, 다전자 원자에는 근사 방법이 필요합니다. 확률은 전자가 퍼져 있다는 뜻이 아닙니다. 측정하면 여전히 국소화된 입자가 관측됩니다.",
    },
  },
};

export default ko;
