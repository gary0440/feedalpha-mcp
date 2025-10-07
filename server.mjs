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
  urls: z.array(z.string()).optional()
});

server.registerTool(
  "generateCalendar",
  {
    title: "Generate 30-day social calendar",
    description: "Creates a 30-day calendar + 5 LinkedIn posts.",
    inputSchema,
    outputSchema: z.any()
  },
  async (args) => {
    const parsed = inputSchema.parse(args);
    const upstream = "https://lovable-content-wiz.lovable.app/functions/v1/generate";
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed)
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Upstream error (${res.status}): ${t}`);
    }
    const data = await res.json();
    return {
      structuredContent: data,
      content: [{ type: "text", text: "Feedalpha calendar generated." }]
    };
  }
);

const app = express();
// keep body limit small to avoid accidental huge payloads
app.use(express.json({ limit: "1mb" }));

// Health check for Render
app.get("/health", (_req, res) => res.status(200).send("ok"));

// ChatGPT will POST here
app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP handler error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => console.log(`MCP server running at :${port}/mcp`));
