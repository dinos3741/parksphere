
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

/**
 * Calculates the distance between two points on Earth using the Haversine formula.
 * @param {number} lat1 - Latitude of the first point
 * @param {number} lon1 - Longitude of the first point
 * @param {number} lat2 - Latitude of the second point
 * @param {number} lon2 - Longitude of the second point
 * @returns {number} - The distance in kilometers
 */
function getDistance(lat1, lon1, lat2, lon2) {
  console.log('getDistance inputs:', { lat1, lon1, lat2, lon2 });
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in km
  console.log('getDistance output:', distance);
  return distance;
}

module.exports = { getRandomPointInCircle, getDistance };
