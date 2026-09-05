import { clone, id, validateProject, type Project } from './model';
import { applyCommand, type Command, type Operation } from './commands';
export interface Commit {
  id: string;
  parentIds: string[];
  timestamp: number;
  message: string;
  operations: Operation[];
  project: Project;
  snapshot?: boolean;
}
export interface Branch {
  id: string;
  name: string;
  head: string;
}
export interface Repository {
  version: 1;
  commits: Record<string, Commit>;
  branches: Branch[];
  activeBranch: string;
  head: string;
  redo: string[];
}
export function createRepository(p: Project): Repository {
  const c: Commit = {
    id: id(),
    parentIds: [],
    timestamp: Date.now(),
    message: 'プロジェクトを作成',
    operations: [],
    project: clone(p),
    snapshot: true,
  };
  const b: Branch = { id: id(), name: 'main', head: c.id };
  return {
    version: 1,
    commits: { [c.id]: c },
    branches: [b],
    activeBranch: b.id,
    head: c.id,
    redo: [],
  };
}
export class Editor {
  repository: Repository;
  project: Project;
  private tx?: { base: Project; operations: Operation[]; message: string };
  constructor(p: Project, repo?: Repository) {
    validateProject(p);
    this.repository = repo ? clone(repo) : createRepository(p);
    this.project = clone(
      this.repository.commits[this.repository.head]?.project || p,
    );
  }
  begin(message: string) {
    if (!this.tx)
      this.tx = { base: clone(this.project), operations: [], message };
  }
  execute(cmd: Command) {
    const result = applyCommand(this.project, cmd);
    if (!result) return false;
    this.project = result.project;
    if (this.tx) this.tx.operations.push(result.operation);
    else
      this.commit(
        [result.operation],
        `${result.operation.target} — ${result.operation.description}`,
      );
    return true;
  }
  preview(commands: Command[]) {
    if (!this.tx) return;
    this.project = clone(this.tx.base);
    this.tx.operations = [];
    for (const c of commands) this.execute(c);
  }
  end() {
    if (!this.tx) return;
    const tx = this.tx;
    this.tx = undefined;
    if (
      JSON.stringify(tx.base) !== JSON.stringify(this.project) &&
      tx.operations.length
    )
      this.commit(tx.operations, tx.message);
  }
  cancel() {
    if (this.tx) {
      this.project = this.tx.base;
      this.tx = undefined;
    }
  }
  private commit(ops: Operation[], message: string, snapshot = false) {
    const r = this.repository;
    let b = r.branches.find((b) => b.id === r.activeBranch)!;
    if (b.head !== r.head) {
      b = { id: id(), name: `別案 ${r.branches.length}`, head: r.head };
      r.branches.push(b);
      r.activeBranch = b.id;
    }
    const c: Commit = {
      id: id(),
      parentIds: [r.head],
      timestamp: Date.now(),
      message,
      operations: ops,
      project: clone(this.project),
      snapshot: snapshot || Object.keys(r.commits).length % 20 === 0,
    };
    r.commits[c.id] = c;
    r.head = c.id;
    b.head = c.id;
    r.redo = [];
  }
  undo() {
    this.cancel();
    const r = this.repository,
      parent = r.commits[r.head].parentIds[0];
    if (parent) {
      r.redo.push(r.head);
      r.head = parent;
      this.project = clone(r.commits[parent].project);
    }
  }
  redo() {
    this.cancel();
    const h = this.repository.redo.pop();
    if (h && this.repository.commits[h]) {
      this.repository.head = h;
      this.project = clone(this.repository.commits[h].project);
    }
  }
  snapshot(message = 'スナップショット') {
    this.end();
    this.commit([], message, true);
  }
  restore(commitId: string) {
    const c = this.repository.commits[commitId];
    if (!c) throw Error('履歴が見つかりません');
    this.cancel();
    this.project = clone(c.project);
    this.commit(
      [
        {
          type: 'project.update',
          target: c.project.name,
          description: `「${c.message}」へ復元`,
        },
      ],
      '履歴から復元',
      true,
    );
  }
  branch(name: string) {
    this.end();
    const b = {
      id: id(),
      name: name.trim() || `別案 ${this.repository.branches.length}`,
      head: this.repository.head,
    };
    this.repository.branches.push(b);
    this.repository.activeBranch = b.id;
    return b;
  }
  checkout(branchId: string) {
    this.cancel();
    const b = this.repository.branches.find((b) => b.id === branchId);
    if (!b) throw Error('別案が見つかりません');
    this.repository.activeBranch = b.id;
    this.repository.head = b.head;
    this.repository.redo = [];
    this.project = clone(this.repository.commits[b.head].project);
  }
  importBranch(repo: Repository, name: string) {
    if (repo.commits[repo.head].project.id !== this.project.id)
      throw Error('別のプロジェクトの履歴は取り込めません');
    const existing = this.repository.branches.find((b) => b.head === repo.head);
    for (const [key, c] of Object.entries(repo.commits))
      if (!this.repository.commits[key])
        this.repository.commits[key] = clone(c);
    for (const remote of repo.branches) {
      const local = this.repository.branches.find((b) => b.id === remote.id);
      if (!local) this.repository.branches.push(clone(remote));
      else if (
        local.head !== remote.head &&
        !this.repository.branches.some(
          (b) => b.head === remote.head && b.name === remote.name,
        )
      )
        this.repository.branches.push({
          ...remote,
          id: id(),
          name: `${name} · ${remote.name}`,
        });
    }
    if (existing) return existing;
    const b = { id: id(), name, head: repo.head };
    this.repository.branches.push(b);
    return b;
  }
}
export function validateRepository(
  value: unknown,
): asserts value is Repository {
  const r = value as Repository;
  if (
    !r ||
    r.version !== 1 ||
    !r.commits ||
    !r.commits[r.head] ||
    !Array.isArray(r.branches) ||
    !r.branches.some((b) => b.id === r.activeBranch) ||
    !Array.isArray(r.redo)
  )
    throw Error('履歴ファイルが不正です');
  for (const [key, c] of Object.entries(r.commits)) {
    if (
      c.id !== key ||
      !Array.isArray(c.parentIds) ||
      c.parentIds.some((id) => !r.commits[id]) ||
      !Array.isArray(c.operations)
    )
      throw Error('履歴の参照が不正です');
    validateProject(c.project);
  }
  if (r.branches.some((b) => !r.commits[b.head]))
    throw Error('別案の参照が不正です');
}
export function syncState(
  local: string,
  remote: string | null,
  last: string | null,
): 'equal' | 'push' | 'pull' | 'conflict' {
  if (local === remote) return 'equal';
  if (!remote || remote === last) return 'push';
  if (local === last) return 'pull';
  return 'conflict';
}

export const repositorySignature = (r: Repository) =>
  JSON.stringify({
    head: r.head,
    branches: r.branches,
    activeBranch: r.activeBranch,
  });
