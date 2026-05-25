import { registerRootComponent } from 'expo';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { processLocationHMM } from './utils/parkDetection_HMM';

import App from './App';

const LOCATION_TASK_NAME = 'background-location-task';

TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
  if (error) {
    console.error('[TaskManager] Error:', error);
    return;
  }
  if (data) {
    const { locations } = data;
    const location = locations[0];
    console.log('[TaskManager] Background location update:', location);
    processLocationHMM(location, null, {});
  }
});

registerRootComponent(App);
