import React, { memo, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, Easing, DeviceEventEmitter } from 'react-native';
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
  // Last known zoom level (from the user's own pinch/pan, or the initial region) — reused by the
  // auto-follow effect below so re-centering on a fresh location update never resets how zoomed in
  // the user currently is.
  const currentDeltasRef = useRef({ latitudeDelta: 0.0922, longitudeDelta: 0.0421 });

  // 2026-08-05: the map only ever centered once, on mount (initialRegion) — moving around afterward
  // kept showing wherever the map first opened instead of following you. Every time a fresh
  // userLocation comes in (useLocationTracking.js's continuous watchPositionAsync), animate the map
  // to it, preserving whatever zoom level is currently set.
  useEffect(() => {
    if (!userLocation || !mapViewRef?.current) return;
    mapViewRef.current.animateToRegion({
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
      latitudeDelta: currentDeltasRef.current.latitudeDelta,
      longitudeDelta: currentDeltasRef.current.longitudeDelta,
    }, 500);
  }, [userLocation?.latitude, userLocation?.longitude, mapViewRef]);

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
            }
            // 2026-08-05: used to also close SpotDetails here whenever e.nativeEvent.action wasn't
            // exactly 'marker-press', to dismiss on tapping empty map. Removed — iOS doesn't reliably
            // report 'marker-press' on every tap of the same marker, so this could race a marker's
            // own onPress (which opens the modal) and close it in the same gesture, making a marker
            // seem to stop responding after its first tap. SpotDetails.js already has its own
            // reliable close paths (backdrop tap, close button) that don't depend on this.
            //
            // Collapsing the Notifications panel on any map tap doesn't have that race risk (it's a
            // one-way "get out of the way" signal, not something a marker's own onPress is fighting
            // over) — DeviceEventEmitter, matching this app's existing pattern for cross-component
            // signals like 'dataReset'/'parkedLocationCleared', since Notifications.js is a sibling
            // with no other connection to the map.
            DeviceEventEmitter.emit('collapseNotifications');
          }}
          // Keeps currentDeltasRef in sync with whatever zoom the user actually has right now
          // (their own pinch/pan, or the initialRegion on first render) — the auto-follow effect
          // above reads this ref so a re-center from a fresh GPS fix never snaps zoom back to the
          // hardcoded default.
          onRegionChangeComplete={(region) => {
            currentDeltasRef.current = {
              latitudeDelta: region.latitudeDelta,
              longitudeDelta: region.longitudeDelta,
            };
          }}
        >
          {/* "Your Car" is a plain, non-interactive offline-first indicator (see SpotContext.js's
              comment on parkedLocation) — shown only until the real spot marker below exists for
              this location. Once your own spot is actually in parkingSpots (server-confirmed,
              manual or auto-detected), that marker takes over as the sole thing rendered there —
              previously both rendered at the same coordinate, and the plain car-icon marker (a
              larger custom view) sat on top of and swallowed taps meant for the functional one,
              making Edit/Delete unreachable. */}
          {parkedLocation && !parkingSpots.some((s) => s.user_id === userId) && (
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

            // Refined hex tones for the custom bubble marker below — getStatusColor's plain color
            // keywords ('yellow'/'green'/'red', formerly used for the OS-default pin's pinColor
            // prop) read as flat/harsh on a custom white-icon badge.
            const getStatusHex = (status) => {
              switch (status) {
                case 'soon_free': return '#FB8C00'; // amber — SOFT zone: owner returning
                case 'committed': return '#2E7D32'; // COMMIT zone: owner about to leave
                case 'vacating': return '#E53935';  // owner driving away now
                case 'free': return '#2E7D32';
                case 'occupied':
                default: return '#E53935';
              }
            };

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
                    anchor={{ x: 0.5, y: 1 }}
                  >
                    <View style={styles.spotMarkerTouchArea}>
                      <View style={styles.spotMarkerContainer}>
                        <View style={[styles.spotMarkerBubble, { backgroundColor: isAccepted ? '#2E7D32' : getStatusHex(displaySpot.status) }]}>
                          <MaterialCommunityIcons name="parking" size={18} color="white" />
                        </View>
                        <View style={[styles.spotMarkerArrow, { backgroundColor: isAccepted ? '#2E7D32' : getStatusHex(displaySpot.status) }]} />
                      </View>
                    </View>
                  </Marker>
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
            <View style={styles.crosshairRing} />
            <View style={[styles.crosshairTick, styles.tickTop]} />
            <View style={[styles.crosshairTick, styles.tickBottom]} />
            <View style={[styles.crosshairTick, styles.tickLeft]} />
            <View style={[styles.crosshairTick, styles.tickRight]} />
            <View style={styles.crosshairDot} />
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
    width: 66, // was 60 — +10%
    height: 66,
    marginLeft: -33,
    marginTop: -33,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Expanding, fading ring behind the reticle — loops via pulseAnim while isAddingSpot is true.
  crosshairPulse: {
    position: 'absolute',
    width: 44, // was 40 — +10%
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E53935', // matches parkedMarkerBubble's red
  },
  // Modern camera-reticle style — a thin ring + four corner ticks + a small center dot, replacing
  // the old plain plus-sign (kept red per feedback — the reticle shape is the "modern" part).
  crosshairRing: {
    position: 'absolute',
    width: 40, // was 36 — +10%
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(229, 57, 53, 0.55)',
  },
  crosshairTick: {
    position: 'absolute',
    backgroundColor: '#E53935',
    borderRadius: 1,
  },
  // Repositioned for the 66pt container (center at 33,33) and the ring's new 20pt radius — was
  // top/left:4/29 against a 60pt container, center 30, ring radius 18.
  tickTop: { top: 4, left: 32, width: 2, height: 9 },
  tickBottom: { bottom: 4, left: 32, width: 2, height: 9 },
  tickLeft: { top: 32, left: 4, width: 9, height: 2 },
  tickRight: { top: 32, right: 4, width: 9, height: 2 },
  crosshairDot: {
    width: 11, // was 10 — +10%
    height: 11,
    borderRadius: 5.5,
    backgroundColor: '#E53935',
    shadowColor: '#E53935',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 4,
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
  // Same bubble+arrow badge design as "Your Car" above, but for an actual listed spot (own or
  // accepted) — color is dynamic (status/accepted-green), so backgroundColor is applied via the
  // inline style array at the call site rather than baked in here. Replaces the plain OS-default
  // teardrop pin (react-native-maps' pinColor prop) that used to render here.
  //
  // Padding is on top/sides only, never bottom — the Marker's anchor={{x:0.5,y:1}} pins the BOTTOM
  // of this whole view to the actual coordinate (the arrow tip), so any bottom padding would shift
  // the visible badge upward, off its real location. Apple HIG's 44x44pt minimum tap target was
  // bigger than the visible badge alone (a likely reason it was hard to hit reliably) — this widens
  // the tappable area without moving the anchor point.
  spotMarkerTouchArea: {
    paddingTop: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  spotMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotMarkerBubble: {
    borderRadius: 22,
    padding: 7, // was 6 — ~10% larger badge, paired with the icon size bump at the call site
    borderWidth: 2,
    borderColor: '#D1C4E9', // soft mauve instead of plain white — a little brand color in the badge
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  spotMarkerArrow: {
    width: 11,
    height: 11,
    transform: [{ rotate: '45deg' }],
    marginTop: -6,
    borderBottomRightRadius: 2,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#D1C4E9',
  },
});

export default Map;
