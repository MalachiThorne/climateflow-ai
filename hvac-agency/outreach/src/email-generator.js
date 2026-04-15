const Anthropic = require("@anthropic-ai/sdk");
const config = require("./config");

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const EMAIL_TEMPLATES = {
  cold_intro: {
    description: "First touch — personalized audit of their online presence",
    prompt: (lead) => `Write a cold outreach email to an HVAC company owner.

Company: ${lead.companyName}
Owner: ${lead.ownerName || "the owner"}
City: ${lead.city}, ${lead.state}
Google Rating: ${lead.googleRating || "unknown"} (${lead.reviewCount || "unknown"} reviews)
Website: ${lead.website || "none found"}

You are writing on behalf of ClimateFlow AI, an AI-powered service that helps HVAC companies:
1. Respond to every missed call in under 60 seconds (Lead Rescue)
2. Get more Google reviews and respond to all of them automatically (Review Autopilot)
3. Follow up on open estimates until they close (Estimate Follow-Up)

Write a SHORT, personalized email (under 150 words) that:
- Opens with something specific about their business (rating, review count, location)
- Identifies ONE pain point they likely have
- Offers a free 7-day trial with no commitment
- Ends with a clear CTA (reply to schedule a 15-min setup call)
- Tone: friendly, direct, no corporate jargon, like a fellow business owner talking

Subject line should be catchy and under 50 characters.

Return the email in this exact format:
SUBJECT: [subject line]
BODY:
[email body]`,
  },

  follow_up_1: {
    description: "Follow up #1 — 3 days after cold intro, provide value",
    prompt: (lead) => `Write a follow-up email to an HVAC company that didn't respond to our first outreach.

Company: ${lead.companyName}
Owner: ${lead.ownerName || "the owner"}
City: ${lead.city}, ${lead.state}

This is follow-up #1, sent 3 days after the initial email. They haven't responded yet.

ClimateFlow AI helps HVAC companies with AI-powered lead response, review management, and estimate follow-up.

Write a SHORT follow-up (under 100 words) that:
- Doesn't guilt them for not responding
- Provides a specific stat or insight (e.g., "HVAC companies lose an average of $4,200/month from missed after-hours calls")
- Reiterates the free trial offer
- Feels casual and genuine

Return in this format:
SUBJECT: [subject line]
BODY:
[email body]`,
  },

  follow_up_2: {
    description: "Follow up #2 — 7 days later, breakup email",
    prompt: (lead) => `Write a final follow-up "breakup" email to an HVAC company.

Company: ${lead.companyName}
Owner: ${lead.ownerName || "the owner"}

This is the last follow-up. They haven't responded to 2 previous emails.

Write a SHORT email (under 80 words) that:
- Acknowledges they're busy (it's HVAC season)
- Says you won't email again unless they're interested
- Leaves the door open
- No pressure, no guilt

Return in this format:
SUBJECT: [subject line]
BODY:
[email body]`,
  },
};

async function generateEmail(lead, templateKey) {
  const template = EMAIL_TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown template: ${templateKey}`);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [{ role: "user", content: template.prompt(lead) }],
  });

  const text = response.content[0].text;
  const subjectMatch = text.match(/SUBJECT:\s*(.+)/);
  const bodyMatch = text.match(/BODY:\s*([\s\S]+)/);

  return {
    subject: subjectMatch ? subjectMatch[1].trim() : "Quick question about your HVAC business",
    body: bodyMatch ? bodyMatch[1].trim() : text,
  };
}

module.exports = { generateEmail, EMAIL_TEMPLATES };
