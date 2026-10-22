export interface PixelTile {
  bytes: Uint8ClampedArray;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  fullWidth: number;
  fullHeight: number;
}
export interface FilterRecipe {
  id: string;
  name: string;
  recipeVersion: number;
  operationsInOrder: string;
  defaultStrength: number;
  seed: number;
  category?: string;
}
