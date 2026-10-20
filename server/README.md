# Chatgram Backend

## Overview
Node.js + Express + Socket.io backend for the Chatgram cross-platform messaging app.

## Features Implemented
- **Authentication System**
  - User registration (phone/email + password)
  - Secure login with JWT tokens
  - Token refresh endpoint
  - Protected routes middleware
  - Password hashing with bcrypt
- **Data Models**
  - User: Profile information with secure password storage
  - Chat: Supports direct and group chats
  - Message: Text and media messages with delivery/read receipts
  - Status: 24h disappearing stories using MongoDB TTL
- **API Endpoints**
  - Auth: `/api/auth/*` (register, login, refresh, profile, logout)
  - Users: `/api/users/*` (get contacts, search, profile update)
- **Middleware**
  - JWT authentication protection
  - Error handling
  - Security headers (helmet)
  - CORS configuration
  - Request size limits
- **Real-time Layer**
  - Socket.io setup with connection handling
  - Authentication middleware for sockets (to be implemented)

## Project Structure
```
/src
  /controllers    - Request handlers (authController.js, userController.js)
  /models         - Mongoose schemas (User.js, Chat.js, Message.js, Status.js)
  /routes         - API route definitions (authRoutes.js, userRoutes.js)
  /middleware     - Custom middleware (auth.js, errorHandler.js)
  /utils          - Utility functions (db.js)
  server.js       - Entry point
```

## Environment Variables
Create a `.env` file with:
```
NODE_ENV=development
PORT=5001
MONGODB_URI=mongodb://localhost:27017/chatgram
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=1d
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-in-production
JWT_REFRESH_EXPIRES_IN=30d
CLIENT_URL=http://localhost:3000
MAX_FILE_SIZE=10mb
```

## Installation
```bash
npm install
```

## Available Scripts
- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run tests (placeholder)

## API Documentation

### Authentication Routes
```
POST /api/auth/register
  Body: { displayName, phone/email, password }
  Returns: User object + accessToken + refreshToken

POST /api/auth/login
  Body: { phone/email, password }
  Returns: User object + accessToken + refreshToken

POST /api/auth/refresh
  Body: { token }
  Returns: { accessToken }

GET /api/auth/me
  Headers: Authorization: Bearer <accessToken>
  Returns: User object (password removed)

POST /api/auth/logout
  Headers: Authorization: Bearer <accessToken>
  Returns: { message }
```

### User Routes (Protected)
```
GET /api/users
  Returns: Array of user objects (excluding current user)

GET /api/users/search?query=<searchterm>
  Returns: Array of matching users

GET /api/users/:id
  Returns: User object by ID

PUT /api/users/:id
  Headers: Authorization: Bearer <accessToken>
  Body: { displayName, about }
  Returns: Updated user object

POST /api/users/:id/avatar
  Headers: Authorization: Bearer <accessToken>
  Returns: Placeholder (to be implemented with multer)
```

## Next Steps Planned
1. Complete Socket.io implementation for real-time messaging
2. Add chat and message controllers/routes
3. Implement media upload functionality
4. Add presence and typing indicators
5. Implement group chat functionality
6. Add Status/Stories feature
7. Implement push notifications (FCM for Android)
8. Add comprehensive error handling and validation
9. Write unit and integration tests
10. Add API documentation with Swagger/OpenAPI