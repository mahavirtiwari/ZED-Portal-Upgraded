/**
 * Which ZED system this build serves. The Consultancy and Surveillance apps are built from this same source
 * (angular.json replaces this file with projects/{consultancy,surveillance}/src/portal-system.ts), so pages and
 * menus can differ per system where the old portals did. Each build talks to its own API (proxy.conf.json).
 */
export type PortalSystem = 'main' | 'consultancy' | 'surveillance';

export const PORTAL_SYSTEM: PortalSystem = 'main';
