import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import {
  routeMemoryCandidate,
  type MemoryRoute,
  type MemoryRouteSignal,
  type MemoryRouterAdapter,
} from "../extensions/memory-router.js";

interface RouterEvalFixture {
  name: string;
  content: string;
  context?: string;
  expectedRoute: MemoryRoute;
  expectedSignals: MemoryRouteSignal[];
}

const routerEvalFixtures = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/memory-router-evals.json"), "utf8"),
) as RouterEvalFixture[];

describe("memory router", () => {
  it.each(routerEvalFixtures)(
    "classifies eval fixture: $name",
    ({ content, context, expectedRoute, expectedSignals }) => {
      const decision = routeMemoryCandidate({
        content,
        ...(context ? { context } : {}),
        config: DEFAULT_CONFIG,
      });

      expect(decision.route).toBe(expectedRoute);
      expect(decision.signals).toEqual(expect.arrayContaining(expectedSignals));
      expect(decision.writes).toEqual([]);
    },
  );

  it("defaults to explicit-only dry-run with no writes", () => {
    const decision = routeMemoryCandidate({
      content: "Kai prefers terse replies across projects",
      config: DEFAULT_CONFIG,
    });

    expect(decision).toMatchObject({
      route: "global",
      mode: "explicit-only",
      writes: [],
      signals: ["global"],
    });
    expect(decision.reason).toContain("dry-run only");
    expect(decision.matchedSignals).toEqual(
      expect.arrayContaining(["preference", "cross-project workflow/style"]),
    );
  });

  it("can describe router writes when router mode is enabled", () => {
    const decision = routeMemoryCandidate({
      content: "Kai prefers terse replies for this repo config workflow",
      config: { ...DEFAULT_CONFIG, globalRetain: { mode: "router" } },
    });

    expect(decision.route).toBe("both");
    expect(decision.writes).toEqual(["project", "global"]);
  });

  it("uses mission terms as routing signals", () => {
    const decision = routeMemoryCandidate({
      content: "The importer checkpoint should preserve manifests safely.",
      config: {
        ...DEFAULT_CONFIG,
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: {
            ...DEFAULT_CONFIG.banks.project,
            retainMission: "Importer checkpoint manifest architecture",
          },
        },
      },
    });

    expect(decision.route).toBe("project");
    expect(decision.matchedSignals).toEqual(
      expect.arrayContaining(["project mission:importer/checkpoint/manifest"]),
    );
  });

  it("passes mission context through the router adapter seam", () => {
    const calls: unknown[] = [];
    const adapter: MemoryRouterAdapter = {
      classify(args) {
        calls.push(args);
        return {
          route: "global",
          confidence: 0.9,
          signals: ["global"],
          matchedSignals: ["mission"],
        };
      },
    };

    const decision = routeMemoryCandidate(
      {
        content: "remember this",
        config: {
          ...DEFAULT_CONFIG,
          banks: {
            ...DEFAULT_CONFIG.banks,
            project: { ...DEFAULT_CONFIG.banks.project, retainMission: "Project retain mission" },
            global: { ...DEFAULT_CONFIG.banks.global, retainMission: "Global retain mission" },
          },
        },
      },
      adapter,
    );

    expect(calls[0]).toMatchObject({
      projectMission: "Project retain mission",
      globalMission: "Global retain mission",
    });
    expect(decision.projectMission).toBe("Project retain mission");
    expect(decision.globalMission).toBe("Global retain mission");
  });
});
