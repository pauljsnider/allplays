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

  it("wires one default-dark Diamond UI variable through every web and Capacitor artifact", () => {
    const webWorkflowPaths = [
      ".github/workflows/deploy-prod.yml",
      ".github/workflows/app-github-pages.yml",
      ".github/workflows/deploy-candidate-host.yml",
      ".github/workflows/deploy-preview.yml",
      ".github/workflows/preview-smoke.yml",
      ".github/workflows/update-visual-baselines.yml",
    ];
    for (const path of webWorkflowPaths) {
      const { source } = loadWorkflow(path);
      expect(source, path).toContain(
        "VITE_DIAMOND_SCOREBOOK_UI_ENABLED: ${{ vars.DIAMOND_SCOREBOOK_UI_ENABLED }}",
      );
      expect(source, path).toContain(
        "ALLPLAYS_DIAMOND_SCOREBOOK_UI_ENABLED: ${{ vars.DIAMOND_SCOREBOOK_UI_ENABLED }}",
      );
    }

    const production = loadWorkflow(".github/workflows/deploy-prod.yml").source;
    expect(production).toContain(
      "EXPECTED_DIAMOND_SCOREBOOK_UI_ENABLED: ${{ vars.DIAMOND_SCOREBOOK_UI_ENABLED }}",
    );
    expect(production).toContain(
      'if [ "$EXPECTED_DIAMOND_SCOREBOOK_UI_ENABLED" = "true" ]; then',
    );
    expect(production).toContain(".diamondScorebookUiEnabled == $expected");

    const previewSmoke = loadWorkflow(
      ".github/workflows/preview-smoke.yml",
    ).workflow;
    expect(
      previewSmoke.jobs["preview-smoke-run"].steps.find(
        (step) => step.name === "Start React app dev server",
      ).env.VITE_DIAMOND_SCOREBOOK_UI_ENABLED,
    ).toBe("${{ vars.DIAMOND_SCOREBOOK_UI_ENABLED }}");

    const visualBaselines = loadWorkflow(
      ".github/workflows/update-visual-baselines.yml",
    ).workflow;
    expect(
      visualBaselines.jobs.generate.steps.find(
        (step) => step.name === "Start visual fixture servers",
      ).env.VITE_DIAMOND_SCOREBOOK_UI_ENABLED,
    ).toBe("${{ vars.DIAMOND_SCOREBOOK_UI_ENABLED }}");

    for (const path of [
      ".github/workflows/mobile-build.yml",
      ".github/workflows/mobile-release.yml",
    ]) {
      const { source } = loadWorkflow(path);
      expect(source, path).toContain(
        "VITE_DIAMOND_SCOREBOOK_UI_ENABLED: ${{ vars.DIAMOND_SCOREBOOK_UI_ENABLED }}",
      );
    }

    const mobileBuild = loadWorkflow(".github/workflows/mobile-build.yml").workflow;
    for (const jobName of ["android-debug", "ios-simulator"]) {
      const buildStep = mobileBuild.jobs[jobName].steps.find(
        (step) => step.name === "Build React app",
      );
      expect(buildStep.env.VITE_DIAMOND_SCOREBOOK_UI_ENABLED).toBe(
        "${{ vars.DIAMOND_SCOREBOOK_UI_ENABLED }}",
      );
    }

    const mobileRelease = loadWorkflow(".github/workflows/mobile-release.yml").workflow;
    expect(
      mobileRelease.jobs["android-release"].steps.find(
        (step) => step.name === "Build signed Android release artifacts",
      ).env.VITE_DIAMOND_SCOREBOOK_UI_ENABLED,
    ).toBe("${{ vars.DIAMOND_SCOREBOOK_UI_ENABLED }}");
    expect(
      mobileRelease.jobs["ios-release"].steps.find(
        (step) => step.name === "Build web assets and sync iOS",
      ).env.VITE_DIAMOND_SCOREBOOK_UI_ENABLED,
    ).toBe("${{ vars.DIAMOND_SCOREBOOK_UI_ENABLED }}");
  });
});
