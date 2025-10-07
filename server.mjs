import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// 1) Create server
const server = new McpServer({ name: "feedalpha-calendar", version: "1.0.0" });

// 2) Define input schema with Zod (what the SDK expects)
const Input = z.object({
  brand: z.string(),
  audience: z.string(),
  tone: z.string().optional(),
  start_date: z.string().optional(),
  key_dates: z.array(z.string()).optional(),
  urls: z.array(z.string()).optional()
});

// 3) Register a single tool
server.tool(
  "generateCalendar",
  {
    description: "Generate a 30-day social calendar + 5 LinkedIn posts.",
    inputSchema: Input
  },
  async (args) => {
    const parsed = Input.parse(args); // validates

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
      content: [
        { type: "text", text: "Calendar generated." },
        { type: "json", value: data }
      ]
    };
  }
);

const app = express();
app.use(express.json({ limit: "1mb" }));

// health
app.get("/health", (_req, res) => res.status(200).send("ok"));

// helper: manual tools/list for sanity (bypasses handshake)
app.get("/debug/tools", (_req, res) => {
  // The SDK doesn’t expose a direct list, so mirror what we registered
  res.json({
    tools: [
      {
        name: "generateCalendar",
        description: "Generate a 30-day social calendar + 5 LinkedIn posts.",
        input_schema: {
          type: "object",
          required: ["brand", "audience"],
          properties: {
            brand: { type: "string" },
            audience: { type: "string" },
            tone: { type: "string" },
            start_date: { type: "string" },
            key_dates: { type: "array", items: { type: "string" } },
            urls: { type: "array", items: { type: "string" } }
          }
        }
      }
    ]
  });
});

// MCP handler (works for "/" and "/mcp")
async function handleMcp(req, res) {
  console.log(`MCP request on ${req.path}`);
  try {
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
}
app.post("/", handleMcp);
app.post("/mcp", handleMcp);

const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => console.log(`MCP server running at :${port} (/, /mcp)`));
