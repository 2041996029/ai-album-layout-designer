import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { LoginPanel } from "../../../apps/web/src/auth/LoginPanel";
function Harness() {
  const [done, setDone] = useState(false);
  return done ? (
    <h1>已登录</h1>
  ) : (
    <LoginPanel
      capabilities={{
        configReleaseId: null,
        serverTime: new Date().toISOString(),
        capabilities: [
          {
            key: "emailLogin",
            status: "available",
            action: "none",
            platforms: ["web"],
          },
        ],
      }}
      onLogin={() => setDone(true)}
    />
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
