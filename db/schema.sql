CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE waitlist_status AS ENUM ('waiting', 'notified', 'seated', 'no_show');

CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20) NOT NULL UNIQUE,
  api_key VARCHAR(64) NOT NULL UNIQUE,
  analytics_reset_time VARCHAR(5) NOT NULL DEFAULT '11:00',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE waitlists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  phone VARCHAR(20) NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  status waitlist_status NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  notified_at TIMESTAMP WITH TIME ZONE,
  seated_at TIMESTAMP WITH TIME ZONE,
  no_show_reason VARCHAR(255),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_waitlists_restaurant_id ON waitlists(restaurant_id);
CREATE INDEX idx_waitlists_restaurant_status ON waitlists(restaurant_id, status);
CREATE INDEX idx_waitlists_restaurant_created_at ON waitlists(restaurant_id, created_at DESC);
CREATE INDEX idx_waitlists_status ON waitlists(status);
CREATE INDEX idx_restaurants_phone_number ON restaurants(phone_number);
CREATE INDEX idx_restaurants_api_key ON restaurants(api_key);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_waitlists_updated_at
BEFORE UPDATE ON waitlists
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_restaurants_updated_at
BEFORE UPDATE ON restaurants
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

INSERT INTO restaurants (name, phone_number, api_key, analytics_reset_time)
VALUES (
  'Demo Cafe',
  '+1234567890',
  'demo_api_key_12345678901234567890123456789012',
  '11:00'
) ON CONFLICT DO NOTHING;