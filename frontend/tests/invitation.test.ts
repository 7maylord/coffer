import assert from "node:assert/strict";
import test from "node:test";
import { invitationToken, invitationUrl } from "../src/lib/invitation.ts";

test("keeps invitation secrets in the URL fragment", () => {
  const token = "A".repeat(43);
  const url = invitationUrl("https://coffer.example", token);

  assert.equal(url, `https://coffer.example/overview#invite=${token}`);
  assert.equal(invitationToken(new URL(url).hash), token);
});

test("rejects malformed invitation tokens", () => {
  assert.equal(invitationToken("#invite=short"), null);
  assert.throws(() => invitationUrl("https://coffer.example", "short"));
});
