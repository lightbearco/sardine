declare module "@mastra/core/dist/test-utils/llm-mock" {
  import type { MastraModelConfig } from "@mastra/core/llm";

  export function createMockModel(args: {
    objectGenerationMode?: "json";
    mockText: unknown;
    version?: "v1" | "v2";
  }): MastraModelConfig;
}
