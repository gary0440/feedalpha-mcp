import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const server = new McpServer({ name: "feedalpha-calendar", version: "1.0.0" });

// Plain JSON Schema (no Zod) so the connector creation never sees null/_def
const inputSchema = {
  type: "object",
  properties: {
    brand: { type: "string", description: "Brand name" },
    audience: { type: "string", description: "Target audience" },
    tone: { type: "string", description: "Writing tone", default: "Confident, friendly" },
    start_date: { type: "string", description: "YYYY-MM-DD", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    key_dates: { type: "array", items: { type: "string" }, description: "e.g. ['2025-10-15 Product Update']" },
    urls: { type: "array", items: { type: "string" }, description: "Reference URLs" }
  },
  required: ["brand", "audience"],
  additionalProperties: false
};

// Use the object form of `server.tool(...)`
server.tool(
  {
    name: "generateCalendar",
    description: "Generate a 30-day social calendar + 5 LinkedIn posts.",
    inputSchema
  },
  async (args) => {
    // Minimal sanity checks (since we dropped Zod here)
    if (!args?.brand || !args?.audience) {
      throw new Error("Missing required fields: brand and audience");
    }

    const upstream = "https://lovable-content-wiz.lovable.app/functions/v1/generate";
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args)
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Upstream error (${res.status}): ${t}`);
    }
    const data = await res.json();

    // Return both a human stub and structured JSON
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

app.get("/health", (_req, res) => res.status(200).send("ok")); // for Render

app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => console.log(`MCP server running at :${port}/mcp`));
