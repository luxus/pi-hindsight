import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonlQueueFileSummary {
  path: string;
  valid: number;
  malformed: number;
  error: string | null;
}

export interface ParsedJsonlQueue<T> {
  jobs: T[];
  malformedLines: string[];
}

export class JsonlQueueStore<T> {
  constructor(
    readonly path: string,
    private readonly isItem: (value: unknown) => value is T,
  ) {}

  async count(): Promise<number> {
    try {
      return (await readFile(this.path, "utf8")).split("\n").filter(Boolean).length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }

  async append(items: T[]): Promise<void> {
    if (items.length === 0) return;
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(
      this.path,
      items.map((item) => JSON.stringify(item)).join("\n") + "\n",
      "utf8",
    );
  }

  async readStrict(): Promise<T[]> {
    const parsed = await this.readTolerant();
    if (parsed.malformedLines.length > 0) {
      throw new Error(
        `Malformed queue file ${this.path}: ${parsed.malformedLines.length} invalid line(s)`,
      );
    }
    return parsed.jobs;
  }

  async readTolerant(): Promise<ParsedJsonlQueue<T>> {
    try {
      const text = await readFile(this.path, "utf8");
      const jobs: T[] = [];
      const malformedLines: string[] = [];
      for (const line of text.split("\n").filter(Boolean)) {
        try {
          const parsed = JSON.parse(line) as unknown;
          if (this.isItem(parsed)) jobs.push(parsed);
          else malformedLines.push(line);
        } catch {
          malformedLines.push(line);
        }
      }
      return { jobs, malformedLines };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { jobs: [], malformedLines: [] };
      }
      throw error;
    }
  }

  async summarize(): Promise<JsonlQueueFileSummary> {
    try {
      const text = await readFile(this.path, "utf8");
      let valid = 0;
      let malformed = 0;
      for (const line of text.split("\n").filter(Boolean)) {
        try {
          const parsed = JSON.parse(line) as unknown;
          if (this.isItem(parsed)) valid += 1;
          else malformed += 1;
        } catch {
          malformed += 1;
        }
      }
      return { path: this.path, valid, malformed, error: null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { path: this.path, valid: 0, malformed: 0, error: null };
      }
      return {
        path: this.path,
        valid: 0,
        malformed: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async replace(items: T[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(
      tmp,
      items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : ""),
      "utf8",
    );
    await rename(tmp, this.path);
  }
}
