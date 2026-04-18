import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import MapView, { Marker, Circle } from 'react-native-maps';

const Map = ({
  userLocation,
  locationPermissionGranted,
  parkingSpots,
  userId,
  handleSpotPress,
  handleCenterMap,
  mapViewRef,
  setSpotDetailsVisible,
  isAddingSpot,
  setIsAddingSpot,
  setNewSpotCoordinates,
  setShowTimeOptionsModal,
  acceptedSpot,
}) => {
  return (
    <View style={styles.mapScreenContainer}>
      {userLocation ? (
        <MapView
          ref={mapViewRef}
          style={styles.map}
          initialRegion={
            parkingSpots.length > 0
              ? {
                  latitude: parseFloat(parkingSpots[0].latitude),
                  longitude: parseFloat(parkingSpots[0].longitude),
                  latitudeDelta: 0.0922,
                  longitudeDelta: 0.0421,
                }
              : userLocation
          }
          showsUserLocation={locationPermissionGranted}
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


          {parkingSpots.map((spot) => {
            const isAccepted = acceptedSpot && spot.id === acceptedSpot.id;
            const displaySpot = isAccepted ? acceptedSpot : spot;

            const getStatusColor = (status) => {
              switch (status) {
                case 'soon_free': return 'orange';
                case 'free': return 'green';
                case 'occupied':
                default: return 'red';
              }
            };

            const getStatusRgba = (status, alpha) => {
              switch (status) {
                case 'soon_free': return `rgba(255, 165, 0, ${alpha})`;
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
          <Text style={styles.centerButtonText}>⌖</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

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
    top: 10,
    right: 10,
    flexDirection: 'column',
  },
  centerButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 20,
    padding: 10,
    elevation: 2,
  },
  centerButtonText: {
    fontSize: 20,
    color: '#333',
  },
  crosshairContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none', // Allows map interaction underneath
  },
  crosshairHorizontal: {
    position: 'absolute',
    width: 30,
    height: 2,
    backgroundColor: 'black',
  },
  crosshairVertical: {
    position: 'absolute',
    width: 2,
    height: 30,
    backgroundColor: 'black',
  },
});

export default Map;
