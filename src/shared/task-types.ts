export type TaskStatus = "inbox" | "todo" | "refinement" | "in-progress" | "done";

export interface Task {
  id: string;
  text: string;
  status: TaskStatus;
  done: boolean;
  subagentId?: string;
  result?: string;
}
