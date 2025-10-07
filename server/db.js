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
        avatar_url VARCHAR(255), -- New column for avatar URL
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add car_type column if it doesn't exist
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS car_type VARCHAR(255);
    `);

    // Add avatar_url column if it doesn't exist
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(255);
    `);

    // Add credits column if it doesn't exist
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 0;
    `);

    // Add reserved_amount column if it doesn't exist
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS reserved_amount INTEGER DEFAULT 0;
    `);

    // Add spots_declared column if it doesn't exist
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS spots_declared INTEGER DEFAULT 0;
    `);

    // Add spots_taken column if it doesn't exist
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS spots_taken INTEGER DEFAULT 0;
    `);

    // Add total_arrival_time and completed_transactions_count to users table
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS total_arrival_time DECIMAL(10, 2) DEFAULT 0.00;
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS completed_transactions_count INTEGER DEFAULT 0;
    `);

    // Check and alter credits column type if it's not INTEGER
    const creditsColumnTypeResult = await client.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'credits';
    `);

    if (creditsColumnTypeResult.rows.length > 0 && creditsColumnTypeResult.rows[0].data_type !== 'integer') {
      console.log('credits column is not INTEGER, attempting to alter to INTEGER...');
      await client.query(`
        ALTER TABLE users ALTER COLUMN credits TYPE INTEGER USING credits::integer;
      `);
      console.log('credits column successfully altered to INTEGER.');
    }

    // Check and alter reserved_amount column type if it's not INTEGER
    const reservedAmountColumnTypeResult = await client.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'reserved_amount';
    `);

    if (reservedAmountColumnTypeResult.rows.length > 0 && reservedAmountColumnTypeResult.rows[0].data_type !== 'integer') {
      console.log('reserved_amount column is not INTEGER, attempting to alter to INTEGER...');
      await client.query(`
        ALTER TABLE users ALTER COLUMN reserved_amount TYPE INTEGER USING reserved_amount::integer;
      `);
      console.log('reserved_amount column successfully altered to INTEGER.');
    }

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
        cost_type VARCHAR(255) NOT NULL, -- Changed from is_free
        price INTEGER DEFAULT 0,
        comments TEXT, -- New column for comments
        declared_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Check and alter cost_type column type if it's BOOLEAN
    const columnTypeResult = await client.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'parking_spots' AND column_name = 'cost_type';
    `);

    if (columnTypeResult.rows.length > 0 && columnTypeResult.rows[0].data_type === 'boolean') {
      console.log('cost_type column is BOOLEAN, attempting to alter to VARCHAR(255)...');
      await client.query(`
        ALTER TABLE parking_spots ALTER COLUMN cost_type TYPE VARCHAR(255) USING CASE
          WHEN cost_type = TRUE THEN 'Free'
          WHEN cost_type = FALSE THEN 'Paid'
          ELSE 'Paid' -- Default for any other unexpected boolean value
        END;
      `);
      await client.query(`ALTER TABLE parking_spots ALTER COLUMN cost_type SET DEFAULT 'Paid';`);
      await client.query(`ALTER TABLE parking_spots ALTER COLUMN cost_type SET NOT NULL;`);
      console.log('cost_type column successfully altered to VARCHAR(255).');
    } else if (columnTypeResult.rows.length === 0) {
      console.log('cost_type column does not exist, it will be created by CREATE TABLE IF NOT EXISTS.');
    }

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

    // Check and alter price column type if it's not INTEGER
    const priceColumnTypeResult = await client.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'parking_spots' AND column_name = 'price';
    `);

    if (priceColumnTypeResult.rows.length > 0 && priceColumnTypeResult.rows[0].data_type !== 'integer') {
      console.log('price column is not INTEGER, attempting to alter to INTEGER...');
      await client.query(`
        ALTER TABLE parking_spots ALTER COLUMN price TYPE INTEGER USING price::integer;
      `);
      console.log('price column successfully altered to INTEGER.');
    }

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
        spot_id INTEGER REFERENCES parking_spots(id),
        requester_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'rejected', 'cancelled', 'fulfilled', 'expired'
        requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        responded_at TIMESTAMP WITH TIME ZONE, -- When owner accepted/rejected
        accepted_at TIMESTAMP WITH TIME ZONE, -- When the request was accepted
        arrived_at TIMESTAMP WITH TIME ZONE, -- When the requester confirmed arrival
        message TEXT, -- Optional message from requester
        response_message TEXT -- Optional message from owner
      );
    `);

    // Drop the existing foreign key constraint if it exists
    await client.query(`
      ALTER TABLE requests
      DROP CONSTRAINT IF EXISTS requests_spot_id_fkey;
    `);

    // Add the foreign key constraint without ON DELETE CASCADE
    await client.query(`
      ALTER TABLE requests
      ADD CONSTRAINT requests_spot_id_fkey
      FOREIGN KEY (spot_id)
      REFERENCES parking_spots(id)
      ON DELETE SET NULL;
    `);

    // Add distance column if it doesn't exist
    await client.query(`
      ALTER TABLE requests
      ADD COLUMN IF NOT EXISTS distance DECIMAL(10, 2);
    `);

    // Add accepted_at column if it doesn't exist
    await client.query(`
      ALTER TABLE requests
      ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP WITH TIME ZONE;
    `);

    // Add arrived_at column if it doesn't exist
    await client.query(`
      ALTER TABLE requests
      ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMP WITH TIME ZONE;
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

module.exports = { pool, createUsersTable, createParkingSpotsTable, createRequestsTable, createUserRatingsTable };
