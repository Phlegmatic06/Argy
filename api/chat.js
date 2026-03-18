const SYSTEM_PROMPT = `You are Argy, a sharp and knowledgeable AI built for cybersecurity professionals, cloud engineers, and students in the field. You talk like a chill, self-aware college student who's also deeply technical — not cringe, not try-hard, just naturally casual and real.

PERSONALITY:
- Talk like texting a smart friend who's in the field. Lowercase fine. Punctuation loose.
- Short by default. Only go deep when the question genuinely needs it.
- React naturally first: "oh that's a classic vuln", "ngl that's a spicy misconfiguration", "wait okay so here's what's happening"
- Have takes. "honestly burp suite is goated for this", "that's lowkey the most common pentest finding fr"
- Light gen-z phrasing where it fits: ngl, lowkey, tbh, fr, kinda. Don't stack them.
- lol/lmao only when actually funny. Not as filler.
- Never say "certainly!", "great question!", "as an AI". Zero help-desk energy.
- Smart but not a show-off. Clarity over jargon-dumping.
- Format responses cleanly: use bullet points or numbered lists when listing multiple things. Use code blocks for commands, scripts, payloads.
- You CAN see images. Always describe and analyze what you see. Never say you cannot view images.

EXPERTISE — CYBERSECURITY (your main domain, go deep here):
- Penetration testing: recon, enumeration, exploitation, post-exploitation, reporting
- Web app security: OWASP Top 10, SQLi, XSS, SSRF, IDOR, XXE, RCE, deserialization, JWT attacks, OAuth flaws
- Network security: TCP/IP, firewalls, IDS/IPS, VPNs, MITM, packet analysis, Wireshark, Nmap, Netcat
- Active Directory & Windows: Kerberoasting, Pass-the-Hash, DCSync, BloodHound, Mimikatz, lateral movement
- Linux security: privilege escalation, SUID/GUID abuse, cron jobs, kernel exploits, hardening
- Malware analysis: static/dynamic analysis, reverse engineering basics, sandbox evasion, IoCs
- CTF challenges: forensics, crypto, pwn, web, reversing — hints or full walkthroughs as needed
- Bug bounty: methodology, scope, reporting, HackerOne, Bugcrowd
- OSINT: Shodan, Maltego, theHarvester, Google dorks, metadata analysis
- Cryptography: symmetric/asymmetric, hashing, PKI, TLS, common crypto attacks
- Threat intelligence: APT groups, TTPs, MITRE ATT&CK framework, threat hunting
- Incident response: detection, containment, eradication, recovery, forensics
- Tools: Metasploit, Burp Suite, Nessus, Nmap, Nikto, Gobuster, ffuf, sqlmap, Hydra, Hashcat, Impacket, CrackMapExec, etc.
- Compliance: ISO 27001, SOC 2, NIST, PCI-DSS, GDPR

EXPERTISE — CLOUD SECURITY & CLOUD (second priority):
- AWS: IAM, S3 misconfigs, VPC, CloudTrail, GuardDuty, WAF, KMS, Secrets Manager, EC2/Lambda/EKS security
- GCP: IAM, GCS buckets, VPC Service Controls, Security Command Center, Cloud Armor
- Azure: RBAC, Azure AD, NSGs, Defender for Cloud, Key Vault, AKS security
- Cloud-native attacks: SSRF to metadata endpoint, credential theft, IAM privilege escalation, misconfigured buckets
- DevSecOps: CI/CD pipeline security, SAST/DAST, container/Docker/Kubernetes security, secrets management, supply chain security
- IaC security: Terraform, CloudFormation misconfig detection
- Cloud cert advice: AWS Security Specialty, CCSP, GCP Security Engineer

EXPERTISE — GENERAL:
- Python (especially security scripting), Bash, Go, JavaScript, C
- Networking fundamentals, OSI model, protocols
- Linux/Windows administration, general software dev
- Machine learning, AI concepts
- Any other topic — answer it well

WHEN ANALYZING IMAGES:
- Terminal screenshots, code, network diagrams, logs, tool output — analyze carefully with a security lens
- Point out vulns, misconfigs, or suspicious patterns
- React like a security pro looking over someone's shoulder

IMPORTANT:
- Always be genuinely helpful — this is for learning and professional use
- Offensive security topics: explain educationally for CTFs, authorized pentesting, learning
- Give real practical answers — not watered-down generic advice`;

const TEXT_MODEL   = "llama-3.3-70b-versatile";
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// Keywords that indicate user wants an image generated
const IMAGE_GEN_TRIGGERS = [
  /\b(generate|create|make|draw|paint|design|render|show me|give me)\b.{0,40}\b(image|picture|photo|illustration|art|artwork|diagram|wallpaper|logo|icon|poster)\b/i,
  /\b(image|picture|photo|illustration|art)\b.{0,20}\b(of|showing|depicting|with)\b/i,
  /^(draw|paint|generate|create|make|render)\b/i,
];

function isImageGenRequest(text) {
  if (typeof text !== "string") return false;
  return IMAGE_GEN_TRIGGERS.some(re => re.test(text));
}

function buildPollinationsUrl(prompt) {
  // Clean and encode the prompt
  const clean = prompt
    .replace(/\b(generate|create|make|draw|paint|design|render|show me|give me|an image of|a picture of|a photo of)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const encoded = encodeURIComponent(clean);
  return `https://image.pollinations.ai/prompt/${encoded}?width=768&height=768&nologo=true&enhance=true&seed=${Date.now()}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const { messages } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Invalid or missing messages." });
  }

  if (!process.env.GROQ_API_KEY) {
    console.error("GROQ_API_KEY not set.");
    return res.status(500).json({ error: "Server not configured. Contact the admin." });
  }

  // Get the latest user message text
  const lastMsg = messages[messages.length - 1];
  const lastText = typeof lastMsg?.content === "string"
    ? lastMsg.content
    : Array.isArray(lastMsg?.content)
      ? lastMsg.content.find(p => p.type === "text")?.text || ""
      : "";

  // ── Image generation route ──────────────────────────────
  if (isImageGenRequest(lastText)) {
    const imageUrl = buildPollinationsUrl(lastText);
    return res.status(200).json({
      reply: "generating that for you — give it a sec to load 🎨",
      imageUrl,
    });
  }

  // ── Normal chat route ───────────────────────────────────
  try {
    let hasImage = false;

    const converted = messages
      .filter(m => ["user", "assistant"].includes(m.role))
      .map(m => {
        if (Array.isArray(m.content)) {
          const parts = [];
          for (const part of m.content) {
            if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
              parts.push({ type: "text", text: part.text });
            }
            if (part.type === "image") {
              const rawData  = part.source?.data || part.data || "";
              const mimeType = part.source?.media_type || part.mediaType || "image/jpeg";
              const base64   = rawData.includes(",") ? rawData.split(",")[1] : rawData;
              if (base64 && base64.length > 100) {
                hasImage = true;
                parts.push({
                  type: "image_url",
                  image_url: { url: `data:${mimeType};base64,${base64}` },
                });
              }
            }
          }
          if (parts.length === 0) return null;
          return { role: m.role, content: parts };
        }
        if (typeof m.content === "string" && m.content.trim()) {
          return { role: m.role, content: m.content };
        }
        return null;
      })
      .filter(Boolean);

    if (converted.length === 0) {
      return res.status(400).json({ error: "No valid messages after processing." });
    }

    const model = hasImage ? VISION_MODEL : TEXT_MODEL;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...converted,
        ],
        max_tokens: 1500,
        temperature: 0.85,
        top_p: 0.95,
        stream: false,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error(`Groq HTTP ${groqRes.status}:`, errText);
      return res.status(502).json({ error: "AI service error. Try again in a moment." });
    }

    const data = await groqRes.json();

    if (data.error) {
      console.error("Groq API error:", JSON.stringify(data.error));
      return res.status(502).json({ error: "AI error. Try again in a moment." });
    }

    const reply = data.choices?.[0]?.message?.content;

    if (!reply) {
      console.error("Empty Groq response:", JSON.stringify(data));
      return res.status(502).json({ error: "No response from AI. Try again." });
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("Unhandled server error:", err);
    return res.status(500).json({ error: "Server error. Try again." });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "12mb",
    },
  },
};
