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


State Machine (old)
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

NEW STATE MACHINE
=================
  1. The Movement Phase
   * IDLE: The baseline state. 
       * If you move > 15 km/h for 1 minute → DRIVING.
       * If you move 1-6 km/h (human walking speed) → WALKING.
   * WALKING: Keeps the system alert while you move on foot. If you stop, it reverts to IDLE; if you speed up,
     it goes to DRIVING.

  2. The Parking Detection Phase
   * DRIVING: Once in this state, the system looks for the vehicle to stop (speed < 0.5 km/h).
   * POSSIBLE_PARK: Triggered after the vehicle is stationary for 30 seconds.
       * The 2-Minute Test: The system stays in this state for 120 seconds. It collects multiple location points
         and ensures you remain within a 10m radius (stability check) while either being idle or walking away.
   * PARKED: If the 2-minute test passes, the system calculates the Average Location of all points collected
     during the stop (to filter out GPS drift) and saves it as your parking spot.

  3. The Leaving Phase
   * LEFT_AREA: Once you are 50m away from the car and walking, the system notes that you have left the vehicle.
   * POSSIBLE_RETURN: Triggered when you come back within 35m of the car.
   * RETURN_CONFIRMED: Confirmed when you are within 15m and walking (likely right next to the car).

  4. The Exit Phase
   * EXIT_CONFIRMED: Triggered when the system detects you are DRIVING again (speed > 15 km/h).
   * Back to IDLE: Once you stop again (e.g., at a light or your next destination), the old spot is cleared, and
     the cycle resets.

  Key Technical Safeguards:
   * Async Persistence: Every state change is saved to AsyncStorage so the state machine survives app restarts
     or background task termination.
   * Averaging: Instead of taking a single GPS point (which can be inaccurate near tall buildings), it averages
     two minutes of data to find the "true" center of the parking spot.

  To visualize the flow:
   * PARKED state: Checks if you have walked >30m away. If yes, it moves you to LEFT_AREA.
   * LEFT_AREA state: Checks if you have started walking back toward the car. If yes, it moves you to
     POSSIBLE_RETURN.
   * POSSIBLE_RETURN state: Checks if you have actually reached the car and started driving. If yes, it moves
     you to EXIT_CONFIRMED.
