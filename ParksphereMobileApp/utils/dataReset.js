import AsyncStorage from '@react-native-async-storage/async-storage';
import { stopParkDetection, resetParkDetection } from './parkDetectionService';

/**
 * Resets all application data stored in AsyncStorage.
 * Used for development simulation and "reset engine" functionality.
 */
export const resetAllAppData = async () => {
  console.log('[System] Resetting all application data...');

  try {
    // 1. Stop the detection engine first to ensure background tasks are cleared
    await stopParkDetection();
    
    // 2. Perform the engine-specific reset (deletes server spots, clears HMM storage)
    await resetParkDetection();

    // 3. Clear other persistent application keys
    const keysToClear = [
      'userToken',
      'userId',
      'username',
      'autoDetectionEnabled'
    ];

    await AsyncStorage.multiRemove(keysToClear);
    console.log('[System] Application data cleared successfully.');

    return true;
  } catch (error) {
    console.error('[System] Error during full app data reset:', error);
    return false;
  }
};
