import { readFile } from "node:fs/promises";
import path from "node:path";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const dataFile = path.join(process.cwd(), "data", "candidates.json");
    const payload = JSON.parse(await readFile(dataFile, "utf8"));
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
