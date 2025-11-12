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
            if (e.nativeEvent.action !== 'marker-press') {
              setSpotDetailsVisible(false);
            }
          }}
        >
          {locationPermissionGranted && userLocation && (
            <Marker
              coordinate={{ latitude: userLocation.latitude, longitude: userLocation.longitude }}
              title="Your Location"
              pinColor="blue"
            />
          )}

          {parkingSpots.map((spot) => (
            <React.Fragment key={spot.id}>
              {spot.ownerId === userId ? (
                <Marker
                  coordinate={{ latitude: parseFloat(spot.latitude), longitude: parseFloat(spot.longitude) }}
                  onPress={() => handleSpotPress(spot)}
                  pinColor="red"
                />
              ) : (
                <>
                  <Circle
                    center={{ latitude: parseFloat(spot.latitude), longitude: parseFloat(spot.longitude) }}
                    radius={200}
                    fillColor="rgba(255,0,0,0.2)"
                    strokeColor="rgba(255,0,0,0.8)"
                    strokeWidth={2}
                  />
                  <Marker
                    coordinate={{ latitude: parseFloat(spot.latitude), longitude: parseFloat(spot.longitude) }}
                    onPress={() => handleSpotPress(spot)}
                    tracksViewChanges={false}
                  >
                    <View style={{ width: 20, height: 20, backgroundColor: 'transparent' }}></View>
                  </Marker>
                </>
              )}
            </React.Fragment>
          ))}
        </MapView>
      ) : (
        <Text style={styles.messageText}>Getting your location...</Text>
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
});

export default Map;
