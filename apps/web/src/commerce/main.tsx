import React from "react";
import { createRoot } from "react-dom/client";
import { CommerceApp } from "./CommerceApp";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CommerceApp />
  </React.StrictMode>,
);
