import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveDoctorHealthContributions,
  shouldSkipLegacyUpdateDoctorConfigWrite,
} from "./doctor-health-contributions.js";

const mocks = vi.hoisted(() => ({
  maybeRunConfiguredPluginInstallReleaseStep: vi.fn(),
  note: vi.fn(),
  discoverConfigSecretTargets: vi.fn(),
  getPath: vi.fn(),
}));

vi.mock("../commands/doctor/shared/release-configured-plugin-installs.js", () => ({
  maybeRunConfiguredPluginInstallReleaseStep: mocks.maybeRunConfiguredPluginInstallReleaseStep,
}));

vi.mock("../terminal/note.js", () => ({
  note: mocks.note,
}));

vi.mock("../version.js", () => ({
  VERSION: "2026.5.2-test",
}));

vi.mock("../secrets/target-registry.js", () => ({
  discoverConfigSecretTargets: mocks.discoverConfigSecretTargets,
}));

vi.mock("../secrets/path-utils.js", () => ({
  getPath: mocks.getPath,
}));

function requireDoctorContribution(id: string) {
  const contribution = resolveDoctorHealthContributions().find((entry) => entry.id === id);
  if (!contribution) {
    throw new Error(`expected doctor contribution ${id}`);
  }
  return contribution;
}

describe("doctor health contributions", () => {
  beforeEach(() => {
    mocks.maybeRunConfiguredPluginInstallReleaseStep.mockReset();
    mocks.note.mockReset();
    mocks.discoverConfigSecretTargets.mockReset();
    mocks.discoverConfigSecretTargets.mockReturnValue([]);
    mocks.getPath.mockReset();
    mocks.getPath.mockReturnValue(undefined);
  });

  it("runs release configured plugin install repair before plugin registry and final config writes", () => {
    const ids = resolveDoctorHealthContributions().map((entry) => entry.id);

    expect(ids.indexOf("doctor:release-configured-plugin-installs")).toBeGreaterThan(-1);
    expect(ids.indexOf("doctor:plugin-registry")).toBeGreaterThan(-1);
    expect(ids.indexOf("doctor:release-configured-plugin-installs")).toBeLessThan(
      ids.indexOf("doctor:plugin-registry"),
    );
    expect(ids.indexOf("doctor:plugin-registry")).toBeLessThan(ids.indexOf("doctor:write-config"));
  });

  it("keeps release configured plugin installs repair-only", async () => {
    const contribution = requireDoctorContribution("doctor:release-configured-plugin-installs");
    const ctx = {
      cfg: {},
      configResult: { cfg: {}, sourceLastTouchedVersion: "2026.4.29" },
      sourceConfigValid: true,
      prompter: { shouldRepair: false },
      env: {},
    } as Parameters<(typeof contribution)["run"]>[0];

    await contribution.run(ctx);

    expect(mocks.maybeRunConfiguredPluginInstallReleaseStep).not.toHaveBeenCalled();
    expect(mocks.note).not.toHaveBeenCalled();
  });

  it("stamps release configured plugin installs after repair changes", async () => {
    mocks.maybeRunConfiguredPluginInstallReleaseStep.mockResolvedValue({
      changes: ["Installed configured plugin matrix."],
      warnings: [],
      touchedConfig: true,
    });
    const contribution = requireDoctorContribution("doctor:release-configured-plugin-installs");
    const ctx = {
      cfg: {},
      configResult: { cfg: {}, sourceLastTouchedVersion: "2026.4.29" },
      sourceConfigValid: true,
      prompter: { shouldRepair: true },
      env: {},
    } as Parameters<(typeof contribution)["run"]>[0];

    await contribution.run(ctx);

    expect(mocks.maybeRunConfiguredPluginInstallReleaseStep).toHaveBeenCalledWith({
      cfg: {},
      env: {},
      touchedVersion: "2026.4.29",
    });
    expect(mocks.note).toHaveBeenCalledWith(
      "Installed configured plugin matrix.",
      "Doctor changes",
    );
    expect(ctx.cfg.meta?.lastTouchedVersion).toBe("2026.5.2-test");
  });

  it("checks command owner configuration before final config writes", () => {
    const ids = resolveDoctorHealthContributions().map((entry) => entry.id);

    expect(ids.indexOf("doctor:command-owner")).toBeGreaterThan(-1);
    expect(ids.indexOf("doctor:command-owner")).toBeLessThan(ids.indexOf("doctor:write-config"));
  });

  it("checks skill readiness before final config writes", () => {
    const ids = resolveDoctorHealthContributions().map((entry) => entry.id);

    expect(ids.indexOf("doctor:skills")).toBeGreaterThan(-1);
    expect(ids.indexOf("doctor:skills")).toBeLessThan(ids.indexOf("doctor:write-config"));
  });

  it("skips doctor config writes under legacy update parents", () => {
    expect(
      shouldSkipLegacyUpdateDoctorConfigWrite({
        env: { OPENCLAW_UPDATE_IN_PROGRESS: "1" },
      }),
    ).toBe(true);
  });

  it("keeps doctor writes outside legacy update writable", () => {
    expect(
      shouldSkipLegacyUpdateDoctorConfigWrite({
        env: {},
      }),
    ).toBe(false);
  });

  it("keeps current update parents writable", () => {
    expect(
      shouldSkipLegacyUpdateDoctorConfigWrite({
        env: {
          OPENCLAW_UPDATE_IN_PROGRESS: "1",
          OPENCLAW_UPDATE_PARENT_SUPPORTS_DOCTOR_CONFIG_WRITE: "1",
        },
      }),
    ).toBe(false);
  });

  it("treats falsey update env values as normal writes", () => {
    expect(
      shouldSkipLegacyUpdateDoctorConfigWrite({
        env: {
          OPENCLAW_UPDATE_IN_PROGRESS: "0",
        },
      }),
    ).toBe(false);
  });

  it("registers secret-resolve preflight before final config writes", () => {
    const ids = resolveDoctorHealthContributions().map((entry) => entry.id);

    expect(ids.indexOf("doctor:secret-resolve-preflight")).toBeGreaterThan(-1);
    expect(ids.indexOf("doctor:secret-resolve-preflight")).toBeLessThan(
      ids.indexOf("doctor:write-config"),
    );
  });

  it("emits no secret-resolve preflight note when the registry yields no targets", async () => {
    mocks.discoverConfigSecretTargets.mockReturnValue([]);
    const contribution = requireDoctorContribution("doctor:secret-resolve-preflight");
    const ctx = { cfg: {} } as Parameters<(typeof contribution)["run"]>[0];

    await contribution.run(ctx);

    expect(mocks.note).not.toHaveBeenCalled();
  });

  it("emits no secret-resolve preflight note when sibling_ref value paths are populated", async () => {
    mocks.discoverConfigSecretTargets.mockReturnValue([
      {
        entry: { secretShape: "sibling_ref" },
        path: "profiles.p1.key",
        pathSegments: ["profiles", "p1", "key"],
      },
    ]);
    mocks.getPath.mockReturnValue("resolved-value");
    const contribution = requireDoctorContribution("doctor:secret-resolve-preflight");
    const ctx = { cfg: {} } as Parameters<(typeof contribution)["run"]>[0];

    await contribution.run(ctx);

    expect(mocks.note).not.toHaveBeenCalled();
  });

  it("emits no note when secret_input value paths are absent (apply will not crash)", async () => {
    mocks.discoverConfigSecretTargets.mockReturnValue([
      {
        entry: { secretShape: "secret_input" },
        path: "agents.defaults.memorySearch.remote.apiKey",
        pathSegments: ["agents", "defaults", "memorySearch", "remote", "apiKey"],
      },
    ]);
    mocks.getPath.mockReturnValue(undefined);
    const contribution = requireDoctorContribution("doctor:secret-resolve-preflight");
    const ctx = { cfg: {} } as Parameters<(typeof contribution)["run"]>[0];

    await contribution.run(ctx);

    expect(mocks.note).not.toHaveBeenCalled();
  });

  it("warns when a sibling_ref target's value path is absent", async () => {
    mocks.discoverConfigSecretTargets.mockReturnValue([
      {
        entry: { secretShape: "sibling_ref" },
        path: "profiles.p1.key",
        pathSegments: ["profiles", "p1", "key"],
      },
    ]);
    mocks.getPath.mockReturnValue(undefined);
    const contribution = requireDoctorContribution("doctor:secret-resolve-preflight");
    const ctx = { cfg: {} } as Parameters<(typeof contribution)["run"]>[0];

    await contribution.run(ctx);

    expect(mocks.note).toHaveBeenCalledTimes(1);
    const [body, label] = mocks.note.mock.calls[0]!;
    expect(label).toBe("Secret resolve preflight");
    expect(body).toContain("profiles.p1.key");
    expect(body).toContain("PR #78555");
  });

  it("warns when a secretShape is unknown to this CLI build", async () => {
    mocks.discoverConfigSecretTargets.mockReturnValue([
      {
        entry: { secretShape: "future_shape" },
        path: "future.target.path",
        pathSegments: ["future", "target", "path"],
      },
    ]);
    const contribution = requireDoctorContribution("doctor:secret-resolve-preflight");
    const ctx = { cfg: {} } as Parameters<(typeof contribution)["run"]>[0];

    await contribution.run(ctx);

    expect(mocks.note).toHaveBeenCalledTimes(1);
    const [body, label] = mocks.note.mock.calls[0]!;
    expect(label).toBe("Secret resolve preflight");
    expect(body).toContain("future.target.path");
    expect(body).toContain("future_shape");
  });
});
