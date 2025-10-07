import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---- Tool input schema (JSON Schema)
const input_schema = {
  type: "object",
  properties: {
    brand: { type: "string", description: "Brand name" },
    audience: { type: "string", description: "Target audience" },
    tone: { type: "string", description: "Writing tone", default: "Confident, friendly" },
    start_date: { type: "string", description: "YYYY-MM-DD", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    key_dates: { type: "array", items: { type: "string" }, description: "['2025-10-15 Product Update']" },
    urls: { type: "array", items: { type: "string" }, description: "Reference URLs" }
  },
  required: ["brand", "audience"],
  additionalProperties: false
};

const SYSTEM_PROMPT = `You are Feedalpha’s Social Calendar generator. 
Goal: From a small brief, produce a 30-day content calendar and 5 LinkedIn posts that are brand-safe, concise, and on-voice.
Rules:
- Audience: LinkedIn first (B2B). Keep posts 3–8 short lines, skimmable.
- Tone: match requested tone; otherwise confident, helpful, human.
- Avoid clichés and buzzword salad. No hashtags inside the body.
- Use British/Irish English when in doubt (organisation, centre, programme).
- Never invent facts or metrics. If unsure, write general yet accurate copy.
- Return ONLY valid JSON matching the schema below. No commentary.
Schema:
{
  "calendar": [
    {"date":"YYYY-MM-DD","theme":"string","title":"string","hook":"string","cta":"string"}
  ],
  "linkedin_posts":[
    {"text":"string"},{"text":"string"},{"text":"string"},{"text":"string"},{"text":"string"}
  ],
  "hashtags": ["#tag1","#tag2","#tag3","#tag4","#tag5"],
  "utms":[{"source":"linkedin","url":"https://..."},{"source":"twitter","url":"https://..."}]
}
Validation:
- All dates must be valid ISO dates.
- Calendar length = 30 exactly.
- linkedin_posts length = 5 exactly.
- Hashtags 3–8, lowercase where possible, no spaces.
- If no URLs provided, set "utms":[].`;

function renderUserPrompt(args) {
  const brand = String(args.brand || "");
  const audience = String(args.audience || "");
  const tone = String(args.tone || "Confident, friendly");
  const start_date = args.start_date ? String(args.start_date) : "";
  const key_dates = Array.isArray(args.key_dates) ? args.key_dates : [];
  const urls = Array.isArray(args.urls) ? args.urls : [];

  const campaignMonth = new Date().toISOString().slice(0, 7).replace("-", "");
  const campaignSlug = brand.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return `Brand: ${brand}
Audience: ${audience}
Tone: ${tone}
Start date (optional): ${start_date}
Key dates (optional): ${JSON.stringify(key_dates)}
Reference URLs (optional): ${JSON.stringify(urls)}

Instructions:
- Prioritise key dates on/near those days with suitable themes (launch, webinar, case study).
- Mix calendar themes across: How-to, POV/Thought leadership, Customer story, Product tip, Behind-the-scenes, Industry stat, FAQ, Myth-buster, Community/CSR.
- For each calendar item: concise title (≤70 chars), a strong hook (1 sentence), and a clear CTA (e.g., “See the full guide →”).
- For LinkedIn posts: write 5 varied posts based on the brief/URLs; no hashtags in body.
- Build UTM URLs for any provided URLs: utm_source={{platform}}, utm_medium=social, utm_campaign=${campaignSlug}_${campaignMonth}.
Return JSON only.`;
}

// ---- MCP JSON-RPC over HTTP
async function handleMcp(req, res) {
  const rpc = req.body || {};
  const id = rpc.id ?? null;
  const method = rpc.method;

  try {
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocol_version: "2024-11-05",
          server_info: { name: "feedalpha-calendar", version: "1.0.0" },
          capabilities: { tools: {} }
        }
      });
    }

    if (method === "tools/list") {
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

    if (method === "tools/call") {
      const name = rpc?.params?.name;
      const args = rpc?.params?.arguments || {};
      if (name !== "generateCalendar") {
        return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } });
      }
      if (!args.brand || !args.audience) {
        return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "brand & audience required" } });
      }
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.json({ jsonrpc: "2.0", id, error: { code: 500, message: "Server missing OPENAI_API_KEY" } });
      }

      // Call OpenAI directly
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: renderUserPrompt(args) }
          ],
          text: { format: "json_object" },
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const t = await response.text();
        return res.json({ jsonrpc: "2.0", id, error: { code: response.status, message: `OpenAI error: ${t}` } });
      }

      const data = await response.json();
      const text =
        data.output_text ||
        data.choices?.[0]?.message?.content ||
        data.output?.[0]?.content?.[0]?.text ||
        "";

      let jsonOut;
      try {
        jsonOut = JSON.parse(text);
      } catch {
        const m = text && String(text).match(/\{[\s\S]*\}$/);
        if (!m) return res.json({ jsonrpc: "2.0", id, error: { code: 502, message: "Model did not return JSON" } });
        jsonOut = JSON.parse(m[0]);
      }

      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            { type: "text", text: "Calendar generated." },
            { type: "json", value: jsonOut }
          ]
        }
      });
    }

    // Optional ping
    if (method === "ping") {
      return res.json({ jsonrpc: "2.0", id, result: { ok: true } });
    }

    return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  } catch (e) {
    return res.json({ jsonrpc: "2.0", id, error: { code: -32000, message: String(e?.message || e) } });
  }
}

// Health (Render)
app.get("/health", (_req, res) => res.status(200).send("ok"));

// Mount at BOTH paths
app.post("/", handleMcp);
app.post("/mcp", handleMcp);

const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => console.log(`MCP JSON-RPC server on :${port} (/, /mcp)`));
