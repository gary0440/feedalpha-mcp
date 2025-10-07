import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---- JSON Schema describing the tool inputs
const input_schema = {
  type: "object",
  properties: {
    brand: { type: "string", description: "Brand name" },
    audience: { type: "string", description: "Target audience" },
    tone: { type: "string", description: "Writing tone", default: "Confident, friendly" },
    start_date: { type: "string", description: "YYYY-MM-DD", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    key_dates: { type: "array", items: { type: "string" }, description: "e.g., ['2025-10-15 Product Update']" },
    urls: { type: "array", items: { type: "string" }, description: "Reference URLs" }
  },
  required: ["brand", "audience"],
  additionalProperties: false
};

// ---- Handle MCP over HTTP (tools/list + tools/call)
async function handleMcp(req, res) {
  const rpc = req.body || {};
  const id = rpc.id ?? null;

  try {
    if (rpc.method === "tools/list") {
      // Return one tool: generateCalendar
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "generateCalendar",
              description: "Generate a 30-day social calendar + 5 LinkedIn posts.",
              input_schema
            }
          ]
        }
      });
    }

    if (rpc.method === "tools/call") {
      const name = rpc?.params?.name;
      const args = rpc?.params?.arguments || {};
      if (name !== "generateCalendar") {
        return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } });
      }
      if (!args.brand || !args.audience) {
        return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "brand & audience required" } });
      }

      // Call your Lovable function
      const upstream = "https://lovable-content-wiz.lovable.app/functions/v1/generate";
      const upstreamRes = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });

      if (!upstreamRes.ok) {
        const t = await upstreamRes.text();
        return res.json({
          jsonrpc: "2.0",
          id,
          error: { code: upstreamRes.status, message: `Upstream error: ${t}` }
        });
      }

      const data = await upstreamRes.json();

      // Valid MCP content payload
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            { type: "text", text: "Calendar generated." },
            { type: "json", value: data }
          ]
        }
      });
    }

    // Optional ping
    if (rpc.method === "ping") {
      return res.json({ jsonrpc: "2.0", id, result: { ok: true } });
    }

    // Unknown method
    return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  } catch (e) {
    return res.json({ jsonrpc: "2.0", id, error: { code: -32000, message: String(e?.message || e) } });
  }
}

// Health check
app.get("/health", (_req, res) => res.status(200).send("ok"));

// Mount at BOTH paths (some clients hit "/" first)
app.post("/", handleMcp);
app.post("/mcp", handleMcp);

const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => console.log(`MCP JSON-RPC server on :${port} (/, /mcp)`));
