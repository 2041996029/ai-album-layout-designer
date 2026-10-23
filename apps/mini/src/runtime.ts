import type { MiniApi } from "./api";
import type { WxApi } from "./wx";
export interface MiniRuntime {
  api: MiniApi;
  wx: WxApi;
  capabilities: { layout: boolean; tasks: boolean; export: boolean };
  algorithmVersion: string;
}
let promise: Promise<MiniRuntime> | null = null;
export function configureMiniRuntime(value: Promise<MiniRuntime>) {
  promise = value;
}
export async function getMiniRuntime() {
  if (!promise) throw new Error("小程序服务未配置");
  return promise;
}
