/**
 * PtyManager — manages pseudo-terminal instances for the integrated terminal.
 *
 * Uses Python's `pty` module to create real PTYs without native Node modules.
 * Each terminal gets a unique ID.
 */
import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export interface PtyInstance {
  id: string;
  process: ChildProcess;
}

// Python script that creates a real PTY and bridges stdin/stdout
const PTY_SCRIPT = `
import pty, os, sys, select, signal, struct, fcntl, termios, json

shell = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('SHELL', '/bin/zsh')
cwd = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 80
rows = int(sys.argv[4]) if len(sys.argv) > 4 else 24

pid, fd = pty.openpty()

# Set initial terminal size
winsize = struct.pack('HHHH', rows, cols, 0, 0)
fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

child = os.fork()
if child == 0:
    os.setsid()
    # Slave side
    slave_fd = os.dup(fd)
    os.close(pid)
    os.close(fd)
    os.dup2(slave_fd, 0)
    os.dup2(slave_fd, 1)
    os.dup2(slave_fd, 2)
    if slave_fd > 2:
        os.close(slave_fd)
    os.chdir(cwd)
    os.execvp(shell, [shell, '-l'])

os.close(fd)

# Handle SIGWINCH (resize) by reading from stdin
def handle_resize(signum, frame):
    pass

signal.signal(signal.SIGWINCH, handle_resize)
sys.stdout.buffer.write(b'\\x00READY\\n')
sys.stdout.buffer.flush()

try:
    while True:
        r, _, _ = select.select([pid, 0], [], [], 0.1)
        if pid in r:
            try:
                data = os.read(pid, 16384)
                if not data:
                    break
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
            except OSError:
                break
        if 0 in r:
            try:
                data = os.read(0, 16384)
                if not data:
                    break
                # Check for resize escape: \\x00RESIZE:cols:rows\\n
                if data.startswith(b'\\x00RESIZE:'):
                    try:
                        parts = data.strip().decode().split(':')
                        c, r = int(parts[1]), int(parts[2])
                        winsize = struct.pack('HHHH', r, c, 0, 0)
                        fcntl.ioctl(pid, termios.TIOCSWINSZ, winsize)
                        os.kill(child, signal.SIGWINCH)
                    except:
                        pass
                else:
                    os.write(pid, data)
            except OSError:
                break
except KeyboardInterrupt:
    pass
finally:
    try:
        os.kill(child, signal.SIGHUP)
        os.waitpid(child, 0)
    except:
        pass
`;

export class PtyManager {
  private instances = new Map<string, PtyInstance>();
  private nextId = 1;
  private onData: (id: string, data: string) => void;
  private onExit: (id: string, exitCode: number) => void;
  private scriptPath: string | null = null;

  constructor(
    onData: (id: string, data: string) => void,
    onExit: (id: string, exitCode: number) => void,
  ) {
    this.onData = onData;
    this.onExit = onExit;
  }

  private getScriptPath(): string {
    if (this.scriptPath) return this.scriptPath;
    // Write the Python script to a temp file
    const tmpDir = os.tmpdir();
    this.scriptPath = path.join(tmpDir, "tau-pty-bridge.py");
    fs.writeFileSync(this.scriptPath, PTY_SCRIPT, "utf-8");
    return this.scriptPath;
  }

  create(cwd: string, cols = 80, rows = 24): string {
    const id = `pty-${this.nextId++}`;
    const shell =
      process.env.SHELL ||
      (os.platform() === "win32" ? "powershell.exe" : "/bin/zsh");

    const scriptPath = this.getScriptPath();

    const proc = spawn("python3", [scriptPath, shell, cwd, String(cols), String(rows)], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLUMNS: String(cols),
        LINES: String(rows),
      },
    });

    let ready = false;

    proc.stdout?.on("data", (data: Buffer) => {
      const str = data.toString("utf-8");
      if (!ready) {
        // Wait for READY signal
        const idx = str.indexOf("\x00READY\n");
        if (idx >= 0) {
          ready = true;
          const after = str.slice(idx + 7);
          if (after.length > 0) {
            this.onData(id, after);
          }
          return;
        }
      }
      this.onData(id, str);
    });

    proc.stderr?.on("data", (data: Buffer) => {
      // Forward stderr as terminal output too
      this.onData(id, data.toString("utf-8"));
    });

    proc.on("close", (exitCode) => {
      this.instances.delete(id);
      this.onExit(id, exitCode ?? 0);
    });

    proc.on("error", (err) => {
      console.error(`[pty-manager] Error for ${id}:`, err.message);
      this.instances.delete(id);
      this.onExit(id, 1);
    });

    this.instances.set(id, { id, process: proc });
    return id;
  }

  write(id: string, data: string): void {
    const instance = this.instances.get(id);
    if (instance?.process.stdin?.writable) {
      instance.process.stdin.write(data);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.instances.get(id);
    if (instance?.process.stdin?.writable) {
      // Send resize command via the special escape
      instance.process.stdin.write(`\x00RESIZE:${cols}:${rows}\n`);
    }
  }

  close(id: string): void {
    const instance = this.instances.get(id);
    if (instance) {
      try {
        instance.process.kill("SIGHUP");
      } catch {
        // ignore
      }
      this.instances.delete(id);
    }
  }

  closeAll(): void {
    for (const [id] of this.instances) {
      this.close(id);
    }
  }

  dispose(): void {
    this.closeAll();
    // Clean up script file
    if (this.scriptPath) {
      try {
        fs.unlinkSync(this.scriptPath);
      } catch {
        // ignore
      }
    }
  }
}
