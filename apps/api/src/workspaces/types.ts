export type WorkspaceRole = "owner" | "admin" | "designer" | "viewer";
export type WorkspaceAction =
  | "read"
  | "edit"
  | "manageAssets"
  | "deleteAssets"
  | "purchase"
  | "share"
  | "manageSettings";
export type WorkspaceContext = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
};
