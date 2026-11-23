# PizzaHub – Backend API

The backend API for PizzaHub, a pizza ordering and delivery platform. Built with Node.js and Express.js, it provides REST APIs for menu management, customer orders, vendor dashboards, admin management, image uploads, favorites, and vendor Premium payments.

## Live Project

- **Frontend:** https://pizza-hub-swart-nine.vercel.app/
- **Backend API:** https://pizzahub-server-p6cs.onrender.com

## Technology Stack

- Node.js
- Express.js
- MongoDB
- Better Auth JWT Authentication
- JOSE for JWT and JWKS verification
- Stripe Checkout and Webhooks
- ImgBB Image Hosting
- Multer for image uploads
- CORS
- dotenv

## Main Features

### Authentication and Authorization

- Verifies authentication tokens issued by Better Auth using its JWKS endpoint.
- Supports role-based access for customers, vendors, and administrators.
- Protects restricted API routes.
- Checks blocked account status.
- Validates resource ownership before allowing users to modify their records.

### Menu Management

- Public menu browsing with search, category filtering, location filtering, and price sorting.
- Displays approved menu items.
- Vendors can create, update, and manage their own menu items.
- New menu items are submitted with pending status for admin review.
- Free vendors can manage up to three active menu items.
- Premium vendors can manage unlimited menu items.

### Order Management

- Customers can place orders and view their order history.
- Prevents duplicate active orders for the same item and delivery date.
- Customers can cancel their own pending orders.
- Vendors can view and manage orders associated with their menu items.
- Validates order information and resource ownership.

### Vendor Dashboard

- Vendor overview and order statistics.
- Vendor profile management.
- Menu item management and availability controls.
- Premium plan information.

### Admin Management

- User search and role filtering.
- Menu item review and approval management.
- Menu item status updates and deletion.
- Transaction history viewing.

### Payments and Premium Plan

- Stripe Checkout integration for vendor Premium upgrades.
- Stripe webhook signature verification.
- Activates Premium only after a verified successful payment.
- Records successful and unsuccessful payment transactions.
- Premium access is granted for 30 days after successful payment.

### Image Uploads and Favorites

- Uploads images to ImgBB.
- Supports image file and base64 uploads.
- Validates image uploads and enforces a 5 MB file-size limit.
- Customers can add and remove favorite menu items.

## Project Structure

```text
pizzahub-server/
├── config/
│   └── db.js
├── constants/
├── middleware/
│   ├── verifyJWT.js
│   └── requireRole.js
├── routes/
│   ├── admin.js
│   ├── favorites.js
│   ├── menuItems.js
│   ├── orders.js
│   ├── payments.js
│   ├── upload.js
│   ├── vendor.js
│   └── webhook.js
├── scripts/
│   └── seed-admin.js
├── .env.example
├── .gitignore
├── index.js
├── package.json
└── README.md
```
