# Contributing to RoninFlow

Thanks for helping! Bug reports, platform/broker export samples and pull requests are all welcome.

## Run it locally

```bash
npm install
npm run dev     # http://localhost:5173 with hot reload
npm test        # importer, pairing and connector tests
```

## Good places to start

- **A new file import or broker connection.** Importers live in `src/lib/importers.js` (browser) and connections in
  `connect-apis.js` / `connect-markets.js` (server). A sample export with the account numbers removed is the most
  useful thing you can attach to an issue.
- **Translations.** Interface phrases are in `src/lib/i18n.js` and `src/lib/i18n-more.js`. Native-speaker fixes are
  very welcome.
- Issues labelled **good first issue**.

## Pull requests

- Keep changes focused, run `npm test`, and add a line under a new version heading in `CHANGELOG.md` if users will
  notice the change.
- Never commit real trades, account numbers or API keys — use the demo data (`src/data/showcase.js`) for examples.
