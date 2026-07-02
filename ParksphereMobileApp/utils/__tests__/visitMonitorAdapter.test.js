import { visitMonitorToLocation } from '../visitMonitorAdapter';

describe('visitMonitorToLocation', () => {
  it('maps a VisitMonitor fix onto the expo-location shape the HMM expects', () => {
    const fix = {
      latitude: 40.5805,
      longitude: 23.0092,
      accuracy: 6.9,
      altitude: 171.3,
      speed: 3.2, // m/s
      course: 73.2,
      timestamp: 1782937759476,
    };
    const loc = visitMonitorToLocation(fix);
    expect(loc.coords.latitude).toBe(40.5805);
    expect(loc.coords.longitude).toBe(23.0092);
    expect(loc.coords.accuracy).toBe(6.9);
    expect(loc.coords.altitude).toBe(171.3);
    expect(loc.coords.speed).toBe(3.2); // m/s passes straight through
    expect(loc.coords.heading).toBe(73.2); // course → heading
    expect(loc.timestamp).toBe(1782937759476);
  });

  it('passes unknown speed (-1) through unchanged (both use -1 = unknown)', () => {
    const loc = visitMonitorToLocation({ latitude: 1, longitude: 2, speed: -1, course: -1, timestamp: 10 });
    expect(loc.coords.speed).toBe(-1);
    expect(loc.coords.heading).toBe(-1);
  });
});
