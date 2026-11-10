const inviteTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function invitationUrl(origin: string, token: string): string {
  if (!inviteTokenPattern.test(token)) throw new Error("Invalid invite token");
  const url = new URL("/overview", origin);
  url.hash = new URLSearchParams({ invite: token }).toString();
  return url.toString();
}

export function invitationToken(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("invite");
  return token && inviteTokenPattern.test(token) ? token : null;
}
