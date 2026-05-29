const SMILES_TAG_RE = /<SMILES>([\s\S]*?)<\/SMILES>/i;

export function extractSmilesFromMessage(text: string): string | null {
  const match = text.match(SMILES_TAG_RE);
  return match?.[1]?.trim() ?? null;
}

export function stripSmilesTags(text: string): string {
  return text.replace(SMILES_TAG_RE, "").trim();
}
