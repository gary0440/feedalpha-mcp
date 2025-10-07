import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const server = new McpServer({ name: "feedalpha-calendar", version: "1.0.0" });

// Define input schema with Zod (required by the SDK)
const inputSchema = z.object({
  brand: z.string(),
  audience: z.string(),
  tone: z.string().optional(),
  start_date: z.string().optional(),
  key_dates: z.array(z.string()).optional(),
  urls: z.array(z.string()).optional(),
});

// Register the tool using the supported API
server.tool(
  "generateCalendar",
  {
    description: "Generate a 30-day social calendar + 5 LinkedIn posts.",
    inputSchema, // do NOT pass null/undefined here
  },
  async (args) => {
    // Validate args from ChatGPT against Zod schema
    const parsed = inputSchema.parse(args);

    // Call your existing Lovable function
    const upstream = "https://lovable-content-wiz.lovable.app/functions/v1/generate";
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Upstream error (${res.status}): ${t}`);
    }
    const data = await res.json();

    // Return valid MCP content. `json` is supported for structured data.
    return {
      content: [
        { type: "text", text: "Calendar generated." },
        { type: "json", value: data },
      ],
    };
  }
);

const app = express();
app.use(express.json({ limit: "1mb" }));

// simple health probe
app.get("/health", (_req, res) => res.status(200).send("ok"));

// ChatGPT will POST here during connector creation & use
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
