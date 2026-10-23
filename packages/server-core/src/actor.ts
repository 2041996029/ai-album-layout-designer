export type Actor = {
  userId: string;
  sessionId: string;
  client: "web" | "mini";
  platformPermissions: string[];
};
