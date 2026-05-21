import Ably from "ably";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ABLY_API_KEY is not configured" });
  }

  const clientId =
    typeof req.query?.clientId === "string" && req.query.clientId.length > 0
      ? req.query.clientId.slice(0, 64)
      : `anon-${Date.now()}`;

  try {
    const ably = new Ably.Rest({ key: apiKey });
    const tokenRequest = await ably.auth.createTokenRequest({ clientId });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(tokenRequest);
  } catch (err) {
    console.error("ably-token error:", err);
    return res.status(500).json({ error: "Failed to create Ably token" });
  }
}
