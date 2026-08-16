import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const app = express();
app.use(express.json());

// Indian Kanoon API Helper
const searchKanoon = async (query: string) => {
  try {
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

// Mock Auth
app.post("/api/auth/login", (req, res) => {
  const { email, role } = req.body;
  res.json({ user: { email, role, name: email.split("@")[0] }, token: "mock-jwt" });
});

export default app;
