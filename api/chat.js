const SYSTEM_PROMPT = `You are Argy, a sharp and knowledgeable AI built for cybersecurity professionals and students... (Keep your existing prompt here)`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Invalid input." });

  try {
    // Groq uses standard OpenAI-style message formatting
    const formattedMessages = messages.map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: Array.isArray(m.content) 
        ? m.content.find(c => c.type === 'text')?.text || "" 
        : m.content
    }));

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GEMINI_API_KEY}`, // Using your Groq key
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile", // One of Groq's best models
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...formattedMessages
        ],
        temperature: 0.85,
        max_tokens: 1500
      })
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      console.error("Groq Error:", data);
      return res.status(groqRes.status).json({ error: "Argy is resting. Try again in a sec." });
    }

    // Extract content from Groq's response format
    const reply = data.choices[0]?.message?.content;
    return res.status(200).json({ reply });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};
