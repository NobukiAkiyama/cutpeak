import { validateRepository, type Repository, type Commit } from './history';
export function serializePack(repository: Repository): string {
  const { commits, ...header } = repository;
  return (
    [
      JSON.stringify({ kind: 'repository', ...header }),
      ...Object.values(commits).map((commit) =>
        JSON.stringify({ kind: 'commit', commit }),
      ),
    ].join('\n') + '\n'
  );
}
export function parsePack(text: string): Repository {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const lines = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const [header, ...records] = lines;
    if (header?.kind !== 'repository')
      throw Error('履歴パックのヘッダーが不正です');
    const commits: Record<string, Commit> = {};
    for (const r of records) {
      if (
        r.kind !== 'commit' ||
        typeof r.commit?.id !== 'string' ||
        commits[r.commit.id]
      )
        throw Error('履歴パックのコミットが不正です');
      commits[r.commit.id] = r.commit;
    }
    const { kind: _kind, ...rest } = header;
    data = { ...rest, commits };
  }
  validateRepository(data);
  return data;
}
