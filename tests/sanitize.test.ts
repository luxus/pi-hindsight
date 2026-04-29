import { describe, expect, it } from "vitest";
import { redactError, redactSecrets } from "../extensions/sanitize.js";

describe("redactSecrets", () => {
  it("redacts common credentials", () => {
    const text = [
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      "API_KEY=supersecret",
      "sk-abcdefghijklmnopqrstuvwxyz",
      "ghp_abcdefghijklmnopqrstuvwxyz",
      "password: hunter2",
      "apiKey: supersecret123456",
      '"token":"jsonsecret123456"',
      "Cookie: sid=secret123456789; other=x",
      "Set-Cookie: sid=secret123456789; Path=/",
      "https://user:pass@example.com/path",
      "https://example.com/callback?ok=1&access_token=secret123456789&api_key=othersecret123456",
    ].join("\n");

    const redacted = redactSecrets(text);

    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(redacted).not.toContain("supersecret");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("jsonsecret");
    expect(redacted).not.toContain("sid=secret");
    expect(redacted).not.toContain("user:pass");
    expect(redacted).not.toContain("access_token=secret");
    expect(redacted).not.toContain("api_key=othersecret");
    expect(redacted).toContain("[REDACTED");
  });

  it("redacts error messages", () => {
    expect(redactError(new Error("request failed: password: hunter2"))).toBe(
      "request failed: password: [REDACTED]",
    );
  });
});
