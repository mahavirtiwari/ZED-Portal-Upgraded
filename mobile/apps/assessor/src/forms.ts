import { BUILT_IN_FORM_VERSION, type FormDefinition, type FormField } from '@zed/shared';

/** The site assessment app's Basic Information form (docs/mobile/APP-FORMS.md `assessor.basicInfo`). */
export const ASSESSOR_BASIC_INFO = 'assessor.basicInfo';

/** res/values/strings.xml string-arrays */
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
 * The app's own form (BasicInformationActivity, labels from res/values/strings.xml with their numbers; the value
 * fields "Enter Value" are not numbered), used until the server's definition arrives. A server definition is
 * `numbered`: the app numbers its fields by position, as the server's standard form expects.
 */
export const BUILT_IN_BASIC_INFO: FormDefinition = {
  form: ASSESSOR_BASIC_INFO,
  name: 'Basic Information',
  numbered: false,
  sections: [{ key: 'basic', label: 'Basic Information' }],
  fields: [
    field('auditsConducted', '1. Whether 3rd Party Financial Audits are conducted?', 'yesno', 10),
    field('productDetailsList', '2. Products', 'rows', 20, {
      columns: [
        field('productName', 'Name of Product manufactured', 'text', 10),
        field('exported', 'Whether Exported?', 'yesno', 20),
        field('productPhoto', 'Product Photos', 'photo', 30, { maxItems: 1 }),
        field('productDescriptionPhoto', 'Product Label/Description Photos', 'photo', 40, { maxItems: 1 }),
      ],
    }),
    field('domesticCustomers', '3. Key Domestic Customers', 'text', 30),
    field('internationalCustomers', '4. Key International Customers', 'text', 40, { when: { field: 'productDetailsList/exported', equals: 'Yes' } }),
    field('rawMaterialImported', '5. Whether Raw Material is imported?', 'yesno', 50),
    field('rawMaterialsList', '6. Raw Materials', 'rows', 60, {
      when: { field: 'rawMaterialImported', equals: 'Yes' },
      columns: [
        field('rawMaterialName', 'Name of Raw Material', 'text', 10),
        field('rawMaterialPercentage', '% of raw material imported', 'number', 20, { min: 0, max: 100 }),
        field('countryName', 'Name of Country', 'multiselect', 30, { optionsSource: 'countries', separator: ', ' }),
      ],
    }),
    field('monthlyManufacturingCapacityUnits', '7. What is the unit monthly manufacturing capacity?', 'dropdown', 70, { options: CAPACITY_UNITS }),
    field('monthlyManufacturingCapacityValue', 'Enter Value', 'number', 80, { maxLength: 20 }),
    field('monthlyUtilizationUnits', '8. What is the monthly utilization of the capacity against the manufacturing capacity?', 'dropdown', 90, {
      options: CAPACITY_UNITS,
    }),
    field('monthlyUtilizationValue', 'Enter Value', 'number', 100, { maxLength: 20 }),
    field('outsourcedProcesses', '9. Processes Outsourced, if any', 'text', 110, { required: false }),
    field('energySources', '10. Energy Source(s) used', 'checkboxes', 120, { options: ENERGY_SOURCES }),
  ],
  version: BUILT_IN_FORM_VERSION,
  updatedOn: null,
};

/** The standard keys (request properties of `basicInformation`) the form can show. */
export const STANDARD_KEYS = BUILT_IN_BASIC_INFO.fields.map(f => f.key);
