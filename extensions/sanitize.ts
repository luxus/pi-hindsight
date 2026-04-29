const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]"],
  [/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[REDACTED_API_KEY]"],
  [/\b(ghp_[A-Za-z0-9_]{12,})\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [
    /\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\s\n"',}]+/gi,
    "$1[REDACTED]",
  ],
  [
    /\b((?:api[_-]?key|token|secret|password|authorization)\s*:\s*)["']?[^\s\n"',}]+["']?/gi,
    "$1[REDACTED]",
  ],
  [
    /(["'](?:api[_-]?key|token|secret|password|authorization)["']\s*:\s*)["'][^"']+["']/gi,
    '$1"[REDACTED]"',
  ],
  [/\b((?:Cookie|Set-Cookie)\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]"],
  [/(https?:\/\/)([^\s/@]+):([^\s/@]+)@/gi, "$1[REDACTED]@"],
];

const SENSITIVE_QUERY_PARAM = /(?:token|key|secret|password|api[_-]?key|apikey)/i;

function redactUrlQuerySecrets(input: string): string {
  return input.replace(/https?:\/\/[^\s"'<>]+/gi, (url) =>
    url.replace(/([?&])([^=&#\s]+)=([^&#\s]+)/g, (match, separator, key) => {
      if (!SENSITIVE_QUERY_PARAM.test(String(key))) return String(match);
      return `${String(separator)}${String(key)}=[REDACTED]`;
    }),
  );
}

export function redactSecrets(input: string): string {
  const text = SECRET_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    input,
  );
  return redactUrlQuerySecrets(text);
}

export function redactError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}
