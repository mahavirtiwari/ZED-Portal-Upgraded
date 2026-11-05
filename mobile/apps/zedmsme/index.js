/**
 * @format
 */

// First: what this app shows differently from the legacy theme (read when @zed/shared loads).
import './src/palette';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
