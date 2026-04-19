Parksphere is a community-centric real-time parking coordination platform designed to alleviate the frustration of
urban parking by facilitating real-time spot sharing between drivers. The application operates
on a peer-to-peer model where users can announce when they are vacating a parking space or
offer private spots to the community. By bridging the gap between departing and arriving
drivers, Parksphere turns parking into a collaborative effort, helping to reduce city
congestion and the time spent searching for a place to park.

The platform is built as a comprehensive full-stack solution featuring a React web interface, a
cross-platform Expo mobile application, and a robust Node.js backend. It provides users with an
interactive map for real-time navigation, an intuitive request-and-approval workflow, and
integrated chat functionality for seamless coordination. With additional features like arrival
confirmations, automated notifications, and a user rating system, Parksphere ensures a secure
and efficient ecosystem for modern urban mobility.


Project Structure
client — React web app
server — Node/Express backend + Socket.IO + PostgreSQL
ParksphereMobileApp — Expo/React Native mobile app
documents — documentation/assets

Key Entry Points
Web: client/src/index.js -> client/src/App.js
Server: server/index.js (API + sockets), server/db.js (DB init/schema)
Mobile: ParksphereMobileApp/index.js -> ParksphereMobileApp/App.js
Core Modules
Web:
client/src/components/Map.js
client/src/components/ChatSideDrawer.js
client/src/components/MessagesSideDrawer.js
client/src/utils/socket.js, client/src/utils/api.js, client/src/utils/auth.js
Server:
server/index.js (routes + socket events)
server/db.js (tables: users, spots, requests, ratings, messages)
server/utils/geoUtils.js, server/utils/carTypes.js
Mobile:
ParksphereMobileApp/components/Map.js
ParksphereMobileApp/components/ChatTab.js
ParksphereMobileApp/components/RequestsScreen.js
ParksphereMobileApp/components/Profile.js
Tech Stack
Web: React, React Router, Leaflet/React-Leaflet (CRA-based)
Mobile: Expo, React Native, React Navigation
Backend: Express, Socket.IO, pg, JWT, bcrypt
Testing: CRA/Jest setup exists in client

How It Fits Together
server is the central API + realtime hub.
Both client and ParksphereMobileApp use JWT auth, call REST endpoints, and subscribe to Socket.IO events.
Main product flow appears shared across web/mobile: post parking spot -> request/accept flow -> arrival/transaction updates -> rating/chat.
Location logic is split between server-side geo utilities and client/mobile map UI.

Google OAuth web application credentials
Client ID:
320058445002-lddk8d48h06bei48bh6u08ku97t1i3kd.apps.googleusercontent.com
Creation date
April 4, 2026, 3:05:06 PM GMT+3
Last used date
April 4, 2026 (Note: this data could be delayed by a day or more.)

google ios client ID:
320058445002-oo08jes63ti9rtqkhpo9d1jfi6fcoo31.apps.googleusercontent.com

google android client ID:


State Machine
=============
   * IDLE: Initial state, no specific activity detected.
   * WALKING: User is actively walking.
   * DRIVING: User is driving or in a moving vehicle.
   * POSSIBLE_PARK: System suspects parking; entered when vehicle speed is below 3 km/h for over 30 seconds.
   * PARKED: User is confirmed parked; reached from POSSIBLE_PARK after 5 minutes stationary with high
     confidence.
   * POSSIBLE_WALK_AWAY: User has parked and is starting to walk away (over 5 steps, within 10 meters of car).
   * LEFT_SPOT: User has driven away from the parked spot; parkedLocation is cleared.
   * POSSIBLE_RETURN: User is returning to the vicinity of the parkedLocation (within 20 meters, low speed) after leaving. Displays "Returning to vehicle...".
   * EXIT_CONFIRMED: User is confirmed to have left the parking spot (moved over 50 meters, took over 15 steps from PARKED or POSSIBLE_WALK_AWAY).

✦ I've implemented a "Collision Radius" (5 meters) in the server logic to address your concern. 

  Now, when a user parks (via auto-detection or manual entry), the system:
   1. Scans the immediate area for any existing free or soon_free spots.
   2. Consumes the old spot: If it finds one within 5 meters, it automatically deletes the old record and its associated requests.
   3. Updates the map: Broadcasts a spotDeleted event for the old spot so other users' maps update instantly.
   4. Places the new spot: Inserts the new occupied spot.

  This ensures that "Free" markers aren't left behind as "ghosts" once someone else has physically occupied that space. The lifecycle is now self-cleaning based on proximity.

✦ To test the new functionality, you can use a combination of API simulation (to verify the
  lifecycle/de-duplication) and mobile simulation.

  1. Testing the Lifecycle & Proximity (Server Logic)
  You can use curl to simulate two different users parking in the same spot to see the "Collision Radius" in
  action.

  Step A: User 1 declares a spot

   1 curl -X POST http://localhost:3001/api/declare-spot \
   2   -H "Authorization: Bearer <USER_1_TOKEN>" \
   3   -H "Content-Type: application/json" \
   4   -d '{"latitude": 37.7749, "longitude": -122.4194, "timeToLeave": 60, "costType": "free"}'

  Step B: User 1 "leaves" (status changes to free)
  Find the spotId from the previous response:

   1 curl -X PUT http://localhost:3001/api/parkingspots/<SPOT_ID>/status \
   2   -H "Authorization: Bearer <USER_1_TOKEN>" \
   3   -H "Content-Type: application/json" \
   4   -d '{"status": "free"}'
  At this point, the spot should turn Green on your map.

  Step C: User 2 parks 2 meters away

   1 curl -X POST http://localhost:3001/api/declare-spot \
   2   -H "Authorization: Bearer <USER_2_TOKEN>" \
   3   -H "Content-Type: application/json" \
   4   -d '{"latitude": 37.77491, "longitude": -122.41941, "timeToLeave": 60, "costType": "free"}'
  Verification:
   - The server log should say: [Lifecycle] Consuming nearby spot <SPOT_ID> (Distance: ~1.5m)
   - The Green spot should disappear from the map.
   - A new Red spot should appear for User 2.

  ---

  2. Testing Park Detection (Mobile Simulation)
  If you are using the iOS Simulator or Android Emulator, you can simulate the movement:

   1. Open the App: Ensure "Auto-Detection" is enabled in your profile/settings.
   2. Simulate Driving: 
       - iOS: Features -> Location -> Freeway Drive.
       - Android: Use the Extended Controls (three dots) -> Location -> Routes and play a route.
       - Log Check: You should see "Driving detected..." in your notification log.
   3. Simulate Parking:
       - Stop the location simulation (set to a fixed point).
       - Wait 30 seconds.
       - You should see "Possible parking detected...".
       - After 5 minutes (or you can temporarily reduce DURATION_PARKED_CONFIRM in parkDetectionService.js to 10
         seconds for faster testing), it will transition to PARKED and you'll see "Parking spot identified!".
   4. Simulate Walking Away:
       - Move the simulated location by ~10-20 meters.
       - You should see "Walking away detected...".
   5. Simulate Returning:
       - Move the location back to the car's original coordinates.
       - You should see "Returning to vehicle..." and the spot marker on the map should turn Orange.





 > ok i did another test: again ssame scenario, i walked to the car, started driving, detected driving state, but when i parked and walked away from the car, it took 6 minutes to display "possible parking  detected", and i stopped walking at that time, so i suspect that in order to detect  the possible parking state, the speed needs to be less than some threshold, so if the user is walking away from the car, it doesnt detect it. so we need to change the logic: we should detect the "possible park" state, only if the previous state was driving, and if the current speed is zero, and if there is walking or idle detected after at least 30 seconds. can we do that? we should check that these conditions are met (all three) for 2 minutes, and if yes, then we should transition to the state Parked. In the state "possible park" we should save the location temporarily. Then if we transition to the state "parked", then the location will be stored as the parked location. if we dont transition to the state parked, we delete this temporary location. Also we need to store the two previous and the current state, so we can identify the sequence. Is this clear? can we do that?
