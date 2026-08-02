import React, { memo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import MapView, { Marker, Circle } from 'react-native-maps';
import HMMOverlay from './HMMOverlay';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '../context/AuthContext';

const Map = memo(({
  userLocation,
  locationPermissionGranted,
  parkingSpots,
  handleSpotPress,
  handleCenterMap,
  mapViewRef,
  setSpotDetailsVisible,
  isAddingSpot,
  setIsAddingSpot,
  setNewSpotCoordinates,
  setShowTimeOptionsModal,
  acceptedSpot,
  parkedLocation,
}) => {
  const { userId } = useAuth();

  return (
    <View style={styles.mapScreenContainer}>
      {userLocation ? (
        <MapView
          ref={mapViewRef}
          style={styles.map}
          initialRegion={
            userLocation || (parkingSpots.length > 0
              ? {
                  latitude: parseFloat(parkingSpots[0].latitude),
                  longitude: parseFloat(parkingSpots[0].longitude),
                  latitudeDelta: 0.0922,
                  longitudeDelta: 0.0421,
                }
              : {
                  latitude: 40.6401,
                  longitude: 22.9444,
                  latitudeDelta: 0.0922,
                  longitudeDelta: 0.0421,
                })
          }
          showsUserLocation={locationPermissionGranted}
          // Measured from a device screenshot: the compass's native (unoffset) position sits with
          // its top ~17pt above the header's bottom edge (110pt), so a 10pt nudge still left it
          // clipped. y:28 clears the header with a small 10pt gap below it. x:-3 is a fine nudge —
          // the compass's default X already lands within ~3pt of the header "+" / center-map
          // button's shared center (both computed to sit 41.5pt from the screen edge) — to land
          // exactly on it.
          compassOffset={{ x: -3, y: 28 }}
          onPress={(e) => {
            if (isAddingSpot) {
              const { coordinate } = e.nativeEvent;
              setNewSpotCoordinates(coordinate);
              setShowTimeOptionsModal(true);
              setIsAddingSpot(false); // Exit adding spot mode after selection
            } else if (e.nativeEvent.action !== 'marker-press') {
              setSpotDetailsVisible(false);
            }
          }}
        >
          {parkedLocation && (
            <Marker
              coordinate={{ latitude: parkedLocation.latitude, longitude: parkedLocation.longitude }}
              title="Your Car"
              description="Where you parked"
            >
              <View style={styles.parkedMarkerContainer}>
                <View style={styles.parkedMarkerBubble}>
                  <MaterialCommunityIcons name="car-side" size={16} color="white" />
                </View>
                <View style={styles.parkedMarkerArrow} />
              </View>
            </Marker>
          )}
          {parkingSpots.map((spot) => {
            const isAccepted = acceptedSpot && spot.id === acceptedSpot.id;
            const displaySpot = isAccepted ? acceptedSpot : spot;

            const getStatusColor = (status) => {
              switch (status) {
                case 'soon_free': return 'yellow';  // SOFT zone: owner returning
                case 'committed': return 'green';   // COMMIT zone: owner about to leave
                case 'vacating': return 'red';      // owner driving away now
                case 'free': return 'green';
                case 'occupied':
                default: return 'red';
              }
            };

            const getStatusRgba = (status, alpha) => {
              switch (status) {
                case 'soon_free': return `rgba(255, 255, 0, ${alpha})`;
                case 'committed': return `rgba(0, 128, 0, ${alpha})`;
                case 'vacating': return `rgba(255, 0, 0, ${alpha})`;
                case 'free': return `rgba(0, 128, 0, ${alpha})`;
                case 'occupied':
                default: return `rgba(255, 0, 0, ${alpha})`;
              }
            };

            const statusColor = getStatusColor(displaySpot.status);

            return (
              <React.Fragment key={spot.id}>
                {spot.user_id === userId || isAccepted ? (
                  <Marker
                    coordinate={{ latitude: parseFloat(displaySpot.latitude), longitude: parseFloat(displaySpot.longitude) }}
                    onPress={() => handleSpotPress(displaySpot)}
                    pinColor={isAccepted ? "green" : statusColor}
                  />
                ) : (
                  <>
                    <Circle
                      center={{ latitude: parseFloat(spot.latitude), longitude: parseFloat(spot.longitude) }}
                      radius={200}
                      fillColor={getStatusRgba(spot.status, 0.2)}
                      strokeColor={getStatusRgba(spot.status, 0.8)}
                      strokeWidth={2}
                    />
                    <Marker
                      coordinate={{ latitude: parseFloat(spot.latitude), longitude: parseFloat(spot.longitude) }}
                      onPress={() => handleSpotPress(spot)}
                      anchor={{ x: 0.5, y: 0.5 }}
                    >
                      <View style={{ width: 40, height: 40, opacity: 0 }} />
                    </Marker>
                  </>
                )}
              </React.Fragment>
            );
          })}
        </MapView>
      ) : (
        <Text style={styles.messageText}>Getting your location...</Text>
      )}
      {isAddingSpot && (
        <View style={styles.crosshairContainer}>
          <View style={styles.crosshairHorizontal} />
          <View style={styles.crosshairVertical} />
        </View>
      )}

      <View style={styles.mapControls}>
        <TouchableOpacity style={styles.centerButton} onPress={handleCenterMap}>
          <Ionicons name="navigate" size={19} color="#0A84FF" style={styles.centerButtonIcon} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  mapScreenContainer: {
    flex: 1,
    width: '100%',
  },
  map: {
    flex: 1,
    width: '100%',
  },
  messageText: {
    fontSize: 18,
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
  },
  mapControls: {
    position: 'absolute',
    top: 172, // clears the floating header and the now-lower compass (compassOffset y:28 below), with a 10pt gap under it
    // Horizontally centered on the header's "+" button: that button is a 31pt icon + 6pt padding
    // (43pt wide) flush against the header's own 20pt edge inset, centering it 41.5pt from the
    // screen edge. This 44pt-wide button matches that same center: 41.5 - 44/2 = 19.5.
    right: 19.5,
    flexDirection: 'column',
  },
  centerButton: {
    backgroundColor: 'white',
    padding: 8,
    borderRadius: 22,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    width: 44, // measured from a device screenshot: the native compass is ~43.7pt across
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerButtonIcon: {
    // The glyph's own visual weight sits slightly off-center within its bounding box — nudges it
    // back to looking centered inside the round button.
    marginLeft: -2,
    marginTop: 2,
  },
  crosshairContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 30,
    height: 30,
    marginLeft: -15,
    marginTop: -15,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  crosshairHorizontal: {
    position: 'absolute',
    width: 30,
    height: 2,
    backgroundColor: 'red',
  },
  crosshairVertical: {
    position: 'absolute',
    width: 2,
    height: 30,
    backgroundColor: 'red',
  },
  parkedMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  parkedMarkerBubble: {
    backgroundColor: '#E53935',
    borderRadius: 20,
    padding: 6,
    borderWidth: 2,
    borderColor: 'white',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  parkedMarkerArrow: {
    backgroundColor: '#E53935',
    width: 10,
    height: 10,
    transform: [{ rotate: '45deg' }],
    marginTop: -6,
    borderBottomRightRadius: 2,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: 'white',
  },
});

export default Map;
