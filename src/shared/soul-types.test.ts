import { describe, it, expect } from "vitest";
import { needsBootstrap, parseSoulSections } from "./soul-types";

describe("needsBootstrap", () => {
  it("returns true for empty content", () => {
    expect(needsBootstrap("")).toBe(true);
  });

  it("returns true for whitespace-only content", () => {
    expect(needsBootstrap("   \n  \n  ")).toBe(true);
  });

  it("returns true for template with placeholders", () => {
    const template = `# SOUL\n\n## Who I Am\n[To be discovered]\n\n## Voice\n[To be discovered]\n`;
    expect(needsBootstrap(template)).toBe(true);
  });

  it("returns false when one section has real content", () => {
    const content = `# SOUL\n\n## Who I Am\n\n## Voice\nFriendly and direct\n`;
    expect(needsBootstrap(content)).toBe(false);
  });

  it("returns false when at least one section has content", () => {
    const content = `# SOUL\n\n## Who I Am\nA software developer\n\n## Voice\n\n`;
    expect(needsBootstrap(content)).toBe(false);
  });

  it("returns true when sections start with TODO", () => {
    const content = `# SOUL\n\n## Who I Am\nTODO: fill in\n\n## Voice\nTODO: fill in\n`;
    expect(needsBootstrap(content)).toBe(true);
  });

  it("returns true when sections start with ...", () => {
    const content = `# SOUL\n\n## Who I Am\n...\n\n## Voice\n...\n`;
    expect(needsBootstrap(content)).toBe(true);
  });

  it("returns false for filled content", () => {
    const content = `# SOUL\n\n## Who I Am\nA software developer who loves TypeScript\n\n## Voice\nFriendly, direct, concise\n`;
    expect(needsBootstrap(content)).toBe(false);
  });

  it("returns false for filled content with additional sections", () => {
    const content = `# SOUL\n\n## Who I Am\nA developer\n\n## Voice\nDirect\n\n## Values\nSimplicity\n`;
    expect(needsBootstrap(content)).toBe(false);
  });

  it("returns false when using custom section names with real content", () => {
    const content = `# SOUL\n\n## Identity\nTau, Igor's assistant\n\n## Core Truths\nBe helpful\n\n## Voice & Style\nCasual\n`;
    expect(needsBootstrap(content)).toBe(false);
  });
});

describe("parseSoulSections", () => {
  it("returns empty array for empty content", () => {
    expect(parseSoulSections("")).toEqual([]);
  });

  it("parses multiple sections", () => {
    const content = `# SOUL\n\n## Who I Am\nA developer\n\n## Voice\nFriendly and direct\n\n## Values\nSimplicity and clarity\n`;
    const sections = parseSoulSections(content);
    expect(sections).toHaveLength(3);
    expect(sections[0].name).toBe("Who I Am");
    expect(sections[0].content).toContain("A developer");
    expect(sections[1].name).toBe("Voice");
    expect(sections[1].content).toContain("Friendly and direct");
    expect(sections[2].name).toBe("Values");
    expect(sections[2].content).toContain("Simplicity and clarity");
  });

  it("handles single section", () => {
    const content = `## Who I Am\nJust me\n`;
    const sections = parseSoulSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("Who I Am");
  });

  it("handles sections with multiline content", () => {
    const content = `## Who I Am\nLine 1\nLine 2\nLine 3\n\n## Voice\nDirect\n`;
    const sections = parseSoulSections(content);
    expect(sections).toHaveLength(2);
    expect(sections[0].content).toContain("Line 1");
    expect(sections[0].content).toContain("Line 3");
  });
});
