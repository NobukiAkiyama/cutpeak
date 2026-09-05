interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}
interface Document {
  modelContext?: {
    registerTool(
      tool: {
        name: string;
        description: string;
        title?: string;
        inputSchema: object;
        annotations?: {
          readOnlyHint?: boolean;
          untrustedContentHint?: boolean;
        };
        execute(input: unknown): unknown;
      },
      options?: { signal?: AbortSignal },
    ): void | Promise<void>;
  };
}
