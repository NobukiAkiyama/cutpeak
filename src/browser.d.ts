interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}
interface Navigator {
  standalone?: boolean;
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
