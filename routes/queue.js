const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { io } = require('../server');
const { authenticateRestaurant } = require('../middleware/auth');

// Get real-time queue for restaurant
router.get('/', authenticateRestaurant, async (req, res) => {
  try {
    const restaurantId = req.restaurantId;

    const result = await db.query(
      `SELECT 
        id,
        phone,
        party_size,
        status,
        created_at,
        notified_at,
        seated_at,
        no_show_reason
      FROM waitlists
      WHERE restaurant_id = $1 AND status IN ('waiting', 'notified')
      ORDER BY 
        CASE WHEN status = 'notified' THEN 0 ELSE 1 END,
        created_at ASC`,
      [restaurantId]
    );

    const queue = result.rows.map((row, index) => ({
      id: row.id,
      position: index + 1,
      phone: maskPhone(row.phone),
      partySize: row.party_size,
      status: row.status,
      joinedAt: row.created_at,
      notifiedAt: row.notified_at,
      seatedAt: row.seated_at,
      waitTimeMinutes: Math.floor(
        (new Date() - row.created_at) / 60000
      )
    }));

    res.json({
      success: true,
      queue,
      totalWaiting: queue.filter(q => q.status === 'waiting').length,
      totalNotified: queue.filter(q => q.status === 'notified').length
    });
  } catch (error) {
    console.error('Error fetching queue:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch queue' });
  }
});

// Mark next customer as notified and send SMS
router.post('/next', authenticateRestaurant, async (req, res) => {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const restaurantId = req.restaurantId;

    // Find next waiting customer
    const nextCustomerResult = await client.query(
      `SELECT id, phone, party_size, created_at
       FROM waitlists
       WHERE restaurant_id = $1 AND status = 'waiting'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE`,
      [restaurantId]
    );

    if (nextCustomerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({
        success: false,
        message: 'No customers waiting'
      });
    }

    const customer = nextCustomerResult.rows[0];
    const waitTimeMinutes = Math.floor(
      (new Date() - customer.created_at) / 60000
    );

    // Update customer to notified status
    const updateResult = await client.query(
      `UPDATE waitlists
       SET status = 'notified', notified_at = NOW()
       WHERE id = $1
       RETURNING id, phone, party_size, notified_at`,
      [customer.id]
    );

    await client.query('COMMIT');

    const updatedCustomer = updateResult.rows[0];

    // Send SMS notification via Twilio
    const Twilio = require('twilio');
    const twilio = Twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const restaurantResult = await db.query(
      'SELECT phone_number FROM restaurants WHERE id = $1',
      [restaurantId]
    );
    const restaurantPhone = restaurantResult.rows[0].phone_number;

    await twilio.messages.create({
      body: `Great news! Your table for ${customer.party_size} is ready. Please come to the host stand. If you don't arrive in 5 minutes, your spot will be released.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: customer.phone
    });

    // Broadcast queue update via WebSocket
    io.to(`restaurant_${restaurantId}`).emit('queue_updated', {
      action: 'customer_notified',
      customerId: customer.id,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Customer notified',
      customer: {
        id: customer.id,
        phone: maskPhone(customer.phone),
        partySize: customer.party_size,
        waitTimeMinutes
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error notifying next customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to notify customer'
    });
  } finally {
    client.release();
  }
});

// Mark customer as seated
router.post('/:id/seated', authenticateRestaurant, async (req, res) => {
  try {
    const restaurantId = req.restaurantId;
    const customerId = req.params.id;

    const result = await db.query(
      `UPDATE waitlists
       SET status = 'seated', seated_at = NOW()
       WHERE id = $1 AND restaurant_id = $2
       RETURNING id, status`,
      [customerId, restaurantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Broadcast update
    io.to(`restaurant_${restaurantId}`).emit('queue_updated', {
      action: 'customer_seated',
      customerId,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Customer marked as seated'
    });
  } catch (error) {
    console.error('Error marking customer as seated:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update customer status'
    });
  }
});

// Remove customer from queue (manual cancellation)
router.delete('/:id', authenticateRestaurant, async (req, res) => {
  try {
    const restaurantId = req.restaurantId;
    const customerId = req.params.id;
    const { reason } = req.body;

    const result = await db.query(
      `UPDATE waitlists
       SET status = 'no_show', no_show_reason = $1
       WHERE id = $2 AND restaurant_id = $3
       RETURNING id, phone, status`,
      [reason || 'manually_removed', customerId, restaurantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const customer = result.rows[0];

    // Send SMS notification to customer if applicable
    if (reason !== 'no_response') {
      const Twilio = require('twilio');
      const twilio = Twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      try {
        await twilio.messages.create({
          body: 'Your reservation has been cancelled. Thank you for your interest!',
          from: process.env.TWILIO_PHONE_NUMBER,
          to: customer.phone
        });
      } catch (smsError) {
        console.error('Error sending cancellation SMS:', smsError);
      }
    }

    // Broadcast update
    io.to(`restaurant_${restaurantId}`).emit('queue_updated', {
      action: 'customer_removed',
      customerId,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Customer removed from queue'
    });
  } catch (error) {
    console.error('Error removing customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove customer'
    });
  }
});

// Get customer details (for debugging/verification)
router.get('/:id', authenticateRestaurant, async (req, res) => {
  try {
    const restaurantId = req.restaurantId;
    const customerId = req.params.id;

    const result = await db.query(
      `SELECT 
        id,
        phone,
        party_size,
        status,
        created_at,
        notified_at,
        seated_at,
        no_show_reason
       FROM waitlists
       WHERE id = $1 AND restaurant_id = $2`,
      [customerId, restaurantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      customer: {
        id: row.id,
        phone: maskPhone(row.phone),
        partySize: row.party_size,
        status: row.status,
        joinedAt: row.created_at,
        notifiedAt: row.notified_at,
        seatedAt: row.seated_at,
        noShowReason: row.no_show_reason,
        waitTimeMinutes: Math.floor(
          (new Date() - row.created_at) / 60000
        )
      }
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer details'
    });
  }
});

// Utility function to mask phone number
function maskPhone(phone) {
  if (!phone || phone.length < 4) return phone;
  return `***-***-${phone.slice(-4)}`;
}

module.exports = router;