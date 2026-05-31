import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import RNBluetoothClassic from 'react-native-bluetooth-classic';

export const useBluetoothMonitoring = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);

  useEffect(() => {
    // 🛡️ iOS PRIVACY GUARD: Apple forbids querying connected classic devices.
    // We rely on Core Motion "automotive" state instead on iOS.
    if (Platform.OS === 'ios') {
      return; 
    }

    const checkConnection = async () => {
      if (!RNBluetoothClassic) {
        console.warn('[useBluetoothMonitoring] RNBluetoothClassic module is NOT available.');
        return;
      }

      try {
        const connectedDevices = await RNBluetoothClassic.getConnectedDevices();
        
        // Check for "Car" or "Audio" devices
        const isCarConnected = connectedDevices.some(device => {
            const name = (device.name || '').toLowerCase();
            return name.includes('car') || name.includes('audio') || name.includes('hands-free');
        });

        setIsConnected(isCarConnected);
      } catch (err) {
        console.warn('[useBluetoothMonitoring] Error checking devices:', err.message);
      }
    };

    const interval = setInterval(checkConnection, 10000); // 10s polling
    checkConnection();

    return () => clearInterval(interval);
  }, []);

  return { isConnected, lastEvent };
};
