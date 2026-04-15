# ClimateFlow AI — HVAC Automation Agency

AI-powered operations for HVAC companies. Three services: Lead Rescue, Review Autopilot, Estimate Follow-Up.

## Structure

```
hvac-agency/
├── landing-page/     # Next.js marketing site (port 3050)
├── automations/      # Express server with Twilio + Claude AI pipelines
├── outreach/         # Cold outreach system (scraper + email campaigns)
└── docs/             # Business plan and documentation
```

## Quick Start

### Landing Page
```bash
cd landing-page
npm install
npm run dev  # http://localhost:3050
```

### Automation Server
```bash
cd automations
npm install
cp .env.example .env  # Fill in Twilio + Anthropic keys
npm start              # http://localhost:3001
```

### Outreach System
```bash
cd outreach
npm install
cp .env.example .env   # Fill in SMTP + Anthropic keys

# Import leads from CSV
node src/import-leads.js path/to/leads.csv

# Dry run (generates emails, doesn't send)
npm run campaign:dry

# Send cold_intro emails
npm run campaign

# Send follow-ups
node src/campaign.js follow_up_1
node src/campaign.js follow_up_2
```

## API Endpoints (Automation Server)

### Twilio Webhooks
- `POST /webhooks/voice/status` — Missed call handler (set as Voice Status Callback in Twilio)
- `POST /webhooks/sms` — Incoming SMS handler (set as SMS Webhook in Twilio)

### Review Autopilot
- `POST /api/review/request` — Send review request after a completed job
- `POST /api/review/incoming` — Process incoming review from Google/Yelp

### Estimate Follow-Up
- `POST /api/estimate` — Add an estimate to track

### Dashboard
- `GET /api/dashboard/:businessId` — Get lead/estimate/review metrics

## Setup Checklist

1. [ ] Get Twilio account + phone number ($1/mo + usage)
2. [ ] Get Anthropic API key
3. [ ] Set up SMTP (Gmail app password or SendGrid)
4. [ ] Deploy landing page to Vercel
5. [ ] Deploy automation server (Railway, Render, or VPS)
6. [ ] Configure Twilio webhooks to point at deployed server
7. [ ] Import HVAC leads and run first outreach campaign
