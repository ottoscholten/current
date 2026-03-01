# current

> Discover life weekly.

Personal events discovery dashboard for London. Pulls events from platforms you follow, filters them with AI against your taste profile, and shows the week ahead in a clean day-by-day grid.

## What it does

- Fetches events from Resident Advisor (and more sources coming)
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
