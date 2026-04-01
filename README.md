# Vinod Industries Website

A Next.js website for Vinod Industries, a textile manufacturing company.

## Features

- Home page with company overview
- Products page showcasing Poplin under Kothari Gold brand
- Manufacturing process gallery
- Contact page with company details

## Getting Started

First, install dependencies:

```bash
npm install
```

Then, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Build for Production

To build the static site for hosting:

```bash
npm run build
```

The output will be in the `out` directory, ready for deployment to infinityfree.com.

## Deployment

Upload the contents of the `out` directory to your hosting provider.

## Notes

- Placeholder images and contact details need to be replaced with actual content.
- Products can be added by modifying the `products` array in `app/products/page.tsx`.


- in new fold program , select lot--> in search area
- Go to Balance Stock → tap "☑ Bulk Mark Used" (amber button, top right)
An amber banner appears explaining bulk mode
Expand any party → each lot card now has a checkbox on the left
Check the lots you want to mark → a Than input + optional Note field appears inline
Enter quantities for each checked lot
A sticky footer at the bottom shows X lots selected + "Save X lots" button
Tap Save → all reservations saved in one transaction → page refreshes
Lots now show amber "Used: X" badge and reduced Avail count
These lots disappear (or show reduced quantity) in New Fold Program's lot picker