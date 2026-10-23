// Deployment supplies an allowlisted HTTPS API and workspace after account selection.
// No provider credentials or demo-success fallback belong in the mini bundle.
export const miniConfig = {
  apiBaseUrl: "",
  workspaceId: "",
  capabilities: { layout: false, tasks: false, export: false },
  algorithmVersion: "local-layout-v1",
};
