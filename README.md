# Finance Coach

A personal finance app for one person, with a Claude-powered coach that can see your accounts, cards,
installments (MSI), bills and spending.

- **Today**: cash available, upcoming payments with a running balance, the day money runs short, the months
  ahead, and when each installment plan ends.
- **Coach**: chat in Spanish or English. The coach reads your data through tools and does all the math in code.
  It can log transactions, update balances, save goals and remember things about you.
- **Spending & payments**:
  - Import statements: PDFs, screenshots or a CSV. You can upload many files at once (e.g. every screenshot of
    your banking app's movements); movements repeated across overlapping screenshots are counted once.
  - Record a payment: upload a receipt (comprobante) or enter it by hand. The card's balance, the installments
    it covers and its next due date update automatically. You can also just tell the coach "I paid my credit card".
- **Plan**: edit accounts, cards (fecha de corte), installment plans, bills, income, goals and your profile.

Your data is stored in `data/coach.db` on your computer (git-ignored), or in Turso if `DATABASE_URL` is set.

## Setup

1. Get a Claude API key at https://platform.claude.com (Settings → API keys) and add some credit.
2. Copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY`.
3. Run:

   ```bash
   npm install
   npm run dev
   ```

4. Open http://localhost:3000.

The database is created the first time the app runs. If `data/seed.json` exists (git-ignored, so your
personal data never goes into the code), an empty database is filled from it; otherwise add your accounts on the
Plan page. Anything marked **CONFIRM** in the notes is an assumption; the dashboard lists those until you fix them.

## Using it from your iPhone

On the same Wi-Fi as your PC:

1. Set `APP_PASSCODE` in `.env.local` (anyone on your network could otherwise open it).
2. Run `npm run dev:phone`, then find your PC's IP address with `ipconfig` (e.g. `192.168.1.20`).
3. On the iPhone open Safari at `http://192.168.1.20:3000`, then Share → **Add to Home Screen**.

Windows Firewall may ask to allow Node.js on private networks; allow it. To use it away from home, deploy it
(e.g. Vercel) with a hosted database: set `DATABASE_URL` / `DATABASE_AUTH_TOKEN` to a Turso database and set
`APP_PASSCODE`.

## Hosting (use it from anywhere)

With Turso already set up, the app can run on Vercel's free Hobby plan:

1. Push the project to a private GitHub repo and import it at vercel.com.
2. In the Vercel project settings, add the variables from `.env.local` (`ANTHROPIC_API_KEY`, `APP_PASSCODE`,
   `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `COACH_MODEL`).
3. Deploy, then open the `*.vercel.app` URL on your iPhone and Add to Home Screen.

Once it's on the internet the passcode is the only lock, so make it long. Vercel limits uploads to about 4.5 MB per
request: screenshots are shrunk automatically, but split large PDFs into smaller batches.

## Cost

Each coach reply costs roughly $0.05–0.20 USD on Claude Opus 5.5 (it makes a few tool calls per reply). Reading a
statement costs about $0.05–0.25. For normal personal use that's a few dollars a month. Set
`COACH_MODEL=claude-sonnet-5-5` for about half the price.

## Development

```bash
npm test        # engine + coach tool tests
npx tsc --noEmit
npm run lint
```

- `src/lib/engine.ts`: all financial calculations (cash flow, card statements, installment schedules).
- `src/lib/coach/`: the coach's system prompt and tools.
- `src/app/api/chat`: streaming chat with the tool loop. `src/app/api/import`: statement extraction.
