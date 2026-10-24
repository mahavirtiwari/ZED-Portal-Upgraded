import {
  BUILT_IN_FORM_VERSION,
  isBasicInfoFieldShown,
  stampFormAnswers as sharedStampFormAnswers,
  type FormDefinition,
  type FormField,
} from '@zed/shared';
import type { BasicInformation } from './models';

/** The Basic Information form of the MSME app and its Bronze surveillance build (docs/mobile/APP-FORMS.md). */
export const MSME_BASIC_INFO = 'msme.basicInfo';

/** res/values/donottranslate.xml string-arrays */
export const CAPACITY_UNITS = ['Metric Ton', 'Litre', 'Meter', 'Number'];
export const ENERGY_SOURCES = ['Electricity', 'Petrol', 'Diesel', 'Coal', 'Solar', 'Wood', 'Natural Gas', 'Other'];

const field = (key: string, label: string, type: string, order: number, extra: Partial<FormField> = {}): FormField => ({
  key,
  label,
  type,
  required: true,
  custom: false,
  section: 'basic',
  order,
  ...extra,
});

/**
 * The app's own form (BasicInformationActivity with its legacy labels), used until the server's definition arrives.
 * Same keys, types, rules and order as the server's standard form for the Surveillance system.
 */
export const BUILT_IN_BASIC_INFO: FormDefinition = {
  form: MSME_BASIC_INFO,
  name: 'Basic Information',
  numbered: false,
  sections: [{ key: 'basic', label: 'Basic Information of Unit' }],
  fields: [
    field('assessorSelfie', 'Assessor Selfie (max. 1 photo)', 'photo', 10, { maxItems: 1 }),
    field('siteExteriorPhotos', 'Site Exterior Photos (max. 2 photos)', 'photo', 20, { maxItems: 2 }),
    field('auditsConducted', 'Whether 3rd Party Financial Audits are conducted?', 'yesno', 30),
    field('productDetailsList', 'Products', 'rows', 40, {
      columns: [
        field('productName', 'Name of Product manufactured', 'text', 10),
        field('exported', 'Whether Exported?', 'yesno', 20),
        field('productPhoto', 'Product Photos', 'photo', 30, { maxItems: 1 }),
        field('productDescriptionPhoto', 'Product Label/Description Photos', 'photo', 40, { maxItems: 1 }),
      ],
    }),
    field('domesticCustomers', 'Key Domestic Customers', 'text', 50),
    field('internationalCustomers', 'Key International Customers', 'text', 60, { when: { field: 'productDetailsList/exported', equals: 'Yes' } }),
    field('rawMaterialImported', 'Whether Raw Material is imported?', 'yesno', 70),
    field('rawMaterialsList', 'Raw Materials', 'rows', 80, {
      when: { field: 'rawMaterialImported', equals: 'Yes' },
      columns: [
        field('rawMaterialName', 'Name of Raw Material', 'text', 10),
        field('rawMaterialPercentage', '% of raw material imported', 'number', 20, { min: 0, max: 100 }),
        field('countryName', 'Name of Country', 'multiselect', 30, { optionsSource: 'countries', separator: ', ' }),
      ],
    }),
    field('monthlyManufacturingCapacityUnits', 'What is the unit monthly manufacturing capacity?', 'dropdown', 90, { options: CAPACITY_UNITS }),
    field('monthlyManufacturingCapacityValue', 'Enter Value', 'number', 100, { maxLength: 20 }),
    field('monthlyUtilizationUnits', 'What is the monthly utilization of the capacity against the manufacturing capacity?', 'dropdown', 110, {
      options: CAPACITY_UNITS,
    }),
    field('monthlyUtilizationValue', 'Enter Value', 'number', 120, { maxLength: 20 }),
    field('outsourcedProcesses', 'Processes Outsourced, if any', 'text', 130, { required: false }),
    field('energySources', 'Energy Source(s) used', 'checkboxes', 140, { options: ENERGY_SOURCES }),
  ],
  version: BUILT_IN_FORM_VERSION,
  updatedOn: null,
};

/** The standard keys (request properties of `basicInformation`) the form can show. */
export const STANDARD_KEYS = BUILT_IN_BASIC_INFO.fields.map(f => f.key);

export { basicInfoValue, LOCAL_FORM_PROPERTIES, rowErrors, validateBasicInformation } from '@zed/shared';

export function isShown(def: FormDefinition, info: BasicInformation, f: FormField): boolean {
  return isBasicInfoFieldShown(def, info, f);
}

/** Proceed: what the submit must carry (version, custom answers, standard fields left out / optional). */
export function stampFormAnswers(def: FormDefinition, info: BasicInformation): void {
  sharedStampFormAnswers(def, info, STANDARD_KEYS);
}
