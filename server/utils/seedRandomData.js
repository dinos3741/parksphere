const { pool, createUsersTable, createParkingSpotsTable } = require('../db');
const bcrypt = require('bcryptjs');
const { getRandomPointInCircle } = require('./geoUtils');

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
    const numbers = Math.floor(100 + Math.random() * 900);
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
    const minLat = 40.3;
    const maxLat = 40.4;
    const minLng = 23.0;
    const maxLng = 23.1;

    const lat = Math.random() * (maxLat - minLat) + minLat;
    const lng = Math.random() * (maxLng - minLng) + minLng;
    return { lat: lat.toFixed(8), lng: lng.toFixed(8) };
}

async function createRandomUser(client) {
    const username = generateRandomUsername();
    const randomPassword = generateRandomString(6);
    const hashedPassword = await bcrypt.hash(randomPassword, 10);
    const plateNumber = generateRandomPlateNumber();
    const carColor = generateRandomCarColor();
    const carType = generateRandomCarType();
    const initialCredits = parseFloat((Math.random() * 50).toFixed(2));

    const result = await client.query(
        'INSERT INTO users (username, password, plate_number, car_color, car_type, credits, reserved_amount) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username',
        [username, hashedPassword, plateNumber, carColor, carType, initialCredits, 0.00]
    );
    const newUser = result.rows[0];
    console.log(`  Added user: ${newUser.username} with ${initialCredits} credits`);
    return newUser.id;
}

async function createRandomSpot(client, userId) {
    const { lat, lng } = generateRandomLatLng();
    const timeToLeave = Math.floor(1 + Math.random() * 15);
    const isFree = Math.random() > 0.5;
    const price = isFree ? 0.00 : parseFloat((Math.random() * 10).toFixed(2));
    const declaredCarType = generateRandomCarType();
    const [fuzzedLat, fuzzedLon] = getRandomPointInCircle(parseFloat(lat), parseFloat(lng), 130);

    await client.query(
        'INSERT INTO parking_spots (user_id, latitude, longitude, time_to_leave, is_free, price, declared_car_type, comments, fuzzed_latitude, fuzzed_longitude) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [userId, lat, lng, timeToLeave, isFree, price, declaredCarType, '', fuzzedLat, fuzzedLon]
    );
    console.log(`    Successfully added spot for user ${userId} at (${lat}, ${lng})`);
}

async function main() {
    let client;
    try {
        client = await pool.connect();
        console.log('Connected to database for seeding service.');

        await createUsersTable();
        await createParkingSpotsTable();

        console.log('Clearing existing parking spots...');
        await client.query('DELETE FROM parking_spots');
        console.log('Clearing existing users (except "dinos" and "riva")...');
        await client.query("DELETE FROM users WHERE username NOT IN ('dinos', 'riva')");

        const userIds = [];
        const dinosResult = await client.query("SELECT id FROM users WHERE username = 'dinos'");
        if (dinosResult.rows.length > 0) {
            userIds.push(dinosResult.rows[0].id);
        }
        const rivaResult = await client.query("SELECT id FROM users WHERE username = 'riva'");
        if (rivaResult.rows.length > 0) {
            userIds.push(rivaResult.rows[0].id);
        }

        console.log(`Seeding 10 initial users...`);
        for (let i = 0; i < 10; i++) {
            const newUserId = await createRandomUser(client);
            userIds.push(newUserId);
        }

        console.log('Seeding 5 initial spots...');
        for (let i = 0; i < 5; i++) {
            const randomUserId = userIds[Math.floor(Math.random() * userIds.length)];
            await createRandomSpot(client, randomUserId);
        }

        console.log('Starting random spot creation service...');
        setInterval(async () => {
            const randomUserId = userIds[Math.floor(Math.random() * userIds.length)];
            await createRandomSpot(client, randomUserId);
        }, 60000); // Create a new spot every 60 seconds

    } catch (error) {
        console.error('Error in seeding service:', error);
    } finally {
        // We don't release the client or end the pool because we want the service to run continuously
    }
}

main().catch(err => console.error('An error occurred while running the seeder service:', err));
