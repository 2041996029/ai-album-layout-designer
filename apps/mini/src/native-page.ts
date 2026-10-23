interface NativeHost {
  setData(value: object): void;
}
type Controller = Record<string, unknown>;
/** Bind native lifecycle methods without sharing controller state across stacked pages. */
export function createNativePage(factory: () => Controller): Controller {
  const template = factory();
  const instances = new WeakMap<object, Controller>();
  const definition: Controller = { data: template.data };
  for (const [name, value] of Object.entries(template)) {
    if (typeof value !== "function") continue;
    definition[name] = function (this: NativeHost, ...args: unknown[]) {
      let controller = instances.get(this);
      if (!controller) {
        controller = factory();
        const current = controller;
        controller.setData = (value: object) => {
          Object.assign(current.data as object, value);
          this.setData(value);
        };
        instances.set(this, controller);
      }
      const result = Reflect.apply(
        controller[name] as (...args: unknown[]) => unknown,
        controller,
        args,
      );
      if (name === "onUnload") instances.delete(this);
      return result;
    };
  }
  return definition;
}
