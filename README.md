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

Hidden Markov Model sopution
=============================
  parkDetection_HMM.js (Hidden Markov Model):
   * This file defines the states the system can be in (e.g., 'IDLE', 'WALKING', 'DRIVING', 'STOPPED', 'PARKED', 'WALKING_AWAY', etc.).
   * It uses a transition matrix (A) to define the probability of moving from one state to another. For example, from 'DRIVING', there's a high probability of staying 'DRIVING', a moderate probability of transitioning to 'STOPPED', and a small probability of transitioning to 'PARKED'.
   * The emissionLogProb function calculates the probability of observing certain data (like speed, distance to a parked location, and Apple's motion activity) given a particular state. This is how the model "emits" probabilities based on sensor data.
   * The processLocationHMM function takes location data and updates the model's belief about the current state using the observed data and the transition probabilities.
   * It relies on the react-native-motion-activity-tracker library to get apple_activity and apple_confidence for more accurate state inference.
   * The stableStateUpdate function seems to decide the current state based on the highest probability from the HMM, but only updates if the confidence is high.

  parkDetectionService.js (Service Layer):
   * This file manages the overall park detection service.
   * It uses expo-location to get location updates and expo-task-manager to run the detection logic in the background.
   * startParkDetection requests location and motion activity permissions, initializes the HMM tracking, and starts the background task.
   * handleLocationUpdate is the core function that receives location data, retrieves the previous state from storage (AsyncStorage), processes it through the HMM (processLocationHMM), and determines the new state.
   * It has side effects for certain state transitions:
       * When 'PARKED' is confirmed, it stores the parkedLocation.
       * When transitioning to 'WALKING_AWAY' (and if no serverSpotId exists), it calls declareSpot to register the parking spot on the server.
       * It handles status updates on the server ('soon_free', 'free') when returning to the car.
   * stopParkDetection stops the background task.


     How Apple Motion is Integrated in the Current Code:
     ---------------------------------------------------

  In the parkDetection_HMM.js file, the emissionLogProb function handles the apple_activity and apple_confidence
  from the obs object.

   1. Categorical Treatment: The code explicitly checks the apple_activity string (e.g., 'AUTOMOTIVE',
      'WALKING', 'STATIONARY') and compares it against the current HMM state.
   2. Confidence Weighting: The apple_confidence is used to get a weight w (HIGH=1.0, MEDIUM=0.5, LOW=0.2).
   3. Log-Additive Boosts: Based on the match between apple_activity and the state, the function applies
      adjustments to the log probability (logp):
       * For matching activities (e.g., 'AUTOMOTIVE' activity when state is 'DRIVING'), it adds Math.log(1 + 2.5
         * w). This is a log-boost, effectively increasing the likelihood of that state.
       * For non-matching activities, it adds Math.log(0.001) or Math.log(0.01), which are small values
         representing a penalty or low probability.

Gaussian distributions of continuous observations (speed and distance to parked location)
-----------------------------------------------------------------------------------------
 1. Speed Observations (in km/h):

   * IDLE:
       * Mean: 0 km/h
       * Standard Deviation: 0.5 km/h
       * Realism: Very realistic for a completely stationary state.
   * WALKING / WALKING_AWAY / RETURNING:
       * Mean: 4.5 km/h
       * Standard Deviation: 1.5 km/h
       * Realism: Realistic for typical walking/jogging speeds (average walking speed is around 5 km/h).
   * DRIVING:
       * Mean: 40 km/h
       * Standard Deviation: 15 km/h
       * Realism: Seems reasonable for general driving, capturing a range from slower city traffic to moderate
         speeds.
   * STOPPED:
       * Mean: 0.3 km/h
       * Standard Deviation: 0.7 km/h
       * Realism: Realistic for very slow movement or near-standstill (e.g., traffic jams, traffic lights).
   * PARKED:
       * Mean: 0.2 km/h
       * Standard Deviation: 0.4 km/h
       * Realism: Realistic for very slow maneuvers during parking or slight vehicle drift.
   * AWAY:
       * Mean: 2 km/h
       * Standard Deviation: 5 km/h
       * Realism: This has a wider spread and a lower mean than walking. It might be intended to capture
         situations where the user is not actively walking but not necessarily driving either (e.g., standing,
         or moving very slowly in a confined space). The high standard deviation implies a broad range.
   * IN_CAR:
       * Mean: 1.5 km/h
  2. Distance to Parked Location (distToParked) Observations (in meters, assuming Earth's radius):

   * PARKED / IN_CAR:
       * Mean: 2 meters
       * Standard Deviation: 5 meters
       * Realism: Realistic for being very close to the last known parking spot.
   * WALKING_AWAY:
       * Mean: 30 meters
       * Standard Deviation: 20 meters
       * Realism: Realistic for walking away from the vehicle, covering a moderate distance.
   * RETURNING:
       * Mean: 15 meters
       * Standard Deviation: 15 meters
       * Realism: Realistic for being closer to the vehicle than when walking away, but not yet inside.
   * AWAY:
       * Mean: 100 meters
       * Standard Deviation: 50 meters
       * Realism: Realistic for being significantly distant from the parked vehicle.


  Areas that might benefit from tuning:

   * AWAY State Speed: The speed parameters for AWAY (mean=2, std=5) are quite broad and overlap significantly with WALKING states. If AWAY is primarily about distance and less about specific movement, the speed model might be less critical or could be simplified.
   * State Overlap and Disambiguation: While generally good, there's natural overlap (e.g., STOPPED vs. PARKED can have similar low speeds). The model relies on the combination of speed, distToParked, and
  apple_activity to disambiguate. If one of these sources of information is weak or missing (e.g.,
   apple_activity not available), accuracy might decrease.
   * Empirical Testing: The "realism" is best validated through empirical testing. By observing the HMM's confidence distribution (belief) and the inferred currentState during real-world driving/parking scenarios,
     you can identify specific situations where the model struggles. For example:
       * If the model frequently transitions between STOPPED and PARKED incorrectly.
       * If it fails to recognize PARKED when the car is stationary for a long time.
       * If AWAY or WALKING_AWAY states are triggered at inappropriate times.



  Potential issues for not detecting parking:
  ------------------------------------------------

   1. Low Confidence in HMM State: The stableStateUpdate function only updates currentState if the confidence for the best state is > 0.85. If the HMM never reaches a high confidence for the 'PARKED' state, it won't be registered. This could happen if:
       * Speed data is inconsistent: If the speed remains too high or fluctuates unexpectedly when it should be low/zero.
       * Motion activity data is misleading or unavailable: If the Apple Motion Activity tracker is not working correctly, or if its reported activity (e.g., 'AUTOMOTIVE' when stopped, or 'WALKING' when in a car)
         doesn't align with the state.
       * Distance to parked location is not helpful: If distToParked is null or its values don't help
         differentiate states.
       * Transition probabilities are not well-tuned: The probabilities in the A matrix might need adjustment.
         For example, the transition from 'STOPPED' to 'PARKED' might be too low (currently 0.2), or the
         conditions for transitioning to 'PARKED' from 'DRIVING' might be too strict.

   2. Insufficient Data for HMM: The HMM relies on a sequence of observations. If the app is only receiving
      sporadic location updates or if the sensor data within those updates is not clear enough, the HMM might
      struggle to infer the 'PARKED' state.

   3. react-native-motion-activity-tracker issues: The initMotionTracking function has a try...catch block and a
      warning if it's running in Expo Go, suggesting it might not work in all environments. If this is not
      functioning, a key input for the HMM is missing.

   4. Server-side interaction delay/failure: While less likely to prevent detection, if declareSpot or
      updateSpotStatus fail silently, it could lead to a poor user experience, making it seem like parking
      wasn't detected when it actually was, but the system didn't register it.

  Troubleshooting Steps:

   1. Enable Verbose Logging: Modify the parkDetectionService.js and parkDetection_HMM.js to log more detailed
      information, especially:
       * The output of processLocationHMM (the calculated obs and the resulting newState and belief).
       * The lastActivityType and lastConfidence from the motion tracker.
       * The currentState before and after stableStateUpdate.
       * The confidence score in stableStateUpdate.

   2. Test in Controlled Environment:
       * Drive to a familiar parking spot.
       * Manually trigger the logging in the app (if possible, or by making code changes).
       * Observe the logged states and probabilities as you park and then leave the vehicle.
       * See if the HMM briefly enters 'PARKED' with high confidence, or if it stays in 'STOPPED' or moves to
         'WALKING_AWAY' too quickly.

   3. Inspect Motion Activity Tracker:
       * Add specific logging around MotionActivity.startTracking() and the addMotionStateChangeListener
         callback in parkDetection_HMM.js to ensure it's receiving data correctly.
       * Check if the react-native-motion-activity-tracker is compatible with the specific device and OS version
         being used.

   4. Tune HMM Parameters:
       * Adjust the transition probabilities in the A matrix in parkDetection_HMM.js. For example, increasing
         the probability of transitioning from STOPPED to PARKED or from DRIVING to PARKED might help.
       * Adjust the logGaussian parameters (mean and standard deviation) in emissionLogProb if the observed
         speed or distance values don't align well with the current model assumptions for the 'PARKED' state.

REAL TIME INFER OF STATE
========================
  In essence, the goal is to continuously update the probability distribution of the system's current state, given all the observations received up to the current moment and the model's parameters (transition anD emission probabilities).

  Here's how it's implemented in your code:

   1. Belief Distribution (belief):
       * The variable belief in parkDetection_HMM.js stores the probability distribution over all possible
         states (e.g., {'IDLE': 0.8, 'WALKING': 0.15, ...}). This represents P(State | Observations up to t-1).
       * It's initialized to {'IDLE': 1.0} and all others to 0.0 when the HMM is reset.

   2. Processing New Observations (processLocationHMM):
       * Whenever a new location update arrives, processLocationHMM is called. This function takes the new
         location data (which is processed into an obs object containing speed, distToParked, apple_activity,
         apple_confidence) and the parkedLocation.
       * It then calls updateBelief with the current belief (from the previous step) and the new obs.

   3. Updating the Belief (updateBelief function):
      This function performs the crucial forward filtering step. For each possible current state s:
       * Prediction (Transition Step): It first calculates the probability of reaching state s from any previous
         state sp, using the transition matrix A. This is done by summing prevBelief[sp] * A[sp][s] for all sp.
         This gives a "prior" belief for state s at time t, before considering the new observation.

   1         let sum = 0;
   2         for (const sp of STATES) {
   3           // Probability of previous state sp * probability of transitioning from sp to s
   4           sum += prevBelief[sp] * ((A[sp]?.[s]) || 0.0001);
   5         }
   6         // At this point, 'sum' is the prior probability of being in state 's'
       * Update (Correction Step using Emission): It then multiplies this prior probability by the likelihood of
         observing the new data (obs) given that the system is in state s. This likelihood is calculated by
         emissionLogProb(s, obs). Since emissionLogProb returns a log probability, this multiplication in the
         original probability space becomes an addition in the log space: newBelief[s] = prior_probability *
         emission_probability. In log space, this translates to:

   1         // log(newBelief[s]) = log(prior_probability) + log(emission_probability)
   2         // The code does: newBelief[s] = sum * Math.exp(emissionLogProb(s, obs));
   3         // where 'sum' is derived from prevBelief and A (prior probability)
   4         // and Math.exp(emissionLogProb(s, obs)) is the emission probability.
   5         newBelief[s] = sum * Math.exp(emissionLogProb(s, obs));
       * Normalization: Finally, it normalizes the newBelief probabilities so they sum up to 1.

   1         const total = Object.values(newBelief).reduce((a, b) => a + b, 0) || 1;
   2         for (const s of STATES) newBelief[s] /= total;

   4. Determining the Most Likely State (stableStateUpdate):
       * After updateBelief calculates the new posterior belief distribution (newBelief), stableStateUpdate
         identifies the state with the highest probability.
       * It then decides whether to update the currentState based on a confidence threshold (0.85 in this case).

  In summary:
  The processLocationHMM function, by calling updateBelief with the previous belief and the latest observation,
  performs a step of the forward filtering algorithm. Each new observation recursively updates the belief
  distribution about the current state of the world. The belief variable is continuously updated, and
  stableStateUpdate provides the most probable current state. This is precisely how real-time state inference
  works with an HMM.You're asking about the real-time state inference process, which is a core function of
  Hidden Markov Models (HMMs). In HMMs, this is achieved through a recursive update of the belief distribution.
  It's often conceptualized as a form of forward filtering where the model continuously updates its belief about
  the current state based on new observations.

  Here's how it works in your code, specifically within parkDetection_HMM.js:

   1. Belief Distribution (belief):
       * The belief variable holds the probability distribution over all possible states (STATES) at a given
         time step. It represents P(State_t | Observations_1...t-1).
       * When the system starts or resets, belief is initialized with a high probability for the IDLE state and
         zero for others.

   2. Processing New Observations (processLocationHMM):
       * This function is called every time a new location update (and associated sensor data) arrives. It takes
         the latest observation (location) and the previous state data.
       * It derives the obs object (containing speed, distToParked, apple_activity, apple_confidence).
       * It then calls updateBelief to compute the new belief distribution based on the previous belief and the
         new obs.

   3. The Recursive Update (updateBelief function):
      This is where the "forward filtering" happens step-by-step for each new observation.
       * Prediction (Transition Step): For each potential current state s, the code calculates the probability
         of being in s based on the previous state distribution and the transition probabilities.

   1         // For each possible current state 's':
   2         let sum = 0;
   3         for (const sp of STATES) { // Iterate through all previous states 'sp'
   4           // Add the probability of being in state 'sp' previously, multiplied by the probability of
     transitioning from 'sp' to 's'.
   5           sum += prevBelief[sp] * ((A[sp]?.[s]) || 0.0001);
   6         }
   7         // 'sum' now represents the prior probability of being in state 's' at time 't',
   8         // *before* considering the new observation.
       * Update (Correction Step using Emission): The prior probability is then combined with the likelihood of
         the new observation obs given state s. This likelihood is calculated using emissionLogProb(s, obs).
         Since emissionLogProb returns log probabilities, the multiplication in probability space becomes an
         addition in log space:

   1         // newBelief[s] = prior_probability_of_s * emission_probability_of_obs_given_s
   2         // The code uses:
   3         newBelief[s] = sum * Math.exp(emissionLogProb(s, obs));
   4         // This combines the prior belief ('sum') with the likelihood from the observation.
       * Normalization: The resulting probabilities for all states are normalized so they sum to 1.

   1         const total = Object.values(newBelief).reduce((a, b) => a + b, 0) || 1;
   2         for (const s of STATES) newBelief[s] /= total;

   4. Determining the Current State (stableStateUpdate):
       * After updateBelief calculates the new, posterior belief distribution (newBelief), stableStateUpdate
         identifies the state with the highest probability.
       * It then decides whether to officially update the system's currentState based on a confidence threshold.

  In essence, processLocationHMM is called repeatedly with new observations. Each call takes the belief from the
  previous step, uses the transition probabilities to predict the next state's likelihood, and then uses the
  emission probabilities (from emissionLogProb) to correct this prediction based on the new data. This recursive
  process refines the belief distribution over states with every new observation, providing a real-time
  estimation of the current state.

✦ The frequency of state updates is determined by the configuration of the background location tracking service.

  In the startParkDetection function within parkDetectionService.js, the Location.startLocationUpdatesAsync
  method is called with the following parameters:

   * timeInterval: 5000: This means the location service will attempt to provide updates at least every 5000
     milliseconds (5 seconds).
   * deferredUpdatesInterval: 5000: This is also set to 5000ms. This setting allows for delivering location
     updates in batches, and this interval influences how often those batches are processed.

  Therefore, the HMM state is updated approximately every 5 seconds, assuming location data is available and
  being processed by the PARK_DETECTION_TASK which calls handleLocationUpdate and subsequently
  processLocationHMM.
