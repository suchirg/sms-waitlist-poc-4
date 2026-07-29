import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import './dashboard.css';

const Dashboard = () => {
  const [queue, setQueue] = useState([]);
  const [analytics, setAnalytics] = useState({
    seatedCount: 0,
    noShowRate: 0,
    avgWaitTime: 0,
    peakHour: null,
    noShowCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('daily');
  const [socket, setSocket] = useState(null);
  const [processingId, setProcessingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [authInput, setAuthInput] = useState('');

  // Initialize Socket.IO connection and fetch initial data
  useEffect(() => {
    if (!authenticated) return;

    const newSocket = io(window.location.origin, {
      query: { apiKey },
    });

    newSocket.on('connect', () => {
      fetchQueue();
      fetchAnalytics();
    });

    newSocket.on('queue_updated', (data) => {
      setQueue(data);
    });

    newSocket.on('analytics_updated', (data) => {
      setAnalytics(data);
    });

    newSocket.on('error', (err) => {
      setError(err.message || 'Connection error');
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [authenticated, apiKey]);

  // Poll for updates every 10 seconds as fallback
  useEffect(() => {
    if (!authenticated) return;

    const interval = setInterval(() => {
      fetchQueue();
      fetchAnalytics();
    }, 10000);

    return () => clearInterval(interval);
  }, [authenticated, timeRange]);

  const handleAuth = (e) => {
    e.preventDefault();
    if (authInput.trim()) {
      setApiKey(authInput);
      setAuthenticated(true);
      setAuthInput('');
    }
  };

  const fetchQueue = async () => {
    try {
      const response = await fetch('/queue', {
        headers: { 'X-API-Key': apiKey },
      });
      if (!response.ok) throw new Error('Failed to fetch queue');
      const data = await response.json();
      setQueue(data.waitlist || []);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const params = new URLSearchParams({ timeRange });
      const response = await fetch(`/analytics?${params}`, {
        headers: { 'X-API-Key': apiKey },
      });
      if (!response.ok) throw new Error('Failed to fetch analytics');
      const data = await response.json();
      setAnalytics(data);
    } catch (err) {
      console.error('Analytics fetch error:', err);
    }
  };

  const handleNext = async () => {
    if (queue.length === 0) return;

    const currentCustomer = queue[0];
    setProcessingId(currentCustomer.id);

    try {
      const response = await fetch('/next', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({ customerId: currentCustomer.id }),
      });

      if (!response.ok) throw new Error('Failed to notify customer');

      const result = await response.json();
      if (result.success) {
        fetchQueue();
        fetchAnalytics();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleRemove = async (customerId) => {
    try {
      const response = await fetch(`/queue/${customerId}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': apiKey },
      });

      if (!response.ok) throw new Error('Failed to remove customer');

      fetchQueue();
      fetchAnalytics();
      setConfirmDelete(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const getNoShowColor = (rate) => {
    if (rate < 10) return '#10b981'; // green
    if (rate < 20) return '#f59e0b'; // yellow
    return '#ef4444'; // red
  };

  const formatWaitTime = (minutes) => {
    if (!minutes) return '—';
    return Math.round(minutes) + ' min';
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatTimeDiff = (createdAt, notifiedAt) => {
    if (!createdAt || !notifiedAt) return '—';
    const created = new Date(createdAt);
    const notified = new Date(notifiedAt);
    const diffMs = notified - created;
    const diffMins = Math.round(diffMs / 60000);
    return diffMins + ' min';
  };

  if (!authenticated) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1>SMS Waitlist</h1>
          <form onSubmit={handleAuth}>
            <input
              type="password"
              placeholder="Enter restaurant API key"
              value={authInput}
              onChange={(e) => setAuthInput(e.target.value)}
              required
            />
            <button type="submit">Access Dashboard</button>
          </form>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="loading">Loading dashboard...</div>;
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>SMS Waitlist Dashboard</h1>
        <button
          className="logout-btn"
          onClick={() => {
            setAuthenticated(false);
            setApiKey('');
          }}
        >
          Logout
        </button>
      </header>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="dashboard-container">
        <div className="left-panel">
          <div className="queue-header">
            <h2>Current Queue</h2>
            <span className="queue-count">{queue.length} waiting</span>
          </div>

          {queue.length === 0 ? (
            <div className="empty-state">
              <p>No customers in queue</p>
            </div>
          ) : (
            <>
              <div className="next-customer-card">
                <div className="next-badge">Next</div>
                <div className="customer-info">
                  <div className="customer-name">
                    Party of {queue[0].party_size}
                  </div>
                  <div className="customer-phone">{queue[0].phone}</div>
                  <div className="customer-time">
                    Joined {formatTime(queue[0].created_at)}
                  </div>
                  <div className="current-wait">
                    Waiting ~
                    {Math.round(
                      (new Date() - new Date(queue[0].created_at)) / 60000
                    )}{' '}
                    min
                  </div>
                </div>
                <button
                  className="next-btn"
                  onClick={handleNext}
                  disabled={processingId === queue[0].id}
                >
                  {processingId === queue[0].id
                    ? 'Notifying...'
                    : 'Table Ready'}
                </button>
              </div>

              <div className="queue-list">
                {queue.map((customer, index) => (
                  <div
                    key={customer.id}
                    className={`queue-item ${customer.status}`}
                  >
                    <div className="queue-position">#{index + 1}</div>
                    <div className="queue-details">
                      <div className="queue-party">
                        Party of {customer.party_size}
                      </div>
                      <div className="queue-phone">{customer.phone}</div>
                      <div className="queue-time">
                        {formatTime(customer.created_at)} •{' '}
                        {Math.round(
                          (new Date() - new Date(customer.created_at)) / 60000
                        )}{' '}
                        min
                      </div>
                    </div>
                    <div className="queue-status-badge">{customer.status}</div>
                    {index > 0 && (
                      <button
                        className="remove-btn"
                        onClick={() => setConfirmDelete(customer.id)}
                        title="Remove from queue"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="right-panel">
          <div className="analytics-header">
            <h2>Analytics</h2>
            <div className="time-range-toggle">
              <button
                className={timeRange === 'daily' ? 'active' : ''}
                onClick={() => setTimeRange('daily')}
              >
                Daily
              </button>
              <button
                className={timeRange === 'weekly' ? 'active' : ''}
                onClick={() => setTimeRange('weekly')}
              >
                Weekly
              </button>
            </div>
          </div>

          <div className="analytics-grid">
            <div className="analytics-card">
              <div className="analytics-label">Total Served</div>
              <div className="analytics-value">{analytics.seatedCount}</div>
            </div>

            <div className="analytics-card">
              <div className="analytics-label">No-Show Rate</div>
              <div
                className="analytics-value"
                style={{
                  color: getNoShowColor(analytics.noShowRate),
                }}
              >
                {analytics.noShowRate.toFixed(1)}%
              </div>
              <div className="analytics-subtext">
                {analytics.noShowCount} no-shows
              </div>
            </div>

            <div className="analytics-card">
              <div className="analytics-label">Avg Wait Time</div>
              <div className="analytics-value">
                {formatWaitTime(analytics.avgWaitTime)}
              </div>
            </div>

            <div className="analytics-card">
              <div className="analytics-label">Peak Hour</div>
              <div className="analytics-value">
                {analytics.peakHour !== null && analytics.peakHour !== undefined
                  ? `${String(analytics.peakHour).padStart(2, '0')}:00`
                  : '—'}
              </div>
            </div>
          </div>

          <div className="metrics-summary">
            <h3>Session Metrics</h3>
            <div className="metric-row">
              <span className="metric-label">Processed:</span>
              <span className="metric-value">
                {analytics.seatedCount + analytics.noShowCount}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Currently Waiting:</span>
              <span className="metric-value">{queue.length}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Success Rate:</span>
              <span className="metric-value">
                {(
                  (analytics.seatedCount /
                    (analytics.seatedCount + analytics.noShowCount || 1)) *
                  100
                ).toFixed(1)}
                %
              </span>
            </div>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Remove Customer?</h3>
            <p>
              This will remove the customer from the queue. This action cannot
              be undone.
            </p>
            <div className="modal-actions">
              <button
                className="modal-cancel"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                className="modal-confirm"
                onClick={() => handleRemove(confirmDelete)}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;