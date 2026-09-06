import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

function loadWorkflow(path) {
  return {
    source: readFileSync(path, "utf8"),
    workflow: parse(readFileSync(path, "utf8")),
  };
}

function commandForStep(workflow, jobName, stepName) {
  return workflow.jobs[jobName].steps.find((step) => step.name === stepName)
    ?.run;
}

describe("Diamond scorebook CI contract", () => {
  it("exposes one local gate that checks generated drift and every focused layer", () => {
    expect(packageJson.scripts["test:diamond:ci"]).toBe(
      "npm run check:diamond-engine && npm run test:diamond:root && npm run test:diamond:functions && npm run test:diamond:app",
    );
    expect(packageJson.scripts["check:diamond-engine"]).toContain(
      "git diff --exit-code -- functions/diamond-engine",
    );
    expect(packageJson.scripts["check:diamond-engine"]).toContain(
      "git ls-files --others --exclude-standard -- functions/diamond-engine",
    );
    expect(packageJson.scripts["test:diamond:root"]).toContain(
      "tests/unit/diamond-*.test.js",
    );
    expect(packageJson.scripts["test:diamond:root"]).toContain(
      "tests/unit/live-scorekeeping-baseball.test.js",
    );
    expect(packageJson.scripts["test:diamond:functions"]).toContain(
      "functions/test/diamond-*.test.cjs",
    );
    expect(packageJson.scripts["test:diamond:app"]).toContain(
      "src/lib/diamondScorebook/diamondGoldenGames.test.ts",
    );
    expect(packageJson.scripts["test:diamond:app"]).toContain(
      "src/lib/diamondStatExport.test.ts",
    );
    expect(packageJson.scripts["test:diamond:app"]).toContain(
      "src/lib/teamCreationService.test.ts",
    );
    expect(packageJson.scripts["test:diamond:app"]).toContain(
      "src/pages/DiamondScorebook.test.tsx",
    );
  });

  it("requires the gate in PR validation without renaming stable contexts or triggers", () => {
    const { workflow } = loadWorkflow(".github/workflows/pr-fast.yml");
    expect(workflow.on.pull_request.types).toEqual([
      "opened",
      "synchronize",
      "reopened",
      "ready_for_review",
    ]);
    expect(Object.keys(workflow.jobs)).toEqual([
      "change-impact",
      "cache-bust-guard",
      "unit-tests",
      "app-quality",
    ]);
    expect(
      commandForStep(
        workflow,
        "unit-tests",
        "Run Diamond scorebook acceptance gate",
      ),
    ).toBe("npm run test:diamond:ci");

    const integration = loadWorkflow(
      ".github/workflows/pr-integration.yml",
    ).workflow;
    expect(integration.on.pull_request.types).toEqual([
      "opened",
      "synchronize",
      "reopened",
      "ready_for_review",
    ]);
    expect(integration.jobs["mobile-build"].name).toBe("mobile-build");
    expect(integration.jobs["preview-smoke"].name).toBe("preview-smoke");
  });

  it("reruns the same gate when production cannot reuse exact-head PR evidence", () => {
    const manual = loadWorkflow(".github/workflows/ci.yml").workflow;
    expect(Object.keys(manual.on)).toEqual(["workflow_dispatch"]);
    expect(
      commandForStep(
        manual,
        "unit-tests",
        "Run Diamond scorebook acceptance gate",
      ),
    ).toBe("npm run test:diamond:ci");

    const production = loadWorkflow(
      ".github/workflows/deploy-prod.yml",
    ).workflow;
    expect(production.on.push.branches).toEqual(["master"]);
    expect(production.on).toHaveProperty("workflow_dispatch");
    expect(
      commandForStep(
        production,
        "unit-tests",
        "Run Diamond scorebook acceptance gate",
      ),
    ).toBe("npm run test:diamond:ci");
    expect(production.jobs["unit-tests"].if).toContain(
      "reuse_pr_validation != 'true'",
    );
  });
});
