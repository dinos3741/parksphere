/**
 * Simulation Scenarios for HMM Testing
 * Each scenario is a sequence of states with specific sensor and GPS data.
 */

export const SCENARIOS = {
  HAPPY_PATH: {
    name: "Happy Path: Drive & Park",
    description: "Drive at 50km/h, stop, and walk away from the car.",
    steps: [
      { label: "Engine Start", speed: 0, steps: 0, duration: 2, accel: 1.0 },
      { label: "Driving (50 km/h)", speed: 50, steps: 0, duration: 30, accel: 1.2, moveDirection: 'AWAY' },
      { label: "Stopping", speed: 5, steps: 0, duration: 5, accel: 1.1, moveDirection: 'AWAY' },
      { label: "Parked (Still)", speed: 0, steps: 0, duration: 10, accel: 1.0 },
      { label: "Walking Away", speed: 5, steps: 1.8, duration: 20, accel: 1.2, moveDirection: 'AWAY' }
    ]
  },
  BUS_TRIP: {
    name: "The Bus Trip (Fix Test)",
    description: "Start far from car, take a bus, get off and walk.",
    steps: [
      { label: "Waiting at Bus Stop", speed: 0, steps: 0, duration: 10, accel: 1.0, startDistance: 200 },
      { label: "Bus Driving", speed: 35, steps: 0, duration: 35, accel: 1.3, moveDirection: 'AWAY' },
      { label: "Bus Stop (Idle)", speed: 0, steps: 0, duration: 10, accel: 1.0 },
      { label: "Get off & Walk", speed: 4, steps: 1.5, duration: 15, accel: 1.2, moveDirection: 'AWAY' }
    ]
  },
  RETURN_TO_CAR: {
    name: "Returning to Car",
    description: "Walk toward car, enter, and drive away.",
    steps: [
      { label: "Walking to Car", speed: 4.5, steps: 1.7, duration: 20, accel: 1.2, startDistance: 60, moveDirection: 'TOWARD' },
      { label: "Standing at Door", speed: 0.5, steps: 0.2, duration: 10, accel: 1.0, startDistance: 2 },
      { label: "Inside Car (Still)", speed: 0, steps: 0, duration: 10, accel: 1.0, startDistance: 0.5 },
      { label: "Driving Away", speed: 30, steps: 0, duration: 15, accel: 1.4, moveDirection: 'AWAY' }
    ]
  },
  INDOOR_JITTER: {
    name: "Indoor Stability",
    description: "Simulate indoor GPS wander and walking in house.",
    steps: [
      { label: "Sitting (GPS Jump)", speed: 12, steps: 0, duration: 10, accel: 1.0 },
      { label: "Walking in Kitchen", speed: 3, steps: 1.2, duration: 15, accel: 1.2 },
      { label: "GPS Jump (25 km/h)", speed: 25, steps: 0.8, duration: 10, accel: 1.1 }
    ]
  },
  REAL_LIFE_ODYSSEY: {
    name: "Real-Life Odyssey",
    description: "Walk to car, drive with traffic, park, walk away, wait, return via detour, and drive again.",
    steps: [
      { label: "Idle at Home", speed: 0, steps: 0, duration: 10, accel: 1.0 },
      { label: "Walk to Car", speed: 4, steps: 1.5, duration: 25, startDistance: 40, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "Enter Car", speed: 0, steps: 0, duration: 10, startDistance: 0.5, accel: 1.0 },
      { label: "Drive (Stage 1)", speed: 40, steps: 0, duration: 30, moveDirection: 'AWAY', accel: 1.3 },
      { label: "Traffic Light", speed: 0, steps: 0, duration: 20, accel: 1.0 },
      { label: "Drive (Stage 2)", speed: 65, steps: 0, duration: 40, moveDirection: 'AWAY', accel: 1.4 },
      { label: "Park & Wait", speed: 0, steps: 0, duration: 60, accel: 1.0 },
      { label: "Walk Away", speed: 4.5, steps: 1.8, duration: 30, moveDirection: 'AWAY', accel: 1.2 },
      { label: "Long Wait (Coffee)", speed: 0, steps: 0, duration: 120, startDistance: 250, accel: 1.0 },
      { label: "Start Return", speed: 4, steps: 1.4, duration: 30, startDistance: 120, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "Pause at Window", speed: 0, steps: 0, duration: 15, startDistance: 60, accel: 1.0 },
      { label: "Final Approach", speed: 5, steps: 1.7, duration: 40, startDistance: 30, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "At Car Door", speed: 0.5, steps: 0.2, duration: 10, startDistance: 1.5, moveDirection: 'TOWARD', accel: 1.0 },
      { label: "Enter & Drive Away", speed: 45, steps: 0, duration: 60, startDistance: 0.5, moveDirection: 'AWAY', accel: 1.5, bluetoothConnected: true }
    ]
  },
  EXTREME_ODYSSEY: {
    name: "Extreme Odyssey (Edge Case Stress)",
    description: "Trip with GPS spikes, tunnels, stoplight fidgeting, running vs driving, and detour return.",
    steps: [
      { label: "GPS Jitter (Home)", speed: 12, steps: 0, duration: 5, accuracy: 80, accel: 1.0 },
      { label: "Walk to Car", speed: 5, steps: 1.8, duration: 25, startDistance: 35, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "Fidgeting in Seat", speed: 2, steps: 0.4, duration: 10, startDistance: 0.5, accel: 1.1 },
      { label: "Enter & Start", speed: 0, steps: 0, duration: 5, accel: 1.0 },
      { label: "Drive & GPS Spike", speed: 45, steps: 0, duration: 10, moveDirection: 'AWAY', accel: 1.3 },
      { label: "1s Spike (120km/h)", speed: 120, steps: 0, duration: 1, moveDirection: 'AWAY', accel: 1.0 },
      { label: "Drive (Resume)", speed: 50, steps: 0, duration: 15, moveDirection: 'AWAY', accel: 1.3 },
      { label: "Tunnel (Bad GPS)", speed: 45, steps: 0, duration: 10, accuracy: 250, accel: 1.0 },
      { label: "Stoplight Fidget", speed: 0, steps: 0.2, duration: 5, accel: 1.0 },
      { label: "Stoplight Creep", speed: 8, steps: 0, duration: 5, accel: 1.1 },
      { label: "Stoplight Wait", speed: 0, steps: 0, duration: 10, accel: 1.0 },
      { label: "Sprint to Park", speed: 80, steps: 0, duration: 20, moveDirection: 'AWAY', accel: 1.5 },
      { label: "Sudden Stop", speed: 0, steps: 0, duration: 30, accel: 1.0 },
      { label: "Walk Away (No Steps)", speed: 4, steps: 0, duration: 10, moveDirection: 'AWAY', accel: 1.1, activity: { walking: true, confidence: 1 } },
      { label: "Normal Walk Away", speed: 5, steps: 1.7, duration: 20, moveDirection: 'AWAY', accel: 1.2 },
      { label: "Intermission (Far)", speed: 0, steps: 0, duration: 60, startDistance: 200, accel: 1.0 }, 
      { label: "Ambiguous Return", speed: 10, steps: 2.2, duration: 30, moveDirection: 'TOWARD', accel: 1.4, activity: { walking: true, confidence: 2 } }, 
      { label: "Pause/Looking", speed: 0, steps: 0.5, duration: 10, accel: 1.0 },
      { label: "Final Sprint Back", speed: 8, steps: 2.8, duration: 40, moveDirection: 'TOWARD', accel: 1.3 }, 
      { label: "Back in Car", speed: 0, steps: 0, duration: 10, startDistance: 0.5, accel: 1.0, bluetoothConnected: true },
      { label: "Drive Away", speed: 40, steps: 0, duration: 45, moveDirection: 'AWAY', accel: 1.4, bluetoothConnected: true }
    ]
  },
  RESIDENTIAL_ARRIVAL: {
    name: "Residential Arrival (Indoor Jitter)",
    description: "User is near the car (inside house), moves around, then eventually enters the car.",
    steps: [
      { label: "Parked at Spot", speed: 0, steps: 0, duration: 5, accel: 1.0 },
      { label: "Indoor Jitter (Near)", speed: 1.5, steps: 0.8, duration: 50, startDistance: 6, accel: 1.1 },
      { label: "Walk to Car", speed: 3, steps: 1.4, duration: 10, startDistance: 10, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "Enter Car", speed: 0, steps: 0, duration: 10, startDistance: 0.5, accel: 1.0 }
    ]
  },
  PASS_BY_SPOT: {
    name: "Pass-By Spot (No Entry)",
    description: "User walks toward the car but passes it and continues walking away.",
    steps: [
      { label: "Approach Car", speed: 4, steps: 1.6, duration: 15, startDistance: 50, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "Passing Spot", speed: 4, steps: 1.6, duration: 5, startDistance: 5, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "Walk Away", speed: 4, steps: 1.6, duration: 20, startDistance: 2, moveDirection: 'AWAY', accel: 1.2 }
    ]
  },
  CITY_TRAFFIC_CLEANUP: {
    name: "City Traffic Cleanup (Regression Test)",
    description: "Stand near car (triggering proximity reset), then drive away slowly in traffic.",
    steps: [
      { label: "Walk to Car", speed: 4, steps: 1.5, duration: 20, startDistance: 30, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "Fumbling for Keys (Long)", speed: 0.2, steps: 0.1, duration: 60, startDistance: 1.5, accel: 1.0 },
      { label: "Enter Car", speed: 0, steps: 0, duration: 10, startDistance: 0.5, accel: 1.0 },
      { label: "Driving in Traffic", speed: 22, steps: 0, duration: 40, moveDirection: 'AWAY', accel: 1.2 }
    ]
  },
  GYM_FAILURE_REPRODUCTION: {
    name: "Gym Failure Reproduction (The Real Test)",
    description: "Mirrors the exact user experience: Walking to car, stop-and-go driving, parking, walking near car, and quick departure.",
    steps: [
      { label: "Walk to Car", speed: 4, steps: 1.5, duration: 25, startDistance: 45, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "Getting In", speed: 0.5, steps: 0.2, duration: 8, startDistance: 1.5, accel: 1.0 },
      { label: "Drive: City Start", speed: 25, steps: 0, duration: 30, moveDirection: 'AWAY', accel: 1.3 },
      { label: "Stop: Red Light", speed: 0, steps: 0, duration: 15, accel: 1.0 },
      { label: "Drive: Speeding Up", speed: 45, steps: 0, duration: 40, moveDirection: 'AWAY', accel: 1.4 },
      { label: "Stop: Arrival", speed: 5, steps: 0, duration: 10, accel: 1.1 },
      { label: "Parked (Gym)", speed: 0, steps: 0, duration: 20, accel: 1.0 },
      { label: "Walk Away", speed: 4.5, steps: 1.8, duration: 25, moveDirection: 'AWAY', accel: 1.2 },
      { label: "Wait (Gym Session)", speed: 0, steps: 0, duration: 120, startDistance: 150, accel: 1.0 },
      { label: "Approach Car", speed: 4, steps: 1.5, duration: 30, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "Walk Around (Yard)", speed: 2, steps: 1.0, duration: 40, startDistance: 6, accel: 1.1, accuracy: 40 }, // GPS Noise
      { label: "Quick Entry", speed: 1.5, steps: 0.5, duration: 5, startDistance: 2, moveDirection: 'TOWARD', accel: 1.0 },
      { label: "Drive Away Fast", speed: 35, steps: 0, duration: 45, moveDirection: 'AWAY', accel: 1.5, bluetoothConnected: true }
    ]
  },
  CLOSE_PROXIMITY_PARKING: {
    name: "Close-Proximity Parking (The Bench Test)",
    description: "Drive, park, and sit on a bench 3m away. Then drive off without ever having 'left' the car's vicinity.",
    steps: [
      { label: "Initial Drive", speed: 45, steps: 0, duration: 30, moveDirection: 'AWAY', accel: 1.4 },
      { label: "Park & Exit", speed: 0, steps: 0, duration: 15, accel: 1.0 },
      { label: "Walk to Bench", speed: 2, steps: 0.8, duration: 5, moveDirection: 'AWAY', startDistance: 0.5, accel: 1.1 },
      { label: "Sitting (3m away)", speed: 0.2, steps: 0, duration: 60, startDistance: 3.5, accel: 1.0 }, // Stay close for 1 min
      { label: "Walk back to Car", speed: 2, steps: 0.8, duration: 5, moveDirection: 'TOWARD', startDistance: 3.5, accel: 1.1 },
      { label: "Enter & Drive", speed: 30, steps: 0, duration: 45, moveDirection: 'AWAY', accel: 1.3, bluetoothConnected: true }
    ]
  },
  BUS_COMMUTE_STRESS: {
    name: "Bus Commute Stress (The Long Test)",
    description: "Drive to a spot, walk to a bus, travel 5km away, return an hour later, and drive home.",
    steps: [
      { label: "Walk to Car", speed: 4, steps: 1.5, duration: 20, startDistance: 30, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "Getting In", speed: 0.5, steps: 0.2, duration: 5, startDistance: 1.5, accel: 1.0 },
      { label: "Drive to Spot", speed: 40, steps: 0, duration: 30, moveDirection: 'AWAY', accel: 1.3 },
      { label: "Park & Exit", speed: 0, steps: 0, duration: 15, accel: 1.0 },
      { label: "Walk to Bus Stop", speed: 4.5, steps: 1.8, duration: 25, moveDirection: 'AWAY', accel: 1.2 },
      { label: "Wait at Bus Stop", speed: 0.5, steps: 0.1, duration: 15, startDistance: 120, accel: 1.0 },
      { label: "Bus Ride Away", speed: 45, steps: 0, duration: 100, moveDirection: 'AWAY', accel: 1.1 }, // Travels ~1.25km
      { label: "Wait at Dest", speed: 0, steps: 0, duration: 60, startDistance: 1370, accel: 1.0 }, 
      { label: "Bus Ride Return", speed: 45, steps: 0, duration: 100, moveDirection: 'TOWARD', startDistance: 1370, accel: 1.1 },
      { label: "Walk back to Car", speed: 4, steps: 1.5, duration: 30, moveDirection: 'TOWARD', startDistance: 120, accel: 1.2 },
      { label: "Getting In (Final)", speed: 0.5, steps: 0.2, duration: 10, startDistance: 1.5, accel: 1.0, bluetoothConnected: true },
      { label: "Drive Home", speed: 40, steps: 0, duration: 45, moveDirection: 'AWAY', accel: 1.4, bluetoothConnected: true }
    ]
  },
  OFFSET_SPOT_DEPARTURE: {
    name: "Offset Spot Departure (Inaccuracy Test)",
    description: "Parking spot is detected 18m away from car. Tests if system can still clear spot upon departure.",
    steps: [
      { label: "Initial Drive", speed: 40, steps: 0, duration: 20, moveDirection: 'AWAY', accel: 1.3 },
      { label: "Park & Exit", speed: 0, steps: 0, duration: 10, accel: 1.0 },
      { label: "Walk Away", speed: 4, steps: 1.5, duration: 20, moveDirection: 'AWAY', startDistance: 18, accel: 1.2 }, // User is actually 18m from the 'logic' spot
      { label: "Wait (Away)", speed: 0, steps: 0, duration: 30, startDistance: 150, accel: 1.0 },
      { label: "Return to Car", speed: 4, steps: 1.5, duration: 25, moveDirection: 'TOWARD', startDistance: 18, accel: 1.2 },
      { label: "Getting In", speed: 0.5, steps: 0.2, duration: 10, startDistance: 18, accel: 1.0, bluetoothConnected: true }, 
      { label: "Drive Away", speed: 35, steps: 0, duration: 45, moveDirection: 'AWAY', startDistance: 18, accel: 1.4, bluetoothConnected: true }
    ]
  },
  CLOSE_WALK_PASS_BY: {
    name: "Close Walk Pass-By (No Entry)",
    description: "User walks around the car at a 5-15m distance but never enters. Tests for false 'Returning' triggers.",
    steps: [
      { label: "Park & Exit", speed: 0, steps: 0, duration: 10, accel: 1.0 },
      { label: "Walk to Sidewalk", speed: 3, steps: 1.2, duration: 10, moveDirection: 'AWAY', startDistance: 2, accel: 1.1 },
      { label: "Walk Parallel (5m)", speed: 3, steps: 1.2, duration: 20, startDistance: 5, moveDirection: 'TOWARD', accel: 1.1 }, // Walking 'toward' but only to a point
      { label: "Loop Around (15m)", speed: 4, steps: 1.5, duration: 20, startDistance: 15, moveDirection: 'AWAY', accel: 1.1 },
      { label: "Walk Past Again (8m)", speed: 3.5, steps: 1.4, duration: 20, startDistance: 8, moveDirection: 'TOWARD', accel: 1.1 },
      { label: "Finally Leave", speed: 5, steps: 1.8, duration: 30, startDistance: 15, moveDirection: 'AWAY', accel: 1.2 }
    ]
  },
  FIELD_TEST_REPLICA: {
    name: "Field Test Replica (Today's Observations)",
    description: "Mimics the drive-park-return cycle with specific focus on the 7m approach flip and home-parking notification spam.",
    steps: [
      { label: "Initial Drive", speed: 45, steps: 0, duration: 40, moveDirection: 'AWAY', accel: 1.4 },
      { label: "Park at Work", speed: 0, steps: 0, duration: 15, accel: 1.0 },
      { label: "Walk Away", speed: 4.5, steps: 1.8, duration: 30, moveDirection: 'AWAY', accel: 1.2 },
      { label: "Coffee Break (Far)", speed: 0, steps: 0, duration: 60, startDistance: 150, accel: 1.0 },
      { label: "Start Return", speed: 4, steps: 1.5, duration: 30, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "Close Approach (7m)", speed: 1.2, steps: 0.5, duration: 15, moveDirection: 'TOWARD', accel: 1.0 },
      { label: "Get In & Leave", speed: 35, steps: 0, duration: 45, moveDirection: 'AWAY', accel: 1.5, bluetoothConnected: true },
      { label: "Drive Home", speed: 50, steps: 0, duration: 45, moveDirection: 'TOWARD', accel: 1.4 }, 
      { label: "Park at Home", speed: 0, steps: 0, duration: 20, accel: 1.0 }, 
      { label: "Enter House", speed: 3, steps: 1.2, duration: 30, moveDirection: 'AWAY', accel: 1.2, bluetoothConnected: false },
      { label: "Sitting (Drift 1)", speed: 0.5, steps: 0.1, duration: 10, moveDirection: 'AWAY', accel: 1.0 },
      { label: "Sitting (Drift 2)", speed: 1.5, steps: 0.3, duration: 5, moveDirection: 'TOWARD', accel: 1.1 },
      { label: "Sitting (Drift 3)", speed: 0.5, steps: 0.1, duration: 5, moveDirection: 'AWAY', accel: 1.0 },
      { label: "Sitting (Final)", speed: 0, steps: 0, duration: 20, accel: 1.0 }
    ]
  },
  TRAFFIC_STRESS: {
    name: "Traffic Stress (Stop-and-Go)",
    description: "Repeated stops at traffic lights to test speed filter responsiveness and state agility.",
    steps: [
      { label: "Start Driving", speed: 30, steps: 0, duration: 15, moveDirection: 'AWAY', accel: 1.3 },
      { label: "Red Light 1", speed: 0, steps: 0, duration: 15, accel: 1.0 },
      { label: "Short Block", speed: 25, steps: 0, duration: 10, moveDirection: 'AWAY', accel: 1.2 },
      { label: "Red Light 2", speed: 0, steps: 0, duration: 15, accel: 1.0 },
      { label: "Medium Block", speed: 45, steps: 0, duration: 20, moveDirection: 'AWAY', accel: 1.3 },
      { label: "Red Light 3", speed: 0, steps: 0, duration: 20, accel: 1.0 },
      { label: "Final Park", speed: 5, steps: 0, duration: 5, accel: 1.1 },
      { label: "Exit Car", speed: 0, steps: 0, duration: 15, accel: 1.0 },
      { label: "Walk Away", speed: 4.5, steps: 1.8, duration: 30, moveDirection: 'AWAY', accel: 1.2 }
    ]
  }
};
