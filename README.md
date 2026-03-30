Parksphere is a real-time parking coordination platform with web and mobile apps that helps drivers share and find available parking spots more efficiently. Users can register, post when they are leaving a spot, browse nearby opportunities on a map, and send requests to claim a space, while the system manages acceptance, arrival, and completion updates through live notifications and chat. The backend handles authentication, location-aware data, and transaction flow, so both drivers and spot holders can coordinate quickly and safely from start to finish.

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
