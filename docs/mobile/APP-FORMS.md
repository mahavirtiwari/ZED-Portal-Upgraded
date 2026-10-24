# App forms (Admin → App Forms)

New in V4: the **Basic Information** forms of the mobile apps can be changed by the Admin under **Admin → App Forms**
on the portal of the same system. The standard form is the legacy app's own
(`backend/src/Zed.Core/Forms/AppFormCatalogue.cs`); the Admin can

- for a **standard field**: change its label, help text and position, make it required or optional, disable it.
  Its key and type never change (the submit endpoints still read it from its legacy request property);
- add **fields of their own** (custom fields: text, whole number, decimal number, date, yes/no, drop-down,
  multi-select list, check boxes), edit and disable them. They are never deleted; their answers stay.

| Form key | App | Systems (mobile host) | Submitted with |
|---|---|---|---|
| `msme.basicInfo` | MSME app (`ZED_MSME_Bronze`) on Main; its Bronze surveillance build on Surveillance (the desktop assessor fills it in for the unit) | Main, Surveillance | `Msme/SubmitBasicInformation` (Main), `Surveillance/SubmitBasicInformation` (Surveillance) |
| `assessor.basicInfo` | Site assessment app (`ZED_SA_Studio`) | Main, Surveillance (the SA app's surveillance site assessments use the same `SA/SubmitBasicInformation`) | `SA/SubmitBasicInformation` |
| `consultant.basicInfo` | Handholding consultant app (`ZEDConsultant`) | Consultancy | `SA/SubmitBasicInformation` (consultancy mobile host) |

Each system has its own copy (its own database): a change on the Main portal does not change the Surveillance form.

## Definition endpoint

`Forms/Definition?form=<form key>` on the mobile host (GET or POST, anonymous: a definition holds no unit data), for
example `/mobileapi/Forms/Definition?form=msme.basicInfo` (Main), `/surveillancemobileapi/Forms/Definition?form=msme.basicInfo`
(Surveillance), `/Consultancymobileapi/Forms/Definition?form=consultant.basicInfo` (Consultancy). A form that is not
one of the host's: `{ "status": "0", "errorMessage": "Unknown form." }`.

```json
{
  "status": "1",
  "form": "msme.basicInfo",
  "name": "Basic Information",
  "numbered": false,
  "sections": [ { "key": "basic", "label": "Basic Information" } ],
  "fields": [
    { "key": "siteExteriorPhotos", "label": "Site Exterior Photos (max. 2 photos)", "type": "photo", "required": true,
      "custom": false, "section": "basic", "order": 20, "maxItems": 2 },
    { "key": "auditsConducted", "label": "Whether 3rd Party Financial Audits are conducted?", "type": "yesno",
      "required": true, "custom": false, "section": "basic", "order": 30 },
    { "key": "cf_gst_number", "label": "GST number", "help": "As on the GST certificate", "type": "text",
      "required": true, "custom": true, "section": "basic", "order": 35 },
    { "key": "productDetailsList", "label": "Products", "type": "rows", "required": true, "custom": false,
      "section": "basic", "order": 40,
      "columns": [
        { "key": "productName", "label": "Name of Product manufactured", "type": "text", "required": true, "custom": false, "section": "basic", "order": 10 },
        { "key": "exported", "label": "Whether Exported?", "type": "yesno", "required": true, "custom": false, "section": "basic", "order": 20 },
        { "key": "productPhoto", "label": "Product Photo", "type": "photo", "required": true, "custom": false, "section": "basic", "order": 30, "maxItems": 1 },
        { "key": "productDescriptionPhoto", "label": "Product Label/Description Photo", "type": "photo", "required": true, "custom": false, "section": "basic", "order": 40, "maxItems": 1 }
      ] },
    { "key": "internationalCustomers", "label": "Key International Customers", "help": "Asked when a product is exported.",
      "type": "text", "required": true, "custom": false, "section": "basic", "order": 60,
      "when": { "field": "productDetailsList/exported", "equals": "Yes" } }
  ],
  "version": "3f9c0a1b2d4e5f60",
  "updatedOn": "2026-10-24T09:30:00Z"
}
```

- `fields` holds only the fields to show, already in display order (by section, then `order`). Disabled fields are
  not in it, and neither is a field shown only for the answer of a disabled field (for example `rawMaterialsList`
  when the Admin disabled `rawMaterialImported`). Columns of a row field are in `columns`, likewise filtered.
- `version` changes whenever anything in the definition changes (a hash). `updatedOn` (UTC, or null for the standard
  form) is for display only.
- Optional properties are left out when they have no value.

### Field properties

| Property | Meaning |
|---|---|
| `key` | Stable. **Standard field**: the property path inside the request's `basicInformation` object (`auditsConducted`, `energyManagement.electrical.unit`); for a column, the property of a row object. **Custom field**: `cf_…`, the key in `customFields`. |
| `label`, `help` | Text to show (help under the field). `heading`: a sub-heading shown above the field (consultant form: "A. Electrical", "Emissions", …). |
| `type` | See below. |
| `required` | The answer is required (for a field with `when`: required when it is asked). For `photo` / `rows`: at least one photo / entry. |
| `custom` | Added by the Admin: send its answer in `customFields`. |
| `section`, `order` | Section key (see `sections`) and position. `numbered: true` (site assessment form): number the top-level fields 1, 2, … in the order given, as the legacy labels did ("1. Whether 3rd Party …"). |
| `options` | Choices (`dropdown`, `multiselect`, `checkboxes`), in order. `optionsSource: "countries"`: the app's own list (`assets/countries.json`). |
| `separator` | A multi-select whose answers go into **one text property**, joined with this separator (`countryName`: `", "`, as the legacy app). |
| `maxItems` | Most photos (`photo`) or entries. `maxLength`: most characters. `min` / `max`: range of a number. |
| `when` | `{ field, equals }`: ask the field only when that field's answer equals the value (case-insensitive). `field` may be `rows/column`: when **any** entry's column has the value. |

### Types

| Type | Shown as | Standard field: sent as (unchanged) | Custom field: value in `customFields` |
|---|---|---|---|
| `text` | text input | string | string (up to 4000 characters) |
| `number` | numeric input | string | whole number: JSON number or string, `^-?\d{1,18}$` |
| `decimal` | numeric input with decimals | string | JSON number or string, up to 6 decimals (`.` as separator) |
| `date` | date picker | — | `"yyyy-MM-dd"` |
| `yesno` | Yes / No | `"Yes"` / `"No"` | `"Yes"` / `"No"` (JSON `true` / `false` also accepted) |
| `dropdown` | single choice | string | one of `options` (case-insensitive; stored as listed) |
| `multiselect` | multi-select list | string joined with `separator` | JSON array of options, e.g. `["North","South"]` (a string holding such an array is also accepted) |
| `checkboxes` | check boxes | JSON array of strings (`energySources`) | JSON array of options |
| `photo` | camera / gallery, up to `maxItems` | as today (`siteExteriorPhotos`, `assessorSelfie`, product photos) | — (custom fields have no photos) |
| `rows` | repeating entries with `columns` | the legacy list (`productDetailsList`, `rawMaterialsList`) | — |

An empty answer (null, `""`, `[]`) is "not answered".

## Rendering and caching

1. Build the Basic Information screen from the definition: sections in order, fields in order, labels and help from
   the definition; standard fields keep their legacy controls and behaviour (photo stamping, the product and raw
   material dialogs, the 0–100 % check, the countries list, `isNumeric` inputs) — the definition changes only what it
   says.
2. Load the definition when the screen is opened online (and after login), **keep the last answer (with its
   `version`) for offline use**, and fall back to the app's built-in standard form when there is no answer yet or the
   call fails. Keep a draft's answers by field key so that a refreshed definition keeps what was entered.
3. A standard field that is not in the definition (disabled) is not shown and its request property is left out (or
   null / empty list). Everything else is sent exactly as the legacy app sends it.
4. Validate on the phone with `required`, `when`, `maxItems`, `maxLength`, `min`/`max` and the types above, before
   queueing the submit (the server applies the same rules, below).

## What to send

The existing submit calls keep their requests and answers. Two optional properties are new, next to `basicInformation`:

```json
{
  "userName": "ZEDMSME000001", "certificationType": "Bronze", "deviceInfo": { "deviceId": "…" },
  "basicInformation": { "auditsConducted": "Yes", "productDetailsList": [ … ], "energySources": ["Solar"], … },
  "customFields": { "cf_gst_number": "09ABCDE1234F1Z5", "cf_markets": ["North", "South"], "cf_employees": 25 },
  "formVersion": "3f9c0a1b2d4e5f60"
}
```

- `customFields`: the answers to the shown custom fields, by key. Send every shown custom field (null or `""` for an
  unanswered optional one).
- `formVersion`: the `version` of the definition the user filled in. **New builds always send it**; it tells the
  server that the app knows the form, so the required fields are enforced.

## Server rules

- The stage, allotment and device checks of each call come first, unchanged.
- **Custom answers** are checked against their field's type and options whenever they are sent. A wrong one refuses
  the call (`status "0"`, e.g. `"Employees: please enter a whole number."`, `"Sector: \"Food\" is not one of the
  choices."`, `"ISO certified?: please answer Yes or No."`). Keys that are not shown custom fields (unknown, disabled,
  standard keys) are **ignored**, so a definition the Admin changed after the app loaded it does not lock the user out.
- **With `formVersion`**: every shown required field must be answered — custom fields, and standard fields from their
  legacy properties (taking `when` into account; for a row field, at least one entry, and every required column in
  every entry). Refusal: `"Please fill in: <label>."` or `"Please fill in <column> for every entry of <rows label>."`.
  When the version sent is not the current one, the message ends with `"(The form was changed on the server; please
  refresh it.)"`: reload the definition and show the form again. A shown custom field left out of `customFields` is
  stored as unanswered.
- **Without `formVersion`** (builds that do not know the forms): nothing new is required; only the custom answers sent
  are checked and stored. Old builds therefore keep working whatever the Admin changes.
- A standard field the Admin disabled or made optional may be left out: the procedure gets NULL for it (an empty table
  for a list). This lifts the legacy refusals that were not form rules: the site assessment call no longer fails
  without `energySources` or with only one of the two product photo lists once that field is optional or disabled,
  and the consultant call accepts a group (`occupationalSafety`, `energyManagement.solar`, …) left out when none of
  its shown fields is required. Answers sent for a disabled standard field are still stored as before.
- Custom answers are written (`dbo.V4AppFormValues`, per form, ZED ID, level and key) only after the Basic
  Information procedure succeeded, in the same call. If they cannot be written the call answers `status "0"` with the
  generic error; sending it again is safe (the procedure replaces the basic information).
- Staff see the custom answers on the desktop-assessment page (Basic Information tab, "Additional information"), also
  for fields disabled since.

## Standard fields

`msme.basicInfo` (keys inside `basicInformation`; Main has no `assessorSelfie`):

| Key | Type | Required | Notes |
|---|---|---|---|
| `assessorSelfie` | photo, 1 | yes | Surveillance (Bronze surveillance build) only |
| `siteExteriorPhotos` | photo, up to 2 | yes | |
| `auditsConducted` | yesno | yes | |
| `productDetailsList` | rows | yes | columns `productName` text, `exported` yesno, `productPhoto` photo 1, `productDescriptionPhoto` photo 1 (all required) |
| `domesticCustomers` | text | yes | |
| `internationalCustomers` | text | yes | when `productDetailsList/exported` = Yes |
| `rawMaterialImported` | yesno | yes | |
| `rawMaterialsList` | rows | yes | when `rawMaterialImported` = Yes; columns `rawMaterialName` text, `rawMaterialPercentage` number 0–100, `countryName` multiselect from `countries`, joined with `", "` |
| `monthlyManufacturingCapacityUnits` | dropdown | yes | Metric Ton, Litre, Meter, Number |
| `monthlyManufacturingCapacityValue` | number | yes | max length 20 |
| `monthlyUtilizationUnits` | dropdown | yes | as above |
| `monthlyUtilizationValue` | number | yes | max length 20 |
| `outsourcedProcesses` | text | no | |
| `energySources` | checkboxes | yes | Electricity, Petrol, Diesel, Coal, Solar, Wood, Natural Gas, Other |

`assessor.basicInfo`: the same fields from `auditsConducted` on (no photos of the site or selfie), `numbered: true`;
the description photo column is labelled "Product Description Photo".

`consultant.basicInfo`: nine sections, one per group of the request (`occupationalSafety`, `measurementOfTimelyDelivery`,
`plannedMaintenanceCalibration`, `energyManagement`, `environmentManagement`, `humanResourceManagement`,
`measurementAnalysis`, `naturalResourcesManagement`, `financialPerformance`); every field required, keys are the
property paths (`occupationalSafety.numOfAccidents`, `energyManagement.electrical.unit`,
`energyManagement.electrical.totalConsumptionPercentage`, …, `financialPerformance.grossProfit`). Types follow the
legacy inputs: `number` for `isNumeric`, `decimal` for `allowDecimal` (energy % of total consumption, defects, rework,
customer rejections, complaints resolved, customer satisfaction), `text` for units and "Measures Taken". Labels and
sub-headings are those of `ZEDConsultant` `models/Models.kt`.
