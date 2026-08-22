export const ATOM_MODEL_IDS = ["dalton", "thomson", "rutherford", "bohr", "quantum"] as const;

export type AtomModelId = (typeof ATOM_MODEL_IDS)[number];

export interface AtomModelMeta {
  id: AtomModelId;
  accentColor: string;
  order: number;
}

export interface AtomModelContent {
  name: string;
  scientist: string;
  year: string;
  history: string;
  postulates: string;
  limitations: string;
}

export interface AtomModelsUiStrings {
  nav_atom_models: string;
  atom_models_badge: string;
  atom_models_title: string;
  atom_models_subtitle: string;
  atom_models_label_timeline: string;
  atom_models_label_history: string;
  atom_models_label_postulates: string;
  atom_models_label_limitations: string;
  atom_models_label_scientist: string;
}

export interface AtomModelsLocaleBundle {
  ui: AtomModelsUiStrings;
  models: Record<AtomModelId, AtomModelContent>;
}
