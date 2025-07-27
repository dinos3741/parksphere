
/**
 * Generates a random point within a circle of radius (in meters) around a center point.
 * @param {number} lat - Latitude of the center
 * @param {number} lon - Longitude of the center
 * @param {number} radiusInMeters - Radius in meters
 * @returns {[number, number]} - [latitude, longitude] of the random point
 */
function getRandomPointInCircle(lat, lon, radiusInMeters) {
  const radiusInDegrees = radiusInMeters / 111320; // ~111.32km per degree
  const angle = Math.random() * 2 * Math.PI;
  const distance = Math.sqrt(Math.random()) * radiusInDegrees;

  const newLat = lat + distance * Math.cos(angle);
  const newLon = lon + distance * Math.sin(angle) / Math.cos(lat * Math.PI / 180);

  return [newLat, newLon];
}

module.exports = { getRandomPointInCircle };
