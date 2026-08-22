import type { AtomModelsLocaleBundle } from "../types";

const zh: AtomModelsLocaleBundle = {
  ui: {
    nav_atom_models: "原子模型",
    atom_models_badge: "原子发展史",
    atom_models_title: "原子模型的演变",
    atom_models_subtitle:
      "穿越五个世纪的科学发现之旅——从 Dalton 的实心球到概率性的量子云。",
    atom_models_label_timeline: "历史时间线",
    atom_models_label_history: "历史背景",
    atom_models_label_postulates: "核心观点",
    atom_models_label_limitations: "科学局限",
    atom_models_label_scientist: "关键人物",
  },
  models: {
    dalton: {
      name: "Dalton 实心球模型",
      scientist: "John Dalton",
      year: "1803",
      history:
        "19 世纪初，John Dalton 复兴了古代不可分原子的思想，为化学建立了第一个定量框架。他提出每种元素由具有特征质量的相同、不可摧毁的粒子组成，化合物则在原子以简单整数比结合时形成。",
      postulates:
        "一切物质由极小的不可分原子构成。同一元素的原子在质量和性质上相同。原子以固定比例结合形成化合物。化学反应只是重新排列原子，从不创造或销毁原子。",
      limitations:
        "Dalton 将原子视为没有内部结构、光滑如台球的无特征球体。该模型无法解释电学现象、谱线、放射性，也无法说明为何某些元素以不同质量的多形态（同位素）存在。",
    },
    thomson: {
      name: "Thomson 葡萄干布丁模型",
      scientist: "J. J. Thomson",
      year: "1904",
      history:
        "1897 年发现电子后，Thomson 提出原子并非不可分。他设想一个弥散的正电荷球——像布丁一样——其中嵌有带负电的电子，使原子整体保持电中性。",
      postulates:
        "电子比整个原子轻得多，带负电荷。正电荷均匀分布在整个原子体积中。电子像布丁中的葡萄干一样位于这一正电荷球内，使电荷平衡至中性。",
      limitations:
        "该模型无法预测 Rutherford 的散射实验结果：大多数 α 粒子穿过金箔时未发生偏转。它也不能解释离散的原子光谱，更无法容纳一个致密的中心原子核。",
    },
    rutherford: {
      name: "Rutherford 核式模型",
      scientist: "Ernest Rutherford",
      year: "1911",
      history:
        "Rutherford 的金箔实验表明，一个微小、致密、带正电的原子核包含了几乎全部原子质量，而电子则远在大部分为空的空间中。这推翻了布丁模型，建立了类似行星系统的核式原子结构。",
      postulates:
        "几乎全部质量和全部正电荷集中在比原子小约 10⁵ 倍的中心核中。电子像行星绕太阳一样绕核运动。原子大部分是空的。",
      limitations:
        "经典物理学预测，轨道上的带电电子会辐射能量、向内螺旋下落，并在纳秒级时间内使原子坍缩。该模型无法解释电子为何占据稳定、分立的能级，也无法解释线状光谱。",
    },
    bohr: {
      name: "Bohr 模型",
      scientist: "Niels Bohr",
      year: "1913",
      history:
        "Bohr 将 Rutherford 的原子核与 Planck 和 Einstein 的量子思想结合起来。他假定电子只能处于某些具有固定能量的允许轨道上，通过吸收或发射光子在不同轨道间跃迁——以惊人的精度解释了氢光谱线。",
      postulates:
        "电子在固定圆形轨道上运动而不辐射能量。每条轨道具有量子化的角动量（n = 1, 2, 3…）。光仅在电子在轨道间跃迁时发射或吸收，能量为 E = hν。",
      limitations:
        "Bohr 模型对类氢原子效果良好，但对多电子原子、分子成键和精细光谱细节则失效。它将经典轨道与量子规则混合，缺乏完全自洽的理论基础。",
    },
    quantum: {
      name: "量子力学模型",
      scientist: "Schrödinger, Heisenberg, Born",
      year: "1920 年代",
      history:
        "现代量子力学用概率分布取代确定的电子路径。Schrödinger 方程给出轨道——电子最可能被找到的三维区域。Heisenberg 不确定性原理禁止同时精确知道位置和动量。",
      postulates:
        "电子既表现为粒子又表现为波。其状态由波函数 ψ 描述；|ψ|² 给出概率密度。轨道（s、p、d、f）定义可能的位置，而非固定轨迹。能量和角动量通过量子数量子化。",
      limitations:
        "该模型在数学上较为抽象，视觉上也不如早期模型直观。精确解仅存在于简单体系；多电子原子需要近似方法。概率并不意味着电子被“抹开”——测量时仍会找到局域化的粒子。",
    },
  },
};

export default zh;
