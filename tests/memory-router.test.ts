import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import {
  routeMemoryCandidate,
  type MemoryRoute,
  type MemoryRouteSignal,
  type RoutingStrategy,
} from "../extensions/memory-router.js";

interface RouterEvalFixture {
  name: string;
  content: string;
  context?: string;
  expectedRoute: MemoryRoute;
  expectedSignals: MemoryRouteSignal[];
  minConfidence: number;
  expectedSafetyNotes: string[];
}

const routerEvalFixtures = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/memory-router-evals.json"), "utf8"),
) as RouterEvalFixture[];

describe("memory router", () => {
  it("keeps eval fixtures balanced across all route outcomes", () => {
    expect(routerEvalFixtures).toHaveLength(16);
    expect(new Set(routerEvalFixtures.map((fixture) => fixture.name)).size).toBe(
      routerEvalFixtures.length,
    );
    expect(routerEvalFixtures.map((fixture) => fixture.expectedRoute).sort()).toEqual([
      "both",
      "both",
      "both",
      "both",
      "both",
      "global",
      "global",
      "global",
      "project",
      "project",
      "project",
      "project",
      "skip",
      "skip",
      "skip",
      "skip",
    ]);
  });

  it.each(routerEvalFixtures)(
    "classifies eval fixture: $name",
    ({ content, context, expectedRoute, expectedSignals, minConfidence, expectedSafetyNotes }) => {
      const decision = routeMemoryCandidate({
        content,
        ...(context ? { context } : {}),
        config: DEFAULT_CONFIG,
      });

      expect(decision.route).toBe(expectedRoute);
      expect(decision.confidence).toBeGreaterThanOrEqual(minConfidence);
      expect(decision.signals).toEqual(expect.arrayContaining(expectedSignals));
      expect(decision.matchedSignals.length).toBeGreaterThanOrEqual(expectedSignals.length);
      for (const note of expectedSafetyNotes) {
        expect(decision.safetyNotes.some((actual) => actual.includes(note))).toBe(true);
      }
      expect(decision.safetyNotes).toContain(
        "dry-run only; no automatic writes in explicit-only mode",
      );
      expect(decision.writes).toEqual([]);
      expect(decision.targets.every((target) => !target.willWrite)).toBe(true);
    },
  );

  it("defaults to explicit-only dry-run with no writes", () => {
    const decision = routeMemoryCandidate({
      content: "Kai prefers terse replies across projects",
      config: {
        ...DEFAULT_CONFIG,
        banks: {
          ...DEFAULT_CONFIG.banks,
          user: { ...DEFAULT_CONFIG.banks.user, enabled: true, bankId: "global-bank" },
        },
      },
    });

    expect(decision).toMatchObject({
      route: "global",
      mode: "explicit-only",
      writes: [],
      signals: ["global"],
    });
    expect(decision.reason).toContain("dry-run only");
    expect(decision.targets).toEqual([
      {
        bankRole: "global",
        bankId: "global-bank",
        tags: [],
        willWrite: false,
      },
    ]);
    expect(decision.safetyNotes).toEqual(
      expect.arrayContaining([
        "dry-run only; no automatic writes in explicit-only mode",
        "global memory candidate; keep only durable cross-project facts",
      ]),
    );
    expect(decision.matchedSignals).toEqual(
      expect.arrayContaining(["preference", "cross-project workflow/style"]),
    );
  });

  it.each(routerEvalFixtures)(
    "describes router-mode writes for eval fixture: $name",
    ({ content, context, expectedRoute }) => {
      const decision = routeMemoryCandidate({
        content,
        ...(context ? { context } : {}),
        config: {
          ...DEFAULT_CONFIG,
          userRetain: { mode: "router" },
          banks: {
            ...DEFAULT_CONFIG.banks,
            project: { ...DEFAULT_CONFIG.banks.project, bankId: "project-bank" },
            user: { ...DEFAULT_CONFIG.banks.user, enabled: true, bankId: "global-bank" },
          },
        },
      });

      const expectedWrites =
        expectedRoute === "both"
          ? ["project", "global"]
          : expectedRoute === "skip"
            ? []
            : [expectedRoute];
      expect(decision.writes).toEqual(expectedWrites);
      expect(
        decision.targets.filter((target) => target.willWrite).map((target) => target.bankRole),
      ).toEqual(expectedWrites);
    },
  );

  it("can describe router writes when router mode is enabled", () => {
    const decision = routeMemoryCandidate({
      content: "Kai prefers terse replies for this repo config workflow",
      config: {
        ...DEFAULT_CONFIG,
        userRetain: { mode: "router" },
        banks: {
          ...DEFAULT_CONFIG.banks,
          project: { ...DEFAULT_CONFIG.banks.project, bankId: "project-bank" },
          user: { ...DEFAULT_CONFIG.banks.user, enabled: true, bankId: "global-bank" },
        },
      },
    });

    expect(decision.route).toBe("both");
    expect(decision.writes).toEqual(["project", "global"]);
    expect(decision.targets).toEqual([
      {
        bankRole: "project",
        bankId: "project-bank",
        tags: [],
        willWrite: true,
      },
      {
        bankRole: "global",
        bankId: "global-bank",
        tags: [],
        willWrite: true,
      },
    ]);
  });

  it("adds safety notes for secret-like content", () => {
    const decision = routeMemoryCandidate({
      content: "Temporary note contained bearer token abc123 from a private URL",
      config: DEFAULT_CONFIG,
    });

    expect(decision.route).toBe("skip");
    expect(decision.safetyNotes).toEqual(
      expect.arrayContaining([
        "review/redact before retain: secret-like content",
        "skip candidate; do not retain transient or unsafe content",
      ]),
    );
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

  it("passes normalized config and mission context through the routing strategy seam", () => {
    const calls: unknown[] = [];
    const adapter: RoutingStrategy = {
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
            user: { ...DEFAULT_CONFIG.banks.user, retainMission: "Global retain mission" },
          },
        },
      },
      adapter,
    );

    expect(calls[0]).toMatchObject({
      content: "remember this",
      config: expect.objectContaining({ globalRetain: { mode: "explicit-only" } }),
      missions: { project: "Project retain mission", global: "Global retain mission" },
    });
    expect(decision.projectMission).toBe("Project retain mission");
    expect(decision.globalMission).toBe("Global retain mission");
  });
});
