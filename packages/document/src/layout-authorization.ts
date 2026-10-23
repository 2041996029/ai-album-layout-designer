import type { DocumentCommand } from "./commands";
import { canonicalJson } from "./canonical";
type LayoutCommand = Extract<DocumentCommand, { type: "apply-layout" }>;
// Internal capability, deliberately absent from the document package barrel.
// Payload binding prevents mutation between layout verification and execution.
const verified = new WeakMap<LayoutCommand, string>();
export function registerLayoutCommand(command: LayoutCommand): LayoutCommand {
  verified.set(command, canonicalJson(command));
  return command;
}
export function isVerifiedLayoutCommand(command: LayoutCommand): boolean {
  return verified.get(command) === canonicalJson(command);
}
