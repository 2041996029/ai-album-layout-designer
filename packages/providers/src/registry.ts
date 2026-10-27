import type { ProviderAdapter } from "./types";
export class ProviderRegistry {
  private entries = new Map<string, ProviderAdapter>();
  register(adapter: ProviderAdapter) {
    const key = adapter.id + ":" + adapter.version;
    if (this.entries.has(key)) throw Error("PROVIDER_VERSION_IMMUTABLE");
    this.entries.set(key, adapter);
  }
  get(id: string, version: string) {
    const p = this.entries.get(id + ":" + version);
    if (!p) throw Error("PROVIDER_UNCONFIGURED");
    return p;
  }
}
