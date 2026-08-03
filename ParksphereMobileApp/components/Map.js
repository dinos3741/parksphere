import React, { memo, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, Easing } from 'react-native';
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
  getDistance,
  spotRadiusKm,
}) => {
  const { userId } = useAuth();
  const pulseAnim = useRef(new Animated.Value(0)).current;

  // Radar-ping loop while the user is aiming a manual spot placement — gives the crosshair a
  // continuous "drop it here" affordance instead of a static mark. Stops (and resets, so it
  // doesn't resume mid-cycle) as soon as adding-spot mode ends.
  useEffect(() => {
    if (!isAddingSpot) {
      pulseAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 1200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [isAddingSpot, pulseAnim]);

  const pulseScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2] });
  const pulseOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

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
          // clipped. y:38 clears the header with a 20pt gap below it (28 + a further 10pt nudge
          // down). x:-3 is a fine nudge — the compass's default X already lands within ~3pt of the
          // header "+" / center-map button's shared center (both computed to sit 41.5pt from the
          // screen edge) — to land exactly on it.
          compassOffset={{ x: -3, y: 38 }}
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
            const isOwnOrAccepted = spot.user_id === userId || isAccepted;

            // Radius filter only applies to other users' unaccepted spots — you should always see
            // your own declared spot, and any spot you've already committed to, regardless of
            // distance.
            if (!isOwnOrAccepted && userLocation && getDistance && spotRadiusKm != null) {
              const distanceMeters = getDistance(
                userLocation.latitude, userLocation.longitude,
                parseFloat(spot.latitude), parseFloat(spot.longitude)
              );
              if (distanceMeters > spotRadiusKm * 1000) return null;
            }

            return (
              <React.Fragment key={spot.id}>
                {isOwnOrAccepted ? (
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
        <>
          <View style={styles.addingSpotHint} pointerEvents="none">
            <Text style={styles.addingSpotHintText}>Locate the crosshair at your parked spot, then tap</Text>
          </View>
          <View style={styles.crosshairContainer} pointerEvents="none">
            <Animated.View
              style={[
                styles.crosshairPulse,
                { opacity: pulseOpacity, transform: [{ scale: pulseScale }] },
              ]}
            />
            <View style={styles.crosshairPlus}>
              <View style={styles.crosshairHorizontal} />
              <View style={styles.crosshairVertical} />
            </View>
          </View>
        </>
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
    // Row-aligned with the native compass (measured from a device screenshot at ~111pt from the
    // top, with compassOffset y:38 applied above, +10pt to match) — both are ~44pt, so matching
    // tops matches centers too.
    top: 121,
    // Column-aligned with the Venio logo: header's paddingHorizontal is 20, and the 44pt logo's
    // center sits at 20 + 44/2 = 42pt from the screen edge. This 44pt-wide button matches that
    // same center: 42 - 44/2 = 20.
    left: 20,
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
  addingSpotHint: {
    position: 'absolute',
    // Sits right above the crosshair (whose container is top:'50%', height 60, marginTop:-30, so
    // its top edge is at 50%-30) with a ~12pt gap above it — no card/background, just a quiet
    // caption floating over the map, kept legible via a soft white text-shadow instead of a solid
    // backing. Constrained + wrapping rather than one long line, so it folds to two lines instead
    // of overflowing off the sides of narrower screens.
    top: '50%',
    marginTop: -80,
    alignSelf: 'center',
    maxWidth: '68%',
  },
  addingSpotHintText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(60,60,67,0.7)',
    letterSpacing: 0.2,
    textAlign: 'center',
    textShadowColor: 'rgba(255,255,255,0.9)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
  crosshairContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 60,
    height: 60,
    marginLeft: -30,
    marginTop: -30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Expanding, fading ring behind the plus sign — loops via pulseAnim while isAddingSpot is true.
  crosshairPulse: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E53935', // matches parkedMarkerBubble's red, not the plain 'red' used before
  },
  crosshairPlus: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  crosshairHorizontal: {
    position: 'absolute',
    width: 40,
    height: 2,
    backgroundColor: '#E53935',
  },
  crosshairVertical: {
    position: 'absolute',
    width: 2,
    height: 40,
    backgroundColor: '#E53935',
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
