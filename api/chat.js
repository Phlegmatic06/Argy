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

EXPERTISE — GENERAL (answer anything, bring it back to security when relevant):
- Python (especially security scripting), Bash, Go, JavaScript, C
- Networking fundamentals, OSI model, protocols
- Linux/Windows administration, general software dev
- Machine learning, AI concepts
- Any other topic — answer it well

WHEN ANALYZING IMAGES:
- Terminal screenshots, code, network diagrams, logs, tool output — analyze carefully with a security lens
- Point out vulns, misconfigs, or suspicious patterns you notice
- React like a security pro looking over someone's shoulder

IMPORTANT:
- Always be genuinely helpful — this is for learning and professional use
- Offensive security topics: explain educationally for CTFs, authorized pentesting, learning
- Give real, practical answers — not watered-down generic advice
- When someone shares a CVE, config, or tool output — engage with the specifics`;

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const { messages } = req.body || {};

  // Validate input
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Invalid or missing messages." });
  }

  // Check API key
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY environment variable not set.");
    return res.status(500).json({ error: "Server not configured. Contact the admin." });
  }

  try {
    // Convert messages to Gemini format
    // Gemini roles: "user" | "model" (not "assistant")
    const rawContents = messages
      .filter((m) => ["user", "assistant"].includes(m.role))
      .filter((m) => typeof m.content === "string" || Array.isArray(m.content))
      .map((m) => {
        const role = m.role === "assistant" ? "model" : "user";

        // Array content = message with image + text
        if (Array.isArray(m.content)) {
          const parts = m.content
            .map((part) => {
              if (part.type === "text" && part.text) {
                return { text: part.text };
              }
              if (part.type === "image" && part.source?.data) {
                return {
                  inlineData: {
                    mimeType: part.source.media_type,
                    data: part.source.data,
                  },
                };
              }
              return null;
            })
            .filter(Boolean);

          // Skip if no valid parts
          if (parts.length === 0) return null;
          return { role, parts };
        }

        // Plain string content
        if (!m.content.trim()) return null;
        return { role, parts: [{ text: m.content }] };
      })
      .filter(Boolean);

    // Gemini requires strictly alternating user/model turns.
    // Merge consecutive same-role messages to prevent API errors.
    const contents = rawContents.reduce((acc, curr) => {
      if (acc.length > 0 && acc[acc.length - 1].role === curr.role) {
        acc[acc.length - 1].parts.push(...curr.parts);
      } else {
        acc.push(curr);
      }
      return acc;
    }, []);

    // Must start with user turn
    if (contents.length === 0 || contents[0].role !== "user") {
      return res.status(400).json({ error: "Conversation must start with a user message." });
    }

    // Call Gemini API
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents,
          generationConfig: {
            maxOutputTokens: 1500,
            temperature: 0.85,
            topP: 0.95,
          },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
          ],
        }),
      }
    );

    // Handle non-200 from Gemini
    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error(`Gemini HTTP ${geminiRes.status}:`, errText);
      return res.status(502).json({ error: "AI service error. Try again in a moment." });
    }

    const data = await geminiRes.json();

    // Gemini-level error in response body
    if (data.error) {
      console.error("Gemini API error:", JSON.stringify(data.error));
      return res.status(502).json({ error: "AI error. Try again in a moment." });
    }

    // Extract reply text
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
      // Could be a safety block
      const blockReason = data.candidates?.[0]?.finishReason;
      console.error("Empty reply. Finish reason:", blockReason, JSON.stringify(data));
      if (blockReason === "SAFETY") {
        return res.status(200).json({ reply: "hmm, i can't respond to that one — looks like it hit a content filter. try rephrasing?" });
      }
      return res.status(502).json({ error: "No response from AI. Try again." });
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("Unhandled server error:", err);
    return res.status(500).json({ error: "Server error. Try again." });
  }
};

// Vercel config: increase body size limit to handle base64 image uploads
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "12mb",
    },
  },
};
