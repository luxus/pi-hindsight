import { existsSync, readFileSync } from "node:fs";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";

export function parseJsonWithComments(text: string, source = "config"): unknown {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const first = errors[0]!;
    throw new Error(
      `Invalid JSONC in ${source} at offset ${first.offset}: ${printParseErrorCode(first.error)}`,
    );
  }
  return value as unknown;
}

export function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return parseJsonWithComments(readFileSync(path, "utf8"), path);
}

export function readConfigFile(basePath: string): unknown {
  const json = readJson(`${basePath}.json`);
  return json === undefined ? readJson(`${basePath}.jsonc`) : json;
}
