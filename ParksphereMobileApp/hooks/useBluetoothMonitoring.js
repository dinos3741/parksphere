import { useState, useEffect } from 'react';
import RNBluetoothClassic from 'react-native-bluetooth-classic';

export const useBluetoothMonitoring = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const connectedDevices = await RNBluetoothClassic.getConnectedDevices();
        // Assuming we check for "Car" in the name, or any audio device
        const isCarConnected = connectedDevices.some(device => 
            device.name.toLowerCase().includes('car') || 
            device.name.toLowerCase().includes('audio')
        );
        setIsConnected(isCarConnected);
      } catch (err) {
        console.warn('[useBluetoothMonitoring] Error checking devices:', err);
      }
    };

    // Poll periodically or listen to events
    const interval = setInterval(checkConnection, 10000); // 10s polling
    checkConnection();

    return () => clearInterval(interval);
  }, []);

  return { isConnected, lastEvent };
};
