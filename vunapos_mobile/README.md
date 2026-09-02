# VunaPOS Mobile

The native VunaPOS mobile app, built independently from the Frappe backend and the React/Vite SPA. It uses Expo SDK 57, Expo Router, React Native Paper, and a small native translation of the Frappe design foundations.

## Run locally

```bash
npm install
npm start
```

Use `npm run android`, `npm run ios`, or `npm run web` to open a specific target. Run `npx tsc --noEmit` and `npm run lint` before handing off a change.

## Structure

```text
src/
├── app/                 # Expo Router route groups and route entry points
│   ├── (auth)/          # unauthenticated routes
│   └── (app)/           # signed-in application routes
├── components/          # small cross-feature visual building blocks
├── config/              # company URL normalization and validation
├── features/            # feature-owned screens and larger components (including pos/)
├── services/            # Frappe requests and encrypted session persistence
└── theme/               # Frappe-derived colour, type, radius, and Paper theme tokens
```

## Current increment

- Frappe-derived visual foundations: Inter typography, neutral surfaces, semantic colours, restrained elevation, and 4–12px radii. Setup/auth use the light workspace palette; POS mirrors the SPA’s Desk-derived dark workspace.
- A company-URL setup screen that validates the VunaPOS site before saving it in encrypted device storage.
- Frappe sign-in using the identifier ERPNext accepts (`usr`) and a password; the resulting session ID is encrypted at rest.
- Restored sessions are checked at startup. An expired session returns to sign-in without discarding the company URL.
- A native-to-JavaScript launch handoff with the “Preparing workspace…” progress treatment.
- A native POS home shell mirroring the SPA’s mobile structure: Invoice selector, item search/camera affordance, two-column catalogue cards, cart count, and static bottom navigation.
- Representative local item cards and cart count interaction only; Frappe bootstrap data, barcode scanning, cart review, and non-Home tabs are intentionally deferred.

## Next increments

1. Add a lightweight authenticated POS bootstrap client that uses the saved Frappe session and replaces the local catalogue preview.
2. Add barcode scanning and real cart review/checkout in focused increments.
3. Add account settings, including a safe company-URL change flow and sign-out.
