"use client";

import { useEffect } from "react";
import { ModuleProvider } from "@/context/ModuleContext";

export default function ClientBody({
  children,
}: {
  children: React.ReactNode;
}) {
  // Remove any extension-added classes during hydration
  useEffect(() => {
    // This runs only on the client after hydration
    document.body.className = "antialiased";
  }, []);

  return (
    <ModuleProvider>
      <div className="antialiased">{children}</div>
    </ModuleProvider>
  );
}
