# SMS Waitlist POC

A simple SMS-based waitlist management system for independent restaurants and cafes. Customers text to join the queue, owners manage the waitlist via a web dashboard with real-time analytics.

## Quick Start

### Prerequisites
- Node.js 16+
- PostgreSQL 12+
- Twilio account with SMS capability
- Git

### Installation

1. **Clone and install dependencies**
```bash
git clone <repository-url>
cd sms-waitlist-poc
npm install
```

2. **Set up database**
```bash
createdb sms_waitlist_poc
psql sms_waitlist_poc < db/schema.sql
```

3. **Configure environment variables**
```bash
cp .env.example .env
```

Edit `.env` with your values:
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/sms_waitlist_poc
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
RESTAURANT_API_KEY=dev_key_12345
RESTAURANT_ID=1
ANALYTICS_RESET_TIME=11:00
```

4. **Start the server**
```bash
npm start
```

The dashboard will be available at `http://localhost:3000`

## Features

### For Customers
- **Text to Join:** Customers text the restaurant number with "Party of 2" or similar
- **Instant Confirmation:** Automatic SMS confirmation with queue position
- **Ready Notification:** SMS when their table is ready to be seated

### For Owners
- **Real-Time Queue Dashboard:** See all waiting customers with phone, party size, and wait time
- **One-Click Service:** Click "Next" button to notify customer table is ready
- **Auto No-Show Handling:** System automatically marks customers as no-show after 5 minutes with no response
- **Manual Controls:** Manually remove customers if they call to cancel
- **Live Analytics:** Track total served, no-show rate, average wait time, and peak hours

## Architecture

### Tech Stack
- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Frontend:** React
- **SMS:** Twilio
- **Real-Time Updates:** Socket.io
- **Hosting:** Heroku/Railway compatible

### System Flow
1. Customer texts restaurant number with party size
2. Twilio webhook receives SMS → Backend creates waitlist entry
3. Customer receives confirmation SMS with queue position
4. Owner sees customer appear in dashboard queue
5. Owner clicks "Next" when table is ready
6. System sends "Table ready" SMS to customer
7. If customer doesn't respond in 5 minutes → marked as no-show, next customer notified
8. Owner clicks "Seated" to complete transaction
9. Analytics update in real-time

## Deployment

### One-Click Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new?repo=<repository-url>)

Or manual deployment:

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and link project
railway login
railway link

# Deploy
railway up
```

### Manual Deployment to Heroku

```bash
heroku create your-app-name
heroku addons:create heroku-postgresql:hobby-dev
git push heroku main
```

### Environment Variables Required
Set these in your hosting platform's dashboard:
- `DATABASE_URL` (automatically set by postgres addon)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `RESTAURANT_API_KEY`
- `RESTAURANT_ID`
- `ANALYTICS_RESET_TIME`

## API Reference

### SMS Webhook
**POST** `/sms/receive`
- Receives inbound SMS from Twilio
- Parses party size from message
- Creates waitlist entry and sends confirmation

### Queue Management
**GET** `/queue/:restaurantId`
- Returns current waitlist ordered by join time
- Requires valid API key in `Authorization` header

**POST** `/queue/:restaurantId/next`
- Marks current customer as notified
- Sends "table ready" SMS
- Returns updated queue

**DELETE** `/queue/:restaurantId/:customerId`
- Removes customer from waitlist
- Requires valid API key

**POST** `/queue/:restaurantId/:customerId/seated`
- Marks customer as seated
- Updates analytics

### Analytics
**GET** `/analytics/:restaurantId`
- Returns current metrics
- Query params: `period=daily|weekly`
- Response includes:
  - `seatedCount`: Customers seated in period
  - `noShowRate`: Percentage of no-shows
  - `avgWaitTime`: Average minutes from join to ready notification
  - `peakHour`: Busiest hour
  - `peakHourVolume`: Customer count at peak hour

## Dashboard Features

### Queue View (Left Panel)
- Real-time list of waiting customers
- Shows: position, phone number, party size, wait time
- "Next" button for each customer (or top customer only)
- Manual remove option
- Search/filter by phone number

### Analytics View (Right Panel)
- **Total Served:** Big number showing customers seated
- **No-Show Rate:** Percentage with color coding
  - Green: <10% (excellent)
  - Yellow: 10-20% (acceptable)
  - Red: >20% (needs attention)
- **Avg Wait Time:** Average minutes customers wait before notification
- **Peak Hour:** Time of day with most customers
- **Daily/Weekly Toggle:** Switch analytics time period

### Live Updates
- WebSocket connection updates queue and analytics in real-time
- No page refresh needed
- Dashboard updates automatically when customers join, get called, or seated

## Configuration

### Service Period Reset
By default, analytics reset daily at 11:00 AM (configurable via `ANALYTICS_RESET_TIME` environment variable).

To manually reset analytics:
**POST** `/analytics/:restaurantId/reset`

### Adding New Restaurants
1. Add entry to `restaurants` table:
```sql
INSERT INTO restaurants (name, phone_number, api_key, analytics_reset_time)
VALUES ('My Cafe', '+1234567890', 'unique_api_key_here', '11:00');
```

2. Use the returned `id` and `api_key` for API calls

## Troubleshooting

### SMS Not Arriving
1. Verify Twilio credentials in `.env`
2. Check Twilio SMS logs in console
3. Ensure restaurant phone number is in E.164 format (+1234567890)
4. Verify SMS capability is enabled in Twilio account

### Analytics Not Updating
1. Check that customers are being marked as "seated" not just "notified"
2. Verify `analytics_reset_time` is set correctly
3. Check database has data in the current service period
4. Manually trigger reset: `POST /analytics/:restaurantId/reset`

### WebSocket Connection Issues
1. Ensure Socket.io is enabled in Express server
2. Check browser console for connection errors
3. Verify firewall allows WebSocket connections

### Database Connection Issues
1. Verify PostgreSQL is running: `psql postgres`
2. Check `DATABASE_URL` format: `postgresql://user:pass@host:port/dbname`
3. Ensure database exists: `createdb sms_waitlist_poc`
4. Run migrations: `psql sms_waitlist_poc < db/schema.sql`

## Testing

### Local Testing with Twilio
1. Get Twilio test credentials from console
2. Use ngrok to expose local server: `ngrok http 3000`
3. Set Twilio webhook to `https://your-ngrok-url.ngrok.io/sms/receive`
4. Send SMS to Twilio test number
5. Check logs: `tail -f logs/sms.log`

### Manual Queue Testing
```bash
# Add test customer
curl -X POST http://localhost:3000/queue/1/test \
  -H "Authorization: Bearer dev_key_12345" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+14155552671", "party_size": 2}'

# Call next
curl -X POST http://localhost:3000/queue/1/next \
  -H "Authorization: Bearer dev_key_12345"

# Mark seated
curl -X POST http://localhost:3000/queue/1/123/seated \
  -H "Authorization: Bearer dev_key_12345"
```

## Production Checklist

- [ ] Database backups configured
- [ ] SMS rate limits set (Twilio)
- [ ] Error logging configured
- [ ] Analytics reset time verified for each location
- [ ] HTTPS enabled
- [ ] Database connection pooling enabled
- [ ] Rate limiting on API endpoints
- [ ] Monitoring/alerting set up
- [ ] Incident response plan documented
- [ ] Customer privacy policy updated (SMS data collection)

## Development

### Project Structure
```
├── server.js              # Express app setup
├── db/
│   └── schema.sql        # Database schema
├── routes/
│   ├── sms.js            # SMS webhook receiver
│   ├── queue.js          # Queue management endpoints
│   └── analytics.js      # Analytics endpoints
├── public/
│   ├── index.html        # Dashboard HTML
│   └── dashboard.jsx     # React dashboard component
└── .env.example          # Environment variable template
```

### Running Tests
```bash
npm test
```

### Code Style
This project uses standard Node.js conventions. Run linter:
```bash
npm run lint
```

## License

MIT

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review Twilio documentation: https://www.twilio.com/docs
3. Check PostgreSQL logs: `tail -f /var/log/postgresql/postgresql.log`

## Success Metrics

This POC will be considered successful when:
- ✅ 2-3 local cafes deploy and test for 1 week minimum
- ✅ System successfully sends/receives SMS messages
- ✅ At least 5 customers per location join via text
- ✅ Owner completes 3+ "table ready" notifications per location
- ✅ Analytics accurately track queue metrics
- ✅ Zero critical bugs during testing

## Roadmap (Phase 2)

- [ ] Multiple table management
- [ ] Walk-in customer support
- [ ] Online booking integration
- [ ] Advanced analytics (cohort analysis, predictions)
- [ ] Customer notifications during wait
- [ ] Custom branding
- [ ] Historical data retention
- [ ] Multi-location dashboard
- [ ] Staff app for table management