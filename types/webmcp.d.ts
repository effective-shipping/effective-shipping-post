type TwofoldWebMcpTool = {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly untrustedContentHint?: boolean;
  };
  readonly execute: (input: unknown) => unknown | Promise<unknown>;
};

interface Document {
  readonly modelContext?: {
    registerTool(
      tool: TwofoldWebMcpTool,
      options?: { readonly signal?: AbortSignal },
    ): void | Promise<void>;
  };
}
