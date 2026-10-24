import { BUILT_IN_FORM_VERSION, type FormDefinition, type FormField } from '@zed/shared';
import { BASIC_INFO_GROUPS, type BasicInfoGroup } from './models';

/** The consultant app's Basic Information form (docs/mobile/APP-FORMS.md `consultant.basicInfo`). */
export const CONSULTANT_BASIC_INFO = 'consultant.basicInfo';

const MEASURES = 'Measures Taken (New technologies, new machines, new processes etc.)';

type Spec = [key: string, label: string, type: 'number' | 'decimal' | 'text', heading?: string];

/** The fields of each group in their legacy order: labels and headings of models/Models.kt and the fragments. */
const GROUP_FIELDS: Record<BasicInfoGroup, Spec[]> = {
  occupationalSafety: [
    ['numOfAccidents', 'No. of accidents (incl. fatalities & disabilities caused, if any)', 'number'],
    ['numOfNearMisses', 'No. of near misses', 'number'],
    ['manHoursLast', 'Man hours lost', 'number'],
    ['lostTimeInjuryFrequencyRate', 'Lost Time Injury Frequency Rate (LTIFR)', 'number'],
  ],
  measurementOfTimelyDelivery: [
    ['numOfDeliveries', 'Number of Deliveries', 'number'],
    ['numOfDeliveriesOnTimeInFull', 'Number of Deliveries made On Time In Full (OTIF) per month', 'number'],
  ],
  plannedMaintenanceCalibration: [
    ['meanTimeToRepair', 'Mean Time To Repair (MTTR)', 'number'],
    ['meanTimeBetweenFailure', 'Mean Time Between Failure (MTBF)', 'number'],
  ],
  energyManagement: [
    ['electrical.unit', 'Unit', 'text', 'A. Electrical'],
    ['electrical.totalConsumptionPercentage', '% of total consumption', 'decimal'],
    ['solar.unit', 'Unit', 'text', 'B. Solar'],
    ['solar.totalConsumptionPercentage', '% of total consumption', 'decimal'],
    ['wind.unit', 'Unit', 'text', 'C. Wind'],
    ['wind.totalConsumptionPercentage', '% of total consumption', 'decimal'],
    ['fossilFuel.unit', 'Unit', 'text', 'D. Fossil Fuel'],
    ['fossilFuel.totalConsumptionPercentage', '% of total consumption', 'decimal'],
    ['gas.unit', 'Unit', 'text', 'E. Gas'],
    ['gas.totalConsumptionPercentage', '% of total consumption', 'decimal'],
    ['others.unit', 'Unit', 'text', 'F. Others'],
    ['others.totalConsumptionPercentage', '% of total consumption', 'decimal'],
    ['totalCost', 'Total Cost', 'number'],
    ['measuresTaken', MEASURES, 'text'],
  ],
  environmentManagement: [
    ['cox', 'COx (please mention unit)', 'number', 'Emissions'],
    ['nox', 'NOx (please mention unit)', 'number'],
    ['sox', 'SOx (please mention unit)', 'number'],
    ['suspendedParticulateMaterial', 'Suspended Particulate Material (SPM)', 'number'],
    ['totalSuspendedSolid', 'Total Suspended Solid (TSS)', 'number', 'Effluents'],
    ['biochemicalOxygenDemand', 'Biochemical Oxygen Demand (BOD)', 'number'],
    ['solidWaste', 'Solid Waste (Kg/Month)', 'number', 'Solid Waste & Hazardous Waste'],
    ['plasticWaste', 'Plastic Waste (Kg/Month)', 'number'],
    ['eWaste', 'e-Waste (Kg/Month)', 'number'],
    ['hazardousWaste', 'Hazardous Waste (Kg/Month)', 'number'],
    ['noiseLevel', 'Noise Level (dB)', 'number', 'Noise Level'],
    ['measuresTaken', 'Measures Taken (New technologies, new machines, new processes etc.)', 'text'],
  ],
  humanResourceManagement: [
    ['employeesEngagedInActivities', '% of employees engaged in improvement activities', 'number'],
    ['noOfSuggestions', 'No. of suggestions received', 'number'],
    ['measuresTaken', 'Measures Taken to develop human resources', 'text'],
  ],
  measurementAnalysis: [
    ['defects', 'Defects (%)', 'decimal'],
    ['rework', 'Rework (%)', 'decimal'],
    ['customerRejections', 'Customer Rejections (%)', 'decimal'],
    ['numberOfCustomerComplaints', 'Number of Customer Complaints', 'number'],
    ['numberOfComplaintsResolved', 'Customer Complaints resolved (%)', 'decimal'],
    ['customerSatisfactionLevel', 'Customer Satisfaction level (%)', 'decimal'],
    ['costOfPoorQuality', 'Cost of Poor Quality (COPQ)', 'number'],
  ],
  naturalResourcesManagement: [
    ['water', 'Water  (Litres)', 'number'],
    ['minerals', 'Minerals (Coal) (Kg)', 'number'],
    ['wood', 'Wood (Kg)', 'number'],
    ['others', 'Others', 'number'],
    ['waterRecycling', 'Water recycling (Litres)', 'number'],
    ['waterReuse', 'Water reuse (Litres)', 'number'],
    ['rainWaterHarvesting', 'Rain water harvesting (Litres)', 'number'],
    ['noOfTreePlanted', 'No. of Tree planted', 'number'],
    ['measuresTaken', MEASURES, 'text'],
  ],
  financialPerformance: [
    ['turnover', 'Turnover (Rupees in Lakhs)', 'number'],
    ['grossProfit', 'Gross Profit (Rupees in Lakhs)', 'number'],
  ],
};

const fields: FormField[] = BASIC_INFO_GROUPS.flatMap(([group]) =>
  GROUP_FIELDS[group].map(([key, label, type, heading], i): FormField => ({
    key: `${group}.${key}`,
    label,
    type,
    required: true,
    custom: false,
    section: group,
    order: (i + 1) * 10,
    ...(heading ? { heading } : {}),
  })),
);

/**
 * The app's own form (the nine BasicInfoParameter fragments, every field required), used until the server's
 * definition arrives. A section is one group of the request; field keys are the property paths in it.
 */
export const BUILT_IN_BASIC_INFO: FormDefinition = {
  form: CONSULTANT_BASIC_INFO,
  name: 'Basic Information',
  numbered: false,
  sections: BASIC_INFO_GROUPS.map(([key, label]) => ({ key, label })),
  fields,
  version: BUILT_IN_FORM_VERSION,
};

/** Every standard key (to know which ones the Admin left out). */
export const STANDARD_KEYS: readonly string[] = fields.map(f => f.key);
