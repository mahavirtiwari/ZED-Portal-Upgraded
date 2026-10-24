/**
 * Server environments of the V4 mobile API. The apps keep the legacy addresses below the host
 * (`/surveillancemobileapi/surveillance/`, `/mobileapi/msme/`, ...), so only the host changes.
 *
 * The environment is chosen at build time: Android resource `zed_environment` (Gradle property
 * `zedEnvironment`; debug builds default to staging, release builds to production).
 */
export type EnvironmentName = 'production' | 'staging' | 'local';

export type Environment = {
  name: EnvironmentName;
  /** Scheme and host, no trailing slash. */
  baseUrl: string;
};

export const ENVIRONMENTS: Record<EnvironmentName, Environment> = {
  // BuildConfig.BASE_URI of the legacy store builds.
  production: { name: 'production', baseUrl: 'https://loginzed.msme.gov.in' },
  // V4 staging (docs/STAGING.md).
  staging: { name: 'staging', baseUrl: 'https://zedv3.qci.org.in' },
  // V4 MobileApi run on the developer PC (launch profile "surveillance", port 5106), reached from the
  // Android emulator through 10.0.2.2. Cleartext is allowed for this host in debug builds only.
  local: { name: 'local', baseUrl: 'http://10.0.2.2:5106' },
};

export function environmentByName(name: string | null | undefined): Environment {
  if (name === 'staging' || name === 'local' || name === 'production') return ENVIRONMENTS[name];
  return ENVIRONMENTS.production;
}

/** Joins the host with a legacy base path such as `surveillancemobileapi/surveillance/`. */
export function apiBase(env: Environment, legacyPath: string): string {
  const path = legacyPath.replace(/^\/+/, '');
  return `${env.baseUrl}/${path.endsWith('/') ? path : path + '/'}`;
}
