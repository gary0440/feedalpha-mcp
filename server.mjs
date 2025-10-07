import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const server = new McpServer({ name: "feedalpha-calendar", version: "1.0.0" });

const inputSchema = z.object({
  brand: z.string(),
  audience: z.string(),
  tone: z.string().optional(),
  start_date: z.string().optional(),
  key_dates: z.array(z.string()).optional(),
  urls: z.array(z.string()).optional(),
});

server.registerTool(
  "generateCalendar",
  {
    title: "Generate 30-day social calendar",
    description: "Creates a 30-day calendar + 5 LinkedIn posts from your brief.",
    inputSchema,
    outputSchema: z.any(),
  },
  async (args) => {
    const parsed = inputSchema.parse(args);
    const res = await fetch("https://lovable-content-wiz.lovable.app/functions/v1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    if (!res.ok) throw new Error(`Upstream error: ${await res.text()}`);
    const data = await res.json();
    return {
      structuredContent: data,
      content: [{ type: "text", text: "Feedalpha calendar generated." }]
    };
  }
);

const app = express();
app.use(express.json());

// ChatGPT expects POST /mcp (Streamable HTTP transport)
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => console.log(`MCP server running on :${port}/mcp`));
