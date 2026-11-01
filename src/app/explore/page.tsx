import { ExploreWorkbench } from "@/components/explore/ExploreWorkbench";
import { getDefaultMoleculeId, resolveMoleculeIdFromQuery } from "@/lib/molecules/resolve-molecule-id";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The molecule named by `?molecule=` / `?id=` is chosen on the server so the first HTML already shows it; an
 * unknown id falls back to the default molecule, exactly as before. Every variant shares the canonical
 * `/explore` (SEO-03).
 */
export default async function ExplorePage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const initialMoleculeId = resolveMoleculeIdFromQuery(first(query.molecule) ?? first(query.id) ?? null) ?? getDefaultMoleculeId();
  return <ExploreWorkbench initialMoleculeId={initialMoleculeId} />;
}
