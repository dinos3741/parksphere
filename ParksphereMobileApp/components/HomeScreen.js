import React from 'react';
import { View, TouchableOpacity, Text, Image, StyleSheet } from 'react-native';
import Map from './Map';
import Notifications from './Notifications';

export default function HomeScreen({ 
  userLocation, 
  locationPermissionGranted, 
  parkingSpots, 
  userId, 
  handleSpotPress, 
  handleCenterMap, 
  mapViewRef, 
  setSpotDetailsVisible, 
  notifications, 
  isAddingSpot, 
  setIsAddingSpot, 
  setNewSpotCoordinates, 
  setShowTimeOptionsModal, 
  acceptedSpot, 
  hasActiveSpot, 
  handleFabPress, 
  parkedLocation 
}) {
  return (
    <View style={{flex: 1}}>
      <View style={{...styles.mapBorderWrapper, flex: 1}}>
        <Map
          userLocation={userLocation}
          locationPermissionGranted={locationPermissionGranted}
          parkingSpots={parkingSpots}
          userId={userId}
          handleSpotPress={handleSpotPress}
          handleCenterMap={handleCenterMap}
          mapViewRef={mapViewRef}
          setSpotDetailsVisible={setSpotDetailsVisible}
          isAddingSpot={isAddingSpot}
          setIsAddingSpot={setIsAddingSpot}
          setNewSpotCoordinates={setNewSpotCoordinates}
          setShowTimeOptionsModal={setShowTimeOptionsModal}
          acceptedSpot={acceptedSpot}
          parkedLocation={parkedLocation}
        />
        <TouchableOpacity
          style={[
            styles.fab,
            (hasActiveSpot && !acceptedSpot && !isAddingSpot) && { backgroundColor: 'gray' }
          ]}
          onPress={handleFabPress}
          disabled={hasActiveSpot && !acceptedSpot && !isAddingSpot}
        >
          {(acceptedSpot) ? (
            <Image source={require('../assets/images/arrived.png')} style={styles.fabIcon} />
          ) : (
            <Text style={isAddingSpot ? styles.fabTextSmall : styles.fabText}>
              {isAddingSpot ? 'X' : '+'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
      <Notifications notifications={notifications} />
    </View>
  );
}

const styles = StyleSheet.create({
  mapBorderWrapper: {
    flex: 1,
    borderWidth: 2,
    borderColor: 'blue',
    borderRadius: 10,
    margin: 5,
  },
  fab: {
    position: 'absolute',
    width: 91,
    height: 91,
    borderRadius: 46,
    backgroundColor: '#9b59b6',
    justifyContent: 'center',
    alignItems: 'center',
    bottom: 10,
    alignSelf: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    transform: [{ rotate: '0deg' }],
  },
  fabText: {
    color: 'white',
    fontSize: 55,
    fontWeight: '300',
    lineHeight: 55,
  },
  fabTextSmall: {
    color: 'red',
    fontSize: 35,
    fontWeight: '300',
    lineHeight: 35,
    top: 3,
  },
  fabIcon: {
    width: 55,
    height: 55,
    resizeMode: 'contain',
  },
});
