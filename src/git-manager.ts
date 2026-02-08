import { execFile } from "node:child_process";
import { watch, FSWatcher } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface GitFileStatus {
  file: string;
  status: "M" | "A" | "D" | "R" | "C" | "U" | "?";
  staged: boolean;
}

export interface GitBranchInfo {
  current: string;
  branches: string[];
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
}

export class GitManager {
  private cwd: string;
  private watcher: FSWatcher | null = null;
  private onChange: () => void;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(cwd: string, onChange: () => void) {
    this.cwd = cwd;
    this.onChange = onChange;
  }

  private async git(...args: string[]): Promise<string> {
    try {
      const { stdout } = await exec("git", args, {
        cwd: this.cwd,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      });
      return stdout.trim();
    } catch (err: any) {
      if (err.stderr?.includes("not a git repository")) {
        throw new Error("NOT_GIT_REPO");
      }
      throw err;
    }
  }

  async isGitRepo(): Promise<boolean> {
    try {
      await this.git("rev-parse", "--is-inside-work-tree");
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<GitStatusResult> {
    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      return { isRepo: false, branch: "", files: [], ahead: 0, behind: 0 };
    }

    const [statusOut, branchOut] = await Promise.all([
      this.git("status", "--porcelain=v1", "-uall"),
      this.git("branch", "--show-current"),
    ]);

    // Parse ahead/behind
    let ahead = 0, behind = 0;
    try {
      const abOut = await this.git("rev-list", "--left-right", "--count", "HEAD...@{upstream}");
      const parts = abOut.split(/\s+/);
      ahead = parseInt(parts[0]) || 0;
      behind = parseInt(parts[1]) || 0;
    } catch {
      // No upstream configured
    }

    const files: GitFileStatus[] = [];
    if (statusOut) {
      for (const line of statusOut.split("\n")) {
        if (!line || line.length < 4) continue;
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        const filePath = line.slice(3);

        // Staged changes
        if (indexStatus !== " " && indexStatus !== "?") {
          files.push({
            file: filePath,
            status: indexStatus as GitFileStatus["status"],
            staged: true,
          });
        }

        // Unstaged changes
        if (workTreeStatus !== " ") {
          const status = workTreeStatus === "?" ? "?" : workTreeStatus as GitFileStatus["status"];
          // Avoid duplicate entries for the same file if already added as staged
          if (!files.some((f) => f.file === filePath && !f.staged)) {
            files.push({
              file: filePath,
              status,
              staged: false,
            });
          }
        }
      }
    }

    return { isRepo: true, branch: branchOut, files, ahead, behind };
  }

  async getBranches(): Promise<GitBranchInfo> {
    const current = await this.git("branch", "--show-current");
    const branchOut = await this.git("branch", "--format=%(refname:short)");
    const branches = branchOut
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean);
    return { current, branches };
  }

  async checkout(branchOrFile: string, isFile = false): Promise<string> {
    if (isFile) {
      await this.git("checkout", "--", branchOrFile);
      return `Restored ${branchOrFile}`;
    }
    await this.git("checkout", branchOrFile);
    return `Switched to branch '${branchOrFile}'`;
  }

  async checkoutNewBranch(name: string): Promise<string> {
    await this.git("checkout", "-b", name);
    return `Created and switched to branch '${name}'`;
  }

  async stageFile(filePath: string): Promise<void> {
    await this.git("add", filePath);
  }

  async unstageFile(filePath: string): Promise<void> {
    await this.git("reset", "HEAD", filePath);
  }

  async stageAll(): Promise<void> {
    await this.git("add", "-A");
  }

  async discardFile(filePath: string): Promise<void> {
    await this.git("checkout", "--", filePath);
  }

  async getDiff(filePath: string, staged: boolean): Promise<string> {
    const args = staged
      ? ["diff", "--cached", "--", filePath]
      : ["diff", "--", filePath];
    return this.git(...args);
  }

  startWatching(): void {
    this.stopWatching();
    const gitDir = path.join(this.cwd, ".git");
    try {
      // Watch .git directory for ref changes (commits, branch switches)
      this.watcher = watch(gitDir, { recursive: true }, () => {
        this.debouncedOnChange();
      });
    } catch {
      // .git dir might not exist
    }
  }

  private debouncedOnChange(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.onChange(), 300);
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  setCwd(cwd: string): void {
    this.cwd = cwd;
    this.stopWatching();
    this.startWatching();
  }

  dispose(): void {
    this.stopWatching();
  }
}
