import {
  applyCommand,
  allLayers,
  isImageLayer,
  parseDocument,
  type DocumentModel,
  type DocumentCommand,
} from "@album/document";
export class History {
  private past: DocumentModel[] = [];
  private future: DocumentModel[] = [];
  private value: DocumentModel;
  constructor(initial: DocumentModel) {
    this.value = parseDocument(initial);
  }
  get current(): DocumentModel {
    return structuredClone(this.value);
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  referencesAsset(assetId: string): boolean {
    return [...this.past, this.value, ...this.future].some((doc) =>
      allLayers(doc).some(
        (layer) => isImageLayer(layer) && (layer.assetId === assetId || layer.alphaMask?.assetId === assetId),
      ),
    );
  }
  execute(command: DocumentCommand): DocumentModel {
    const next = applyCommand(this.value, command);
    this.past.push(this.value);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.value = next;
    return this.current;
  }
  undo(): DocumentModel {
    const prev = this.past.pop();
    if (prev) {
      this.future.push(this.value);
      this.value = prev;
    }
    return this.current;
  }
  redo(): DocumentModel {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.value);
      this.value = next;
    }
    return this.current;
  }
}
