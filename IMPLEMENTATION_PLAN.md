# Chatgram Implementation Plan

## Technical Architecture Overview

### Client (Flutter)
- **Framework**: Flutter SDK for cross-platform compilation
- **State Management**: Provider or Riverpod (to be decided)
- **Networking**: 
  - Socket.io client for real-time communication
  - HTTP client (dio) for REST API calls
- **Local Storage**: Shared preferences or Hive for caching
- **Authentication**: JWT token storage with refresh mechanism
- **Media Handling**: image_picker, video_player, just_audio
- **Notifications**: 
  - Android: firebase_messaging (FCM)
  - Windows/Local: flutter_local_notifications
- **UI**: Material Design with custom WhatsApp-like theme

### Server (Node.js)
- **Runtime**: Node.js with Express.js
- **Real-time**: Socket.io for WebSocket connections
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (access/refresh tokens), bcrypt hashing
- **Media Storage**: Local file system (Express static) - MVP
- **API Design**: RESTful endpoints for initial data fetching
- **Real-time Events**: Socket.io namespaces/rooms per chat

## Phase-by-Phase Implementation Breakdown

### Phase 1: Foundation & Authentication (Weeks 1-2)
**Goals**: Set up project structure, user registration/login, basic API
**Client**:
- Initialize Flutter project
- Set up navigation and basic UI themes
- Create auth screens (login, register, verify)
- Implement JWT storage and refresh logic
- Basic Socket.io connection setup
**Server**:
- Initialize Node.js project with Express
- Set up MongoDB connection
- Create User model with bcrypt password hashing
- Implement auth routes (register, login, refresh, logout)
- JWT middleware for protected routes
- Basic Socket.io connection handling
**Dependencies**:
- Client: flutter, http, shared_provider, socket_io_client
- Server: express, mongoose, bcryptjs, jsonwebtoken, socket.io

### Phase 2: 1:1 Messaging Core (Weeks 3-4)
**Goals**: Enable real-time text messaging between two users
**Client**:
- Chat list screen showing recent conversations
- Chat detail screen with message input
- Message bubbles (sent/received)
- Text input field with send button
- Socket.io event handling for messaging
**Server**:
- Chat and Message models
- Socket.io room management per chat
- Message persistence to MongoDB
- Delivery/read receipts implementation
- Message broadcasting to room participants
**Dependencies**: 
- Additional: firebase_messaging (setup only), intl

### Phase 3: Presence & Typing Indicators (Week 5)
**Goals**: Show online/offline status and typing indicators
**Client**:
- Presence indicator in chat list and chat header
- Typing indicator UI in chat detail
- Socket.io events for typing start/stop
- Online/offline status with grace period
**Server**:
- User online status tracking
- Socket.io connection/disconnection handling
- Presence broadcasting with 10s grace period
- Typing event forwarding to room participants

### Phase 4: Group Chat (Weeks 6-7)
**Goals**: Enable group creation and messaging
**Client**:
- Group creation screen (name, avatar, participants)
- Group info screen (members, settings)
- Adapted chat UI for group context
- Admin controls (add/remove members)
**Server**:
- Enhanced Chat model with group fields
- Group creation validation
- Member management endpoints
- Socket.io room handling for group chats
- Admin permission checks

### Phase 5: Status/Stories Feature (Weeks 8-9)
**Goals**: 24h disappearing status updates
**Client**:
- Status tab with circular avatars
- Status creation screen (text/image)
- Status viewer with swipe/dismiss gestures
- 24h timer visualization
- Story progress indicators
**Server**:
- Status model with expiresAt TTL index
- Status creation/upload endpoints
- Status retrieval for contacts
- ViewedBy tracking
- Automatic cleanup via MongoDB TTL
**Dependencies**:
- Client: story_view or stories_for_flutter package
- Additional: image_picker for media status

### Phase 6: Media Messaging (Weeks 10-11)
**Goals**: Send/receive images, videos, voice notes
**Client**:
- Media picker integration (gallery/camera)
- Message type selectors (text, image, video, audio, file)
- Media preview before sending
- Inline media playback in chat
- Download/save functionality
**Server**:
- Media upload endpoints (multipart/form-data)
- Media storage in local filesystem
- Security validation (file types, size limits)
- Media URL generation and serving
- Message model enhancement for media types

### Phase 7: Notifications (Week 12)
**Goals**: Push notifications for Android, local for Windows
**Client**:
- FCM setup and token handling
- Background message handling
- Local notification scheduling
- Notification tapping to open specific chats
**Server**:
- FCM integration (admin SDK) for Android pushes
- Notification triggering on new messages
- Topic-based messaging for efficiency
- Windows: Local notification fallback

### Phase 8: Polish & Enhancements (Weeks 13-14)
**Goals**: Search, archiving, muting, profile editing, final polishing
**Client**:
- Message/search functionality
- Chat archiving/swipe actions
- Mute notifications per chat
- Profile editing screen
- Avatar upload/crop
- Settings/preferences screen
- Performance optimization
**Server**:
- Search indices for messages
- Archive/mute flags in chat model
- Profile update endpoints
- Media cleanup utilities

## Data Model Specifications

### User Model
```javascript
{
  _id: ObjectId,
  phone: String (unique, sparse),
  email: String (unique, sparse),
  passwordHash: String,
  displayName: String,
  avatarUrl: String,
  about: String,
  lastSeen: Date,
  isOnline: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Chat Model
```javascript
{
  _id: ObjectId,
  type: Enum['direct', 'group'],
  participants: [ObjectId], // References to User
  groupName: String (null for direct),
  groupAvatar: String (null for direct),
  groupAdmins: [ObjectId] (null for direct),
  createdAt: Date,
  updatedAt: Date
}
```

### Message Model
```javascript
{
  _id: ObjectId,
  chatId: ObjectId,
  senderId: ObjectId,
  type: Enum['text', 'image', 'video', 'audio', 'file'],
  content: String, // For text or caption
  mediaUrl: String (nullable),
  sentAt: Date,
  deliveredTo: [ObjectId], // User IDs who received
  readBy: [ObjectId], // User IDs who read
}
```

### Status Model
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  text: String (nullable),
  mediaUrl: String (nullable),
  createdAt: Date,
  expiresAt: Date (createdAt + 24h),
  viewedBy: [ObjectId]
}
```

## API Endpoints Specification

### Authentication
- POST `/api/auth/register` - User registration
- POST `/api/auth/login` - User login
- POST `/api/auth/refresh` - Refresh access token
- POST `/api/auth/logout` - User logout
- GET `/api/auth/me` - Get current user profile

### Users
- GET `/api/users/search?query=` - Search users by name/phone
- GET `/api/users/:id` - Get user profile
- PUT `/api/users/:id` - Update profile
- POST `/api/users/:id/avatar` - Upload avatar

### Chats
- GET `/api/chats` - Get user's chat list
- POST `/api/chats` - Create new chat (direct/group)
- GET `/api/chats/:id` - Get chat details
- PUT `/api/chats/:id` - Update chat (group name/avatar)
- DELETE `/api/chats/:id` - Delete/archive chat
- POST `/api/chats/:id/participants` - Add participants
- DELETE `/api/chats/:id/participants/:userId` - Remove participant

### Messages
- GET `/api/messages?chatId=&limit=&before=` - Fetch chat history
- POST `/api/messages/media` - Upload media file
- (Real-time messaging via Socket.io)

### Status
- GET `/api/status` - Get contacts' statuses
- POST `/api/status` - Create new status
- DELETE `/api/status/:id` - Delete status
- POST `/api/status/:id/view` - Mark status as viewed

## Socket.io Events Specification

### Connection
- Client emits: `authenticate` (with JWT)
- Server emits: `authenticated` or `auth_error`

### Rooms
- Client joins: `room:chat-{chatId}`
- Server manages room membership based on chat participants

### Messaging
- Client emits: `message:send` (with message data)
- Server emits: `message:new` (to room)
- Client emits: `message:delivered` (to server)
- Server emits: `message:delivered` (to sender)
- Client emits: `message:read` (to server)
- Server emits: `message:read` (to room)

### Presence
- Server emits: `presence:online` (userId)
- Server emits: `presence:offline` (userId, lastSeen)
- Client emits: `typing:start` (chatId)
- Client emits: `typing:stop` (chatId)
- Server emits: `typing:start` (chatId, userId)
- Server emits: `typing:stop` (chatId, userId)

## Dependencies & Packages

### Flutter Client
- **Core**: flutter, flutter_localizations
- **State Management**: provider or riverpod
- **Networking**: dio, socket_io_client
- **Local Storage**: shared_preferences or hive
- **Authentication**: jwt_decode
- **Media**: image_picker, video_player, just_audio, photo_view
- **Notifications**: firebase_messaging, flutter_local_notifications
- **UI**: cached_network_image, intl, flutter_svg
- **Utils**: uuid, mime_type
- **Status Stories**: story_view or stories_for_flutter

### Node.js Server
- **Core**: express, mongoose
- **Real-time**: socket.io, socket.io-redis (for scaling)
- **Authentication**: bcryptjs, jsonwebtoken
- **Validation**: joi or express-validator
- **File Handling**: multer, fs-extra
- **Security**: helmet, cors, rate-limiter-flexible
- **Utilities**: lodash, moment-timezone
- **FCM**: firebase-admin (for push notifications)
- **Monitoring**: winston (logging), express-status-monitor

## Risks & Mitigation Strategies

### Technical Risks
1. **Real-time Connection Reliability**
   - Risk: Socket.io connection drops causing message loss
   - Mitigation: Implement message queuing with local storage and retry mechanism
   
2. **Media Storage Scalability**
   - Risk: Local disk storage limits growth
   - Mitigation: Design abstraction layer for easy swap to S3-compatible storage
   
3. **Cross-platform Consistency**
   - Risk: Different behavior on Android vs Windows
   - Mitigation: Comprehensive platform testing, conditional UI where needed

### Security Risks
1. **Authentication Token Security**
   - Risk: JWT token theft or misuse
   - Mitigation: Secure token storage, short-lived access tokens, refresh token rotation
   
2. **Media Upload Security**
   - Risk: Malicious file uploads
   - Mitigation: File type validation, size limits, virus scanning (future), sandboxed storage

### Performance Risks
1. **Message History Loading**
   - Risk: Slow loading of long chat histories
   - Mitigation: Pagination, efficient database indexing, message compression
   
2. **Presence Updates Overload**
   - Risk: Excessive presence events causing bandwidth issues
   - Mitigation: Debounce presence updates, batch updates

## Testing Approach

### Unit Testing
- **Client**: Widget testing for UI components, unit tests for business logic
- **Server**: Model validation, service function testing, controller logic
- **Tools**: flutter_test, jest/mocha, sinon

### Integration Testing
- **Client**: Integration tests for auth flow, messaging flow
- **Server**: API endpoint testing, database integration, Socket.io event handling
- **Tools**: integration_test, supertest

### End-to-End Testing
- **Critical paths**: User registration → login → messaging → logout
- **Cross-platform**: Android emulator + Windows desktop
- **Tools**: flutter drive, appium (future consideration)

### Test Coverage Goals
- Minimum 80% coverage for business logic
- Critical paths: Auth, Messaging, Presence
- UI tests for key screens

## File Structure Recommendations

### Client (Flutter)
```
/lib
  /main.dart
  /core
    /utils
    /constants
    /routes.dart
    /theme.dart
  /features
    /auth
      /screens
      /widgets
      /services
      /models
    /chat
      /screens
      /widgets
      /services
      /models
    /status
      /screens
      /widgets
      /services
      /models
    /contacts
      /screens
      /widgets
      /services
    /settings
      /screens
      /widgets
      /services
  /shared
    /widgets
    /services
      /socket_service.dart
      /auth_service.dart
      /notification_service.dart
    /models
      /user_model.dart
      /chat_model.dart
      /message_model.dart
      /status_model.dart
    /utils
      /helpers.dart
      /validators.dart
```

### Server (Node.js)
```
/server
  /src
    /index.js
    /app.js
    /config
      /database.js
      /socket.js
      /passport.js
    /middleware
      /auth.js
      /validation.js
      /errorHandler.js
    /controllers
      /authController.js
      /userController.js
      /chatController.js
      /messageController.js
      /statusController.js
    /routes
      /authRoutes.js
      /userRoutes.js
      /chatRoutes.js
      /messageRoutes.js
      /statusRoutes.js
    /models
      /User.js
      /Chat.js
      /Message.js
      /Status.js
    /services
      /authService.js
      /chatService.js
      /messageService.js
      /statusService.js
      /notificationService.js
    /sockets
      /chatSocket.js
      /presenceSocket.js
    /utils
      /helpers.js
      /constants.js
  /uploads
    /avatars
    /media
    /status
  /tests
    /unit
    /integration
```

## Milestones & Success Criteria

### Milestone 1: Authentication Working (End of Week 2)
- Users can register, login, logout
- JWT tokens properly handled
- Protected routes secured
- Basic user profile management

### Milestone 2: Basic 1:1 Messaging (End of Week 4)
- Real-time text messaging between two users
- Message persistence in MongoDB
- Delivery and read receipts working
- Basic chat UI functional

### Milestone 3: Core Communication Features (End of Week 6)
- Presence/online status working
- Typing indicators functional
- Group chat creation and messaging
- Basic group management

### Milestone 4: Multimedia Features (End of Week 10)
- Status/Stories feature complete with 24h TTL
- Media messaging (images, video, audio) working
- Media upload/download functional

### Milestone 5: Complete MVP (End of Week 14)
- Push notifications (Android FCM) working
- Local notifications (Windows) functional
- All polish features: search, archiving, muting, profile editing
- Performance optimized
- Ready for beta testing

## Next Steps

1. **Immediate**: Set up development environment
   - Install Flutter SDK
   - Install Node.js
   - Set up MongoDB (local or Atlas)
   - Configure Firebase project for FCM

2. **Short-term**: Begin Phase 1 implementation
   - Create Flutter project structure
   - Initialize Node.js server
   - Implement authentication system

3. **Ongoing**: Regular code reviews and testing
   - Follow TDD approach: write tests first
   - Conduct code reviews after each feature
   - Maintain documentation