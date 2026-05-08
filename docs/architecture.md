# Architecture Documentation

## Real-time Notification Service

## Overview

A production-ready, multi-channel notification delivery service built with Node.js, Express, and Socket.IO. The service supports in-app, email, and push notifications with real-time delivery via WebSockets.

## System Architecture

```
                    +------------------+
                    |    Clients       |
                    | (Web/Mobile/CLI) |
                    +--------+---------+
                             |
              +--------------+--------------+
              |                             |
      +-------v-------+          +----------v----------+
      |   REST API    |          |   WebSocket (WS)    |
      |   (Express)   |          |    (Socket.IO)      |
      +-------+-------+          +----------+----------+
              |                             |
              +--------------+--------------+
                             |
                    +--------v---------+
                    |  Service Layer   |
                    |                  |
                    | - Delivery       |
                    | - Template       |
                    | - Preference     |
                    | - Scheduler      |
                    | - Analytics      |
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
      +-------v-----+ +------v------+ +----v----+
      |   Models    | |    Utils    | |  Routes  |
      |             | |             | |          |
      | Notification| | Pub/Sub     | |Notif.    |
      | Preference  | | Retry       | |Pref.     |
      | Template    | | Logger      | |Template  |
      +-------------+ +-------------+ +----------+
                             |
                    +--------v---------+
                    |   Middleware     |
                    |                  |
                    | - Auth (JWT)     |
                    | - Rate Limiter   |
                    | - Validator      |
                    +------------------+
```

## Component Breakdown

### 1. REST API Layer (`src/routes/`)

| Route | Description |
|-------|-------------|
| `POST /api/notifications` | Create and deliver notification |
| `POST /api/notifications/bulk` | Bulk notification delivery |
| `POST /api/notifications/schedule` | Schedule future delivery |
| `GET /api/notifications` | Query notifications with filters |
| `GET /api/notifications/unread-count/:userId` | Unread count |
| `PATCH /api/notifications/:id/read` | Mark as read |
| `PUT /api/preferences` | Update user preferences |
| `POST /api/preferences/mute` | Mute notifications |
| `GET /api/templates` | List templates |
| `POST /api/templates` | Create template |
| `GET /api/analytics/dashboard` | Dashboard metrics |

### 2. WebSocket Layer (`src/websocket/`)

| Event | Direction | Description |
|-------|-----------|-------------|
| `connection:established` | Server -> Client | Connection confirmed |
| `notification:incoming` | Server -> Client | New notification |
| `notification:read` | Client -> Server | Mark as read |
| `notification:read_receipt` | Server -> Client | Read confirmation |
| `notification:unread_count` | Server -> Client | Unread count update |
| `room:join` | Client -> Server | Join room |
| `room:leave` | Client -> Server | Leave room |
| `subscribe:topic` | Client -> Server | Subscribe to topic |
| `typing:start/stop` | Client -> Server | Typing indicators |

### 3. Service Layer (`src/services/`)

#### DeliveryService
- Orchestrates multi-channel delivery
- Manages in-memory notification store
- Tracks read/unread status
- Handles retry logic with circuit breakers
- Provides pagination and filtering

#### TemplateService
- CRUD for notification templates
- Variable interpolation with defaults
- Conditional rendering
- Localization support
- Template cloning and versioning

#### PreferenceService
- Per-user channel preferences
- Quiet hours with timezone support
- Sender blocking
- Category-based filtering
- Batch configuration
- Mute/unmute controls

#### SchedulerService
- Delayed notification delivery
- Cron-based recurring schedules
- Schedule management (cancel, reschedule)
- Priority-aware processing

#### AnalyticsService
- Event tracking
- Time-based aggregation (hourly/daily)
- User engagement metrics
- Channel performance comparison
- CSV/JSON export

### 4. Models (`src/models/`)

#### Notification
```
id, userId, title, body, channel, priority, status,
createdAt, updatedAt, scheduledFor, deliveredAt, readAt,
expiresAt, metadata, tags, category, retryCount, isRead
```

**Status Lifecycle:**
```
pending -> queued -> delivering -> delivered -> read
                   |-> retrying -> delivering
                   |-> failed
                   |-> cancelled
scheduled -> delivering (when due)
```

#### UserPreference
```
userId, inApp, email, push, quietHours, batching,
categories, blockedSenders, muteUntil
```

**Delivery Decision Matrix:**
```
shouldDeliver = !isMuted 
  && isChannelEnabled 
  && isCategoryEnabled
  && !isInQuietHours (or isUrgent)
  && !isBlocked
```

#### Template
```
id, name, version, channel, category, content {subject, body, html, actionUrl},
variables, conditions, localizations, tags, isActive
```

### 5. Utility Modules (`src/utils/`)

#### PubSub
- Redis-like in-memory pub/sub
- Topic and pattern subscriptions
- Message history
- Namespaces for isolation

#### Retry
- Exponential backoff with jitter
- Circuit breaker pattern
- Configurable max attempts
- Retryable error classification

#### Logger
- Winston-based structured logging
- Environment-aware formatting
- Request context tracking

### 6. Middleware (`src/middleware/`)

#### Auth
- JWT token authentication
- API key authentication
- Development bypass
- Role-based authorization

#### RateLimiter
- Sliding window algorithm
- Per-user notification limits
- Batch operation limits
- WebSocket connection limits

#### Validator
- Joi schema validation
- Custom types (ISO date, UUID)
- Separate schemas per endpoint

## Data Flow

### Notification Delivery Flow

```
1. Client POST /api/notifications
   |
2. Auth + Rate Limit + Validation
   |
3. DeliveryService.createAndDeliver()
   |
4. PreferenceService.shouldDeliver() check
   |
5. Channel-specific delivery:
   - in_app: immediate + WS broadcast
   - email: simulated (retry + circuit breaker)
   - push: simulated (retry + circuit breaker)
   |
6. PubSub.publish() for real-time updates
   |
7. AnalyticsService.trackEvent()
   |
8. Response to client
```

### WebSocket Real-time Flow

```
1. Client connects via Socket.IO
   |
2. WS Auth Middleware validates token
   |
3. RoomManager registers user socket
   |
4. Join user-specific room
   |
5. Subscribe to PubSub channel
   |
6. Push unread count
   |
7. Ready for real-time notifications
```

## Design Patterns

1. **Strategy Pattern**: Channel delivery strategies (in_app, email, push)
2. **Observer Pattern**: Pub/Sub for real-time updates
3. **Circuit Breaker**: Prevent cascading failures in delivery
4. **Repository Pattern**: In-memory stores with clear interfaces
5. **Factory Pattern**: Model creation with defaults
6. **Singleton**: Logger, RoomManager, PubSub instances

## Scaling Considerations

- Replace in-memory stores with Redis
- Add database persistence layer (PostgreSQL/MongoDB)
- Horizontal scaling with Redis Adapter for Socket.IO
- Message queue (RabbitMQ/Kafka) for delivery
- Dedicated email service (AWS SES/SendGrid)
- Push notification service (FCM/APNs)
- Add monitoring (Prometheus/Grafana)

## Configuration

All configuration is environment-driven via `src/config.js`:
- Server port and host
- WebSocket settings
- Rate limiting parameters
- Retry configuration
- Batch processing limits
- Scheduler intervals
- JWT settings
- Logging levels
