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
  }
};
