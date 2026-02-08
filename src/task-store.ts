import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { Task, TaskStatus } from './shared/task-types';

const TASK_FILE = 'tasks.md';

const SECTION_MAP: Record<string, TaskStatus> = {
  'inbox': 'inbox',
  'todo': 'todo',
  'refinement': 'refinement',
  'in progress': 'in-progress',
  'done': 'done',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  'inbox': 'Inbox',
  'todo': 'Todo',
  'refinement': 'Refinement',
  'in-progress': 'In Progress',
  'done': 'Done',
};

const STATUS_ORDER: TaskStatus[] = ['inbox', 'todo', 'refinement', 'in-progress', 'done'];

export function parseTasks(markdown: string): Task[] {
  const tasks: Task[] = [];
  let currentStatus: TaskStatus = 'inbox';
  let currentTask: Task | null = null;
  const resultLines: string[] = [];

  const flushResult = () => {
    if (currentTask && resultLines.length > 0) {
      currentTask.result = resultLines.join('\n').trim();
      resultLines.length = 0;
    }
    currentTask = null;
  };

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();

    // Section header: ## Inbox, ## Todo, ## In Progress, ## Done
    const headerMatch = trimmed.match(/^##\s+(.+)$/);
    if (headerMatch) {
      flushResult();
      const key = headerMatch[1].toLowerCase();
      if (key in SECTION_MAP) {
        currentStatus = SECTION_MAP[key];
      }
      continue;
    }

    // Task line: - [ ] text or - [x] text, optionally with <!-- agent:id --> and/or <!-- id:uuid -->
    const taskMatch = trimmed.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      flushResult();
      const checked = taskMatch[1].toLowerCase() === 'x';
      let text = taskMatch[2];
      let subagentId: string | undefined;
      let taskId: string | undefined;

      // Extract task id from trailing HTML comment <!-- id:uuid -->
      const idTag = text.match(/\s*<!--\s*id:(\S+)\s*-->$/);
      if (idTag) {
        taskId = idTag[1];
        text = text.slice(0, idTag.index!).trimEnd();
      }

      // Extract subagentId from trailing HTML comment <!-- agent:id -->
      const agentTag = text.match(/\s*<!--\s*agent:(\S+)\s*-->$/);
      if (agentTag) {
        subagentId = agentTag[1];
        text = text.slice(0, agentTag.index!).trimEnd();
      }

      currentTask = {
        id: taskId ?? crypto.randomUUID(),
        text,
        status: currentStatus,
        done: currentStatus === 'done' || checked,
        subagentId,
      };
      tasks.push(currentTask);
      continue;
    }

    // Result line: blockquote under a task (>  result text)
    if (currentTask && trimmed.startsWith('>')) {
      resultLines.push(trimmed.slice(1).trimStart());
      continue;
    }

    // Empty line or other content — flush any pending result
    if (trimmed === '') {
      flushResult();
    }
  }

  flushResult();
  return tasks;
}

export function serializeTasks(tasks: Task[]): string {
  const lines: string[] = ['# Tasks', ''];

  for (const status of STATUS_ORDER) {
    const group = tasks.filter((t) => t.status === status);
    lines.push(`## ${STATUS_LABELS[status]}`);
    if (group.length === 0) {
      lines.push('');
      continue;
    }
    for (const task of group) {
      const check = task.done ? 'x' : ' ';
      const agentSuffix = task.subagentId ? ` <!-- agent:${task.subagentId} -->` : '';
      const idSuffix = ` <!-- id:${task.id} -->`;
      lines.push(`- [${check}] ${task.text}${agentSuffix}${idSuffix}`);
      // Write result as blockquote lines below the task
      if (task.result) {
        for (const rl of task.result.split('\n')) {
          lines.push(`  > ${rl}`);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function loadTasks(cwd: string): Promise<Task[]> {
  const filePath = path.join(cwd, TASK_FILE);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return parseTasks(content);
  } catch {
    return [];
  }
}

export async function saveTasks(cwd: string, tasks: Task[]): Promise<void> {
  const filePath = path.join(cwd, TASK_FILE);
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, serializeTasks(tasks), 'utf-8');
  await fs.rename(tmp, filePath);
}
