import type { WxApi } from "./wx";
declare global {
  const wx: WxApi;
  function App(definition: { onLaunch: () => void }): void;
  function Page(definition: object): void;
}
export {};
