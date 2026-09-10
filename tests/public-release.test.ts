import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

const PUBLIC_TEXT_FILES = [
  "README.md",
  "CHANGELOG.md",
  "HANDOVER.md",
  "LICENSE",
  "package.json",
  "package-lock.json",
  "docs/design.md",
  "docs/installation-guide.md",
];

describe("public release packaging", () => {
  it("declares an MIT license with the required copyright line", () => {
    const license = read("LICENSE");
    expect(license).toMatch(/MIT License/);
    expect(license).toContain("Copyright (c) 2026 stones-hub contributors");
  });

  it("package.json exposes the pi-package keyword and an explicit pi.skills manifest", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.keywords).toContain("pi-package");
    expect(pkg.pi).toBeDefined();
    expect(pkg.pi.skills).toContain("skill/project-development-orchestrator");
    expect(pkg.private).toBe(true);
  });

  it("declares a Node engines range that is a real semver subset of vitest 5's own engines requirement", () => {
    const pkg = JSON.parse(read("package.json"));
    // Mirrors the pinned Pi 0.85.1 floor documented in docs/installation-guide.md.
    // Pi is an external CLI, not a devDependency, so this constant must be updated
    // by hand if the pinned Pi version's own `engines.node` floor ever changes.
    const PI_MIN_NODE: [number, number, number] = [22, 19, 0];

    type Range = { min: [number, number, number]; max: [number, number, number] | null };

    const parseVersion = (v: string): [number, number, number] => {
      const match = v.match(/(\d+)\.(\d+)\.(\d+)/);
      if (!match) throw new Error(`Not a version: "${v}"`);
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    };
    const cmp = (a: [number, number, number], b: [number, number, number]): number =>
      a[0] !== b[0] ? a[0] - b[0] : a[1] !== b[1] ? a[1] - b[1] : a[2] - b[2];
    const parseAlternative = (token: string): Range => {
      const trimmed = token.trim();
      if (trimmed.startsWith("^")) {
        const version = parseVersion(trimmed.slice(1));
        return { min: version, max: [version[0] + 1, 0, 0] };
      }
      if (trimmed.startsWith(">=")) {
        return { min: parseVersion(trimmed.slice(2)), max: null };
      }
      throw new Error(`Unsupported range alternative (only "^x.y.z" and ">=x.y.z" are handled): "${trimmed}"`);
    };
    const parseRangeSet = (range: string): Range[] => range.split("||").map(parseAlternative);
    const isSubsetOf = (sub: Range, sup: Range): boolean => {
      const minOk = cmp(sub.min, sup.min) >= 0;
      const maxOk = sup.max === null || (sub.max !== null && cmp(sub.max, sup.max) <= 0);
      return minOk && maxOk;
    };
    const isRangeSetSubsetOf = (subSet: Range[], supSet: Range[]): boolean =>
      subSet.every((s) => supSet.some((t) => isSubsetOf(s, t)));

    expect(pkg.engines?.node).toBe("^22.19.0 || ^24.0.0 || >=26.0.0");

    const ourRanges = parseRangeSet(pkg.engines.node);
    const vitestEngines = JSON.parse(
      fs.readFileSync(path.join(ROOT, "node_modules/vitest/package.json"), "utf8"),
    ).engines.node as string;
    const vitestRanges = parseRangeSet(vitestEngines);

    expect(
      isRangeSetSubsetOf(ourRanges, vitestRanges),
      `package.json engines.node (${pkg.engines.node}) must be a semver subset of vitest's own engines (${vitestEngines}) — a plain floor comparison can wrongly accept unsupported Node majors in the gaps between vitest's alternatives`,
    ).toBe(true);
    expect(
      ourRanges.every((r) => cmp(r.min, PI_MIN_NODE) >= 0),
      `every alternative in package.json engines.node (${pkg.engines.node}) must be >= the pinned Pi floor (${PI_MIN_NODE.join(".")})`,
    ).toBe(true);
  });

  it("package-lock.json's root package metadata is in sync with package.json (no manual drift)", () => {
    const pkg = JSON.parse(read("package.json"));
    const lock = JSON.parse(read("package-lock.json"));
    const rootEntry = lock.packages?.[""];
    expect(rootEntry, "package-lock.json must have a root ('') packages entry").toBeDefined();

    expect(lock.name).toBe(pkg.name);
    expect(lock.version).toBe(pkg.version);
    expect(rootEntry.name).toBe(pkg.name);
    expect(rootEntry.version).toBe(pkg.version);
    expect(rootEntry.license).toBe(pkg.license);
    expect(rootEntry.engines).toEqual(pkg.engines);
    expect(rootEntry.devDependencies).toEqual(pkg.devDependencies);
  });

  it("the manifest-declared skill path exists and has a SKILL.md", () => {
    const pkg = JSON.parse(read("package.json"));
    for (const skillPath of pkg.pi.skills as string[]) {
      const absolute = path.join(ROOT, skillPath);
      expect(fs.existsSync(absolute)).toBe(true);
      expect(fs.existsSync(path.join(absolute, "SKILL.md"))).toBe(true);
    }
  });

  it("CHANGELOG.md describes v0.2.0 without claiming a tag/release is already published", () => {
    const changelog = read("CHANGELOG.md");
    expect(changelog).toMatch(/v0\.2\.0/);
    expect(changelog).not.toMatch(/已(经)?发布/);
  });

  it("public deliverable files contain no personal absolute paths", () => {
    for (const file of PUBLIC_TEXT_FILES) {
      const content = read(file);
      expect(content, `${file} should not contain a personal home-directory path`).not.toMatch(/\/Users\/[^/\s]+/);
    }
  });

  it("public deliverable files contain no obvious credential material", () => {
    const credentialPatterns = [/sk-[a-zA-Z0-9]{16,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
    for (const file of PUBLIC_TEXT_FILES) {
      const content = read(file);
      for (const pattern of credentialPatterns) {
        expect(content, `${file} should not contain credential-shaped text (${pattern})`).not.toMatch(pattern);
      }
    }
  });

  it("public docs do not claim the old Node.js 18 floor", () => {
    for (const file of ["README.md", "docs/installation-guide.md"]) {
      const content = read(file);
      expect(content, `${file} should not mention the stale Node.js 18 requirement`).not.toMatch(
        /Node\.js\s*18/,
      );
    }
  });

  it("upgrade instructions warn that a pinned git ref does not move on its own", () => {
    for (const file of ["README.md", "docs/installation-guide.md"]) {
      const content = read(file);
      expect(content, `${file} should explain that pi update does not advance a pinned ref`).toMatch(
        /不会自动/,
      );
    }
  });

  it("the internal task book is excluded from the tracked/public deliverable via .gitignore", () => {
    const gitignore = read(".gitignore");
    expect(gitignore).toMatch(/(^|\n)\.pi\//);
  });

  it("node_modules is not part of the public deliverable", () => {
    const gitignore = read(".gitignore");
    expect(gitignore).toMatch(/(^|\n)node_modules\//);
  });
});
