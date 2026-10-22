import manifest from "../../manifests/filters-v1.json";
import type { FilterRef } from "@album/document";
import type { FilterRecipe } from "./types";
export const filterManifest = manifest;
export const recipes: readonly FilterRecipe[] = Object.freeze(
  manifest.items.map((r) => Object.freeze({ ...r })),
);
export function getRecipe(ref: FilterRef): FilterRecipe {
  if (
    !Number.isFinite(ref.strength) ||
    ref.strength < 0 ||
    ref.strength > 1 ||
    !Number.isInteger(ref.seed) ||
    ref.seed < 0 ||
    ref.seed > 0xffffffff
  )
    throw new Error("INVALID_FILTER_PARAMETERS");
  const recipe = recipes.find(
    (r) => r.id === ref.presetId && r.recipeVersion === ref.recipeVersion,
  );
  if (!recipe) throw new Error("UNSUPPORTED_FILTER_VERSION");
  return recipe;
}
