import { templateVersions, type TemplateRef } from "@album/document";
import type { ResourceManifest } from "@album/assets";
import type { MiniPolicy } from "./mini-patch";
const identity = (ref: TemplateRef) => `${ref.id}:${ref.version}:${ref.sha256}`;
/** Server policy for immutable shipped templates; document extension fields never grant permissions. */
const registeredPolicies = new Map(
  templateVersions.map((template) => [
    identity(template),
    new Map(
      template.slots.map((slot) => [
        slot.slotId,
        {
          kind: slot.kind,
          fields:
            slot.kind === "image"
              ? ["crop", "assetId"]
              : slot.kind === "text"
                ? (slot.editableFields ?? []).filter(
                    (field) => field === "text",
                  )
                : [],
        },
      ]),
    ),
  ]),
);
export function nativeMiniPolicy(resources: ResourceManifest): MiniPolicy {
  return (spread, layer) => {
    if (!spread.templateRef) return;
    const binding = layer.templateSlot as
      { version?: number; slotId?: string } | undefined;
    if (binding?.version !== 1 || !binding.slotId) return;
    const permission = registeredPolicies
      .get(identity(spread.templateRef))
      ?.get(binding.slotId);
    if (!permission || permission.kind !== layer.type) return;
    return {
      editableFields: permission.fields,
      allowedAssetIds: resources.assets.map((a) => a.id),
      assetDimensions: resources.assets.find((a) => a.id === layer.assetId),
    };
  };
}
