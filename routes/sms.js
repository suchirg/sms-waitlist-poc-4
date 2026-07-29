const express = require('express');
const twilio = require('twilio');
const router = express.Router();
const db = require('../db');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const PARTY_SIZE_REGEX = /(?:party of|for|group of|table of)\s+(\d+)|(\d+)\s+(?:people|person|guests?)/i;

function parsePartySize(message) {
  const match = message.match(PARTY_SIZE_REGEX);
  if (match) {
    return parseInt(match[1] || match[2], 10);
  }
  const singleDigit = message.match(/^\d+$/);
  if (singleDigit) {
    return parseInt(singleDigit[0], 10);
  }
  return null;
}

function validatePhoneNumber(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  if (cleaned.length === 11 && cleaned[0] === '1') {
    return `+${cleaned}`;
  }
  if (cleaned.length === 11) {
    return `+1${cleaned.slice(1)}`;
  }
  return null;
}

async function getRestaurantByPhoneNumber(phoneNumber) {
  try {
    const result = await db.query(
      'SELECT id, name, phone_number FROM restaurants WHERE phone_number = $1',
      [phoneNumber]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching restaurant:', error);
    throw error;
  }
}

async function getWaitlistPosition(restaurantId) {
  try {
    const result = await db.query(
      `SELECT COUNT(*) as position FROM waitlists 
       WHERE restaurant_id = $1 AND status IN ('waiting', 'notified') 
       ORDER BY created_at ASC`,
      [restaurantId]
    );
    return parseInt(result.rows[0].position, 10);
  } catch (error) {
    console.error('Error getting waitlist position:', error);
    throw error;
  }
}

async function createWaitlistEntry(restaurantId, phone, partySize) {
  try {
    const result = await db.query(
      `INSERT INTO waitlists (restaurant_id, phone, party_size, status, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, created_at`,
      [restaurantId, phone, partySize, 'waiting']
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error creating waitlist entry:', error);
    throw error;
  }
}

async function sendSMS(toPhone, message) {
  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: toPhone,
    });
    console.log(`SMS sent to ${toPhone}: ${result.sid}`);
    return result.sid;
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}

router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const incomingPhone = req.body.From;
    const incomingMessage = (req.body.Body || '').trim();

    console.log(`Received SMS from ${incomingPhone}: ${incomingMessage}`);

    if (!incomingPhone || !incomingMessage) {
      console.warn('Missing From or Body in Twilio webhook');
      const twiml = new twilio.twiml.MessagingResponse();
      return res.type('text/xml').send(twiml.toString());
    }

    const normalizedPhone = validatePhoneNumber(incomingPhone);
    if (!normalizedPhone) {
      console.warn(`Invalid phone number format: ${incomingPhone}`);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('Sorry, we could not process your request. Please try again.');
      return res.type('text/xml').send(twiml.toString());
    }

    const restaurant = await getRestaurantByPhoneNumber(process.env.TWILIO_PHONE_NUMBER);
    if (!restaurant) {
      console.warn(`No restaurant found for phone: ${process.env.TWILIO_PHONE_NUMBER}`);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('Sorry, we could not process your request. Please contact the restaurant.');
      return res.type('text/xml').send(twiml.toString());
    }

    const partySize = parsePartySize(incomingMessage);
    if (!partySize || partySize < 1 || partySize > 20) {
      console.warn(`Invalid party size parsed: ${partySize}`);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(
        `Hi! To join our waitlist, please text back with your party size. For example: "party of 4" or "2 people".`
      );
      return res.type('text/xml').send(twiml.toString());
    }

    const position = await getWaitlistPosition(restaurant.id);
    const nextPosition = position + 1;

    const entry = await createWaitlistEntry(restaurant.id, normalizedPhone, partySize);

    const confirmationMessage = `Hi! You're #${nextPosition} in line at ${restaurant.name}. Party of ${partySize}. We'll text you when your table is ready. Estimated wait: varies by availability.`;

    await sendSMS(normalizedPhone, confirmationMessage);

    console.log(
      `Waitlist entry created for ${normalizedPhone}: party size ${partySize}, position ${nextPosition}`
    );

    const twiml = new twilio.twiml.MessagingResponse();
    return res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('Error in SMS webhook:', error);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Sorry, something went wrong. Please try again later.');
    return res.type('text/xml').send(twiml.toString());
  }
});

module.exports = router;