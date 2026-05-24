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
      { label: "Start Return", speed: 4, steps: 1.4, duration: 30, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "Pause at Window", speed: 0, steps: 0, duration: 15, accel: 1.0 },
      { label: "Slight Detour", speed: 4, steps: 1.4, duration: 15, moveDirection: 'AWAY', accel: 1.2 },
      { label: "Final Approach", speed: 5, steps: 1.7, duration: 40, moveDirection: 'TOWARD', accel: 1.2 },
      { label: "At Car Door", speed: 0.5, steps: 0.2, duration: 5, startDistance: 1.5, accel: 1.0 },
      { label: "Enter & Drive Away", speed: 45, steps: 0, duration: 30, moveDirection: 'AWAY', accel: 1.5 }
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
      { label: "Intermission (Far)", speed: 0, steps: 0, duration: 60, startDistance: 200, accel: 1.0 }, // 🚀 Reduced from 400m
      { label: "Ambiguous Return", speed: 10, steps: 2.2, duration: 30, moveDirection: 'TOWARD', accel: 1.4, activity: { walking: true, confidence: 2 } }, // 🚀 10s -> 30s (~83m)
      { label: "Pause/Looking", speed: 0, steps: 0.5, duration: 10, accel: 1.0 },
      { label: "Final Sprint Back", speed: 8, steps: 2.8, duration: 40, moveDirection: 'TOWARD', accel: 1.3 }, // 🚀 30s -> 40s (~88m). Total: 83+88=171m. 200-171 = 29m (within return zone)
      { label: "Back in Car", speed: 0, steps: 0, duration: 10, startDistance: 0.5, accel: 1.0 },
      { label: "Drive Away", speed: 40, steps: 0, duration: 30, moveDirection: 'AWAY', accel: 1.4 }
    ]
  }
};
