import React from "react";
import { createRoot } from "react-dom/client";
import { CommerceConsole } from "./commerce/CommerceConsole";
import { api, setSession, type DTO } from "../../web/src/cloud/api";
import "../../web/src/commerce/commerce.css";
void api<DTO<"WebSession">>("/auth/session")
  .then(setSession)
  .catch(() => {});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CommerceConsole />
  </React.StrictMode>,
);
