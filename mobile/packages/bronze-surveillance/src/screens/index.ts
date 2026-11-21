import type { ScreenMap } from '@zed/shared';
import { BasicInformationScreen } from './BasicInformationScreen';
import { CertificationOptionsScreen } from './CertificationOptionsScreen';
import { DashboardScreen } from './DashboardScreen';
import { EsgChecklistScreen } from './EsgChecklistScreen';
import { EvidencesScreen } from './EvidencesScreen';
import { MyAccountScreen } from './MyAccountScreen';
import { MyCertificationsScreen } from './MyCertificationsScreen';
import { NcDetailsScreen, NcProductScreen, NcRequirementScreen, NcSitePhotosScreen, NonConformancesScreen } from './NonConformanceScreens';
import { PaymentScreen } from './PaymentScreen';
import { PendingUploadsScreen } from './PendingUploadsScreen';
import { RemoteAssessmentDetailsScreen, RemoteAssessmentInitialScreen, SurveillanceScreen } from './SurveillanceScreens';

/**
 * The pages of a unit's Bronze surveillance after the sign-in, by their route names (the old app's own). The ZED Surveillance
 * build registers them as they are next to its Launcher; ZED SA registers them with its prefix ("Bronze.") and opens
 * "Dashboard" (with `fromLogin`) for the unit it opened (2026-11-21).
 */
export const BRONZE_SCREENS: ScreenMap = {
  Dashboard: DashboardScreen,
  MyAccount: MyAccountScreen,
  MyCertifications: MyCertificationsScreen,
  CertificationOptions: CertificationOptionsScreen,
  BasicInformation: BasicInformationScreen,
  EsgChecklist: EsgChecklistScreen,
  Evidences: EvidencesScreen,
  NonConformances: NonConformancesScreen,
  NcDetails: NcDetailsScreen,
  NcSitePhotos: NcSitePhotosScreen,
  NcProduct: NcProductScreen,
  NcRequirement: NcRequirementScreen,
  Surveillance: SurveillanceScreen,
  RemoteAssessmentInitial: RemoteAssessmentInitialScreen,
  RemoteAssessmentDetails: RemoteAssessmentDetailsScreen,
  Payment: PaymentScreen,
  PendingUploads: PendingUploadsScreen,
};

/** The first page of a unit (the old app's after its login). */
export const BRONZE_START = 'Dashboard';
