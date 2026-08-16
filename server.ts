import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Indian Kanoon API Helper
const searchKanoon = async (query: string) => {
  try {
    // Using POST as GET often returns 405 for search endpoints in some API versions
    // or requires specific query params. POST is safer for search.
    const response = await axios.post("https://api.indiankanoon.org/search/", 
      `formInput=${encodeURIComponent(query)}&pagenum=0`, 
      {
        headers: {
          "Authorization": `Token ${process.env.KANOON_API_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
      }
    );
    return response.data.results?.slice(0, 3) || [];
  } catch (error) {
    console.error("Kanoon API Error:", error);
    return [];
  }
};

// Research Endpoint (Kanoon Proxy)
app.post("/api/research", async (req, res) => {
  const { query } = req.body;
  const cases = await searchKanoon(query);
  res.json({ cases: cases.map((c: any) => ({ title: c.title, url: `https://indiankanoon.org/doc/${c.tid}/`, snippet: c.headline })) });
});

// Document Auditor Endpoint (Secure Server-Side Analysis)
app.post("/api/audit", async (req, res) => {
  const { text, fileName } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Document text is required" });
  }

  try {
    const prompt = `Audit this legal document: "${fileName || "document.txt"}"
    
    Document Content:
    ${text}
    
    Identify:
    1. Document Type (e.g., NDA, Lease, Employment Contract).
    2. Key Obligations for both parties.
    3. India-specific legal risks (e.g., Stamp Act compliance, Arbitration clauses under Indian law).
    4. Suggested improvements.`;

    const response = await ai.models.generateContent({
      model: "gemini-1.5-pro",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            documentType: { type: Type.STRING },
            summary: { type: Type.STRING },
            obligations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  importance: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] }
                },
                required: ['title', 'description', 'importance']
              }
            },
            risks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  severity: { type: Type.STRING, enum: ['Critical', 'High', 'Medium', 'Low'] }
                },
                required: ['title', 'description', 'severity']
              }
            },
            improvements: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ['documentType', 'summary', 'obligations', 'risks', 'improvements']
        }
      }
    });

    const reportData = JSON.parse(response.text);
    res.json(reportData);
  } catch (error: any) {
    console.error("Backend Audit Error:", error);
    res.status(500).json({ error: error.message || "Failed to analyze document" });
  }
});

// Helper to recursively map string types to SDK Type enums for schema validations
function convertSchemaTypes(schema: any): any {
  if (!schema) return undefined;
  
  const typeMap: Record<string, Type> = {
    "STRING": Type.STRING,
    "INTEGER": Type.INTEGER,
    "NUMBER": Type.NUMBER,
    "BOOLEAN": Type.BOOLEAN,
    "ARRAY": Type.ARRAY,
    "OBJECT": Type.OBJECT,
    "string": Type.STRING,
    "integer": Type.INTEGER,
    "number": Type.NUMBER,
    "boolean": Type.BOOLEAN,
    "array": Type.ARRAY,
    "object": Type.OBJECT,
  };

  const newSchema = { ...schema };
  if (typeof newSchema.type === 'string') {
    const mapped = typeMap[newSchema.type];
    if (mapped) {
      newSchema.type = mapped;
    }
  }

  if (newSchema.items) {
    newSchema.items = convertSchemaTypes(newSchema.items);
  }

  if (newSchema.properties) {
    const newProps: any = {};
    for (const key of Object.keys(newSchema.properties)) {
      newProps[key] = convertSchemaTypes(newSchema.properties[key]);
    }
    newSchema.properties = newProps;
  }

  return newSchema;
}

// Generic generation endpoint used by all other AI features
app.post("/api/generate", async (req, res) => {
  const { prompt, contents, systemInstruction, model, responseSchema, useJson } = req.body;

  if (!prompt && !contents) {
    return res.status(400).json({ error: "Prompt or contents are required" });
  }

  try {
    const config: any = {};
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }
    if (useJson || responseSchema) {
      config.responseMimeType = "application/json";
    }
    if (responseSchema) {
      config.responseSchema = convertSchemaTypes(responseSchema);
    }

    const response = await ai.models.generateContent({
      model: model || "gemini-1.5-flash",
      contents: contents || [{ parts: [{ text: prompt }] }],
      config
    });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("Backend Generation Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate content from AI" });
  }
});

// Mock Auth
app.post("/api/auth/login", (req, res) => {
  const { email, role } = req.body;
  res.json({ user: { email, role, name: email.split("@")[0] }, token: "mock-jwt" });
});

// Vite Integration
if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

export default app;

if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Law Bridge Server running on http://localhost:${PORT}`);
  });
}
