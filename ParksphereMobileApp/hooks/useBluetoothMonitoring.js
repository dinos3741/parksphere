import { useState, useEffect } from 'react';
import RNBluetoothClassic from 'react-native-bluetooth-classic';

export const useBluetoothMonitoring = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);

  useEffect(() => {
    const checkConnection = async () => {
      if (!RNBluetoothClassic) {
        console.warn('[useBluetoothMonitoring] RNBluetoothClassic module is NOT available. Bluetooth detection will not work.');
        return;
      }

      try {
        const connectedDevices = await RNBluetoothClassic.getConnectedDevices();
        console.log(`[useBluetoothMonitoring] Found ${connectedDevices?.length || 0} connected devices.`);
        
        // Assuming we check for "Car" in the name, or any audio device
        const isCarConnected = connectedDevices.some(device => {
            const name = (device.name || '').toLowerCase();
            return name.includes('car') || name.includes('audio') || name.includes('hands-free');
        });

        if (isCarConnected && !isConnected) {
            console.log('[useBluetoothMonitoring] 🚗 Car Bluetooth connection detected!');
        }
        
        setIsConnected(isCarConnected);
      } catch (err) {
        console.warn('[useBluetoothMonitoring] Error checking devices:', err.message);
      }
    };

    // Poll periodically or listen to events
    const interval = setInterval(checkConnection, 10000); // 10s polling
    checkConnection();

    return () => clearInterval(interval);
  }, []);

  return { isConnected, lastEvent };
};
