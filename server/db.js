const { Pool } = require('pg');

// index.js loads dotenv before requiring this file, so process.env is already populated here.
// DB_PASSWORD has no fallback — a missing password should fail loudly at startup, not silently
// connect with a hardcoded credential. The other fields default to this project's own local dev
// values so a fresh checkout with a matching local Postgres setup still works with zero config.
if (!process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD is not set. Add it to server/.env — see server/.env.example.');
}

const pool = new Pool({
  user: process.env.DB_USER || 'konstantinos',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'parksphere_db',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// 2026-08-03: consolidated from ~20 accumulated ALTER TABLE migrations (column additions, two
// type conversions, one rename, one drop) into the direct target schema — safe because
// CREATE TABLE IF NOT EXISTS is a complete no-op against a database that already has the table
// (Postgres doesn't diff columns), so this only changes what a genuinely FRESH database gets;
// the live database's actual shape was already reconciled by that whole migration history having
// already run. Verified by creating a fresh scratch database from this file and comparing its
// resulting schema (\d) directly against live's before this landed.
//
// Also dropped 7 columns confirmed unused by any app code across server/mobile/web
// (users.rating, rating_count, expo_push_token, facebook_id, instagram_id;
// requests.latitude, requests.longitude) — superseded by average_rating (rating/rating_count),
// never-implemented features (expo_push_token/facebook_id/instagram_id), or by distance
// (requests.latitude/longitude). Confirmed empty/stale in the live data before dropping.
async function createUsersTable() {
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE,
        google_id VARCHAR(255) UNIQUE,
        keycloak_id VARCHAR(255) UNIQUE,
        plate_number VARCHAR(255),
        car_color VARCHAR(255),
        car_type VARCHAR(255),
        avatar_url VARCHAR(255),
        credits INTEGER DEFAULT 0,
        reserved_amount INTEGER DEFAULT 0,
        spots_declared INTEGER DEFAULT 0,
        spots_taken INTEGER DEFAULT 0,
        total_arrival_time DECIMAL(10, 2) DEFAULT 0.00,
        completed_transactions_count INTEGER DEFAULT 0,
        average_rating NUMERIC(3, 2) DEFAULT 0.00,
        auto_detect BOOLEAN DEFAULT FALSE,
        notifications_enabled BOOLEAN DEFAULT TRUE,
        share_plate_number BOOLEAN DEFAULT TRUE, -- opt-out: plate is still hidden from anyone without an accepted-spot relationship regardless of this flag; this only controls whether an accepted requester specifically sees it
        role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'demo')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // 2026-08-03: one genuinely new column added after the consolidation above — exactly the
    // narrow, one-off ADD COLUMN this pattern is meant for going forward, not a return to the old
    // sprawling migration list. Needed because CREATE TABLE IF NOT EXISTS is a no-op against the
    // already-existing live table.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS share_plate_number BOOLEAN DEFAULT TRUE;`);
    client.release();
    console.log('Users table ensured to exist.');
  } catch (err) {
    console.error('Error creating users table:', err);
  }
}

async function createParkingSpotsTable() {
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS parking_spots (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        fuzzed_latitude DECIMAL(10, 8),
        fuzzed_longitude DECIMAL(11, 8),
        time_to_leave INTEGER NOT NULL, -- minutes
        cost_type VARCHAR(255) NOT NULL DEFAULT 'Paid',
        price INTEGER DEFAULT 0,
        declared_car_type VARCHAR(255),
        comments TEXT,
        status VARCHAR(50) DEFAULT 'occupied', -- 'occupied' | 'soon_free' (yellow) | 'committed' (green) | 'vacating' (red) | 'free'
        is_auto_detected BOOLEAN DEFAULT FALSE,
        declared_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    client.release();
    console.log('Parking spots table ensured to exist.');
  } catch (err) {
    console.error('Error creating parking spots table:', err);
  }
}

async function createRequestsTable() {
  try {
    const client = await pool.connect();
    await client.query(`DROP TABLE IF EXISTS accepted_requests CASCADE;`); // superseded by this table, long ago
    await client.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        spot_id INTEGER REFERENCES parking_spots(id) ON DELETE SET NULL,
        requester_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'fulfilled' | 'expired'
        distance DECIMAL(10, 2),
        message TEXT, -- optional, from requester
        response_message TEXT, -- optional, from owner
        requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        responded_at TIMESTAMP WITH TIME ZONE, -- owner accepted/rejected
        accepted_at TIMESTAMP WITH TIME ZONE,
        arrived_at TIMESTAMP WITH TIME ZONE -- requester confirmed arrival
      );
    `);
    client.release();
    console.log('Requests table ensured to exist.');
  } catch (err) {
    console.error('Error creating requests table:', err);
  }
}

async function createUserRatingsTable() {
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_ratings (
        id SERIAL PRIMARY KEY,
        rater_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        rated_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    client.release();
    console.log('User ratings table ensured to exist.');
  } catch (err) {
    console.error('Error creating user ratings table:', err);
  }
}

async function createMessagesTable() {
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    client.release();
    console.log('Messages table ensured to exist.');
  } catch (err) {
    console.error('Error creating messages table:', err);
  }
}

// Postgres auto-indexes PRIMARY KEY/UNIQUE columns only — every foreign key below needed its own
// index for two reasons: (1) every query in index.js that filters or joins on these columns was
// doing a sequential scan, worst of all user_ratings.rated_user_id, hit as a correlated subquery
// on every row of several listing/profile endpoints; (2) every one of these tables has an
// ON DELETE CASCADE back to users, and without an index on the referencing column, deleting a
// single user means a full scan of each dependent table to find the rows to cascade.
// status columns included too — filtered directly in several parking_spots/requests queries.
async function createIndexes() {
  try {
    const client = await pool.connect();
    await client.query(`CREATE INDEX IF NOT EXISTS idx_parking_spots_user_id ON parking_spots(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_parking_spots_status ON parking_spots(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_requests_spot_id ON requests(spot_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_requests_requester_id ON requests(requester_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_requests_owner_id ON requests(owner_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_ratings_rater_id ON user_ratings(rater_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_ratings_rated_user_id ON user_ratings(rated_user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages(receiver_id);`);
    client.release();
    console.log('Indexes ensured to exist.');
  } catch (err) {
    console.error('Error creating indexes:', err);
  }
}

module.exports = { pool, createUsersTable, createParkingSpotsTable, createRequestsTable, createUserRatingsTable, createMessagesTable, createIndexes };
