/**
 * @zed/bronze-surveillance (2026-11-21): the Bronze surveillance steps of a unit's desktop assessor, moved out of the ZED
 * Surveillance app (apps/msme, com.qci.zed.bronzesurveillance, now retired) so that ZED SA shows them unchanged: enterprise
 * profile, certification options, basic information and documents, evidences and photos, the ESG checklist, the "financial
 * assistance availed" answers, NC replies, the Surveillance Assessment photos, final submit, pending uploads and the offline
 * sync. The calls stay the old app's (surveillancemobileapi/surveillance/*, msme/SubmitSurveillancePhoto) with its "SURV"
 * token. Deep imports (`@zed/bronze-surveillance/src/...`) are used by the old build's tests.
 */
export { MsmeApi } from './api';
export { MsmeApp, LOGIN_DB_NAME, MEDIA_DB_NAME, type MsmeAppDeps } from './app/MsmeApp';
export { MsmeAppProvider, useMsme } from './app/context';
export { BronzeHostProvider, routeName, useBronzeHost, useNavigation as useBronzeNavigation, type BronzeHost } from './app/nav';
export { AppDrawerHost, AppDrawerOverlay } from './app/AppDrawer';
export { BUILT_IN_TEXTS as BRONZE_BUILT_IN_TEXTS } from './content/builtInTexts';
export { updateCertificationDetails, type LoginResponse } from './models';
export { queueOutstanding, registerHandlers, syncNow } from './sync/queue';
export { BRONZE_SCREENS, BRONZE_START } from './screens';
export { LauncherScreen } from './screens/LauncherScreen';
