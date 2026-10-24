/**
 * @format
 */

// First: the legacy colours for the shared components (read when @zed/shared loads).
import './src/palette';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
