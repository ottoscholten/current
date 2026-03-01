# Current - Discovery Life Weekly

London has too many events and not enough signal.
Finding something worth going to means juggling Resident Advisor, Instagram, and word of mouth - and still ending up at the wrong thing.

**The job to be done:** I want a night out. Find me events I'll actually enjoy, without the research burden.

Current solves this by learning your taste profile and doing the filtering for you - so what shows up in your week view is already curated to you, not just categorised.

---

## Why I built this

Two reasons, honestly:

**The problem is real.** I live in London and experience this weekly. Classical event filters (genre, price, date) are too literal — they can't capture taste.

**I'm learning how to integrate AI into products properly.** Not "add AI" for the sake of it — but understand where it genuinely earns its place and where it doesn't. As a PM, I spec AI features all the time. I wanted to build one end-to-end: define the problem, choose where AI fits, wire up the APIs, and feel the trade-offs myself. The filtering layer here felt like a real use case, not a gimmick, which is exactly why I started here.

## What I'm learning

- Where AI earns its place - filtering by taste felt right; navigation didn't need it
- Working with external APIs (Resident Advisor) and designing around their constraints
- Serverless function architecture for scheduled sync jobs
- Building a taste model from unstructured natural language input

---

## How it works

- Fetches events from Resident Advisor (more sources coming)
- Filters them with AI against your personal taste profile — only events you'd actually want go into the DB
- Displays the current week Mon–Sun, with category filters and a detail modal per event
- Lets you manage which sources are active

## Stack

- **Frontend:** React + TypeScript + Tailwind CSS + shadcn-ui
- **Build:** Vite
- **Database:** Supabase
- **Hosting:** Netlify
- **Serverless functions:** Netlify Functions (event fetching + sync)
- **AI filtering:** OpenRouter

## Local development

```sh
git clone https://github.com/ottoscholten/current.git
cd current
npm install
npm run dev
```

Copy `.env.example` to `.env` and fill in your own credentials.

## Environment variables

See `.env.example` for the full list. You'll need:

- Supabase project URL and publishable key
- An OpenRouter API key (for AI filtering)
