import type { Branch, Commit, Repository } from './history';

export const isCheckpoint = (c: Commit) =>
  !c.parentIds.length || (!!c.snapshot && !c.operations.length);

export interface LogEntry {
  commit: Commit;
  edits: Commit[];
  branches: Branch[];
}
export interface HistoryLog {
  changes: Commit[];
  entries: LogEntry[];
}
export function historyLog(r: Repository): HistoryLog {
  const log: HistoryLog = { changes: [], entries: [] };
  const seen = new Set<string>();
  let edits = log.changes;
  let c: Commit | undefined = r.commits[r.head];
  while (c && !seen.has(c.id)) {
    seen.add(c.id);
    if (isCheckpoint(c)) {
      const entry: LogEntry = { commit: c, edits: [], branches: [] };
      log.entries.push(entry);
      edits = entry.edits;
    } else edits.push(c);
    const parent: string | undefined = c.parentIds[0];
    c = parent ? r.commits[parent] : undefined;
  }
  for (const entry of log.entries) {
    const members = new Set([entry.commit.id, ...entry.edits.map((e) => e.id)]);
    entry.branches = r.branches.filter((b) => members.has(b.head));
  }
  return log;
}
