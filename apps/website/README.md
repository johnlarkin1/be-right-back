# Be Right Back Website

Marketing website for Be Right Back, deployed at [be-right-back.com](https://be-right-back.com).

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Styling:** Tailwind CSS
- **UI Components:** shadcn/ui
- **Deployment:** Vercel

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Build

Build for production:

```bash
npm run build
```

Preview production build:

```bash
npm start
```

## Project Structure

```
src/
├── app/
│   ├── page.tsx          # Homepage
│   ├── about/            # About page
│   ├── download/         # Download page
│   ├── layout.tsx        # Root layout
│   └── globals.css       # Global styles
├── components/           # Reusable UI components
└── lib/
    └── utils.ts          # Utility functions
```

## Deployment

The site is configured for automatic deployment to Vercel:

1. Push to the `main` branch
2. Vercel automatically builds and deploys
3. Preview deployments are created for pull requests

### Manual Deployment

```bash
npx vercel
```

For production:

```bash
npx vercel --prod
```

## Adding Components

Add shadcn/ui components:

```bash
npx shadcn@latest add button
npx shadcn@latest add card
```

## Environment Variables

No environment variables are currently required for the marketing site.

## License

Same license as the main Be Right Back project.
