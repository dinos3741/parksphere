const { pool, createUsersTable, createParkingSpotsTable } = require('../db');
const bcrypt = require('bcryptjs');

// --- Helper Functions for Random Data Generation ---

function generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}
function generateRandomUsername() {
    return `user_${generateRandomString(5).toLowerCase()}`;
}

function generateRandomPlateNumber() {
    const letters = generateRandomString(3).toUpperCase();
    const numbers = Math.floor(100 + Math.random() * 900); // 3-digit number
    return `${letters}-${numbers}`;
}

function generateRandomCarColor() {
    const colors = ['Red', 'Blue', 'Green', 'Black', 'White', 'Silver', 'Yellow', 'Orange'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function generateRandomCarType() {
    const carTypes = ['city car', 'hatchback', 'sedan', 'SUV', 'family car', 'van', 'truck', 'motorcycle'];
    return carTypes[Math.floor(Math.random() * carTypes.length)];
}

function generateRandomLatLng() {
    // Coordinates around Thessaloniki, Greece
    const minLat = 40.5;
    const maxLat = 40.7;
    const minLng = 22.8;
    const maxLng = 23.1;

    const lat = Math.random() * (maxLat - minLat) + minLat;
    const lng = Math.random() * (maxLng - minLng) + minLng;
    return { lat: lat.toFixed(8), lng: lng.toFixed(8) };
}

async function seedDatabase(numUsers = 8, numSpotsPerUser = 1) {
    let client;
    try {
        client = await pool.connect();
        console.log('Connected to database for seeding.');

        // Ensure tables exist before seeding
        await createUsersTable();
        await createParkingSpotsTable();

        // Optional: Clear existing data (uncomment if you want a fresh start each time)
        console.log('Clearing existing parking spots...');
        await client.query('DELETE FROM parking_spots');
        console.log('Clearing existing users (except "dinos")...');
        await client.query("DELETE FROM users WHERE username != 'dinos'"); // Keep your user
        const insertedUserIds = {};
        // All seeded users will have a random 6-character password

        // Seed Users
        console.log(`Seeding ${numUsers} users...`);
        for (let i = 0; i < numUsers; i++) {
            const username = generateRandomUsername();
            const randomPassword = generateRandomString(6); // Generate a random 6-character password
            const hashedPassword = await bcrypt.hash(randomPassword, 10);
            const plateNumber = generateRandomPlateNumber();
            const carColor = generateRandomCarColor();
            const carType = generateRandomCarType();

            const result = await client.query(
                'INSERT INTO users (username, password, plate_number, car_color, car_type) VALUES ($1, $2, $3, $4, $5) RETURNING id, username',
                [username, hashedPassword, plateNumber, carColor, carType]
            );
            const newUser = result.rows[0];
            insertedUserIds[newUser.username] = newUser.id;
            console.log(`  Added user: ${newUser.username}`);
        }

        // Seed Parking Spots
        console.log(`Seeding ${numUsers * numSpotsPerUser} parking spots...`);
        const userUsernames = Object.keys(insertedUserIds);
        console.log(`Found ${userUsernames.length} users to seed spots for.`);
        for (const username of userUsernames) {
            const userId = insertedUserIds[username];
            console.log(`  Seeding spots for user: ${username} (ID: ${userId})`);
            for (let i = 0; i < numSpotsPerUser; i++) {
                const { lat, lng } = generateRandomLatLng();
                const timeToLeave = Math.floor(1 + Math.random() * 15); // 1 to 15 minutes
                const isFree = Math.random() > 0.5; // 50% chance of being free
                const price = isFree ? 0.00 : parseFloat((Math.random() * 10).toFixed(2)); // Random price between 0 and 10 for paid spots

                console.log(`    Attempting to insert spot: userId=${userId}, lat=${lat}, lng=${lng}, timeToLeave=${timeToLeave}, isFree=${isFree}, price=${price}`);
                await client.query(
                    'INSERT INTO parking_spots (user_id, latitude, longitude, time_to_leave, is_free, price) VALUES ($1, $2, $3, $4, $5, $6)',
                    [userId, lat, lng, timeToLeave, isFree, price]
                );
                console.log(`    Successfully added spot for ${username} at (${lat}, ${lng}), ${timeToLeave} min, Free: ${isFree}, Price: ${price}`);
            }
        }

        console.log('Database seeding complete!');
    } catch (error) {
        console.error('Error during database seeding:', error);
    } finally {
        if (client) {
            client.release();
            console.log('Database connection released.');
        }
        // End the pool to allow the script to exit gracefully
        await pool.end();
        console.log('Pool has been closed.');
    }
}

// Execute the seeding function
seedDatabase().catch(err => console.error('An error occurred while running the seeder:', err));