const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticateRestaurant } = require('../middleware/auth');

// GET /analytics - retrieve analytics metrics for current service period
router.get('/', authenticateRestaurant, async (req, res) => {
  try {
    const restaurantId = req.restaurant.id;
    const { period = 'daily' } = req.query;

    // Calculate service period boundaries
    const now = new Date();
    const resetTime = req.restaurant.analytics_reset_time || '11:00';
    const [resetHour, resetMinute] = resetTime.split(':').map(Number);

    let periodStart;
    if (period === 'weekly') {
      // Start of current week (Monday)
      periodStart = new Date(now);
      const day = periodStart.getDay();
      const diff = periodStart.getDate() - day + (day === 0 ? -6 : 1);
      periodStart.setDate(diff);
      periodStart.setHours(resetHour, resetMinute, 0, 0);
    } else {
      // Daily: from reset time today
      periodStart = new Date(now);
      periodStart.setHours(resetHour, resetMinute, 0, 0);

      // If current time is before reset time, start from yesterday
      if (now < periodStart) {
        periodStart.setDate(periodStart.getDate() - 1);
      }
    }

    // Fetch all metrics in one query
    const metricsQuery = `
      SELECT 
        COUNT(CASE WHEN status = 'seated' THEN 1 END)::INTEGER as seated_count,
        COUNT(CASE WHEN status = 'no_show' THEN 1 END)::INTEGER as no_show_count,
        COUNT(*)::INTEGER as total_processed,
        ROUND(AVG(EXTRACT(EPOCH FROM (notified_at - created_at))/60)::NUMERIC, 1)::FLOAT as avg_wait_minutes,
        EXTRACT(HOUR FROM created_at)::INTEGER as peak_hour,
        COUNT(CASE WHEN EXTRACT(HOUR FROM created_at)::INTEGER = EXTRACT(HOUR FROM created_at)::INTEGER THEN 1 END)::INTEGER as peak_volume
      FROM waitlists
      WHERE restaurant_id = $1 
        AND created_at >= $2
        AND (status = 'seated' OR status = 'no_show')
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY peak_volume DESC
      LIMIT 1
    `;

    const metricsResult = await pool.query(metricsQuery, [restaurantId, periodStart]);
    const metrics = metricsResult.rows[0] || {};

    // Fetch hourly distribution for peak hours summary
    const hourlyQuery = `
      SELECT 
        EXTRACT(HOUR FROM created_at)::INTEGER as hour,
        COUNT(*)::INTEGER as customer_count
      FROM waitlists
      WHERE restaurant_id = $1 
        AND created_at >= $2
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY hour ASC
    `;

    const hourlyResult = await pool.query(hourlyQuery, [restaurantId, periodStart]);

    // Calculate no-show rate
    const totalProcessed = metrics.total_processed || 0;
    const noShowCount = metrics.no_show_count || 0;
    const noShowRate = totalProcessed > 0 ? ((noShowCount / totalProcessed) * 100).toFixed(1) : 0;

    // Determine peak hour label
    let peakHourLabel = 'N/A';
    if (metrics.peak_hour !== null && metrics.peak_hour !== undefined) {
      const hour = parseInt(metrics.peak_hour);
      peakHourLabel = `${hour.toString().padStart(2, '0')}:00`;
    }

    // Determine no-show rate color
    const noShowRateNum = parseFloat(noShowRate);
    let noShowColor = 'green';
    if (noShowRateNum >= 20) {
      noShowColor = 'red';
    } else if (noShowRateNum >= 10) {
      noShowColor = 'yellow';
    }

    res.json({
      success: true,
      period,
      periodStart: periodStart.toISOString(),
      metrics: {
        seatedCount: metrics.seated_count || 0,
        noShowRate: parseFloat(noShowRate),
        noShowRateColor: noShowColor,
        avgWaitMinutes: metrics.avg_wait_minutes || 0,
        peakHour: peakHourLabel,
        hourlyDistribution: hourlyResult.rows
      }
    });
  } catch (error) {
    console.error('Analytics fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: error.message
    });
  }
});

// POST /analytics/reset - manually reset analytics for current service period
router.post('/reset', authenticateRestaurant, async (req, res) => {
  try {
    const restaurantId = req.restaurant.id;

    // Update analytics_reset_time to current time
    const now = new Date();
    const resetTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const updateQuery = `
      UPDATE restaurants
      SET analytics_reset_time = $1
      WHERE id = $2
      RETURNING analytics_reset_time
    `;

    const result = await pool.query(updateQuery, [resetTime, restaurantId]);

    res.json({
      success: true,
      message: 'Analytics reset successful',
      newResetTime: result.rows[0].analytics_reset_time
    });
  } catch (error) {
    console.error('Analytics reset error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset analytics',
      error: error.message
    });
  }
});

// GET /analytics/detailed - detailed breakdown for advanced views
router.get('/detailed', authenticateRestaurant, async (req, res) => {
  try {
    const restaurantId = req.restaurant.id;
    const { period = 'daily' } = req.query;

    const now = new Date();
    const resetTime = req.restaurant.analytics_reset_time || '11:00';
    const [resetHour, resetMinute] = resetTime.split(':').map(Number);

    let periodStart;
    if (period === 'weekly') {
      periodStart = new Date(now);
      const day = periodStart.getDay();
      const diff = periodStart.getDate() - day + (day === 0 ? -6 : 1);
      periodStart.setDate(diff);
      periodStart.setHours(resetHour, resetMinute, 0, 0);
    } else {
      periodStart = new Date(now);
      periodStart.setHours(resetHour, resetMinute, 0, 0);
      if (now < periodStart) {
        periodStart.setDate(periodStart.getDate() - 1);
      }
    }

    // Fetch detailed queue progression
    const detailedQuery = `
      SELECT 
        id,
        phone,
        party_size,
        status,
        created_at,
        notified_at,
        seated_at,
        no_show_reason,
        EXTRACT(EPOCH FROM (notified_at - created_at))/60 as wait_minutes,
        EXTRACT(EPOCH FROM (seated_at - created_at))/60 as total_time_minutes
      FROM waitlists
      WHERE restaurant_id = $1 
        AND created_at >= $2
      ORDER BY created_at DESC
    `;

    const detailedResult = await pool.query(detailedQuery, [restaurantId, periodStart]);

    // Group by status for breakdown
    const statusBreakdown = {
      seated: 0,
      no_show: 0,
      notified: 0,
      waiting: 0
    };

    const totalPartySize = { seated: 0, no_show: 0, notified: 0, waiting: 0 };

    detailedResult.rows.forEach(row => {
      statusBreakdown[row.status]++;
      totalPartySize[row.status] += row.party_size;
    });

    res.json({
      success: true,
      period,
      periodStart: periodStart.toISOString(),
      summary: {
        statusBreakdown,
        totalPartySize,
        records: detailedResult.rows
      }
    });
  } catch (error) {
    console.error('Detailed analytics fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch detailed analytics',
      error: error.message
    });
  }
});

// GET /analytics/comparison - compare daily vs weekly
router.get('/comparison', authenticateRestaurant, async (req, res) => {
  try {
    const restaurantId = req.restaurant.id;
    const now = new Date();
    const resetTime = req.restaurant.analytics_reset_time || '11:00';
    const [resetHour, resetMinute] = resetTime.split(':').map(Number);

    // Current day period
    const currentDayStart = new Date(now);
    currentDayStart.setHours(resetHour, resetMinute, 0, 0);
    if (now < currentDayStart) {
      currentDayStart.setDate(currentDayStart.getDate() - 1);
    }

    // Previous day period
    const previousDayStart = new Date(currentDayStart);
    previousDayStart.setDate(previousDayStart.getDate() - 1);

    // Current week period
    const currentWeekStart = new Date(now);
    const day = currentWeekStart.getDay();
    const diff = currentWeekStart.getDate() - day + (day === 0 ? -6 : 1);
    currentWeekStart.setDate(diff);
    currentWeekStart.setHours(resetHour, resetMinute, 0, 0);

    // Previous week period
    const previousWeekStart = new Date(currentWeekStart);
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);

    const comparisonQuery = `
      SELECT 
        COUNT(CASE WHEN status = 'seated' THEN 1 END)::INTEGER as seated_count,
        COUNT(CASE WHEN status = 'no_show' THEN 1 END)::INTEGER as no_show_count,
        COUNT(*)::INTEGER as total_processed,
        ROUND(AVG(EXTRACT(EPOCH FROM (notified_at - created_at))/60)::NUMERIC, 1)::FLOAT as avg_wait_minutes,
        $3::TEXT as period_label
      FROM waitlists
      WHERE restaurant_id = $1 
        AND created_at >= $2
        AND (status = 'seated' OR status = 'no_show')
    `;

    const currentDay = await pool.query(comparisonQuery, [restaurantId, currentDayStart, 'Today']);
    const previousDay = await pool.query(comparisonQuery, [restaurantId, previousDayStart, 'Yesterday']);
    const currentWeek = await pool.query(comparisonQuery, [restaurantId, currentWeekStart, 'This Week']);
    const previousWeek = await pool.query(comparisonQuery, [restaurantId, previousWeekStart, 'Last Week']);

    const formatMetrics = (rows) => {
      const data = rows[0] || {};
      const totalProcessed = data.total_processed || 0;
      const noShowRate = totalProcessed > 0 ? ((data.no_show_count / totalProcessed) * 100).toFixed(1) : 0;
      return {
        seatedCount: data.seated_count || 0,
        noShowRate: parseFloat(noShowRate),
        avgWaitMinutes: data.avg_wait_minutes || 0
      };
    };

    res.json({
      success: true,
      comparison: {
        today: formatMetrics(currentDay.rows),
        yesterday: formatMetrics(previousDay.rows),
        thisWeek: formatMetrics(currentWeek.rows),
        lastWeek: formatMetrics(previousWeek.rows)
      }
    });
  } catch (error) {
    console.error('Comparison analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch comparison analytics',
      error: error.message
    });
  }
});

module.exports = router;