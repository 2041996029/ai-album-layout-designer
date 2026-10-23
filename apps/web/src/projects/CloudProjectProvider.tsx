import { createContext, useContext, useMemo, type ReactNode } from "react";
import { CloudRevisionStore } from "@album/storage";
import { apiBase, cloudFetch } from "../cloud/api";
const Context = createContext<CloudRevisionStore | null>(null);
export function CloudProjectProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const store = useMemo(
    () => new CloudRevisionStore(apiBase, workspaceId, cloudFetch),
    [workspaceId],
  );
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useCloudProject() {
  return useContext(Context);
}
