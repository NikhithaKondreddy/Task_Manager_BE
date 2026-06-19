# Applying Ticketing Bootstrap

This project contains a bootstrap helper to create missing ticketing tables and seed defaults.

To run the bootstrap locally:

```bash
npm run apply:bootstrap
```

Or directly:

```bash
node scripts/apply-ticketing-bootstrap.js
```

The script calls `ensureTicketingSchema()` in `src/modules/tickets/bootstrap.js` and logs results.
