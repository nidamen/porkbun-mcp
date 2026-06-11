#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PorkbunClient } from "./client.js";
import { callTool, toolDefinitions } from "./tools.js";

const client = new PorkbunClient();
const server = new McpServer({
  name: "porkbun-mcp",
  version: "0.1.0",
});

for (const tool of toolDefinitions()) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    },
    async (args: unknown) => {
      const result = await callTool(client, tool.name, args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Porkbun MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in Porkbun MCP server:", error);
  process.exit(1);
});
