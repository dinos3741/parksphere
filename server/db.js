const { Pool } = require('pg');

const pool = new Pool({
  user: 'konstantinos', // Replace with your PostgreSQL username
  host: 'localhost',
  database: 'parksphere_db', // Replace with your database name
  password: 'dinos1234', // Replace with your PostgreSQL password
  port: 5432,
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

async function createUsersTable() {
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        plate_number VARCHAR(255) NOT NULL,
        car_color VARCHAR(255) NOT NULL,
        car_type VARCHAR(255), -- New column for car type
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add car_type column if it doesn't exist
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS car_type VARCHAR(255);
    `);

    // Add credits column if it doesn't exist
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS credits DECIMAL(10, 2) DEFAULT 0.00;
    `);

    // Add reserved_amount column if it doesn't exist
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS reserved_amount DECIMAL(10, 2) DEFAULT 0.00;
    `);

    // Add spots_declared column if it doesn't exist
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS spots_declared INTEGER DEFAULT 0;
    `);
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
        time_to_leave INTEGER NOT NULL, -- Time in minutes
        is_free BOOLEAN NOT NULL,
        price DECIMAL(10, 2) DEFAULT 0.00,
        comments TEXT, -- New column for comments
        declared_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add declared_car_type column if it doesn't exist
    await client.query(`
      ALTER TABLE parking_spots
      ADD COLUMN IF NOT EXISTS declared_car_type VARCHAR(255);
    `);

    // Add comments column if it doesn't exist
    await client.query(`
      ALTER TABLE parking_spots
      ADD COLUMN IF NOT EXISTS comments TEXT;
    `);

    // Add fuzzed location columns if they don't exist
    await client.query(`
      ALTER TABLE parking_spots
      ADD COLUMN IF NOT EXISTS fuzzed_latitude DECIMAL(10, 8);
    `);
    await client.query(`
      ALTER TABLE parking_spots
      ADD COLUMN IF NOT EXISTS fuzzed_longitude DECIMAL(11, 8);
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
    // Drop the old accepted_requests table if it exists
    await client.query(`DROP TABLE IF EXISTS accepted_requests CASCADE;`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        spot_id INTEGER REFERENCES parking_spots(id) ON DELETE CASCADE,
        requester_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'rejected', 'cancelled', 'fulfilled', 'expired'
        requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        responded_at TIMESTAMP WITH TIME ZONE, -- When owner accepted/rejected
        message TEXT, -- Optional message from requester
        response_message TEXT -- Optional message from owner
      );
    `);
    client.release();
    console.log('Requests table ensured to exist.');
  } catch (err) {
    console.error('Error creating requests table:', err);
  }
}

module.exports = { pool, createUsersTable, createParkingSpotsTable, createRequestsTable };
