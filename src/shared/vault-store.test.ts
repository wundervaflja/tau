import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
  extractWikilinks,
  slugify,
  noteTypeToSubdir,
} from "../vault-store";

describe("parseFrontmatter", () => {
  it("parses valid YAML frontmatter", () => {
    const content = `---
type: memory
memoryType: fact
tags: [typescript, tooling]
created: 2026-01-15T10:00:00Z
updated: 2026-01-15T10:00:00Z
usedCount: 3
---

# Some Title

Body content here.`;

    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.type).toBe("memory");
    expect(frontmatter.memoryType).toBe("fact");
    expect(frontmatter.tags).toEqual(["typescript", "tooling"]);
    expect(frontmatter.usedCount).toBe(3);
    expect(body).toContain("# Some Title");
    expect(body).toContain("Body content here.");
  });

  it("returns defaults for content without frontmatter", () => {
    const { frontmatter, body } = parseFrontmatter("# Just a title\n\nSome content.");
    expect(frontmatter.type).toBe("concept");
    expect(frontmatter.tags).toEqual([]);
    expect(body).toContain("# Just a title");
  });

  it("handles missing fields gracefully", () => {
    const content = `---
type: pattern
---

# A Pattern`;

    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.type).toBe("pattern");
    expect(frontmatter.tags).toEqual([]);
    expect(frontmatter.memoryType).toBeUndefined();
    expect(frontmatter.usedCount).toBeUndefined();
  });

  it("handles memory-specific fields", () => {
    const content = `---
type: memory
memoryType: preference
source: manual
usedCount: 5
lastUsedAt: 2026-02-01T12:00:00Z
tags: [editor, vim]
created: 2026-01-01T00:00:00Z
updated: 2026-02-01T12:00:00Z
---

# Prefers vim`;

    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.memoryType).toBe("preference");
    expect(frontmatter.source).toBe("manual");
    expect(frontmatter.usedCount).toBe(5);
    expect(frontmatter.lastUsedAt).toBe("2026-02-01T12:00:00Z");
  });

  it("handles malformed frontmatter (no closing ---)", () => {
    const content = `---
type: concept
tags: [test]

# Title without closing frontmatter`;

    const { frontmatter, body } = parseFrontmatter(content);
    // Should fall back to defaults since frontmatter isn't properly closed
    expect(frontmatter.type).toBe("concept");
    expect(body).toContain("# Title without closing frontmatter");
  });
});

describe("serializeFrontmatter", () => {
  it("produces valid frontmatter string", () => {
    const fm = {
      type: "memory" as const,
      memoryType: "fact" as const,
      tags: ["test"],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      source: "manual" as const,
      usedCount: 2,
      lastUsedAt: "2026-01-01T00:00:00Z",
    };
    const result = serializeFrontmatter(fm, "# Title\n\nBody.");

    expect(result).toContain("---");
    expect(result).toContain("type: memory");
    expect(result).toContain("memoryType: fact");
    expect(result).toContain("tags: [test]");
    expect(result).toContain("usedCount: 2");
    expect(result).toContain("# Title");
    expect(result).toContain("Body.");
  });

  it("round-trips with parseFrontmatter", () => {
    const fm = {
      type: "concept" as const,
      tags: ["arch", "design"],
      created: "2026-02-01T00:00:00Z",
      updated: "2026-02-01T00:00:00Z",
    };
    const body = "# Microservices\n\nA pattern for distributed systems.";
    const serialized = serializeFrontmatter(fm, body);
    const { frontmatter, body: parsedBody } = parseFrontmatter(serialized);

    expect(frontmatter.type).toBe("concept");
    expect(frontmatter.tags).toEqual(["arch", "design"]);
    expect(parsedBody).toContain("# Microservices");
    expect(parsedBody).toContain("A pattern for distributed systems.");
  });

  it("omits optional fields when undefined", () => {
    const fm = {
      type: "concept" as const,
      tags: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
    };
    const result = serializeFrontmatter(fm, "# Note");

    expect(result).not.toContain("memoryType:");
    expect(result).not.toContain("source:");
    expect(result).not.toContain("usedCount:");
    expect(result).not.toContain("lastUsedAt:");
    expect(result).not.toContain("aliases:");
  });
});

describe("extractWikilinks", () => {
  it("returns empty array for no links", () => {
    expect(extractWikilinks("Just some text")).toEqual([]);
  });

  it("extracts a single wikilink", () => {
    expect(extractWikilinks("See [[some-note]] for details")).toEqual(["some-note"]);
  });

  it("extracts multiple wikilinks", () => {
    const content = "Link to [[note-a]] and [[note-b]] and [[note-c]]";
    expect(extractWikilinks(content)).toEqual(["note-a", "note-b", "note-c"]);
  });

  it("handles display text syntax [[slug|display]]", () => {
    expect(extractWikilinks("See [[my-note|My Note]] here")).toEqual(["my-note"]);
  });

  it("handles mixed links", () => {
    const content = "[[simple]] and [[complex|Display Text]] together";
    expect(extractWikilinks(content)).toEqual(["simple", "complex"]);
  });
});

describe("slugify", () => {
  it("converts spaces to hyphens", () => {
    expect(slugify("hello world")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("hello! world?")).toBe("hello-world");
  });

  it("lowercases text", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("hello---world")).toBe("hello-world");
  });

  it("truncates to 80 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });

  it("removes leading/trailing hyphens", () => {
    expect(slugify("-hello-")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});

describe("noteTypeToSubdir", () => {
  it("maps memory to memories", () => {
    expect(noteTypeToSubdir("memory")).toBe("memories");
  });

  it("maps concept to concepts", () => {
    expect(noteTypeToSubdir("concept")).toBe("concepts");
  });

  it("maps pattern to patterns", () => {
    expect(noteTypeToSubdir("pattern")).toBe("patterns");
  });

  it("maps project to projects", () => {
    expect(noteTypeToSubdir("project")).toBe("projects");
  });

  it("maps reference to references", () => {
    expect(noteTypeToSubdir("reference")).toBe("references");
  });

  it("maps log to logs", () => {
    expect(noteTypeToSubdir("log")).toBe("logs");
  });

  it("maps moc to mocs", () => {
    expect(noteTypeToSubdir("moc")).toBe("mocs");
  });
});
