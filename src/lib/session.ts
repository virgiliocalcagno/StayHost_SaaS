
/**
 * Resolves the active tenant email with multiple fallbacks.
 * Important for synchronization processes when the current user (e.g., Staff)
 * doesn't have an email in their session.
 */
export function getActiveTenantEmail(): string | null {
  if (typeof window === "undefined") return null;

  try {
    // 1. Current Session
    const sessionStr = localStorage.getItem("stayhost_session");
    if (sessionStr) {
      const session = JSON.parse(sessionStr);
      if (session.email) return session.email;
    }

    // 2. Explicitly saved owner email
    const ownerEmail = localStorage.getItem("stayhost_owner_email");
    if (ownerEmail) return ownerEmail;

    // 3. Search in Team List for an OWNER
    const teamStr = localStorage.getItem("stayhost_team");
    if (teamStr) {
      const team = JSON.parse(teamStr);
      if (Array.isArray(team)) {
        const owner = team.find((m: any) => 
          m.role?.toLowerCase() === "owner" || 
          m.email === "virgiliocalcagno@gmail.com"
        );
        if (owner?.email) return owner.email;
      }
    }

    // 4. Ultimate Hardcoded Fallback for this SaaS instance
    return "virgiliocalcagno@gmail.com";
  } catch (err) {
    console.error("[getActiveTenantEmail] Error resolving identity:", err);
    return "virgiliocalcagno@gmail.com";
  }
}
